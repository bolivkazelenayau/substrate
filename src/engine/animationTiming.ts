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
