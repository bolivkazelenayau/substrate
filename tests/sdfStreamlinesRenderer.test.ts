import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { geometryNodeCost } from "../src/engine/geometry";
import { baseState } from "../src/engine/presets";
import { getRenderer, renderers } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleMask } from "../src/engine/substrate/sampling";
import { getTextLayout } from "../src/engine/textLayout";
import { validateSvgReload } from "../src/engine/svgValidation";
import type { ProjectState, RenderContext } from "../src/types";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;
let state: ProjectState;
let context: RenderContext;

beforeAll(async () => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
  state = {
    ...baseState,
    text: "FLOW",
    font: loaded.metadata,
    renderer: "sdf-streamlines",
    density: 12,
    amplitude: 22,
    maxNodes: 240,
    edgeInfluence: 62,
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrate = buildSubstrate({
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 192, height: 115 },
    bounds: textGeometry.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData: substrate };
});

describe("SDF Streamlines renderer", () => {
  it("is registered", () => {
    expect(renderers["sdf-streamlines"]).toBeDefined();
    expect(getRenderer("sdf-streamlines").label).toBe("SDF Streamlines");
  });

  it("produces continuous finite polyline geometry", () => {
    const group = getRenderer("sdf-streamlines").generateGeometry(state, context);
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(group.geometries.every((geometry) => geometry.type === "polyline" && geometry.points.length >= 4)).toBe(true);
    expect(group.geometries.every((geometry) =>
      geometry.type === "polyline" && geometry.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: true, fallback: false });
  });

  it("is deterministic for identical state and context", () => {
    const renderer = getRenderer("sdf-streamlines");
    expect(renderer.generateGeometry(state, context)).toEqual(renderer.generateGeometry(state, context));
  });

  it("changes placement when the seed changes", () => {
    const renderer = getRenderer("sdf-streamlines");
    const first = renderer.generateGeometry(state, context);
    const second = renderer.generateGeometry({ ...state, seed: state.seed + 37 }, context);
    expect(second.geometries).not.toEqual(first.geometries);
  });

  it("bends deterministically when glyph field angular modulation is enabled", () => {
    const renderer = getRenderer("sdf-streamlines");
    const enabled = { ...state, emitter: { ...state.emitter, enabled: true }, glyphFieldMode: "strong" as const, glyphFieldInfluence: 100, glyphFieldDisplacement: 30 };
    const off = renderer.generateGeometry({ ...enabled, glyphFieldMode: "off" }, context);
    const first = renderer.generateGeometry(enabled, context);
    expect(first.geometries).not.toEqual(off.geometries);
    expect(renderer.generateGeometry(enabled, context)).toEqual(first);
    expect(first.diagnostics).toMatchObject({ glyphFieldEnabled: true, glyphFieldMode: "strong" });
  });

  it("preserves single-mode modulation and responds to multiple shared-field sources", () => {
    const renderer = getRenderer("sdf-streamlines");
    const enabled = {
      ...state,
      emitter: { ...state.emitter, enabled: true },
      glyphFieldMode: "strong" as const,
      glyphFieldInfluence: 100,
      glyphFieldDisplacement: 30,
      glyphFieldDensity: 80,
    };
    const legacy = renderer.generateGeometry(enabled, context);
    expect(renderer.generateGeometry({
      ...enabled,
      emitterMode: "single",
      emitters: [{ ...enabled.emitters[0], phaseOffset: 2, weight: 0.2 }],
    }, context).geometries).toEqual(legacy.geometries);
    const first = { ...enabled.emitters[0], id: "first", glyphId: "auto-first" };
    const one = renderer.generateGeometry({ ...enabled, emitterMode: "multiple", emitters: [first] }, context);
    const multipleState = {
      ...enabled,
      emitterMode: "multiple" as const,
      emitters: [first, { ...first, id: "last", glyphId: "auto-last", phaseOffset: Math.PI / 2 }],
    };
    const multiple = renderer.generateGeometry(multipleState, context);
    expect(multiple.geometries).not.toEqual(one.geometries);
    expect(renderer.generateGeometry(multipleState, context).geometries).toEqual(multiple.geometries);
  });

  it("returns an explicit empty fallback without substrate", () => {
    const group = getRenderer("sdf-streamlines").generateGeometry(state, { timeMs: 0, frame: 0 });
    expect(group.geometries).toEqual([]);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: false, fallback: true, acceptedStreamlines: 0 });
  });

  it("keeps integrated points inside the sampled mask within tolerance", () => {
    const group = getRenderer("sdf-streamlines").generateGeometry(state, context);
    const points = group.geometries.flatMap((geometry) => geometry.type === "polyline" ? geometry.points : []);
    const inside = points.filter((point) => sampleMask(context.substrateData!, point.x, point.y) >= 0.45);
    expect(inside.length / points.length).toBeGreaterThan(0.98);
  });

  it("enforces maxNodes against total polyline points", () => {
    const limitedState = { ...state, density: 80, maxNodes: 45 };
    const group = getRenderer("sdf-streamlines").generateGeometry(limitedState, context);
    expect(geometryNodeCost(group)).toBeLessThanOrEqual(45);
    expect(group.diagnostics?.totalPolylinePoints).toBeLessThanOrEqual(45);
  });

  it("serializes streamlines as vector polylines and passes SVG reload validation", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelectorAll("#generated-artwork polyline").length).toBeGreaterThan(0);
    expect(validation.document?.querySelector("#generated-artwork image")).toBeNull();
    const metadata = JSON.parse(validation.document!.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({ renderer: "SDF Streamlines", rendererId: "sdf-streamlines" });
  });
});
