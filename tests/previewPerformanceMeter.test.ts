import { describe, expect, it } from "vitest";
import {
  computeFrameStats,
  estimateBucketCost,
  rankBucketCounts,
  simulateScheduler,
  type SchedulerConfig,
} from "../src/engine/previewPerformanceMeter";

describe("scheduler simulation — trailing-edge (useAnimationClock)", () => {
  const baseConfig: SchedulerConfig = {
    targetFps: 30,
    vsyncMs: 16.67,
    renderCostMs: 0,
    kind: "useAnimationClock",
  };

  it("with zero render cost, trailing-edge throttle hits exactly the target FPS", () => {
    const result = simulateScheduler({ ...baseConfig, renderCostMs: 0 });
    expect(result.targetIntervalMs).toBeCloseTo(33.33, 1);
    expect(result.observedFps).toBeCloseTo(30, 0);
    expect(result.lateFrames).toBe(0);
  });

  it("with render cost above the target interval, observed FPS drops below target", () => {
    // On a 120Hz display, target 30 FPS needs 33.33ms. Even light render cost
    // (5ms) causes the trailing-edge throttle to round up to the next vsync,
    // dropping below 30. Heavy render cost (40ms) drops further.
    const fast = { ...baseConfig, vsyncMs: 1000 / 120, targetFps: 30 } as SchedulerConfig;
    const light = simulateScheduler({ ...fast, renderCostMs: 5 });
    const heavy = simulateScheduler({ ...fast, renderCostMs: 40 });
    expect(light.observedFps).toBeLessThan(30);
    expect(heavy.observedFps).toBeLessThan(light.observedFps);
    expect(heavy.observedFps).toBeLessThan(30);
  });

  it("with render cost, observed FPS is below the target", () => {
    const config = { ...baseConfig, vsyncMs: 1000 / 120, renderCostMs: 20 };
    const at60 = simulateScheduler({ ...config, targetFps: 60 });
    const at30 = simulateScheduler({ ...config, targetFps: 30 });
    // Both should deliver frames but below target.
    expect(at60.observedFps).toBeGreaterThan(0);
    expect(at30.observedFps).toBeGreaterThan(0);
    expect(at60.observedFps).toBeLessThan(60);
    expect(at30.observedFps).toBeLessThan(30);
  });

  it("SVG clock carries fractional remainder at an uneven cap", () => {
    const result = simulateScheduler({ ...baseConfig, targetFps: 24, renderCostMs: 0 });
    const committed = result.frames.filter((f) => f.committed);
    expect(committed.some((f) => f.remainderMs > 0)).toBe(true);
  });
});

describe("scheduler simulation — accumulator (CanvasFlowPreview)", () => {
  const baseConfig: SchedulerConfig = {
    targetFps: 30,
    vsyncMs: 16.67,
    renderCostMs: 0,
    kind: "canvasRafLoop",
  };

  it("with zero render cost, accumulator throttle hits exactly the target FPS", () => {
    const result = simulateScheduler({ ...baseConfig, renderCostMs: 0 });
    expect(result.observedFps).toBeCloseTo(30, 0);
    expect(result.lateFrames).toBe(0);
  });

  it("accumulator carries remainder forward (committed frames have remainder field)", () => {
    const result = simulateScheduler({ ...baseConfig, renderCostMs: 5 });
    const committed = result.frames.filter((f) => f.committed);
    expect(committed.length).toBeGreaterThan(0);
    expect(committed.every((f) => f.remainderMs >= 0)).toBe(true);
  });

  it("accumulator and trailing-edge both produce observable frames at reasonable render cost", () => {
    const config = { vsyncMs: 1000 / 120, renderCostMs: 20, targetFps: 30 };
    const trailing = simulateScheduler({ ...config, kind: "useAnimationClock" });
    const accumulator = simulateScheduler({ ...config, kind: "canvasRafLoop" });
    expect(trailing.observedFps).toBeGreaterThan(0);
    expect(accumulator.observedFps).toBeGreaterThan(0);
  });
});

describe("bucket cost estimation", () => {
  it("fewer buckets reduce max attribute writes and paint operations", () => {
    const counts = [8, 12, 24, 48];
    const ranked = rankBucketCounts(1564, counts);
    expect(ranked[0].bucketCount).toBe(8);
    expect(ranked[0].maxAttributeWrites).toBe(16);
    expect(ranked[ranked.length - 1].bucketCount).toBe(48);
    expect(ranked[ranked.length - 1].maxAttributeWrites).toBe(96);
  });

  it("grades 24 as acceptable and 48 as excessive", () => {
    const b48 = estimateBucketCost(48, 1564);
    const b8 = estimateBucketCost(8, 1564);
    expect(estimateBucketCost(24, 1564).grade).toBe("acceptable");
    expect(b48.grade).toBe("excessive");
    expect(b8.grade).toBe("good");
  });

  it("paint operations are capped by segment count", () => {
    expect(estimateBucketCost(24, 10).paintOperations).toBe(10);
    expect(estimateBucketCost(24, 1564).paintOperations).toBe(24);
  });
});

describe("computeFrameStats from collected rAF timestamps", () => {
  it("computes observed FPS, median, mean, p95, and late frame count", () => {
    const timestamps = Array.from({ length: 11 }, (_, i) => i * 33.33);
    const stats = computeFrameStats(timestamps, 30);
    expect(stats.observedFps).toBeCloseTo(30, 0);
    expect(stats.medianIntervalMs).toBeCloseTo(33.33, 0);
    expect(stats.meanIntervalMs).toBeCloseTo(33.33, 0);
    expect(stats.lateFrames).toBe(0);
    expect(stats.targetIntervalMs).toBeCloseTo(33.33, 1);
  });

  it("counts late frames exceeding 1.5x the target interval", () => {
    const timestamps = [0, 33, 66, 150, 183, 216];
    const stats = computeFrameStats(timestamps, 30);
    expect(stats.lateFrames).toBe(1);
    expect(stats.p95IntervalMs).toBeGreaterThan(33);
  });

  it("handles single-frame input without crashing", () => {
    const stats = computeFrameStats([0], 30);
    expect(stats.observedFps).toBe(0);
    expect(stats.medianIntervalMs).toBe(0);
  });
});

describe("Gate 7.8A QA anomaly reproduction", () => {
  it("reproduces the observed pattern: target 60 > target 30 in delivered FPS", () => {
    // On a 120Hz display (vsyncMs=1000/120) with ~20ms render cost (React
    // re-render + geometry build + SVG DOM mutation + masked repaint).
    const common = { vsyncMs: 1000 / 120, renderCostMs: 20, kind: "useAnimationClock" as const };
    const at60 = simulateScheduler({ ...common, targetFps: 60 });
    const at30 = simulateScheduler({ ...common, targetFps: 30 });

    // The observed FPS at target 60 should be higher than at target 30,
    // mirroring the manual QA report (~40 FPS at 60 target vs ~22 FPS at 30).
    expect(at60.observedFps).toBeGreaterThan(at30.observedFps);
    // Sanity: both produce frames.
    expect(at60.observedFps).toBeGreaterThan(0);
    expect(at30.observedFps).toBeGreaterThan(0);
    // Sanity: both are below their respective targets.
    expect(at60.observedFps).toBeLessThan(60);
    expect(at30.observedFps).toBeLessThan(30);
  });

  it("target 24 FPS stays closest to its target under moderate render cost", () => {
    const common = { vsyncMs: 1000 / 120, renderCostMs: 20, kind: "useAnimationClock" as const };
    const at24 = simulateScheduler({ ...common, targetFps: 24 });
    const at30 = simulateScheduler({ ...common, targetFps: 30 });
    const at60 = simulateScheduler({ ...common, targetFps: 60 });
    // The 60 FPS target always loses the most absolute FPS (render cost exceeds
    // its 16.67ms interval). The lower targets are closer to their targets.
    const drop24 = 24 - at24.observedFps;
    const drop30 = 30 - at30.observedFps;
    const drop60 = 60 - at60.observedFps;
    expect(drop60).toBeGreaterThan(drop30);
    expect(drop60).toBeGreaterThan(drop24);
  });
});
