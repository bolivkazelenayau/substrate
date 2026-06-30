import type { LineSegment } from "./geometry";

// Gate 7.8 — Edge Current SVG DOM preview performance.
//
// The Vector-render contract:
//   * Final Artwork SVG export stays vector-only, deterministic, fixed-bounds, and CPU.
//   * Preview is allowed to use SVG DOM with stable node identity.
//
// The regression root cause (Gate 7.7 forced SVG DOM for Flow Lines, removing the
// >500 element Canvas 2D auto-selection) was the FlowPreview component calling
// `setAttribute` for x1/y1/x2/y2/opacity on every `<line>` element every animation
// frame (≈ 5 * 1564 ≈ 7800 DOM attribute mutations per frame). Each mutation
// re-coordinates layout/paint for the masked `<g>` and re-runs the clip path,
// collapsing FPS to ~6.
//
// This module replaces that pattern with **stable SVG node identity** plus
// **grouped path batching by opacity bucket**:
//   * Render a fixed, K-bucket set of `<path>` elements once.
//   * Each frame, partition the renderer's LineSegments into opacity buckets and
//     concatenate them into a single `d` attribute per bucket (M/L subpaths).
//   * Only `setAttribute("d", …)` per bucket path and setAttribute("opacity", …)
//     when the bucket value changes. This drops DOM mutations from ~N*5 to
//     ≤ 2*K per frame.
//
// Stroke painting of multi-subpath `<path d="M… L… M… L…">` is visually
// equivalent to N `<line>` elements with equal stroke style — Final Artwork
// export continues to serialize per-segment `<path d="M… L…">` per-line-opacity
// via exportSvg.ts (`serializeGeometry`), so the export pipeline remains
// unchanged and vector-only.

export const FLOW_PREVIEW_BUCKET_COUNT = 24;
export const FLOW_PREVIEW_PRECISION = 1;

export interface FlowPathBucket {
  /** SVG `d` payload containing M/L subpaths for this bucket. Empty when no segment maps here. */
  d: string;
  /** Midpoint opacity used for the bucket element. */
  opacity: number;
  /** Number of line segments placed in this bucket. */
  count: number;
}

export interface FlowPreviewFramePlan {
  buckets: FlowPathBucket[];
  /** Total line segments accounted for. Equal to the input length. */
  segmentCount: number;
  /** Number of buckets that received any subpath. */
  activeBuckets: number;
}

function bucketIndexOf(opacity: number, bucketCount: number): number {
  const safeOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  const bucket = Math.floor(safeOpacity * bucketCount);
  // Clamp Math.floor(1 * bucketCount) to the top bucket index.
  return Math.min(bucketCount - 1, Math.max(0, bucket));
}

/**
 * Partition a renderer's LineSegments into opacity buckets and produce a single
 * concatenated SVG path-data string per bucket. The output preserves the visual
 * contract (stroke-only path with one M/L subpath per source segment) while
 * enabling FlowPreview to update at most K `<path>` elements per frame instead
 * of N `<line>` elements * 5 attributes each.
 */
export function buildFlowPathPlan(
  lines: readonly LineSegment[],
  bucketCount = FLOW_PREVIEW_BUCKET_COUNT,
  precision = FLOW_PREVIEW_PRECISION,
): FlowPreviewFramePlan {
  const dParts: string[] = new Array(bucketCount).fill("");
  const counts: number[] = new Array(bucketCount).fill(0);
  const multiplier = Math.pow(10, precision);
  for (const line of lines) {
    const bucket = bucketIndexOf(line.opacity ?? 1, bucketCount);
    dParts[bucket] +=
      "M" + (Math.round(line.start.x * multiplier) / multiplier).toFixed(precision) +
      " " + (Math.round(line.start.y * multiplier) / multiplier).toFixed(precision) +
      "L" + (Math.round(line.end.x * multiplier) / multiplier).toFixed(precision) +
      " " + (Math.round(line.end.y * multiplier) / multiplier).toFixed(precision);
    counts[bucket] += 1;
  }
  const buckets: FlowPathBucket[] = new Array(bucketCount);
  let activeBuckets = 0;
  for (let i = 0; i < bucketCount; i += 1) {
    const midpoint = (i + 0.5) / bucketCount;
    const count = counts[i];
    buckets[i] = { d: dParts[i], opacity: midpoint, count };
    if (count > 0) activeBuckets += 1;
  }
  return { buckets, segmentCount: lines.length, activeBuckets };
}

export interface FlowPreviewUpdateResult {
  /** Number of `d` attribute writes performed after diffing against previous payloads. */
  dUpdates: number;
  /** Number of `opacity` attribute writes performed after diffing against previous payloads. */
  opacityUpdates: number;
  /** Total DOM `setAttribute` calls issued this frame (≤ 2 * bucketCount). */
  attributeWrites: number;
  /** Identity reuse signal — every existing `<path>` element keeps its identity when true. */
  nodeIdentityReused: boolean;
}

/**
 * Apply a flow path frame plan to a stable array of bucket `<path>` elements.
 * Mutates the underlying DOM elements with `setAttribute` only when the value
 * actually differs from the previous frame.
 *
 * Designed for a synchronous layout-effect; React state is intentionally not used
 * here so the per-frame animation avoids reconciling a large SVG tree.
 */
export function applyFlowPathPlan(
  elements: readonly (SVGPathElement | null)[],
  plan: FlowPreviewFramePlan,
  previousDStrings: string[],
): FlowPreviewUpdateResult {
  let dUpdates = 0;
  let opacityUpdates = 0;
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i];
    if (!element) continue;
    const bucket = plan.buckets[i];
    const nextD = bucket.d;
    const prevD = previousDStrings.length > i ? previousDStrings[i] : null;
    if (prevD !== nextD) {
      element.setAttribute("d", nextD);
      dUpdates += 1;
      previousDStrings[i] = nextD;
    }
    // Opacity is rounded to two decimals to mirror the bucket midpoint and avoid
    // floating-point churn that would otherwise force per-frame DOM writes.
    const nextOpacity = Number(bucket.opacity.toFixed(2));
    if (element.getAttribute("opacity") !== String(nextOpacity)) {
      element.setAttribute("opacity", String(nextOpacity));
      opacityUpdates += 1;
    }
  }
  return {
    dUpdates,
    opacityUpdates,
    attributeWrites: dUpdates + opacityUpdates,
    nodeIdentityReused: true,
  };
}

/** Reset cached diff state when bucket count changes (typically only at mount/unmount). */
export function resetPreviousDStrings(
  bucketCount = FLOW_PREVIEW_BUCKET_COUNT,
): string[] {
  return new Array(bucketCount).fill("");
}

/** Preview-only opacity × spatial partition for dirty-region experiments. */
export function buildHybridFlowPathPlan(
  lines: readonly LineSegment[],
  opacityBucketCount = 12,
  spatialColumns = 2,
  viewportWidth = 1200,
  precision = FLOW_PREVIEW_PRECISION,
): FlowPreviewFramePlan {
  const bucketCount = opacityBucketCount * spatialColumns;
  const dParts: string[] = new Array(bucketCount).fill("");
  const counts: number[] = new Array(bucketCount).fill(0);
  const multiplier = Math.pow(10, precision);
  for (const line of lines) {
    const opacityBucket = bucketIndexOf(line.opacity ?? 1, opacityBucketCount);
    const midpointX = (line.start.x + line.end.x) / 2;
    const column = Math.min(spatialColumns - 1, Math.max(0, Math.floor(midpointX / viewportWidth * spatialColumns)));
    const bucket = column * opacityBucketCount + opacityBucket;
    dParts[bucket] +=
      "M" + (Math.round(line.start.x * multiplier) / multiplier).toFixed(precision) +
      " " + (Math.round(line.start.y * multiplier) / multiplier).toFixed(precision) +
      "L" + (Math.round(line.end.x * multiplier) / multiplier).toFixed(precision) +
      " " + (Math.round(line.end.y * multiplier) / multiplier).toFixed(precision);
    counts[bucket] += 1;
  }
  let activeBuckets = 0;
  const buckets = dParts.map((d, index) => {
    const count = counts[index];
    if (count > 0) activeBuckets += 1;
    return {
      d,
      opacity: ((index % opacityBucketCount) + 0.5) / opacityBucketCount,
      count,
    };
  });
  return { buckets, segmentCount: lines.length, activeBuckets };
}

export function scheduledBucketIndices(bucketCount: number, updateBudget: number, frameIndex: number): number[] {
  if (!Number.isInteger(bucketCount) || bucketCount <= 0 || !Number.isInteger(updateBudget) || updateBudget <= 0) return [];
  const count = Math.min(bucketCount, updateBudget);
  const start = (Math.max(0, Math.floor(frameIndex)) * count) % bucketCount;
  return Array.from({ length: count }, (_, offset) => (start + offset) % bucketCount);
}

export function applyFlowPathPlanBudget(
  elements: readonly (SVGPathElement | null)[],
  plan: FlowPreviewFramePlan,
  previousDStrings: string[],
  indices: readonly number[],
): FlowPreviewUpdateResult {
  let dUpdates = 0;
  let opacityUpdates = 0;
  for (const index of indices) {
    const element = elements[index];
    const bucket = plan.buckets[index];
    if (!element || !bucket) continue;
    if (previousDStrings[index] !== bucket.d) {
      element.setAttribute("d", bucket.d);
      previousDStrings[index] = bucket.d;
      dUpdates += 1;
    }
    const nextOpacity = Number(bucket.opacity.toFixed(2));
    if (element.getAttribute("opacity") !== String(nextOpacity)) {
      element.setAttribute("opacity", String(nextOpacity));
      opacityUpdates += 1;
    }
  }
  return {
    dUpdates,
    opacityUpdates,
    attributeWrites: dUpdates + opacityUpdates,
    nodeIdentityReused: true,
  };
}
