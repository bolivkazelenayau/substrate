export interface TimingSample {
  averageFrameMs: number;
  fps: number;
  validity: "valid" | "unstable" | "invalid";
}

export function updateTimingAverage(previousAverage: number, deltaMs: number): TimingSample {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) {
    const averageFrameMs = Number.isFinite(previousAverage) && previousAverage > 0 ? previousAverage : 0;
    return {
      averageFrameMs,
      fps: averageFrameMs > 0 ? 1000 / averageFrameMs : 0,
      validity: "invalid",
    };
  }
  const clampedDelta = Math.min(deltaMs, 1000);
  const averageFrameMs = previousAverage > 0 && Number.isFinite(previousAverage)
    ? previousAverage * 0.82 + clampedDelta * 0.18
    : clampedDelta;
  return {
    averageFrameMs,
    fps: Math.max(0, 1000 / averageFrameMs),
    validity: deltaMs > 250 ? "unstable" : "valid",
  };
}

export function formatFps(frameMs: number, validity: TimingSample["validity"]): string {
  if (validity === "invalid" || !Number.isFinite(frameMs) || frameMs <= 0) return "FPS INVALID";
  return `FPS +${Math.abs(1000 / frameMs).toFixed(1)}`;
}

export function getFramePacingStatus(
  frameMs: number,
  targetIntervalMs: number,
  validity: TimingSample["validity"],
): "stable" | "unstable" {
  if (validity !== "valid" || !Number.isFinite(frameMs) || frameMs <= 0 || !Number.isFinite(targetIntervalMs) || targetIntervalMs <= 0) {
    return "unstable";
  }
  return Math.abs(frameMs - targetIntervalMs) / targetIntervalMs <= 0.2 ? "stable" : "unstable";
}

export function consumeFrameBudget(accumulatorMs: number, targetIntervalMs: number) {
  if (!Number.isFinite(accumulatorMs) || accumulatorMs < 0 || !Number.isFinite(targetIntervalMs) || targetIntervalMs <= 0) {
    return { draw: false, remainderMs: 0 };
  }
  const toleranceMs = Math.min(1, targetIntervalMs * 0.06);
  if (accumulatorMs + toleranceMs < targetIntervalMs) return { draw: false, remainderMs: accumulatorMs };
  return {
    draw: true,
    remainderMs: Math.max(0, accumulatorMs - targetIntervalMs),
  };
}

export const MAX_ANIMATION_DELTA_MS = 250;
export const DIAGNOSTICS_PUBLISH_INTERVAL_MS = 300;

export interface AnimationFrameBudget {
  draw: boolean;
  remainderMs: number;
  phaseDeltaMs: number;
  clamped: boolean;
}

/**
 * Advance a capped rAF clock while preserving fractional frame remainder.
 * At most one visual frame is returned per call. Long gaps intentionally drop
 * backlog so a restored tab cannot enter a catch-up spiral.
 */
export function advanceAnimationFrameBudget(
  accumulatorMs: number,
  deltaMs: number,
  targetIntervalMs: number,
  maximumDeltaMs = MAX_ANIMATION_DELTA_MS,
): AnimationFrameBudget {
  if (
    !Number.isFinite(accumulatorMs)
    || accumulatorMs < 0
    || !Number.isFinite(deltaMs)
    || deltaMs <= 0
    || !Number.isFinite(targetIntervalMs)
    || targetIntervalMs <= 0
    || !Number.isFinite(maximumDeltaMs)
    || maximumDeltaMs <= 0
  ) {
    return { draw: false, remainderMs: 0, phaseDeltaMs: 0, clamped: false };
  }

  const clamped = deltaMs > maximumDeltaMs;
  const nextAccumulator = accumulatorMs + Math.min(deltaMs, maximumDeltaMs);
  const budget = consumeFrameBudget(nextAccumulator, targetIntervalMs);
  if (!budget.draw) {
    return {
      draw: false,
      remainderMs: nextAccumulator,
      phaseDeltaMs: 0,
      clamped,
    };
  }

  // A large backlog represents inactivity or a blocked main thread, not visual
  // frames that should be replayed. Drop it after emitting this one update.
  const excessiveBacklog = clamped || nextAccumulator >= targetIntervalMs * 3;
  return {
    draw: true,
    remainderMs: excessiveBacklog ? 0 : budget.remainderMs,
    phaseDeltaMs: Math.min(deltaMs, maximumDeltaMs),
    clamped: excessiveBacklog,
  };
}

export function shouldPublishAnimationDiagnostics(
  nowMs: number,
  lastPublishedMs: number,
  intervalMs = DIAGNOSTICS_PUBLISH_INTERVAL_MS,
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastPublishedMs) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    return false;
  }
  return lastPublishedMs === 0 || nowMs - lastPublishedMs >= intervalMs;
}
