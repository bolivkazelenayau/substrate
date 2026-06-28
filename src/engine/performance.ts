export type PerformanceSeverity = "ok" | "noticeable" | "slow" | "severe";

export interface PerformanceTiming {
  durationMs: number;
  severity: PerformanceSeverity;
  warning: string | null;
}

export function classifyPerformance(durationMs: number, label: string): PerformanceTiming {
  const severity: PerformanceSeverity = durationMs >= 500
    ? "severe"
    : durationMs >= 250
      ? "slow"
      : durationMs >= 100
        ? "noticeable"
        : "ok";
  return {
    durationMs,
    severity,
    warning: severity === "ok" ? null : `${label} is ${severity} at ${durationMs.toFixed(1)} ms.`,
  };
}

export const measure = <T,>(work: () => T): { value: T; durationMs: number } => {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const value = work();
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { value, durationMs: ended - started };
};

export function getSubstratePerformanceWarnings(durationMs: number, quality: "low" | "medium" | "high" | "ultra") {
  return [
    classifyPerformance(durationMs, "Substrate build").warning,
    quality === "ultra" ? "Ultra substrate quality is expensive; cpu-main fallback may block interaction." : null,
  ].filter((warning): warning is string => Boolean(warning));
}
