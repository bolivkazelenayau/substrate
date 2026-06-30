import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DevWebGpuAppFieldPreviewController,
  DevWebGpuAppFieldSnapshot,
  DevWebGpuMappedField,
} from "../src/engine/gpu/webgpuAppFieldPreviewAdapter";
import type { TexturePreviewFrameTiming } from "../src/engine/gpu/webgpuTexturePreview";
import { baseState } from "../src/engine/presets";
import { WebGpuFieldOverlay } from "../src/components/dev/WebGpuFieldOverlay";
import type { WebGpuFieldOverlayProps } from "../src/components/dev/WebGpuFieldOverlay";

const { mountMockFn } = vi.hoisted(() => ({ mountMockFn: vi.fn() }));

vi.mock("../src/engine/gpu/webgpuAppFieldPreviewAdapter", async () => {
  const actual = await vi.importActual<
    typeof import("../src/engine/gpu/webgpuAppFieldPreviewAdapter")
  >("../src/engine/gpu/webgpuAppFieldPreviewAdapter");
  return {
    ...actual,
    mountDevWebGpuAppFieldPreview: mountMockFn,
  };
});

type MountResult =
  | {
      status: "ready";
      controller: DevWebGpuAppFieldPreviewController;
      preview: { status: "ready" };
    }
  | {
      status: "cpu-fallback";
      controller: DevWebGpuAppFieldPreviewController;
      preview: { status: "cpu-fallback"; reason?: string };
    }
  | { status: "error"; preview: { status: "error" } };

interface MockControllerOptions {
  mapping: DevWebGpuMappedField;
  backend?: DevWebGpuAppFieldPreviewController["backend"];
  /**
   * Optional hook invoked from `update()` with the snapshot the overlay's
   * start-loop passed in. Tests use this to simulate a real controller whose
   * `getMapping()` reflects the latest snapshot (e.g. by swapping the mapping
   * object when the snapshot identity changes).
   */
  onUpdate?: (snapshot: DevWebGpuAppFieldSnapshot) => void;
}

function mockTexturePreviewFrameTiming(): TexturePreviewFrameTiming {
  return {
    frameEnqueueMs: 0.1,
    queueCompletionMs: null,
    synchronized: false,
    cpuFallbackMs: null,
  };
}

function createMockController(options: MockControllerOptions): {
  controller: DevWebGpuAppFieldPreviewController;
  startSpy: ReturnType<typeof vi.fn>;
  stopSpy: ReturnType<typeof vi.fn>;
  disposeSpy: ReturnType<typeof vi.fn>;
  onDeviceLostSpy: ReturnType<typeof vi.fn>;
  updateSpy: ReturnType<typeof vi.fn>;
  setMapping: (next: DevWebGpuMappedField) => void;
} {
  let mapping = options.mapping;
  const startSpy = vi.fn();
  const stopSpy = vi.fn();
  const disposeSpy = vi.fn();
  const onDeviceLostSpy = vi.fn(() => () => undefined);
  const updateSpy = vi.fn(async (snapshot: DevWebGpuAppFieldSnapshot) => {
    options.onUpdate?.(snapshot);
    return mockTexturePreviewFrameTiming();
  });
  const controller: DevWebGpuAppFieldPreviewController = {
    backend: options.backend ?? "webgpu-texture",
    update: updateSpy,
    start: startSpy,
    stop: stopSpy,
    getMapping: () => mapping,
    onDeviceLost: onDeviceLostSpy,
    dispose: disposeSpy,
  };
  return {
    controller,
    startSpy,
    stopSpy,
    disposeSpy,
    onDeviceLostSpy,
    updateSpy,
    setMapping: (next) => {
      mapping = next;
    },
  };
}

function activeMapping(): DevWebGpuMappedField {
  return {
    field: { emitters: [] },
    emitterMode: "single",
    activeEmitterCount: 1,
    clippedEmitterCount: 0,
    usedResolvedAnchorCount: 1,
    bounds: { x: 0, y: 0, width: 1200, height: 720 },
    fieldState: "active",
    singleModeSharedEmitterEnabled: true,
    ignoredEmitterRowsCount: 1,
    enabledEmitterRowsCount: 1,
    disabledEmitterRowsCount: 0,
    fallbackAnchorCount: 0,
    zeroStrengthEmitterCount: 0,
    activeContributingEmitterCount: 1,
    emitterStrengths: [{ id: "emitter-1", effectiveStrength: 1, contributing: true }],
  };
}

function neutralMapping(): DevWebGpuMappedField {
  return {
    field: { emitters: [] },
    emitterMode: "single",
    activeEmitterCount: 0,
    clippedEmitterCount: 0,
    usedResolvedAnchorCount: 0,
    bounds: { x: 0, y: 0, width: 1200, height: 720 },
    fieldState: "neutral",
    neutralReason: "shared emitter disabled",
    singleModeSharedEmitterEnabled: false,
    ignoredEmitterRowsCount: 1,
    enabledEmitterRowsCount: 1,
    disabledEmitterRowsCount: 0,
    fallbackAnchorCount: 0,
    zeroStrengthEmitterCount: 0,
    activeContributingEmitterCount: 0,
    emitterStrengths: [],
  };
}

function approximateMapping(): DevWebGpuMappedField {
  return {
    field: { emitters: [] },
    emitterMode: "multiple",
    activeEmitterCount: 2,
    clippedEmitterCount: 0,
    usedResolvedAnchorCount: 0,
    bounds: { x: 0, y: 0, width: 1200, height: 720 },
    fieldState: "approximate",
    approximateReason: "0 of 2 active emitter(s) had resolved glyph anchors; 2 used fallback.",
    singleModeSharedEmitterEnabled: true,
    ignoredEmitterRowsCount: 0,
    enabledEmitterRowsCount: 2,
    disabledEmitterRowsCount: 0,
    fallbackAnchorCount: 2,
    zeroStrengthEmitterCount: 0,
    activeContributingEmitterCount: 2,
    emitterStrengths: [
      { id: "a", effectiveStrength: 1, contributing: true },
      { id: "b", effectiveStrength: 1, contributing: true },
    ],
  };
}

const getSnapshot = (): DevWebGpuAppFieldSnapshot => ({
  project: {
    ...baseState,
    emitter: { ...baseState.emitter, enabled: true },
    emitters: [],
  },
  bounds: { x: 0, y: 0, width: 1200, height: 720 },
});

describe("WebGpuFieldOverlay dev lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let lastController: {
    controller: DevWebGpuAppFieldPreviewController;
    startSpy: ReturnType<typeof vi.fn>;
    stopSpy: ReturnType<typeof vi.fn>;
    disposeSpy: ReturnType<typeof vi.fn>;
    onDeviceLostSpy: ReturnType<typeof vi.fn>;
    updateSpy: ReturnType<typeof vi.fn>;
    setMapping: (next: DevWebGpuMappedField) => void;
  } | null;
  let createdCanvases: HTMLCanvasElement[];

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    lastController = null;
    createdCanvases = [];
    mountMockFn.mockReset();
    mountMockFn.mockImplementation(async (_canvas: HTMLCanvasElement) => {
      createdCanvases.push(_canvas);
      lastController = createMockController({ mapping: activeMapping() });
      return {
        status: "ready",
        controller: lastController.controller,
        preview: { status: "ready" },
      } as MountResult;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const renderOverlay = async (overrides: Partial<WebGpuFieldOverlayProps> = {}) => {
    await act(async () => {
      root.render(
        createElement(WebGpuFieldOverlay, {
          getSnapshot,
          onClose: () => undefined,
          size: 256,
          ...overrides,
        } as WebGpuFieldOverlayProps),
      );
    });
    // Flush the async mount + at least one legend rAF poll (jsdom rAF fires on
    // a macrotask timer).
    await act(async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
  };

  const overlayRoot = () =>
    container.querySelector("[data-dev-web-gpu-overlay='true']") as HTMLElement | null;

  it("mounts the controller on open and disposes on unmount", async () => {
    await renderOverlay();
    expect(mountMockFn).toHaveBeenCalledTimes(1);
    expect(lastController).not.toBeNull();
    expect(lastController!.startSpy).toHaveBeenCalledTimes(1);
    expect(lastController!.disposeSpy).toHaveBeenCalledTimes(0);

    act(() => root.render(createElement("div")));
    expect(lastController!.disposeSpy).toHaveBeenCalledTimes(1);
    expect(lastController!.stopSpy).toHaveBeenCalled();
  });

  it("removes the canvas on dispose (no leftover canvases/loops)", async () => {
    await renderOverlay();
    expect(createdCanvases.length).toBeGreaterThanOrEqual(1);
    act(() => root.render(createElement("div")));
    for (const canvas of createdCanvases) {
      expect(canvas.isConnected).toBe(false);
    }
  });

  it("does not duplicate controllers/canvases on repeated toggles", async () => {
    await renderOverlay();
    expect(mountMockFn).toHaveBeenCalledTimes(1);
    expect(createdCanvases.length).toBe(1);
    act(() => root.render(createElement("div")));
    expect(lastController!.disposeSpy).toHaveBeenCalledTimes(1);

    await renderOverlay();
    expect(mountMockFn).toHaveBeenCalledTimes(2);
    expect(createdCanvases.length).toBe(2);
    expect(createdCanvases[0].isConnected).toBe(false);
    expect(createdCanvases[1].isConnected).toBe(true);
  });

  it("renders the dev labels GPU FIELD DEBUG and NOT EXPORT", async () => {
    await renderOverlay();
    const el = overlayRoot();
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("GPU FIELD DEBUG");
    expect(el!.textContent).toContain("NOT EXPORT");
  });

  it("renders the active legend from getMapping() without readback", async () => {
    await renderOverlay();
    const el = overlayRoot()!;
    expect(el.textContent).toContain("fieldState");
    expect(el.textContent).toContain("active");
    expect(el.textContent).toContain("shared emitter");
    expect(el.textContent).not.toContain("neutral:");
  });

  it("renders the neutral reason in the legend", async () => {
    mountMockFn.mockImplementationOnce(async (_canvas: HTMLCanvasElement) => {
      createdCanvases.push(_canvas);
      lastController = createMockController({
        mapping: neutralMapping(),
        backend: "cpu-canvas",
      });
      return {
        status: "cpu-fallback",
        controller: lastController.controller,
        preview: { status: "cpu-fallback", reason: undefined },
      } as MountResult;
    });
    await renderOverlay();
    const el = overlayRoot()!;
    expect(el.textContent).toContain("neutral: shared emitter disabled");
    expect(el.textContent).toContain("backend: cpu-canvas");
  });

  it("renders zero-strength emitters as neutral and non-contributing", async () => {
    mountMockFn.mockImplementationOnce(async (_canvas: HTMLCanvasElement) => {
      createdCanvases.push(_canvas);
      lastController = createMockController({
        mapping: {
          ...neutralMapping(),
          neutralReason: "shared emitter has zero strength",
          singleModeSharedEmitterEnabled: true,
          zeroStrengthEmitterCount: 1,
          emitterStrengths: [{
            id: "emitter-1",
            effectiveStrength: 0,
            contributing: false,
          }],
        },
      });
      return {
        status: "ready",
        controller: lastController.controller,
        preview: { status: "ready" },
      } as MountResult;
    });
    await renderOverlay();
    const text = overlayRoot()!.textContent ?? "";
    expect(text).toContain("neutral: shared emitter has zero strength");
    expect(text).toContain("contributing");
    expect(text).toContain("zero strength");
    expect(text).toContain("effective strength: emitter-1=0");
  });

  it("labels unavailable renderer clipping diagnostics as n/a", async () => {
    await renderOverlay({
      rendererComparison: {
        activeFieldEmitterCount: undefined,
        consumedFieldMode: undefined,
        cacheEmitterKey: undefined,
        renderedMarkCountPerEmitter: undefined,
        normalizationMode: undefined,
        emitterDomains: undefined,
        artboardBoundsClipped: undefined,
        maxNodesClipped: undefined,
        activeContributingEmitterCount: undefined,
        zeroStrengthEmitterCount: undefined,
      },
    });
    const text = overlayRoot()!.textContent ?? "";
    expect(text).toContain("artboard clipped: n/a");
    expect(text).toContain("marks cap: n/a");
  });

  it("renders the approximate reason in the legend", async () => {
    mountMockFn.mockImplementationOnce(async (_canvas: HTMLCanvasElement) => {
      createdCanvases.push(_canvas);
      lastController = createMockController({ mapping: approximateMapping() });
      return {
        status: "ready",
        controller: lastController.controller,
        preview: { status: "ready" },
      } as MountResult;
    });
    await renderOverlay();
    const el = overlayRoot()!;
    expect(el.textContent).toContain("approximate:");
    expect(el.textContent).toContain("fallback anchors");
  });

  it("surfaces the CPU-fallback state", async () => {
    mountMockFn.mockImplementationOnce(async (_canvas: HTMLCanvasElement) => {
      createdCanvases.push(_canvas);
      lastController = createMockController({
        mapping: activeMapping(),
        backend: "cpu-canvas",
      });
      return {
        status: "cpu-fallback",
        controller: lastController.controller,
        preview: { status: "cpu-fallback", reason: "canvas-webgpu-context-unavailable" },
      } as MountResult;
    });
    await renderOverlay();
    const el = overlayRoot()!;
    expect(el.textContent).toContain("backend: cpu-canvas (fallback)");
    expect(el.textContent).toContain("fallback reason: canvas-webgpu-context-unavailable");
  });

  it("surfaces a mount error without crashing the app", async () => {
    mountMockFn.mockImplementationOnce(async () => ({ status: "error", preview: { status: "error" } } as MountResult));
    await renderOverlay();
    const el = overlayRoot()!;
    expect(el.textContent).toContain("mount error: WebGPU preview mount failed.");
  });

  it("calls onClose when the close button is pressed", async () => {
    const onClose = vi.fn();
    await renderOverlay({ onClose });
    const closeBtn = overlayRoot()!.querySelector(
      "button[aria-label='Close WebGPU field debug overlay']",
    ) as HTMLButtonElement;
    expect(closeBtn).toBeTruthy();
    act(() => closeBtn.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces device-lost via onDeviceLost subscription", async () => {
    await renderOverlay();
    expect(lastController!.onDeviceLostSpy).toHaveBeenCalledTimes(1);
    const listener = lastController!.onDeviceLostSpy.mock.calls[0][0] as (details: {
      reason?: string;
      message?: string;
    }) => void;
    act(() => listener({ message: "device destroyed" }));
    const el = overlayRoot()!;
    expect(el.textContent).toContain("device lost: device destroyed");
  });

  describe("live updates without remount (Gate 7.1 regression)", () => {
    /**
     * Simulates a real controller `start()` rAF loop by capturing the getter
     * the overlay passes to `start()`, then letting the test drive one frame:
     * `update(getter())` → `setMapping(real mapping for that snapshot)`. This
     * mirrors how the real adapter controller updates its cached mapping each
     * frame and lets `getMapping()` reflect the latest snapshot.
     */
    function captureStartLoopGetter(): {
      tick: () => Promise<void>;
    } {
      const getterHolder: { current: (() => DevWebGpuAppFieldSnapshot) | null } = {
        current: null,
      };
      mountMockFn.mockImplementationOnce(async (_canvas: HTMLCanvasElement) => {
        createdCanvases.push(_canvas);
        const adapter = await vi.importActual<
          typeof import("../src/engine/gpu/webgpuAppFieldPreviewAdapter")
        >("../src/engine/gpu/webgpuAppFieldPreviewAdapter");
        lastController = createMockController({
          mapping: adapter.mapAppFieldSnapshotToTexturePreview(getSnapshotA()),
          onUpdate: (snapshot) => {
            lastController!.setMapping(
              adapter.mapAppFieldSnapshotToTexturePreview(snapshot),
            );
          },
        });
        // Capture the getter the overlay passes to start(); later ticks call
        // update(getter()) so the ref-based live path is exercised.
        lastController!.startSpy.mockImplementation(
          (getSnapshot: () => DevWebGpuAppFieldSnapshot) => {
            getterHolder.current = getSnapshot;
          },
        );
        return {
          status: "ready",
          controller: lastController.controller,
          preview: { status: "ready" },
        } as MountResult;
      });
      return {
        tick: async () => {
          const getter = getterHolder.current;
          if (!getter) return;
          await lastController!.controller.update(getter());
        },
      };
    }

    const getSnapshotA = (): DevWebGpuAppFieldSnapshot => ({
      project: {
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
        emitters: [],
      },
      bounds: { x: 0, y: 0, width: 1200, height: 720 },
      singleAnchor: { x: 300, y: 180 },
    });

    const getSnapshotB = (): DevWebGpuAppFieldSnapshot => ({
      project: {
        ...baseState,
        emitterMode: "multiple",
        emitter: { ...baseState.emitter, enabled: true },
        emitters: [
          { id: "a", glyphId: null, enabled: false, weight: 1, phaseOffset: 0, radiusMultiplier: 1, label: "a" },
        ],
      },
      bounds: { x: 0, y: 0, width: 1200, height: 720 },
    });

    it("updates legend to state B without remount when the snapshot source changes while mounted", async () => {
      const loop = captureStartLoopGetter();
      // Render with snapshot A.
      await renderOverlay({ getSnapshot: getSnapshotA });
      expect(mountMockFn).toHaveBeenCalledTimes(1);
      const elAfterA = overlayRoot()!;
      // Initial legend reflects snapshot A (single, active, 1 emitter).
      expect(elAfterA.textContent).toContain("active");

      // Simulate one controller frame for A (ensures start-loop getter wired).
      await act(async () => { await loop.tick(); });

      // Now change the snapshot source to B (multiple, no enabled rows → neutral)
      // WITHOUT remounting: re-render the overlay with a new getSnapshot prop.
      await act(async () => {
        root.render(
          createElement(WebGpuFieldOverlay, {
            getSnapshot: getSnapshotB,
            onClose: () => undefined,
            size: 256,
          } as WebGpuFieldOverlayProps),
        );
      });

      // The controller must NOT be recreated for an ordinary parameter change.
      expect(mountMockFn).toHaveBeenCalledTimes(1);
      expect(createdCanvases.length).toBe(1);

      // Drive one controller frame; the start-loop getter now reads through the
      // updated ref and returns snapshot B → update() → mapping becomes neutral.
      await act(async () => { await loop.tick(); });
      // Flush the legend poll rAF.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const elAfterB = overlayRoot()!;
      expect(elAfterB.textContent).toContain("neutral");
      expect(elAfterB.textContent).toContain("no enabled emitter rows");
      // Controller still alive, not disposed.
      expect(lastController!.disposeSpy).toHaveBeenCalledTimes(0);
    });

    it("calls controller.update with the latest snapshot each frame (live update path)", async () => {
      const loop = captureStartLoopGetter();
      await renderOverlay({ getSnapshot: getSnapshotA });
      expect(lastController!.updateSpy).toHaveBeenCalledTimes(0);
      await act(async () => { await loop.tick(); });
      expect(lastController!.updateSpy).toHaveBeenCalledTimes(1);
      const firstSnapshot = lastController!.updateSpy.mock.calls[0][0] as DevWebGpuAppFieldSnapshot;
      expect(firstSnapshot.project.emitterMode).toBe("single");

      // Switch to B and tick again.
      await act(async () => {
        root.render(
          createElement(WebGpuFieldOverlay, {
            getSnapshot: getSnapshotB,
            onClose: () => undefined,
            size: 256,
          } as WebGpuFieldOverlayProps),
        );
      });
      await act(async () => { await loop.tick(); });
      expect(lastController!.updateSpy).toHaveBeenCalledTimes(2);
      const secondSnapshot = lastController!.updateSpy.mock.calls[1][0] as DevWebGpuAppFieldSnapshot;
      expect(secondSnapshot.project.emitterMode).toBe("multiple");
    });

    it("getMapping() changes after a simulated state change (no duplicate canvases/loops)", async () => {
      const loop = captureStartLoopGetter();
      await renderOverlay({ getSnapshot: getSnapshotA });
      const mappingA = lastController!.controller.getMapping();
      expect(mappingA.fieldState).toBe("active");
      await act(async () => { await loop.tick(); });

      await act(async () => {
        root.render(
          createElement(WebGpuFieldOverlay, {
            getSnapshot: getSnapshotB,
            onClose: () => undefined,
            size: 256,
          } as WebGpuFieldOverlayProps),
        );
      });
      await act(async () => { await loop.tick(); });
      const mappingB = lastController!.controller.getMapping();
      expect(mappingB.fieldState).toBe("neutral");
      expect(mappingB).not.toBe(mappingA);

      // No new canvas/controller created for the parameter change.
      expect(mountMockFn).toHaveBeenCalledTimes(1);
      expect(createdCanvases.length).toBe(1);
    });
  });
});
