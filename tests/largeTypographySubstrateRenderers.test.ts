import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveContourDomain } from "../src/engine/contourDomain";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { buildGlyphSamplingDiagnostics, resolveVisibleGlyphSamplingBounds } from "../src/engine/rendererSampling";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { GeometryGroup, Point } from "../src/engine/geometry";
import type { ProjectState, RenderContext, RendererId } from "../src/types";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

function points(group: GeometryGroup): Point[] {
  return group.geometries.flatMap((geometry) => {
    if (geometry.type === "circle") return [geometry.center];
    if (geometry.type === "line") return [geometry.start, geometry.end];
    if (geometry.type === "polyline") return geometry.points;
    return [];
  });
}

function candidateOrigins(group: GeometryGroup): Point[] {
  return group.geometries.flatMap((geometry) => {
    if (geometry.type === "circle") return [geometry.center];
    if (geometry.type === "line") return [geometry.start];
    if (geometry.type === "polyline") return geometry.points.length > 0 ? [geometry.points[0]] : [];
    return [];
  });
}

function contains(bounds: { x: number; y: number; width: number; height: number }, point: Point) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
}

let loaded: LoadedFont;
let state: ProjectState;
let context: RenderContext;
let edgeBounds: Array<{ x: number; y: number; width: number; height: number }>;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = await parseFontBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "Basic-Regular.ttf",
  );
  state = {
    ...baseState,
    text: "SUBSTRATE",
    font: loaded.metadata,
    fontSize: 560,
    density: 58,
    maxNodes: 5000,
    renderer: "sdf-contours",
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const domain = resolveContourDomain(state, textGeometry, textGeometry.bounds);
  const substrateData = buildSubstrate({
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 384, height: 230 },
    bounds: textGeometry.bounds,
    domainBounds: domain.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData };
  edgeBounds = resolveVisibleGlyphSamplingBounds(state, context, { x: 0, y: 0, width: 1200, height: 720 });
});

describe.each([
  "sdf-flow",
  "sdf-streamlines",
  "sdf-halftone",
  "sdf-contours",
] as RendererId[])("%s large-type substrate coverage", (rendererId) => {
  it("retains output in both edge glyph intersections deterministically", () => {
    expect(edgeBounds.length).toBeGreaterThanOrEqual(2);
    const rendererState = { ...state, renderer: rendererId };
    const renderer = getRenderer(rendererId);
    const first = renderer.generateGeometry(rendererState, context);
    const second = renderer.generateGeometry(rendererState, context);
    const output = points(first);
    expect(output.some((point) => contains(edgeBounds[0], point))).toBe(true);
    expect(output.some((point) => contains(edgeBounds[edgeBounds.length - 1], point))).toBe(true);
    expect(first).toEqual(second);
  });
});

describe.each(["ripple", "dots"] as RendererId[])("%s partial-glyph candidate density", (rendererId) => {
  it("spends the large-type candidate budget inside visible glyph intersections", () => {
    const rendererState = { ...state, renderer: rendererId };
    const renderer = getRenderer(rendererId);
    const first = renderer.generateGeometry(rendererState, context);
    const second = renderer.generateGeometry(rendererState, context);
    const origins = candidateOrigins(first);
    const diagnostics = buildGlyphSamplingDiagnostics(context, origins, origins);
    const partial = diagnostics.filter((glyph) => glyph.visibility === "partial");
    const middle = diagnostics.find((glyph) => glyph.visibility === "inside" && glyph.generatedMarkCount > 0);

    expect(partial.length).toBeGreaterThanOrEqual(2);
    expect(middle).toBeDefined();
    for (const glyph of partial) {
      expect(glyph.visibleArea).toBeGreaterThan(0);
      expect(glyph.generatedMarkCount).toBeGreaterThan(2);
      expect(glyph.droppedMarkCount).toBe(0);
      expect(glyph.retainedCandidateCount).toBe(glyph.candidateCount);
      expect(glyph.retainedDensity).toBeGreaterThanOrEqual(middle!.retainedDensity * 0.25);
    }
    expect(first).toEqual(second);
  });
});
