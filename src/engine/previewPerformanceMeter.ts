// Gate 7.8A — Edge Current preview performance meter.
//
// Deterministic scheduler simulation and pacing metrics for the two animation
// paths in this app:
//   1. `useAnimationClock` (SVG DOM path) — trailing-edge throttle without
//      accumulator; calls `setContext()` every committed frame, forcing a
//      full React re-render of App + Viewport each tick.
//   2. `CanvasFlowPreview` (Canvas 2D path) — self-contained imperative rAF
//      with an accumulator (`consumeFrameBudget`); drawing is imperative;
//      `onSample` reports diagnostics only every 300ms; no per-frame React
//      re-render.
//
// This module is used by the dev-only `PreviewPerformanceMeter` overlay to
// measure real browser metrics and by unit tests to verify the scheduler
// simulation against known pacing scenarios. It does NOT alter the production
// renderer, scheduler, or export pipeline.

export type SchedulerKind = "useAnimationClock" | "canvasRafLoop";

export interface SchedulerConfig {
  /** Target FPS cap: 24, 30, or 60. */
  targetFps: number;
  /** Display refresh interval in ms (e.g. 16.67 for 60Hz, 8.33 for 120Hz). */
  vsyncMs: number;
  /** Per-commit render + paint cost in ms. Represents the React render +
   *  geometry generation + SVG DOM mutation + browser repaint cost. */
  renderCostMs: number;
  /** Which scheduler to simulate. */
  kind: SchedulerKind;
}

export interface SimulatedFrame {
  /** rAF timestamp in ms. */
  now: number;
  /** Whether this tick committed a frame. */
  committed: boolean;
  /** Elapsed time since the previous commit (ms). 0 if not committed. */
  intervalMs: number;
  /** Accumulated remainder after this commit (ms). */
  remainderMs: number;
}

export interface SimulationResult {
  frames: SimulatedFrame[];
  committedCount: number;
  totalDurationMs: number;
  intervals: number[];
  medianIntervalMs: number;
  meanIntervalMs: number;
  p95IntervalMs: number;
  observedFps: number;
  /** Number of ticks that were skipped (rAF fired but no commit). */
  skippedTicks: number;
  /** Number of committed frames whose interval exceeded 1.5x the target interval. */
  lateFrames: number;
  /** Frame budget = 1000 / targetFps (ms). */
  targetIntervalMs: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/**
 * Simulate the `useAnimationClock` trailing-edge throttle:
 *
 *   if (elapsed >= minimumFrameTime) {
 *     lastCommit = now;        // ← discards remainder
 *     commit;
 *   }
 *
 * No accumulator, no remainder carry. The `now` time advances by the max of
 * vsync interval and render cost (the next rAF cannot fire until the previous
 * render + paint completes).
 */
function simulateTrailingEdge(config: SchedulerConfig): SimulatedFrame[] {
  const { targetFps, vsyncMs, renderCostMs } = config;
  const minimumFrameTime = 1000 / targetFps;
  const frames: SimulatedFrame[] = [];
  let lastCommit: number | null = null;
  let now = 0;
  const maxTicks = 600; // simulate ~10 seconds at 60Hz

  for (let tick = 0; tick < maxTicks; tick += 1) {
    now = tick * vsyncMs;
    if (lastCommit !== null && now < lastCommit + renderCostMs) {
      // Render still in progress; rAF is delayed to after render completes.
      now = lastCommit + renderCostMs;
      // Snap to the next vsync after render completes.
      const nextVsync = Math.ceil(now / vsyncMs) * vsyncMs;
      now = Math.max(now, nextVsync);
    }
    const frame: SimulatedFrame = { now, committed: false, intervalMs: 0, remainderMs: 0 };
    if (lastCommit === null) {
      lastCommit = now;
    } else {
      const elapsed = now - lastCommit;
      if (elapsed >= minimumFrameTime) {
        lastCommit = now;
        frame.committed = true;
        frame.intervalMs = elapsed;
        // Trailing-edge throttle discards the remainder.
        frame.remainderMs = 0;
      }
    }
    frames.push(frame);
    if (now > 10_000) break;
  }
  return frames;
}

/**
 * Simulate the `CanvasFlowPreview` accumulator-based throttle:
 *
 *   accumulator += rafDelta;
 *   const budget = consumeFrameBudget(accumulator, minimumFrame);
 *   if (budget.draw) {
 *     accumulator = budget.remainderMs;  // ← carries remainder forward
 *     commit;
 *   }
 *
 * The accumulator preserves sub-frame remainder, preventing drift.
 */
function simulateAccumulator(config: SchedulerConfig): SimulatedFrame[] {
  const { targetFps, vsyncMs, renderCostMs } = config;
  const minimumFrameTime = 1000 / targetFps;
  const frames: SimulatedFrame[] = [];
  let lastCommit: number | null = null;
  let accumulator = 0;
  let prevRaf = 0;
  let now = 0;
  const maxTicks = 600;

  for (let tick = 0; tick < maxTicks; tick += 1) {
    now = tick * vsyncMs;
    if (lastCommit !== null && now < lastCommit + renderCostMs) {
      now = lastCommit + renderCostMs;
      const nextVsync = Math.ceil(now / vsyncMs) * vsyncMs;
      now = Math.max(now, nextVsync);
    }
    const frame: SimulatedFrame = { now, committed: false, intervalMs: 0, remainderMs: 0 };
    if (lastCommit === null) {
      lastCommit = now;
      prevRaf = now;
    } else {
      const rafDelta = now - prevRaf;
      prevRaf = now;
      if (Number.isFinite(rafDelta) && rafDelta > 0) {
        accumulator += Math.min(rafDelta, 1000);
        const tolerance = Math.min(1, minimumFrameTime * 0.06);
        if (accumulator + tolerance >= minimumFrameTime) {
          const elapsed = now - lastCommit;
          lastCommit = now;
          accumulator = Math.max(0, accumulator - minimumFrameTime);
          frame.committed = true;
          frame.intervalMs = elapsed;
          frame.remainderMs = accumulator;
        }
      } else {
        accumulator = 0;
      }
    }
    frames.push(frame);
    if (now > 10_000) break;
  }
  return frames;
}

/**
 * Run the scheduler simulation and produce pacing metrics. This is a pure
 * function — no side effects, no DOM, no React. Used by the dev-only overlay
 * and by unit tests to validate the pacing model.
 */
export function simulateScheduler(config: SchedulerConfig): SimulationResult {
  const rawFrames = simulateAccumulator(config);
  const frames = rawFrames;
  const committedFrames = frames.filter((f) => f.committed);
  const intervals = committedFrames.map((f) => f.intervalMs);
  const sortedIntervals = [...intervals].sort((a, b) => a - b);
  const totalDurationMs = frames.length > 0 ? frames[frames.length - 1].now : 0;
  const committedCount = committedFrames.length;
  const targetIntervalMs = 1000 / config.targetFps;
  const observedFps = committedCount > 0 && totalDurationMs > 0
    ? (committedCount / totalDurationMs) * 1000
    : 0;
  const skippedTicks = frames.length - committedFrames.length - 1;
  const lateFrames = intervals.filter((i) => i > targetIntervalMs * 1.5).length;

  return {
    frames,
    committedCount,
    totalDurationMs,
    intervals,
    medianIntervalMs: percentile(sortedIntervals, 50) || 0,
    meanIntervalMs: intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0,
    p95IntervalMs: percentile(sortedIntervals, 95),
    observedFps,
    skippedTicks,
    lateFrames,
    targetIntervalMs,
  };
}

// ---------------------------------------------------------------------------
// Bucket optimization analysis
// ---------------------------------------------------------------------------

export interface BucketCostEstimate {
  bucketCount: number;
  /** Estimated DOM attribute writes per frame (≤ 2 * bucketCount). */
  maxAttributeWrites: number;
  /** Estimated SVG paint operations (one per non-empty bucket). */
  paintOperations: number;
  /** Qualitative grading. */
  grade: "good" | "acceptable" | "excessive";
}

export function estimateBucketCost(bucketCount: number, segmentCount: number): BucketCostEstimate {
  const maxAttributeWrites = 2 * bucketCount;
  const paintOperations = Math.min(bucketCount, segmentCount);
  let grade: BucketCostEstimate["grade"] = "good";
  if (bucketCount > 32) grade = "excessive";
  else if (bucketCount > 16) grade = "acceptable";
  return { bucketCount, maxAttributeWrites, paintOperations, grade };
}

/**
 * Compare bucket counts and return a ranking by estimated SVG efficiency.
 * Does NOT change export geometry — export always uses per-segment paths.
 */
export function rankBucketCounts(segmentCount: number, counts: number[] = [8, 12, 24, 48]): BucketCostEstimate[] {
  return counts
    .map((c) => estimateBucketCost(c, segmentCount))
    .sort((a, b) => a.maxAttributeWrites - b.maxAttributeWrites);
}

// ---------------------------------------------------------------------------
// Runtime measurement helpers (dev-only)
// ---------------------------------------------------------------------------

/**
 * Collect frame intervals over a duration and compute pacing statistics.
 * The caller passes an array of rAF timestamps (performance.now() values).
 * This is a pure function used by the dev-only overlay after collecting
 * browser rAF timestamps.
 */
export function computeFrameStats(rafTimestamps: number[], targetFps: number): {
  observedFps: number;
  medianIntervalMs: number;
  meanIntervalMs: number;
  p95IntervalMs: number;
  lateFrames: number;
  targetIntervalMs: number;
  totalDurationMs: number;
} {
  const intervals: number[] = [];
  for (let i = 1; i < rafTimestamps.length; i += 1) {
    const delta = rafTimestamps[i] - rafTimestamps[i - 1];
    if (Number.isFinite(delta) && delta > 0) intervals.push(delta);
  }
  const sorted = [...intervals].sort((a, b) => a - b);
  const totalDurationMs = rafTimestamps.length > 1
    ? rafTimestamps[rafTimestamps.length - 1] - rafTimestamps[0]
    : 0;
  const targetIntervalMs = 1000 / targetFps;
  const observedFps = intervals.length > 0 && totalDurationMs > 0
    ? (intervals.length / totalDurationMs) * 1000
    : 0;
  const lateFrames = intervals.filter((i) => i > targetIntervalMs * 1.5).length;
  return {
    observedFps,
    medianIntervalMs: percentile(sorted, 50) || 0,
    meanIntervalMs: intervals.length > 0 ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0,
    p95IntervalMs: percentile(sorted, 95),
    lateFrames,
    targetIntervalMs,
    totalDurationMs,
  };
}
