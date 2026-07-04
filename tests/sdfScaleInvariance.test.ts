import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { resolveContourDomain } from "../src/engine/contourDomain";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { resolveSdfScaleContext } from "../src/engine/sdfScale";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { GeometryGroup } from "../src/engine/geometry";
import type { ProjectState, RenderContext, RendererId } from "../src/types";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = await parseFontBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "Basic-Regular.ttf",
  );
});

function fixture(fontSize: number, renderer: RendererId): { state: ProjectState; context: RenderContext } {
  const state: ProjectState = {
    ...baseState,
    text: "SDF",
    font: loaded.metadata,
    fontSize,
    renderer,
    density: 46,
    maxNodes: 3000,
    emitter: { ...baseState.emitter, enabled: true },
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
  return { state, context: { timeMs: 0, frame: 0, textGeometry, substrateData } };
}

function pointCount(group: GeometryGroup) {
  return group.geometries.reduce((total, geometry) =>
    total + (geometry.type === "polyline" ? geometry.points.length : 1), 0);
}

describe("SDF renderer scale invariance", () => {
  it("resolves different deterministic world scales at 148 and 540", () => {
    expect(resolveSdfScaleContext({ fontSize: 148 }).scale).toBe(0.2741);
    expect(resolveSdfScaleContext({ fontSize: 540 }).scale).toBe(1);
    expect(resolveSdfScaleContext({ fontSize: 148 }).world(11, 2)).toBe(3.0148);
    expect(resolveSdfScaleContext({ fontSize: 540 }).world(11, 2)).toBe(11);
  });

  it.each(["sdf-flow", "sdf-streamlines", "sdf-contours", "wave-contours"] as RendererId[])(
    "%s remains non-empty and deterministic at sizes 148 and 540",
    (rendererId) => {
      for (const fontSize of [148, 540]) {
        const { state, context } = fixture(fontSize, rendererId);
        const renderer = getRenderer(rendererId);
        const first = renderer.generateGeometry(state, context);
        const second = renderer.generateGeometry(state, context);
        expect(first.geometries.length).toBeGreaterThan(2);
        expect(pointCount(first)).toBeGreaterThan(8);
        expect(second.geometries).toEqual(first.geometries);
      }
    },
  );

  it("keeps small SDF contour density within a broad useful range of large type", () => {
    const small = fixture(148, "sdf-contours");
    const large = fixture(540, "sdf-contours");
    const smallOutput = getRenderer("sdf-contours").generateGeometry(small.state, small.context);
    const largeOutput = getRenderer("sdf-contours").generateGeometry(large.state, large.context);
    const ratio = pointCount(smallOutput) / pointCount(largeOutput);
    expect(smallOutput.geometries.length).toBeGreaterThan(8);
    expect(ratio).toBeGreaterThan(0.1);
    expect(ratio).toBeLessThan(10);
  });

  it("scales SDF Flow line length separately from contour weight", () => {
    const averageLength = (fontSize: number) => {
      const { state, context } = fixture(fontSize, "sdf-flow");
      const output = getRenderer("sdf-flow").generateGeometry(state, context);
      return output.geometries.reduce((total, geometry) => geometry.type === "line"
        ? total + Math.hypot(geometry.end.x - geometry.start.x, geometry.end.y - geometry.start.y)
        : total, 0) / output.geometries.length;
    };
    expect(averageLength(540)).toBeGreaterThan(averageLength(148) * 2);
  });
});
