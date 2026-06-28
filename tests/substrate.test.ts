import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getTextLayout } from "../src/engine/textLayout";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleDistance, sampleMask } from "../src/engine/substrate/sampling";
import { getDeferredSubstrateDebugImage } from "../src/engine/substrate/debugImage";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const resolution = { width: 192, height: 115 };
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;

beforeAll(() => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function glyphSubstrate(text = "TYPE") {
  const state = { ...baseState, text, font: loaded.metadata };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  return buildSubstrate({
    sourceText: text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution,
    bounds: textGeometry.bounds,
  }, canvasFactory);
}

describe("raster mask, edge map, and signed distance substrate", () => {
  afterEach(() => vi.restoreAllMocks());

  it("builds the requested raster dimensions from glyph paths", () => {
    const result = glyphSubstrate();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      width: 192,
      height: 115,
      viewportWidth: 1200,
      viewportHeight: 720,
      substrateType: "glyph-paths",
    });
    expect(result.data.mask.data).toHaveLength(192 * 115);
  });

  it("produces a non-empty mask and edge map for visible text", () => {
    const { data } = glyphSubstrate();
    expect(data.diagnostics.maskCoverage).toBeGreaterThan(0);
    expect(data.diagnostics.maskCoverage).toBeLessThan(1);
    expect(data.diagnostics.edgePixelCount).toBeGreaterThan(0);
    expect(Array.from(data.edge.data).some((value) => value > 0)).toBe(true);
  });

  it("handles empty text without crashing", () => {
    const result = glyphSubstrate("");
    expect(result.error).toBeNull();
    expect(result.data.substrateType).toBe("empty");
    expect(result.data.diagnostics.maskCoverage).toBe(0);
  });

  it("keeps every distance finite with positive-inside and negative-outside signs", () => {
    const { data } = glyphSubstrate();
    expect(Array.from(data.distance.data).every(Number.isFinite)).toBe(true);
    expect(Array.from(data.distance.data).some((value) => value > 0)).toBe(true);
    expect(Array.from(data.distance.data).some((value) => value < 0)).toBe(true);
    expect(data.diagnostics.minDistance).toBeLessThan(0);
    expect(data.diagnostics.maxDistance).toBeGreaterThan(0);
  });

  it("samples mask and distance in SVG world coordinates", () => {
    const { data } = glyphSubstrate();
    let insideIndex = 0;
    for (let index = 1; index < data.mask.data.length; index += 1) {
      if (data.mask.data[index] > data.mask.data[insideIndex]) insideIndex = index;
    }
    const rasterX = insideIndex % data.width;
    const rasterY = Math.floor(insideIndex / data.width);
    const worldX = rasterX / (data.width - 1) * data.viewportWidth;
    const worldY = rasterY / (data.height - 1) * data.viewportHeight;
    expect(sampleMask(data, worldX, worldY)).toBeGreaterThan(0.5);
    expect(sampleDistance(data, worldX, worldY)).toBeGreaterThanOrEqual(0);
    expect(sampleMask(data, 0, 0)).toBeLessThan(0.5);
    expect(sampleDistance(data, 0, 0)).toBeLessThan(0);
  });

  it("handles native-text fallback safely", () => {
    const layout = getTextLayout(baseState, false);
    const result = buildSubstrate({
      sourceText: "TYPE",
      textGeometry: null,
      fontSize: baseState.fontSize,
      tracking: baseState.tracking,
      fontFamily: layout.fontFamily,
      fontWeight: layout.fontWeight,
      baselineY: layout.baselineY,
      textX: layout.x,
      resolution,
      bounds: null,
    }, canvasFactory);
    expect(result.error).toBeNull();
    expect(result.data.substrateType).toBe("native-text-fallback");
    expect(result.data.mask.data).toHaveLength(resolution.width * resolution.height);
    expect(Array.from(result.data.distance.data).every(Number.isFinite)).toBe(true);
  });

  it("defers and caches debug images across animation-only reads", async () => {
    const { data } = glyphSubstrate();
    let canvasCreations = 0;
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName !== "canvas") return originalCreateElement(tagName);
      canvasCreations += 1;
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          createImageData: (width: number, height: number) => ({
            data: new Uint8ClampedArray(width * height * 4),
          }),
          putImageData: () => {},
        }),
        toDataURL: () => "data:image/png;base64,debug",
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    const first = await getDeferredSubstrateDebugImage(data, "mask");
    const animationTickRead = await getDeferredSubstrateDebugImage(data, "mask");
    expect(first.url).toBe("data:image/png;base64,debug");
    expect(animationTickRead.generationId).toBe(first.generationId);
    expect(canvasCreations).toBe(1);
  });
});
