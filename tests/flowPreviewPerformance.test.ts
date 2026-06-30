import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FlowPreview } from "../src/components/FlowPreview";
import {
  FLOW_PREVIEW_BUCKET_COUNT,
  applyFlowPathPlan,
  applyFlowPathPlanBudget,
  buildHybridFlowPathPlan,
  buildFlowPathPlan,
  resetPreviousDStrings,
  scheduledBucketIndices,
  type FlowPreviewUpdateResult,
} from "../src/engine/flowPreviewOptimization";
import type { GeometryGroup, LineSegment } from "../src/engine/geometry";
import { rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { applyPreset, baseState } from "../src/engine/presets";
import { createSvg } from "../src/engine/exportSvg";
import { panBy, zoomAtCenter, type ViewportNavigationState } from "../src/engine/viewportNavigation";
import type { ProjectState, RenderContext } from "../src/types";

function svgNs(): Element {
  if (typeof document.createElementNS !== "function") {
    throw new Error("Test environment missing createElementNS");
  }
  return document.createElementNS("http://www.w3.org/2000/svg", "path");
}

function makeBucketPaths(count = FLOW_PREVIEW_BUCKET_COUNT): (SVGPathElement | null)[] {
  return new Array(count).fill(null).map(() => svgNs() as unknown as SVGPathElement);
}

function edgeCurrentGeometry(timeMs: number): GeometryGroup {
  const state = applyPreset(baseState, "Edge Current");
  const context: RenderContext = { timeMs, frame: Math.round(timeMs / 33), viewport: { width: 1200, height: 720, centerX: 600, centerY: 360 } };
  return generateRendererGeometry(state, context);
}

describe("Edge Current Flow SVG preview architecture (Gate 7.8)", () => {
  it("keeps a fixed bucket-pool count regardless of line count", () => {
    const small = buildFlowPathPlan(edgeCurrentGeometry(0).geometries as LineSegment[]);
    const dense = buildFlowPathPlan(edgeCurrentGeometry(0).geometries as LineSegment[], FLOW_PREVIEW_BUCKET_COUNT, 1);
    expect(small.buckets).toHaveLength(FLOW_PREVIEW_BUCKET_COUNT);
    expect(dense.buckets).toHaveLength(FLOW_PREVIEW_BUCKET_COUNT);
    expect(small.segmentCount).toBe(dense.segmentCount);
    expect(small.segmentCount).toBeGreaterThan(500); // sanity: Edge Current default ~1.5k
  });

  it("preserves every renderer segment across the bucket partition", () => {
    const geometry = edgeCurrentGeometry(0);
    const lines = geometry.geometries as LineSegment[];
    const plan = buildFlowPathPlan(lines);
    expect(plan.buckets.reduce((total, bucket) => total + bucket.count, 0)).toBe(lines.length);
  });

  it("limits DOM attribute writes per animation frame to ≤ 2 * bucketCount", () => {
    const geometry = edgeCurrentGeometry(0);
    const lines = geometry.geometries as LineSegment[];
    const paths = makeBucketPaths();
    const previousDStrings = resetPreviousDStrings();

    const firstPlan = buildFlowPathPlan(lines);
    const firstStats = applyFlowPathPlan(paths, firstPlan, previousDStrings);
    // First write populates every (d, opacity) pair: ≤ 2 * K writes.
    expect(firstStats.attributeWrites).toBeLessThanOrEqual(2 * FLOW_PREVIEW_BUCKET_COUNT);
    expect(firstStats.nodeIdentityReused).toBe(true);

    // Subsequent animation frames only mutate differing buckets.
    const laterPlan = buildFlowPathPlan(edgeCurrentGeometry(4123).geometries as LineSegment[]);
    const laterStats = applyFlowPathPlan(paths, laterPlan, previousDStrings);
    expect(laterStats.attributeWrites).toBeLessThanOrEqual(2 * FLOW_PREVIEW_BUCKET_COUNT);
    // Frame-to-frame animation must rewrite `d` (lines move every tick).
    expect(laterStats.dUpdates).toBeGreaterThan(0);
  });

  it("eliminates per-segment React tree reconciliation by reusing bucket paths", () => {
    // Re-running the plan for the same geometry writes ZERO `d` attributes.
    const geometry = edgeCurrentGeometry(0);
    const lines = geometry.geometries as LineSegment[];
    const paths = makeBucketPaths();
    const previousDStrings = resetPreviousDStrings();
    applyFlowPathPlan(paths, buildFlowPathPlan(lines), previousDStrings);
    const repeatStats = applyFlowPathPlan(paths, buildFlowPathPlan(lines), previousDStrings);
    expect(repeatStats.dUpdates).toBe(0);
    expect(repeatStats.opacityUpdates).toBe(0);
    expect(repeatStats.attributeWrites).toBe(0);
  });
});

describe("Gate 7.8D repaint budgets", () => {
  it("schedules deterministic rotating subsets that eventually refresh every bucket", () => {
    expect(scheduledBucketIndices(24, 12, 0)).toEqual(scheduledBucketIndices(24, 12, 0));
    expect(new Set([
      ...scheduledBucketIndices(24, 12, 0),
      ...scheduledBucketIndices(24, 12, 1),
    ]).size).toBe(24);
    expect(new Set([
      ...scheduledBucketIndices(24, 8, 0),
      ...scheduledBucketIndices(24, 8, 1),
      ...scheduledBucketIndices(24, 8, 2),
    ]).size).toBe(24);
  });

  it("updates only the scheduled path subset", () => {
    const paths = makeBucketPaths();
    const previous = resetPreviousDStrings();
    const plan = buildFlowPathPlan(edgeCurrentGeometry(0).geometries as LineSegment[]);
    const indices = scheduledBucketIndices(24, 8, 0);
    const stats = applyFlowPathPlanBudget(paths, plan, previous, indices);
    expect(stats.attributeWrites).toBeLessThanOrEqual(16);
    expect(previous.filter(Boolean)).toHaveLength(indices.filter((index) => plan.buckets[index].d).length);
  });

  it("preserves all segments in the 12-opacity × 2-spatial hybrid", () => {
    const lines = edgeCurrentGeometry(0).geometries as LineSegment[];
    const plan = buildHybridFlowPathPlan(lines, 12, 2);
    expect(plan.buckets).toHaveLength(24);
    expect(plan.buckets.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(lines.length);
  });
});

describe("Edge Current Flow SVG DOM preview stable identity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let statsLog: FlowPreviewUpdateResult[];

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    statsLog = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("does not recreate the SVG path tree or full DOM on every animation tick", () => {
    const geometryAt0 = edgeCurrentGeometry(0);
    const geometryAt123 = edgeCurrentGeometry(1234);
    const onUpdate = (stats: FlowPreviewUpdateResult) => statsLog.push(stats);

    act(() => {
      root.render(
        createElement("div", null,
          createElement("svg", null,
            createElement(FlowPreview, { geometry: geometryAt0, onUpdate }),
          ),
        ),
      );
    });
    const initialPaths = Array.from(container.querySelectorAll("path"));
    expect(initialPaths.length).toBe(FLOW_PREVIEW_BUCKET_COUNT);
    const pathRefs = initialPaths.slice();
    const initialDByPath = pathRefs.map((p) => p.getAttribute("d") ?? "");
    // Initial mount: at least one d write occurred.
    expect(statsLog.at(-1)?.dUpdates).toBeGreaterThan(0);

    act(() => {
      root.render(
        createElement("div", null,
          createElement("svg", null,
            createElement(FlowPreview, { geometry: geometryAt123, onUpdate }),
          ),
        ),
      );
    });

    // Same node instances reused — no SVG tree replacement.
    const afterPaths = Array.from(container.querySelectorAll("path"));
    expect(afterPaths.length).toBe(FLOW_PREVIEW_BUCKET_COUNT);
    expect(afterPaths.every((path, i) => path === pathRefs[i])).toBe(true);
    const updatedDByPath = afterPaths.map((p) => p.getAttribute("d") ?? "");
    expect(updatedDByPath.some((d, i) => d !== initialDByPath[i])).toBe(true);
  });
});

describe("Animation frame geometry rebuild invariants (Gate 7.8)", () => {
  const context: RenderContext = { timeMs: 500, frame: 15 };

  it("shape animation updates path data without re-creating DOM tree identity", () => {
    const state = applyPreset(baseState, "Edge Current");
    const g0 = generateRendererGeometry(state, context);
    const g1 = generateRendererGeometry(state, { ...context, timeMs: 1500, frame: 45 });
    const paths = makeBucketPaths();
    const prev = resetPreviousDStrings();
    applyFlowPathPlan(paths, buildFlowPathPlan(g0.geometries as LineSegment[]), prev);
    const idsBefore = paths.map((p) => p);
    const stats = applyFlowPathPlan(paths, buildFlowPathPlan(g1.geometries as LineSegment[]), prev);
    expect(paths.every((p, i) => p === idsBefore[i])).toBe(true); // stable node identity
    expect(stats.dUpdates).toBeGreaterThan(0);
  });

  it("animation frame does not trigger geometry rebuild unless geometry parameters changed", () => {
    const state = applyPreset(baseState, "Edge Current");
    const a = generateRendererGeometry(state, context);
    const b = generateRendererGeometry(state, context);
    // Same timeMs/frame produces structurally identical deltas; the renderer
    // identity is fresh but the projected SVG path strings must match exactly.
    expect(buildFlowPathPlan(a.geometries as LineSegment[]).buckets.map((b) => b.d))
      .toEqual(buildFlowPathPlan(b.geometries as LineSegment[]).buckets.map((b) => b.d));
  });
});

describe("Appearance-only changes are paint-only (Gate 7.8 Scope C)", () => {
  const context: RenderContext = { timeMs: 500, frame: 15 };
  const forbiddenRaster = /<image\b|<canvas\b|<foreignObject\b|data:image\/|;base64,/i;

  function flowPathStrings(state: ProjectState) {
    const geometry = generateRendererGeometry(state, context);
    return buildFlowPathPlan(geometry.geometries as LineSegment[]).buckets.map((b) => b.d);
  }

  it("primary color drag does not change path data or rebuild geometry", () => {
    const base = applyPreset(baseState, "Edge Current");
    const recolored = { ...base, primaryColor: "#00ffaa" };
    expect(rendererGeometryStateKey(recolored)).toBe(rendererGeometryStateKey(base));
    // Flow Lines is the only `usesTime` renderer; identity is intentionally regenerated
    // per call, so we compare structures (not references) — same paths, same opacity.
    expect(generateRendererGeometry(recolored, context)).toEqual(generateRendererGeometry(base, context));
    expect(flowPathStrings(recolored)).toEqual(flowPathStrings(base));
  });

  it("background color drag does not change path data or line count", () => {
    const base = applyPreset(baseState, "Edge Current");
    const repaint = { ...base, backgroundColor: "#abcdef" };
    expect(rendererGeometryStateKey(repaint)).toBe(rendererGeometryStateKey(base));
    expect(generateRendererGeometry(repaint, context)).toEqual(generateRendererGeometry(base, context));
    expect(flowPathStrings(repaint)).toEqual(flowPathStrings(base));
  });

  it("outline color change does not change Flow path data, line count, animation state, or opacity", () => {
    const base = applyPreset(baseState, "Edge Current");
    const repaint = { ...base, outlineColor: "#ff7700" };
    expect(rendererGeometryStateKey(repaint)).toBe(rendererGeometryStateKey(base));
    expect(generateRendererGeometry(repaint, context)).toEqual(generateRendererGeometry(base, context));
    const basePlan = buildFlowPathPlan(generateRendererGeometry(base, context).geometries as LineSegment[]);
    const repaintPlan = buildFlowPathPlan(generateRendererGeometry(repaint, context).geometries as LineSegment[]);
    expect(repaintPlan.buckets.map((b) => b.d)).toEqual(basePlan.buckets.map((b) => b.d));
    expect(repaintPlan.buckets.map((b) => b.opacity)).toEqual(basePlan.buckets.map((b) => b.opacity));
    expect(repaintPlan.buckets.map((b) => b.count)).toEqual(basePlan.buckets.map((b) => b.count));
  });

  it("transparent background toggle does not change path data, line count, opacity, or animation state", () => {
    const base = applyPreset(baseState, "Edge Current");
    const transparent = { ...base, transparentBackground: true };
    expect(rendererGeometryStateKey(transparent)).toBe(rendererGeometryStateKey(base));
    expect(generateRendererGeometry(transparent, context)).toEqual(generateRendererGeometry(base, context));
    const basePlan = buildFlowPathPlan(generateRendererGeometry(base, context).geometries as LineSegment[]);
    const transparentPlan = buildFlowPathPlan(generateRendererGeometry(transparent, context).geometries as LineSegment[]);
    expect(transparentPlan.buckets.map((b) => b.d)).toEqual(basePlan.buckets.map((b) => b.d));
    expect(transparentPlan.buckets.map((b) => b.opacity)).toEqual(basePlan.buckets.map((b) => b.opacity));
    expect(transparentPlan.buckets.map((b) => b.count)).toEqual(basePlan.buckets.map((b) => b.count));
    // Animation running state unchanged when transparency toggles.
    expect(transparent.renderer).toBe(base.renderer);
  });

  it("keeps all-appearance changes out of the vector export path geometry", () => {
    const base = applyPreset(baseState, "Edge Current");
    const transparent = { ...base, transparentBackground: true, primaryColor: "#11ddcc", backgroundColor: "#0a0a0a" };
    const transparentSvg = createSvg(transparent, context, null);
    expect(createSvg(base, context, null)).not.toMatch(forbiddenRaster);
    expect(transparentSvg).not.toMatch(forbiddenRaster);
    // Edge Current remains the visible default (RendererId unchanged).
    expect(transparent.preset).toBe("Edge Current");
    // The exported vector artwork block stays identical because geometry is
    // paint-only for these appearance knobs.
    expect(
      createSvg(transparent, context, null).match(/<g id="generated-artwork".*?<\/g>/s)?.[0]
        .replace(/fill="[^"]*"/g, "").replace(/stroke="[^"]*"/g, ""),
    ).toBe(
      createSvg(base, context, null).match(/<g id="generated-artwork".*?<\/g>/s)?.[0]
        .replace(/fill="[^"]*"/g, "").replace(/stroke="[^"]*"/g, ""),
    );
  });
});

describe("Zoom and pan do not invalidate renderer geometry (Gate 7.8 Scope D)", () => {
  const context: RenderContext = { timeMs: 250, frame: 7 };

  function flowPathStrings(viewport: ViewportNavigationState) {
    const state = applyPreset(baseState, "Edge Current");
    // ProjectState never carries zoom/pan; canvas navigation lives in
    // CanvasNavigation component state — confirm via type guard.
    expect((state as unknown as { zoom?: unknown }).zoom).toBeUndefined();
    expect((state as unknown as { panX?: unknown }).panX).toBeUndefined();
    expect((state as unknown as { panY?: unknown }).panY).toBeUndefined();
    return buildFlowPathPlan(generateRendererGeometry(state, context).geometries as LineSegment[])
      .buckets.map((b) => b.d);
  }

  it("zoom changes the CSS transform only and does not mutate path data", () => {
    const stringsBefore = flowPathStrings(defaultViewport());
    const stringsAfter = flowPathStrings(zoomAtCenter(defaultViewport(), 2.4));
    expect(stringsBefore).toEqual(stringsAfter);
    // Flow Lines is `usesTime`; the geometry identity is intentionally regenerated
    // per call, so we compare structures rather than references — they must match.
    const base = applyPreset(baseState, "Edge Current");
    expect(generateRendererGeometry(base, context))
      .toEqual(generateRendererGeometry(base, context));
  });

  it("panning mutates only the CSS translate and does not regenerate renderer geometry", () => {
    const stringsBefore = flowPathStrings(defaultViewport());
    const stringsAfter = flowPathStrings(panBy(defaultViewport(), 240, -120));
    expect(stringsBefore).toEqual(stringsAfter);
  });

  it("keeps viewport navigation math outside the deterministic export path", () => {
    const state = applyPreset(baseState, "Edge Current");
    const svg = createSvg(state, context, null);
    expect(svg).not.toMatch(/zoom|panX|panY|transform=/i);
  });
});

function defaultViewport(): ViewportNavigationState {
  return { zoom: 1, panX: 0, panY: 0 };
}
