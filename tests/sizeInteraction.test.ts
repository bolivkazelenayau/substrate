import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSizeDraftSceneLayout } from "../src/engine/sizeDraftScene";
import {
  SIZE_DRAFT_PREVIEW_ELEMENT_CAP,
  buildSizeDraftPresentationGeometry,
} from "../src/engine/sizeDraftPreview";
import { sizeDraftPolicy } from "../src/engine/sizeRendererDraftPolicy";
import { resolveSizeSceneTransform } from "../src/engine/sizeSceneTransform";
import type { GeometryGroup } from "../src/engine/geometry";
import { baseState } from "../src/engine/presets";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { useSizeInteraction } from "../src/hooks/useSizeInteraction";

const exactGeometry: GeometryGroup = {
  id: "geometry:exact",
  geometries: [
    { type: "circle", center: { x: 600, y: 360 }, radius: 12, opacity: 1 },
    { type: "line", start: { x: 100, y: 100 }, end: { x: 200, y: 200 }, opacity: 1 },
  ],
  diagnostics: { fallback: false, acceptedCandidates: 2, rejectedCandidates: 0, averageSampledDistance: 0, substrateAvailable: true, maxNodesClipped: false },
};

describe("size renderer draft policy", () => {
  it("classifies lightweight renderers as renderer-aware and dense renderers as retained-transform", () => {
    expect(sizeDraftPolicy("flow")).toBe("renderer-aware");
    expect(sizeDraftPolicy("ripple")).toBe("renderer-aware");
    expect(sizeDraftPolicy("dots")).toBe("renderer-aware");
    expect(sizeDraftPolicy("sdf-halftone")).toBe("retained-transform");
    expect(sizeDraftPolicy("glyph-diffuser")).toBe("retained-transform");
  });
});

describe("size scene transform", () => {
  it("round-trips 148 to 540 and back without drift", () => {
    const source148 = resolveSceneLayout({ ...baseState, fontSize: 148 }, null);
    const target540 = resolveSceneLayout({ ...baseState, fontSize: 540 }, null);
    const back148 = resolveSceneLayout({ ...baseState, fontSize: 148 }, null);
    const up = resolveSizeSceneTransform(source148, 148, target540, 540);
    const down = resolveSizeSceneTransform(target540, 540, back148, 148);
    expect(up.scale).toBeCloseTo(540 / 148, 5);
    expect(down.scale).toBeCloseTo(148 / 540, 5);
    expect(up.scale * down.scale).toBeCloseTo(1, 5);
    const point = { x: source148.authoredArtboard.width / 2, y: source148.authoredArtboard.height / 2 };
    const scaled = buildSizeDraftPresentationGeometry(
      exactGeometry,
      source148,
      148,
      target540,
      540,
    );
    const restored = buildSizeDraftPresentationGeometry(scaled, target540, 540, back148, 148);
    if (restored.geometries[0]?.type === "circle" && exactGeometry.geometries[0]?.type === "circle") {
      expect(restored.geometries[0].center.x).toBeCloseTo(exactGeometry.geometries[0].center.x, 1);
      expect(restored.geometries[0].center.y).toBeCloseTo(exactGeometry.geometries[0].center.y, 1);
    }
    expect(point.x).toBe(source148.authoredArtboard.width / 2);
  });

  it("uses draft resolveSceneLayout for equivalent placement at the same Size", () => {
    const committed = resolveSceneLayout({ ...baseState, fontSize: 220 }, null);
    const draft = resolveSizeDraftSceneLayout({ ...baseState, fontSize: 220 }, 220, null);
    expect(draft.typography.resolvedOrigin).toEqual(committed.typography.resolvedOrigin);
    expect(draft.effectiveArtboard).toEqual(committed.effectiveArtboard);
  });
});

describe("sizeDraftPreview", () => {
  it("caps retained geometry element count", () => {
    const dense: GeometryGroup = {
      ...exactGeometry,
      geometries: Array.from({ length: SIZE_DRAFT_PREVIEW_ELEMENT_CAP + 25 }, (_, index) => ({
        type: "circle" as const,
        center: { x: 600 + index, y: 360 },
        radius: 4,
        opacity: 1,
      })),
    };
    const source = resolveSceneLayout(baseState, null);
    const target = resolveSceneLayout({ ...baseState, fontSize: 300 }, null);
    const draft = buildSizeDraftPresentationGeometry(dense, source, baseState.fontSize, target, 300);
    expect(draft.geometries).toHaveLength(SIZE_DRAFT_PREVIEW_ELEMENT_CAP);
  });
});

describe("useSizeInteraction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("coalesces drag input to one draft frame and commits once on release", async () => {
    const commits: number[] = [];
    let latest: ReturnType<typeof useSizeInteraction> | null = null;

    function Harness({ committedFontSize }: { committedFontSize: number }) {
      const interaction = useSizeInteraction(committedFontSize, "ripple", (fontSize) => commits.push(fontSize));
      latest = interaction;
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness, { committedFontSize: 148 }));
    });

    act(() => {
      latest!.handlers.onPointerDown(148, 1, document.createElement("input"));
      latest!.handlers.onInput(180, "input");
      latest!.handlers.onInput(220, "input");
      latest!.handlers.onInput(260, "input");
      latest!.handlers.onPointerUp(260, 1);
    });

    expect(commits).toEqual([260]);
    expect(latest!.state.phase).toBe("settling");
    if (latest!.state.phase === "settling") {
      expect(latest!.state.committedSize).toBe(260);
    }

    await act(async () => {
      root.render(createElement(Harness, { committedFontSize: 260 }));
    });

    act(() => {
      latest!.completeSettlement();
    });
    expect(latest!.state.phase).toBe("idle");
  });

  it("ignores duplicate finish calls for the same gesture", () => {
    const commits: number[] = [];
    let latest: ReturnType<typeof useSizeInteraction> | null = null;

    function Harness() {
      latest = useSizeInteraction(148, "ripple", (fontSize) => commits.push(fontSize));
      return null;
    }

    act(() => root.render(createElement(Harness)));
    act(() => {
      latest!.handlers.onPointerDown(148, 1, document.createElement("input"));
      latest!.handlers.onInput(300, "input");
      latest!.handlers.onPointerUp(300, 1);
      latest!.handlers.onPointerUp(300, 1);
      latest!.handlers.onBlur(300);
    });
    expect(commits).toEqual([300]);
  });

  it("lets the newest gesture supersede settling", () => {
    const commits: number[] = [];
    let latest: ReturnType<typeof useSizeInteraction> | null = null;

    function Harness({ committedFontSize }: { committedFontSize: number }) {
      latest = useSizeInteraction(committedFontSize, "ripple", (fontSize) => commits.push(fontSize));
      return null;
    }

    act(() => root.render(createElement(Harness, { committedFontSize: 148 })));
    act(() => {
      latest!.handlers.onPointerDown(148, 1, document.createElement("input"));
      latest!.handlers.onInput(300, "input");
      latest!.handlers.onPointerUp(300, 1);
    });
    act(() => root.render(createElement(Harness, { committedFontSize: 300 })));
    act(() => {
      latest!.handlers.onPointerDown(300, 2, document.createElement("input"));
      latest!.handlers.onInput(340, "input");
      latest!.handlers.onPointerUp(340, 2);
    });
    expect(commits).toEqual([300, 340]);
    if (latest!.state.phase === "settling") {
      expect(latest!.state.committedSize).toBe(340);
    }
  });

  it("auto-settles when the committed size catches up", async () => {
    const commits: number[] = [];
    let latest: ReturnType<typeof useSizeInteraction> | null = null;

    function Harness({ committedFontSize }: { committedFontSize: number }) {
      const interaction = useSizeInteraction(committedFontSize, "ripple", (fontSize) => commits.push(fontSize));
      const { completeSettlement, state } = interaction;
      latest = interaction;
      useEffect(() => {
        if (state.phase === "settling" && state.committedSize === committedFontSize) {
          completeSettlement();
        }
      }, [committedFontSize, completeSettlement, state]);
      return null;
    }

    act(() => root.render(createElement(Harness, { committedFontSize: 148 })));
    act(() => {
      latest!.handlers.onPointerDown(148, 1, document.createElement("input"));
      latest!.handlers.onInput(220, "input");
      latest!.handlers.onPointerUp(220, 1);
    });
    await act(async () => {
      root.render(createElement(Harness, { committedFontSize: 220 }));
    });
    expect(latest!.state.phase).toBe("idle");
    expect(commits).toEqual([220]);
  });

  it("keeps live draft tracking after a double-click reset", async () => {
    const commits: number[] = [];
    let latest: ReturnType<typeof useSizeInteraction> | null = null;

    function Harness({ committedFontSize }: { committedFontSize: number }) {
      const interaction = useSizeInteraction(committedFontSize, "ripple", (fontSize) => commits.push(fontSize));
      latest = interaction;
      return null;
    }

    await act(async () => {
      root.render(createElement(Harness, { committedFontSize: 200 }));
    });

    act(() => {
      const el = document.createElement("input");
      latest!.handlers.onPointerDown(200, 1, el);
      latest!.handlers.onPointerUp(200, 1);
      latest!.handlers.onPointerDown(200, 2, el);
      latest!.handlers.onPointerUp(200, 2);
      latest!.handlers.onDoubleClickReset(200, 148);
    });
    expect(commits).toEqual([148]);

    await act(async () => {
      root.render(createElement(Harness, { committedFontSize: 148 }));
    });
    act(() => latest!.completeSettlement());

    act(() => {
      const el = document.createElement("input");
      latest!.handlers.onPointerDown(148, 3, el);
      latest!.handlers.onInput(180, "input");
      latest!.handlers.onInput(220, "input");
      latest!.handlers.onPointerUp(220, 3);
    });
    // Live draft + single commit after reset (no mid-drag exact rebuild thrash).
    expect(commits).toEqual([148, 220]);
    expect(latest!.state.phase).toBe("settling");
  });
});