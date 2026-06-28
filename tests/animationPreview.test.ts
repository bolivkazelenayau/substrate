import { describe, expect, it } from "vitest";
import { consumeFrameBudget, formatFps, getFramePacingStatus, updateTimingAverage } from "../src/engine/animationTiming";
import { DEFAULT_PREVIEW_FPS_CAP, selectPreviewBackend, shouldRunPreviewAnimation } from "../src/engine/previewBackend";
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

  it("selects Canvas 2D for dense animated Flow Lines and keeps SVG fallback selectable", () => {
    expect(DEFAULT_PREVIEW_FPS_CAP).toBe(30);
    expect(selectPreviewBackend("flow", 1564, "auto")).toBe("canvas-2d");
    expect(selectPreviewBackend("flow", 1564, "svg-dom")).toBe("svg-dom");
    expect(selectPreviewBackend("flow", 1564, "canvas-2d", false)).toBe("svg-dom");
    expect(selectPreviewBackend("ripple", 1564, "canvas-2d")).toBe("svg-dom");
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
  });
});
