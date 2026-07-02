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
import { resolveContourDomain } from "../src/engine/contourDomain";

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
    text: "FORM",
    font: loaded.metadata,
    renderer: "sdf-contours",
    density: 42,
    amplitude: 30,
    turbulence: 18,
    edgeInfluence: 55,
    maxNodes: 1600,
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrateData = buildSubstrate({
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
  context = { timeMs: 0, frame: 0, textGeometry, substrateData };
});

describe("SDF Contours renderer", () => {
  it("is registered", () => {
    expect(renderers["sdf-contours"]).toBeDefined();
    expect(getRenderer("sdf-contours").label).toBe("SDF Contours");
  });

  it("extracts finite contour polyline geometry", () => {
    const group = getRenderer("sdf-contours").generateGeometry(state, context);
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(group.geometries.every((geometry) => geometry.type === "polyline" && geometry.points.length >= 3)).toBe(true);
    expect(group.geometries.every((geometry) =>
      geometry.type === "polyline" && geometry.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))).toBe(true);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: true, fallback: false });
  });

  it("is deterministic for identical state and context", () => {
    const renderer = getRenderer("sdf-contours");
    expect(renderer.generateGeometry(state, context)).toEqual(renderer.generateGeometry(state, context));
  });

  it("changes contour level or point count when density changes", () => {
    const renderer = getRenderer("sdf-contours");
    const low = renderer.generateGeometry({ ...state, density: 10 }, context);
    const high = renderer.generateGeometry({ ...state, density: 80 }, context);
    expect(high.diagnostics?.contourLevelCount).toBeGreaterThan(low.diagnostics?.contourLevelCount ?? 0);
    expect(
      high.diagnostics?.totalContourPoints !== low.diagnostics?.totalContourPoints
      || high.geometries.length !== low.geometries.length,
    ).toBe(true);
  });

  it("changes contour geometry when glyph field displacement is enabled", () => {
    const renderer = getRenderer("sdf-contours");
    const enabled = { ...state, emitter: { ...state.emitter, enabled: true }, glyphFieldMode: "strong" as const, glyphFieldInfluence: 100, glyphFieldDisplacement: 28 };
    const off = renderer.generateGeometry({ ...enabled, glyphFieldMode: "off" }, context);
    const modulated = renderer.generateGeometry(enabled, context);
    expect(modulated.geometries).not.toEqual(off.geometries);
    expect(modulated.diagnostics).toMatchObject({ glyphFieldEnabled: true, glyphFieldMode: "strong" });
  });

  it("preserves single-mode modulation and responds to multiple shared-field sources", () => {
    const renderer = getRenderer("sdf-contours");
    const enabled = {
      ...state,
      emitter: { ...state.emitter, enabled: true },
      glyphFieldMode: "strong" as const,
      glyphFieldInfluence: 100,
      glyphFieldDisplacement: 28,
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

  it("enforces maxNodes against contour point output", () => {
    const group = getRenderer("sdf-contours").generateGeometry({ ...state, maxNodes: 75 }, context);
    expect(geometryNodeCost(group)).toBeLessThanOrEqual(75);
    expect(group.diagnostics?.totalContourPoints).toBeLessThanOrEqual(75);
    expect(group.diagnostics).toMatchObject({
      maxNodesClipped: true,
      warning: "Contour fragments were clipped by the maxNodes point budget.",
    });
  });

  it("fairly reduces large-type contours across the full visible span", () => {
    const largeState = { ...state, text: "SUBSTRATE", fontSize: 560, density: 58, maxNodes: 400 };
    const textGeometry = layoutGlyphs(largeState, loaded);
    const layout = getTextLayout(largeState, true);
    const domain = resolveContourDomain(largeState, textGeometry, textGeometry.bounds);
    const substrateData = buildSubstrate({
      sourceText: largeState.text,
      textGeometry,
      fontSize: largeState.fontSize,
      tracking: largeState.tracking,
      fontFamily: layout.fontFamily,
      fontWeight: layout.fontWeight,
      baselineY: layout.baselineY,
      textX: layout.x,
      resolution: {
        width: Math.round(192 * domain.resolutionScaleX),
        height: Math.round(115 * domain.resolutionScaleY),
      },
      bounds: textGeometry.bounds,
      domainBounds: domain.bounds,
    }, canvasFactory).data;
    const largeContext = { timeMs: 0, frame: 0, textGeometry, substrateData };
    const renderer = getRenderer("sdf-contours");
    const limited = renderer.generateGeometry(largeState, largeContext);
    const complete = renderer.generateGeometry({ ...largeState, maxNodes: 5000 }, largeContext);
    const limitedX = limited.geometries.flatMap((geometry) => geometry.type === "polyline" ? geometry.points.map((point) => point.x) : []);
    const completeX = complete.geometries.flatMap((geometry) => geometry.type === "polyline" ? geometry.points.map((point) => point.x) : []);
    const fullMin = Math.min(...completeX);
    const fullMax = Math.max(...completeX);
    const third = (fullMax - fullMin) / 3;

    expect(limited.diagnostics?.maxNodesClipped).toBe(true);
    expect(limited.diagnostics?.warning).toBe("Contour detail was reduced by the maxNodes point budget.");
    expect(limitedX.some((x) => x <= fullMin + third)).toBe(true);
    expect(limitedX.some((x) => x > fullMin + third && x < fullMax - third)).toBe(true);
    expect(limitedX.some((x) => x >= fullMax - third)).toBe(true);
    expect(Math.min(...limitedX)).toBeLessThanOrEqual(fullMin + third * 0.25);
    expect(Math.max(...limitedX)).toBeGreaterThanOrEqual(fullMax - third * 0.25);
    expect(renderer.generateGeometry(largeState, largeContext)).toEqual(limited);
    expect(complete.diagnostics?.maxNodesClipped).toBe(false);
    expect(substrateData.domainBounds!.x).toBeLessThan(textGeometry.bounds!.x);
    expect(substrateData.domainBounds!.x + substrateData.domainBounds!.width).toBeGreaterThan(textGeometry.bounds!.x + textGeometry.bounds!.width);
    expect(fullMin).toBeLessThan(0);
    expect(fullMax).toBeGreaterThan(1200);
    expect(fullMin - substrateData.domainBounds!.x).toBeGreaterThan(domain.padding * 0.25);
    expect(substrateData.domainBounds!.x + substrateData.domainBounds!.width - fullMax).toBeGreaterThan(domain.padding * 0.25);
  });

  it("returns an explicit empty fallback without substrate", () => {
    const group = getRenderer("sdf-contours").generateGeometry(state, { timeMs: 0, frame: 0 });
    expect(group.geometries).toEqual([]);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: false, fallback: true, contourLevelCount: 0 });
  });

  it("keeps contour points inside the glyph mask within boundary tolerance", () => {
    const group = getRenderer("sdf-contours").generateGeometry(state, context);
    const points = group.geometries.flatMap((geometry) => geometry.type === "polyline" ? geometry.points : []);
    const inside = points.filter((point) => sampleMask(context.substrateData!, point.x, point.y) >= 0.4);
    expect(inside.length / points.length).toBeGreaterThan(0.95);
  });

  it("serializes contour polylines as vector SVG and passes reload validation", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelectorAll("#generated-artwork polyline").length).toBeGreaterThan(0);
    expect(validation.document?.querySelectorAll('#generated-artwork polyline:not([fill="none"])')).toHaveLength(0);
    expect(validation.document?.querySelector("#generated-artwork image")).toBeNull();
    const metadata = JSON.parse(validation.document!.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({ renderer: "SDF Contours", rendererId: "sdf-contours" });
  });
});
