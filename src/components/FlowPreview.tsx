import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { GeometryGroup, LineSegment } from "../engine/geometry";
import {
  FLOW_PREVIEW_BUCKET_COUNT,
  applyFlowPathPlan,
  applyFlowPathPlanBudget,
  buildHybridFlowPathPlan,
  buildFlowPathPlan,
  resetPreviousDStrings,
  scheduledBucketIndices,
  type FlowPreviewUpdateResult,
} from "../engine/flowPreviewOptimization";
import { recordPreviewGeometryBuild, recordPreviewPathCommit } from "../engine/previewRuntimeDiagnostics";
import { advanceAnimationFrameBudget } from "../engine/animationTiming";
import { generateRendererGeometry } from "../engine/rendererRuntime";
import type { SvgTraceMode } from "../engine/previewTraceConfig";
import type { ProjectState, RenderContext } from "../types";

interface FlowPreviewProps {
  geometry: GeometryGroup;
  /**
   * Optional per-frame callback fired after the SVG DOM has been mutated.
   * Receives the bucketed-path update summary so the host Viewport can surface
   * the Gate 7.8 instrumentation alongside the existing animation diagnostics
   * without committing React state on every animation tick.
   */
  onUpdate?: (stats: FlowPreviewUpdateResult) => void;
  bucketCount?: 8 | 12 | 24;
  traceMode?: SvgTraceMode;
  state?: ProjectState;
  context?: RenderContext;
  running?: boolean;
  fpsCap?: 24 | 30 | 60;
}

// Gate 7.8 — Edge Current SVG DOM preview performance.
//
// Previously this component emitted one `<line>` per LineSegment and updated
// x1/y1/x2/y2/opacity on each animation frame (≈ N * 5 `setAttribute` calls
// per frame). With the default Edge Current preset (≈ 1564 segments) that meant
// ~7800 live SVG attribute mutations per frame, each invalidating the masked
// `<g>` paint and re-running the glyph clip path — collapsing preview FPS to ≈ 6
// after Gate 7.7 forced SVG DOM for Flow Lines.
//
// We now keep a fixed pool of opacity-bucket `<path>` elements (created exactly
// once, keyed on the bucket index) and update them imperatively each frame via
// `applyFlowPathPlan`. The renderer's LineSegment array reference still changes
// per animation tick — that is fine: React reconciles only the small memoized
// path element array, while the per-frame SVG DOM mutation drops to at most
// `2 * FLOW_PREVIEW_BUCKET_COUNT` `setAttribute` calls. Multi-subpath
// `M… L… M… L…` stroke painting is visually equivalent to N `<line>` elements
// that share the same stroke style.
//
// Final Artwork SVG export is unchanged: exportSvg.ts serializes one vector
// `<path d="M… L…">` per LineSegment with its true per-segment opacity.

export const FlowPreview = memo(function FlowPreview({
  geometry,
  onUpdate,
  bucketCount = FLOW_PREVIEW_BUCKET_COUNT,
  traceMode = "normal",
  state,
  context,
  running = false,
  fpsCap = 60,
}: FlowPreviewProps) {
  const lines = geometry.geometries as LineSegment[];
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const previousDStrings = useRef<string[]>([]);
  const staticFrameApplied = useRef(false);
  const budgetFrame = useRef(0);
  const lastCadenceUpdateMs = useRef<number | null>(null);
  const bucketElements = useMemo(() => {
    // Stable pool of bucket <path> elements. Created exactly once; React never
    // replaces them across animation frames, so the per-frame setAttribute diff
    // in the layout-effect is the only SVG DOM mutation that occurs.
    pathRefs.current.length = bucketCount;
    previousDStrings.current = resetPreviousDStrings(bucketCount);
    staticFrameApplied.current = false;
    budgetFrame.current = 0;
    lastCadenceUpdateMs.current = null;
    return Array.from({ length: bucketCount }, (_, index) => (
      <path
        key={index}
        ref={(element) => {
          pathRefs.current[index] = element;
        }}
      />
    ));
  }, [bucketCount]);

  const applyFrame = (frameLines: LineSegment[], freezeAfterFirst = false, frameTimeMs = context?.timeMs ?? 0) => {
    const cadenceFps = traceMode === "cadence-15" ? 15 : traceMode === "cadence-20" ? 20 : null;
    if (cadenceFps !== null && staticFrameApplied.current) {
      const previous = lastCadenceUpdateMs.current ?? frameTimeMs;
      if (frameTimeMs - previous < 1000 / cadenceFps) return;
    }
    lastCadenceUpdateMs.current = frameTimeMs;
    const groupingStart = performance.now();
    const plan = traceMode === "hybrid-spatial"
      ? buildHybridFlowPathPlan(frameLines, 12, 2)
      : buildFlowPathPlan(frameLines, bucketCount);
    const pathGroupingMs = performance.now() - groupingStart;
    const domStart = performance.now();
    const shouldFreeze = freezeAfterFirst && staticFrameApplied.current;
    const temporalBudget = traceMode === "temporal-12" ? 12 : traceMode === "temporal-8" ? 8 : null;
    const indices = temporalBudget !== null && staticFrameApplied.current
      ? scheduledBucketIndices(bucketCount, temporalBudget, budgetFrame.current)
      : null;
    const stats = shouldFreeze
      ? { dUpdates: 0, opacityUpdates: 0, attributeWrites: 0, nodeIdentityReused: true }
      : indices
        ? applyFlowPathPlanBudget(pathRefs.current, plan, previousDStrings.current, indices)
        : applyFlowPathPlan(pathRefs.current, plan, previousDStrings.current);
    staticFrameApplied.current = true;
    budgetFrame.current += 1;
    const domWriteMs = performance.now() - domStart;
    const dStringLength = indices
      ? indices.reduce((total, index) => total + (plan.buckets[index]?.d.length ?? 0), 0)
      : shouldFreeze
        ? 0
        : plan.buckets.reduce((total, bucket) => total + bucket.d.length, 0);
    recordPreviewPathCommit({
      pathGroupingMs,
      domWriteMs,
      stats,
      segmentCount: plan.segmentCount,
      activeBuckets: plan.activeBuckets,
      dStringLength,
    });
    onUpdate?.(stats);
  };

  useLayoutEffect(() => {
    previousDStrings.current = resetPreviousDStrings(bucketCount);
    staticFrameApplied.current = false;
    budgetFrame.current = 0;
    lastCadenceUpdateMs.current = null;
  }, [bucketCount, traceMode, running]);

  useLayoutEffect(() => {
    if (traceMode === "local-clock") {
      applyFrame(lines);
      return;
    }
    applyFrame(lines, traceMode === "static-mask", context?.timeMs ?? 0);
    // applyFrame intentionally follows the current geometry commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, onUpdate, bucketCount, traceMode]);

  useEffect(() => {
    if (traceMode !== "local-clock" || !running || !state || !context) return;
    let raf = 0;
    let previousRaf: number | null = null;
    let accumulator = 0;
    let localTimeMs = context.timeMs;
    let localFrame = context.frame;
    const interval = 1000 / fpsCap;
    const tick = (now: number) => {
      if (previousRaf === null) {
        previousRaf = now;
      } else {
        const delta = now - previousRaf;
        previousRaf = now;
        const budget = advanceAnimationFrameBudget(accumulator, delta, interval);
        accumulator = budget.remainderMs;
        if (budget.draw) {
          localTimeMs += budget.phaseDeltaMs;
          localFrame += 1;
          const geometryStart = performance.now();
          const localGeometry = generateRendererGeometry(state, {
            ...context,
            timeMs: localTimeMs,
            frame: localFrame,
          });
          const geometryMs = performance.now() - geometryStart;
          // The local trace does not pass through App's geometry memo, so record
          // the equivalent phase explicitly for the shared capture.
          recordPreviewGeometryBuild(geometryMs);
          applyFrame(localGeometry.geometries as LineSegment[]);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Trace-only local ownership; state/context changes intentionally restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [traceMode, running, fpsCap, state, context, bucketCount]);

  return bucketElements;
});
