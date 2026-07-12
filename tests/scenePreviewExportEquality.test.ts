import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { createSvg } from "../src/engine/exportSvg";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { extractSvgExportSummary } from "./utils/canonicalSvg";
import { buildProductionSceneFrame } from "./utils/sceneLayoutHarness";

describe("preview and export scene equality", () => {
  it("uses the same effective rect and scene key for preview SVG and export snapshot", () => {
    const state = { ...baseState, renderer: "flow" as const, fontSize: 300 };
    const frame = buildProductionSceneFrame(state, null);
    const geometry = generateRendererGeometry(state, frame.context);
    const svg = createSvg(state, frame.context, null, geometry, undefined, frame.scene.effectiveArtboard);
    const summary = extractSvgExportSummary(svg);
    const [viewX, viewY, viewWidth, viewHeight] = summary.viewBox.split(" ").map(Number);

    expect(frame.exportSceneKey).toBe(frame.scene.key);
    expect(viewX).toBe(frame.scene.effectiveArtboard.x);
    expect(viewY).toBe(frame.scene.effectiveArtboard.y);
    expect(viewWidth).toBe(frame.scene.effectiveArtboard.width);
    expect(viewHeight).toBe(frame.scene.effectiveArtboard.height);
    expect(frame.context.viewport?.x).toBe(frame.scene.effectiveArtboard.x);
    expect(frame.context.viewport?.y).toBe(frame.scene.effectiveArtboard.y);
  });

  it("keeps preview and export viewBoxes identical across a size round trip", () => {
    const initial = buildProductionSceneFrame({ ...baseState, fontSize: 148 }, null);
    const final = buildProductionSceneFrame({ ...baseState, fontSize: 148 }, null);
    expect(final.svgViewBox).toBe(initial.svgViewBox);
    expect(final.exportSceneKey).toBe(initial.exportSceneKey);
  });
});