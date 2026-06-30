import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import {
  assertFinalArtworkExportable,
  PREVIEW_ONLY_EXPORT_WARNING,
  presetExportKinds,
} from "../src/engine/presetExportability";
import { applyPreset, baseState, presets } from "../src/engine/presets";
import { selectPreviewBackend } from "../src/engine/previewBackend";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { assertVectorOnlySvg } from "../src/engine/svgValidation";
import type { PresetId } from "../src/types";

const context = { timeMs: 0, frame: 0 };
const presetNames = Object.keys(presets) as Array<Exclude<PresetId, "Custom">>;
const forbiddenRaster = /<image\b|<canvas\b|<foreignObject\b|data:image\/|;base64,/i;
const vectorTags = new Set(["svg", "metadata", "g", "rect", "defs", "mask", "text", "path", "circle", "line", "polyline"]);

describe("preset vector integrity", () => {
  it.each(presetNames)("%s exports vector-only Final Artwork SVG", (preset) => {
    const state = applyPreset(baseState, preset);
    const geometry = generateRendererGeometry(state, context);
    const first = createSvg(state, context, null, geometry);
    const second = createSvg(state, context, null, geometry);
    const document = new DOMParser().parseFromString(first, "image/svg+xml");
    const secondDocument = new DOMParser().parseFromString(second, "image/svg+xml");

    expect(presetExportKinds[preset]).toBe("vector");
    expect(first).not.toMatch(forbiddenRaster);
    expect([...document.querySelectorAll("*")].map((element) => element.tagName).filter((tag) => !vectorTags.has(tag))).toEqual([]);
    expect(document.querySelector("#generated-artwork")?.outerHTML)
      .toBe(secondDocument.querySelector("#generated-artwork")?.outerHTML);
  });

  it("keeps Edge Current Canvas recommendation isolated from vector export", () => {
    const state = applyPreset(baseState, "Edge Current");
    const geometry = generateRendererGeometry(state, context);
    expect(state.renderer).toBe("flow");
    expect(selectPreviewBackend(state.renderer, geometry.geometries.length, "canvas-2d")).toBe("canvas-2d");
    expect(createSvg(state, context, null, geometry)).not.toMatch(forbiddenRaster);
  });

  it("guards future preview-only Final Artwork presets without blocking Editable Text", () => {
    expect(() => assertFinalArtworkExportable("preview-only", "artwork")).toThrow(PREVIEW_ONLY_EXPORT_WARNING);
    expect(() => assertFinalArtworkExportable("preview-only", "editable")).not.toThrow();
    expect(() => assertVectorOnlySvg('<svg><image href="data:image/png;base64,AAAA"/></svg>')).toThrow(
      "forbidden raster",
    );
  });

  it("keeps canvas and WebGPU modules out of the SVG serializer dependency path", () => {
    const source = readFileSync("src/engine/exportSvg.ts", "utf8");
    expect(source).not.toMatch(/CanvasFlowPreview|CanvasRenderingContext|engine\/gpu|webgpu/i);
  });
});
