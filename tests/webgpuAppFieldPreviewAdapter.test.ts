import { describe, expect, it, vi } from "vitest";
import {
  mapAppFieldSnapshotToTexturePreview,
  mountDevWebGpuAppFieldPreview,
  updateDevWebGpuAppFieldPreview,
} from "../src/engine/gpu/webgpuAppFieldPreviewAdapter";
import { baseState } from "../src/engine/presets";
import type { GlyphEmitterInstance, ProjectState } from "../src/types";

function emitter(
  id: string,
  overrides: Partial<GlyphEmitterInstance> = {},
): GlyphEmitterInstance {
  return {
    id,
    glyphId: null,
    enabled: true,
    weight: 1,
    phaseOffset: 0,
    radiusMultiplier: 1,
    label: id,
    ...overrides,
  };
}

function snapshot(project: ProjectState, extras: { singleAnchor?: { x: number; y: number } | null; resolvedEmitterAnchors?: Array<{ id: string; x: number; y: number }> } = {}) {
  return {
    project: {
      ...project,
      emitter: { ...project.emitter },
      emitters: project.emitters.map((row) => ({ ...row })),
    },
    bounds: { x: 0, y: 0, width: 1200, height: 720 },
    ...(extras.singleAnchor !== undefined ? { singleAnchor: extras.singleAnchor } : {}),
    ...(extras.resolvedEmitterAnchors ? { resolvedEmitterAnchors: extras.resolvedEmitterAnchors } : {}),
  };
}

describe("dev WebGPU app-field preview adapter", () => {
  it("maps deterministic single and multiple snapshots", () => {
    const single = mapAppFieldSnapshotToTexturePreview(
      snapshot(
        {
          ...baseState,
          emitterMode: "single",
          emitter: {
            ...baseState.emitter,
            enabled: true,
            amplitude: 2,
            frequency: 0.1,
            phase: 0.4,
            radius: 360,
          },
        },
        { singleAnchor: { x: 300, y: 180 } },
      ),
    );
    expect(single).toMatchObject({
      emitterMode: "single",
      activeEmitterCount: 1,
      usedResolvedAnchorCount: 1,
      fieldState: "active",
      fallbackAnchorCount: 0,
      field: {
        emitters: [
          {
            x: 0.25,
            y: 0.25,
            amplitude: 2,
            phase: 0.4,
            radius: 0.5,
          },
        ],
      },
    });

    const project = {
      ...baseState,
      emitter: { ...baseState.emitter, enabled: true },
      emitterMode: "multiple" as const,
      emitters: [
        emitter("a", { weight: 0.5, phaseOffset: 1 }),
        emitter("b", { weight: 0.75, radiusMultiplier: 0.5 }),
      ],
    };
    const snap = snapshot(project, {
      resolvedEmitterAnchors: [
        { id: "a", x: 120, y: 72 },
        { id: "b", x: 1080, y: 648 },
      ],
    });
    expect(mapAppFieldSnapshotToTexturePreview(snap)).toEqual(
      mapAppFieldSnapshotToTexturePreview(snap),
    );
    expect(
      mapAppFieldSnapshotToTexturePreview(snap).field.emitters,
    ).toMatchObject([
      { x: 0.1, y: 0.1, phase: 1, amplitude: 0.5 },
      { x: 0.9, y: 0.9, radius: expect.any(Number) },
    ]);
  });

  it("excludes disabled emitters and caps rows before activation", () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      emitter(`row-${index}`, { enabled: index !== 2 }),
    );
    const mapped = mapAppFieldSnapshotToTexturePreview(
      snapshot({
        ...baseState,
        emitter: { ...baseState.emitter, enabled: true },
        emitterMode: "multiple",
        emitters: rows,
      }),
    );

    expect(mapped.activeEmitterCount).toBe(7);
    expect(mapped.field.emitters).toHaveLength(7);
    expect(mapped.clippedEmitterCount).toBe(2);
    expect(mapped.enabledEmitterRowsCount).toBe(9);
    expect(mapped.disabledEmitterRowsCount).toBe(1);
    expect(mapped.ignoredEmitterRowsCount).toBe(0);
  });

  describe("single mode source-of-truth diagnostics", () => {
    it("reports neutral with 'shared emitter disabled' and ignored rows when shared emitter is off", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "single",
        emitter: { ...baseState.emitter, enabled: false },
        emitters: [
          emitter("a", { enabled: true }),
          emitter("b", { enabled: true }),
        ],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, { singleAnchor: { x: 300, y: 180 } }),
      );
      expect(mapped.activeEmitterCount).toBe(0);
      expect(mapped.fieldState).toBe("neutral");
      expect(mapped.neutralReason).toBe("shared emitter disabled");
      expect(mapped.singleModeSharedEmitterEnabled).toBe(false);
      // Rows look enabled but are ignored because single mode uses the shared
      // emitter, which is disabled.
      expect(mapped.ignoredEmitterRowsCount).toBe(2);
      expect(mapped.enabledEmitterRowsCount).toBe(2);
      expect(mapped.disabledEmitterRowsCount).toBe(0);
      expect(mapped.fallbackAnchorCount).toBe(0);
    });

    it("reports active and one mapped emitter when the shared emitter is enabled", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "single",
        emitter: { ...baseState.emitter, enabled: true },
        emitters: [emitter("a"), emitter("b")],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, { singleAnchor: { x: 300, y: 180 } }),
      );
      expect(mapped.activeEmitterCount).toBe(1);
      expect(mapped.fieldState).toBe("active");
      expect(mapped.singleModeSharedEmitterEnabled).toBe(true);
      expect(mapped.usedResolvedAnchorCount).toBe(1);
      expect(mapped.fallbackAnchorCount).toBe(0);
      // rows still ignored in single mode even though the shared emitter is on
      expect(mapped.ignoredEmitterRowsCount).toBe(2);
    });

    it("reports enabled zero-strength single mode as neutral and non-contributing", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "single",
        emitter: { ...baseState.emitter, enabled: true, amplitude: 0 },
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, { singleAnchor: { x: 300, y: 180 } }),
      );
      expect(mapped).toMatchObject({
        fieldState: "neutral",
        neutralReason: "shared emitter has zero strength",
        activeEmitterCount: 0,
        activeContributingEmitterCount: 0,
        zeroStrengthEmitterCount: 1,
        emitterStrengths: [{
          id: project.emitter.id,
          effectiveStrength: 0,
          contributing: false,
        }],
      });
      expect(mapped.field.emitters).toEqual([]);
      expect(mapped.usedResolvedAnchorCount).toBe(0);
    });

    it("reports approximate when the single-mode anchor is not resolved", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "single",
        emitter: { ...baseState.emitter, enabled: true, sourceMode: "center" },
        emitters: [emitter("a")],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, { singleAnchor: null }),
      );
      expect(mapped.activeEmitterCount).toBe(1);
      expect(mapped.fieldState).toBe("approximate");
      expect(mapped.fallbackAnchorCount).toBe(1);
      expect(mapped.approximateReason).toBeTruthy();
      expect(mapped.ignoredEmitterRowsCount).toBe(1);
    });
  });

  describe("multiple mode row-count diagnostics", () => {
    it("keeps enabled row counts while excluding zero-weight rows from active field sources", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true, amplitude: 1 },
        emitters: [
          emitter("a", { weight: 1 }),
          emitter("b", { weight: 0 }),
        ],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, {
          resolvedEmitterAnchors: [
            { id: "a", x: 120, y: 72 },
            { id: "b", x: 1080, y: 648 },
          ],
        }),
      );
      expect(mapped).toMatchObject({
        fieldState: "active",
        enabledEmitterRowsCount: 2,
        activeEmitterCount: 1,
        activeContributingEmitterCount: 1,
        zeroStrengthEmitterCount: 1,
      });
      expect(mapped.field.emitters).toHaveLength(1);
      expect(mapped.emitterStrengths).toEqual([
        { id: "a", effectiveStrength: 1, contributing: true },
        { id: "b", effectiveStrength: 0, contributing: false },
      ]);
    });

    it("reports all enabled zero-weight rows as neutral", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true, amplitude: 1 },
        emitters: [emitter("a", { weight: 0 }), emitter("b", { weight: 0 })],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(snapshot(project));
      expect(mapped).toMatchObject({
        fieldState: "neutral",
        neutralReason: "no contributing emitter rows",
        enabledEmitterRowsCount: 2,
        activeContributingEmitterCount: 0,
        zeroStrengthEmitterCount: 2,
      });
      expect(mapped.field.emitters).toEqual([]);
    });

    it("reports active row counts and resolved anchors for enabled rows", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true },
        emitters: [
          emitter("a", { weight: 1 }),
          emitter("b", { enabled: false, weight: 1 }),
          emitter("c", { weight: 1 }),
        ],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(
        snapshot(project, {
          resolvedEmitterAnchors: [
            { id: "a", x: 120, y: 72 },
            { id: "c", x: 1080, y: 648 },
          ],
        }),
      );
      expect(mapped.activeEmitterCount).toBe(2);
      expect(mapped.fieldState).toBe("active");
      expect(mapped.enabledEmitterRowsCount).toBe(2);
      expect(mapped.disabledEmitterRowsCount).toBe(1);
      expect(mapped.ignoredEmitterRowsCount).toBe(0);
      expect(mapped.usedResolvedAnchorCount).toBe(2);
      expect(mapped.fallbackAnchorCount).toBe(0);
    });

    it("reports neutral with 'no enabled emitter rows' when all rows are disabled", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true },
        emitters: [emitter("a", { enabled: false }), emitter("b", { enabled: false })],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(snapshot(project));
      expect(mapped.activeEmitterCount).toBe(0);
      expect(mapped.fieldState).toBe("neutral");
      expect(mapped.neutralReason).toBe("no enabled emitter rows");
      expect(mapped.enabledEmitterRowsCount).toBe(0);
      expect(mapped.disabledEmitterRowsCount).toBe(2);
      expect(mapped.ignoredEmitterRowsCount).toBe(0);
    });

    it("reports approximate when resolved anchors are missing for enabled rows", () => {
      const project: ProjectState = {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true, sourceMode: "center" },
        emitters: [emitter("a"), emitter("b")],
      };
      const mapped = mapAppFieldSnapshotToTexturePreview(snapshot(project));
      expect(mapped.activeEmitterCount).toBe(2);
      expect(mapped.fieldState).toBe("approximate");
      expect(mapped.fallbackAnchorCount).toBe(2);
      expect(mapped.usedResolvedAnchorCount).toBe(0);
      expect(mapped.approximateReason).toBeTruthy();
    });
  });

  it("falls back safely and supports update/dispose lifecycle", async () => {
    const remove = vi.fn();
    const putImageData = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      remove,
      getContext: (type: string) =>
        type === "2d"
          ? {
              createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
              }),
              putImageData,
            }
          : null,
    };
    const initialSnapshot = {
      project: {
        ...baseState,
        emitter: { ...baseState.emitter, enabled: true },
        emitterMode: "single" as const,
      },
    };
    const mounted = await mountDevWebGpuAppFieldPreview(
      canvas as unknown as HTMLCanvasElement,
      initialSnapshot,
      {
        size: 256,
        requestDevice: async () => ({
          status: "unavailable",
          reason: "gpu-unavailable",
        }),
      },
    );

    expect(mounted.status).toBe("cpu-fallback");
    if (mounted.status === "error") {
      throw new Error("Expected CPU fallback.");
    }
    expect(mounted.controller.backend).toBe("cpu-canvas");
    const updated = {
      project: {
        ...baseState,
        emitter: { ...baseState.emitter, enabled: true },
        emitterMode: "multiple" as const,
        emitters: [emitter("a"), emitter("b", { phaseOffset: 1.2 })],
      },
    };
    await updateDevWebGpuAppFieldPreview(mounted.controller, updated);
    expect(mounted.controller.getMapping().activeEmitterCount).toBe(2);
    expect(putImageData.mock.calls.length).toBeGreaterThanOrEqual(2);

    mounted.controller.dispose();
    mounted.controller.dispose();
    expect(remove).toHaveBeenCalledOnce();
    await expect(mounted.controller.update(initialSnapshot)).rejects.toThrow(
      "disposed",
    );
  });

  describe("mounted controller getMapping()", () => {
    function cpuCanvasStub() {
      const remove = vi.fn();
      const putImageData = vi.fn();
      return {
        canvas: {
          width: 0,
          height: 0,
          remove,
          getContext: (type: string) =>
            type === "2d"
              ? {
                  createImageData: (w: number, h: number) => ({
                    data: new Uint8ClampedArray(w * h * 4),
                  }),
                  putImageData,
                }
              : null,
        } as unknown as HTMLCanvasElement,
        putImageData,
      };
    }

    it("returns a defined current mapping immediately after mount with full diagnostic fields", async () => {
      const { canvas } = cpuCanvasStub();
      const snap = snapshot(
        {
          ...baseState,
          emitterMode: "single",
          emitter: { ...baseState.emitter, enabled: true },
        },
        { singleAnchor: { x: 300, y: 180 } },
      );
      const mounted = await mountDevWebGpuAppFieldPreview(canvas, snap, {
        size: 256,
        requestDevice: async () => ({ status: "unavailable", reason: "gpu-unavailable" }),
      });
      if (mounted.status === "error") throw new Error("Expected CPU fallback.");
      const mapping = mounted.controller.getMapping();
      expect(mapping).toBeDefined();
      expect(mapping.activeEmitterCount).toBe(1);
      expect(mapping.fieldState).toBe("active");
      expect(mapping.singleModeSharedEmitterEnabled).toBe(true);
      mounted.controller.dispose();
    });

    it("returns the latest mapping after update()", async () => {
      const { canvas } = cpuCanvasStub();
      const mounted = await mountDevWebGpuAppFieldPreview(
        canvas,
        snapshot(
          {
            ...baseState,
            emitterMode: "single",
            emitter: { ...baseState.emitter, enabled: true },
          },
          { singleAnchor: { x: 300, y: 180 } },
        ),
        {
          size: 256,
          requestDevice: async () => ({ status: "unavailable", reason: "gpu-unavailable" }),
        },
      );
      if (mounted.status === "error") throw new Error("Expected CPU fallback.");
      await mounted.controller.update(
        snapshot(
          {
            ...baseState,
            emitterMode: "multiple",
            emitter: { ...baseState.emitter, enabled: true },
            emitters: [
              emitter("a", { enabled: false }),
              emitter("b", { enabled: false }),
            ],
          },
        ),
      );
      const mapping = mounted.controller.getMapping();
      expect(mapping.emitterMode).toBe("multiple");
      expect(mapping.fieldState).toBe("neutral");
      expect(mapping.neutralReason).toBe("no enabled emitter rows");
      mounted.controller.dispose();
    });

    it("returns the latest mapping after a start() frame", async () => {
      const { canvas, putImageData } = cpuCanvasStub();
      const mounted = await mountDevWebGpuAppFieldPreview(
        canvas,
        snapshot(
          {
            ...baseState,
            emitterMode: "single",
            emitter: { ...baseState.emitter, enabled: true },
          },
          { singleAnchor: { x: 300, y: 180 } },
        ),
        {
          size: 256,
          requestDevice: async () => ({ status: "unavailable", reason: "gpu-unavailable" }),
        },
      );
      if (mounted.status === "error") throw new Error("Expected CPU fallback.");
      let current = mounted.controller.getMapping();
      expect(current.activeEmitterCount).toBe(1);
      mounted.controller.start(() =>
        snapshot(
          {
            ...baseState,
            emitterMode: "multiple",
            emitter: { ...baseState.emitter, enabled: true },
            emitters: [emitter("a", { weight: 0.5 }), emitter("b", { weight: 0.8 })],
          },
          {
            resolvedEmitterAnchors: [
              { id: "a", x: 120, y: 72 },
              { id: "b", x: 1080, y: 648 },
            ],
          },
        ),
      );
      // Wait a couple of rAF ticks for the CPU-canvas backend to render.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      current = mounted.controller.getMapping();
      expect(current.emitterMode).toBe("multiple");
      expect(current.activeEmitterCount).toBe(2);
      expect(current.fieldState).toBe("active");
      expect(putImageData).toHaveBeenCalled();
      mounted.controller.stop();
      mounted.controller.dispose();
    });
  });
});
