import { describe, expect, it } from "vitest";
import {
  advanceAnimationFrameBudget,
  consumeFrameBudget,
  formatFps,
  getFramePacingStatus,
  shouldPublishAnimationDiagnostics,
  updateTimingAverage,
} from "../src/engine/animationTiming";
import {
  DEFAULT_PREVIEW_FPS_CAP,
  previewBackends,
  recommendedPreviewBackends,
  selectPreviewBackend,
  shouldRunPreviewAnimation,
} from "../src/engine/previewBackend";
import { batchFlowLinesForCanvas, createFlowPreviewFrame } from "../src/engine/flowPreviewFrame";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { createSvg } from "../src/engine/exportSvg";

describe("animation preview", () => {
  it("never reports negative frame time or FPS", () => {
    const invalid = updateTimingAverage(0, -16);
    expect(invalid.averageFrameMs).toBe(0);
    expect(invalid.fps).toBe(0);
    expect(invalid.validity).toBe("invalid");

    const valid = updateTimingAverage(0, 40);
    expect(valid.averageFrameMs).toBe(40);
    expect(valid.fps).toBe(25);
    expect(formatFps(32.1, "valid")).toBe("FPS +31.2");
    expect(formatFps(-32.1, "valid")).toBe("FPS INVALID");
    expect(formatFps(32.1, "invalid")).toBe("FPS INVALID");
    expect(formatFps(32.1, "valid")).not.toContain("-");
  });

  it("reports pacing stability against the selected cap", () => {
    expect(getFramePacingStatus(33.3, 1000 / 30, "valid")).toBe("stable");
    expect(getFramePacingStatus(16.7, 1000 / 60, "valid")).toBe("stable");
    expect(getFramePacingStatus(32, 1000 / 60, "valid")).toBe("unstable");
    expect(getFramePacingStatus(0, 1000 / 30, "invalid")).toBe("unstable");
  });

  it("does not skip every other 60 Hz RAF tick at the 60 FPS cap", () => {
    const target = 1000 / 60;
    expect(consumeFrameBudget(16.6, target).draw).toBe(true);
    expect(consumeFrameBudget(8, target).draw).toBe(false);
    expect(consumeFrameBudget(33.2, 1000 / 30).draw).toBe(true);
  });

  it.each([24, 30, 60])("paces %i FPS accurately on simulated 60 Hz rAF", (targetFps) => {
    const targetInterval = 1000 / targetFps;
    const rafInterval = 1000 / 60;
    let accumulator = 0;
    let commits = 0;
    for (let tick = 0; tick < 600; tick += 1) {
      const budget = advanceAnimationFrameBudget(accumulator, rafInterval, targetInterval);
      accumulator = budget.remainderMs;
      if (budget.draw) commits += 1;
    }
    expect(commits / 10).toBeCloseTo(targetFps, 0);
    expect(commits).toBeLessThanOrEqual(600);
  });

  it("carries remainder at 24 FPS instead of quantizing to three vsyncs", () => {
    const interval = 1000 / 24;
    let accumulator = 0;
    let sawRemainder = false;
    for (let tick = 0; tick < 12; tick += 1) {
      const budget = advanceAnimationFrameBudget(accumulator, 1000 / 60, interval);
      accumulator = budget.remainderMs;
      if (budget.draw && budget.remainderMs > 0) sawRemainder = true;
    }
    expect(sawRemainder).toBe(true);
  });

  it("drops long-gap backlog and emits at most one visual update", () => {
    const result = advanceAnimationFrameBudget(20, 5_000, 1000 / 30);
    expect(result).toMatchObject({ draw: true, remainderMs: 0, phaseDeltaMs: 250, clamped: true });
    expect(advanceAnimationFrameBudget(0, 1000 / 60, 1000 / 30).draw).toBe(false);
  });

  it("publishes diagnostics at a throttled cadence", () => {
    expect(shouldPublishAnimationDiagnostics(16, 0)).toBe(true);
    expect(shouldPublishAnimationDiagnostics(250, 16)).toBe(false);
    expect(shouldPublishAnimationDiagnostics(316, 16)).toBe(true);
  });

  it("keeps Flow Lines preview selection explicit and renderer-scoped", () => {
    expect(DEFAULT_PREVIEW_FPS_CAP).toBe(30);
    expect(selectPreviewBackend("flow", 1564, "canvas-2d")).toBe("canvas-2d");
    expect(selectPreviewBackend("flow", 1564, "svg-dom")).toBe("svg-dom");
    expect(selectPreviewBackend("flow", 1564, "canvas-2d", false)).toBe("svg-dom");
    expect(selectPreviewBackend("ripple", 1564, "canvas-2d")).toBe("svg-dom");
    expect(previewBackends["canvas-2d"]).toMatchObject({
      label: "Canvas Performance",
      detail: "preview only",
    });
    expect(previewBackends["svg-dom"]).toMatchObject({
      label: "SVG Accuracy",
      detail: "vector DOM",
    });
    expect(recommendedPreviewBackends["Edge Current"]).toBe("canvas-2d");
  });

  it("does not animate static renderers, reduced motion, paused previews, or exports", () => {
    expect(shouldRunPreviewAnimation(false, true, false, false)).toBe(false);
    expect(shouldRunPreviewAnimation(true, true, true, false)).toBe(false);
    expect(shouldRunPreviewAnimation(true, false, false, false)).toBe(false);
    expect(shouldRunPreviewAnimation(true, true, false, true)).toBe(false);
    expect(shouldRunPreviewAnimation(true, true, false, false)).toBe(true);
  });

  it("keeps preview backend selection out of deterministic vector export", () => {
    const state = { ...baseState, renderer: "flow" as const, density: 46, maxNodes: 2000 };
    const context = { timeMs: 420, frame: 12 };
    const geometry = generateRendererGeometry(state, context);
    const first = createSvg(state, context, null, geometry);
    expect(generateRendererGeometry(state, context)).toEqual(geometry);
    expect(first).toContain("<path");
    expect(first).not.toMatch(/<canvas|<image|data:image/i);
    expect(JSON.stringify(state)).not.toMatch(/canvas-2d|svg-dom|previewBackend/);
  });

  it("uses the renderer's resolved Flow geometry as the shared preview frame", () => {
    const state = { ...baseState, renderer: "flow" as const };
    const context = { timeMs: 420, frame: 12 };
    const geometry = generateRendererGeometry(state, context);
    const frame = createFlowPreviewFrame(state, context, geometry);
    expect(frame.geometry).toBe(geometry);
    expect(frame.lines).toBe(geometry.geometries);
    expect(frame.bounds).toMatchObject({ width: 1200, height: 720 });
    expect(frame.appearance).toMatchObject({
      primaryColor: state.primaryColor,
      outlineColor: state.outlineColor,
      backgroundColor: state.backgroundColor,
      transparentBackground: state.transparentBackground,
    });
    const batches = batchFlowLinesForCanvas(frame.lines);
    expect(batches).toHaveLength(24);
    expect(batches.reduce((count, batch) => count + batch.lines.length, 0)).toBe(frame.lines.length);
  });
});
