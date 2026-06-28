import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { getEmitterContributionAtPoint, getFalloffWeight, buildCompositeWaveField, createGlyphFieldContext, sampleGlyphField, sampleGlyphFieldGradient } from "../src/engine/field/compositeWaveField";
import { getGlyphEmitterAnchor, getGlyphEmitterMetadata } from "../src/engine/field/glyphEmitters";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer, renderers } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import { validateSvgReload } from "../src/engine/svgValidation";
import type { ProjectState, RenderContext } from "../src/types";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return { context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"], createPath: (d) => new Path2D(d) };
};

let loaded: LoadedFont;
let state: ProjectState;
let context: RenderContext;

beforeAll(() => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = parseFontBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "Basic-Regular.ttf");
  state = {
    ...baseState,
    text: "FORM",
    font: loaded.metadata,
    renderer: "wave-contours",
    density: 32,
    maxNodes: 1200,
    emitter: { ...baseState.emitter, enabled: true, glyphId: null, radius: 500, neighborInfluence: 1 },
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrateData = buildSubstrate({
    sourceText: state.text, textGeometry, fontSize: state.fontSize, tracking: state.tracking,
    fontFamily: layout.fontFamily, fontWeight: layout.fontWeight, baselineY: layout.baselineY,
    textX: layout.x, resolution: { width: 160, height: 96 }, bounds: textGeometry.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData };
});

describe("Wave Contours renderer", () => {
  it("exposes finite shared scalar and central-difference gradient sampling", () => {
    const enabled = { ...state, emitter: { ...state.emitter, enabled: true } };
    const field = buildCompositeWaveField(enabled, context);
    expect(field).not.toBeNull();
    expect(Number.isFinite(sampleGlyphField(field!, field!.anchor.x, field!.anchor.y))).toBe(true);
    const gradient = sampleGlyphFieldGradient(field!, field!.anchor.x + 12, field!.anchor.y);
    expect([gradient.x, gradient.y, gradient.magnitude].every(Number.isFinite)).toBe(true);
    const shared = createGlyphFieldContext(field);
    expect(shared.glyphField).toBe(field);
    expect(shared.glyphFieldDiagnostics?.resolution).toBe(`${field!.width}×${field!.height}`);
    expect(createGlyphFieldContext(null).sampleGlyphField(10, 10)).toBe(0);
  });
  it("registers as a static renderer", () => {
    expect(renderers["wave-contours"]).toBeDefined();
    expect(getRenderer("wave-contours").usesTime).toBe(false);
  });

  it("provides deterministic anchors and falloff curves", () => {
    const glyph = getGlyphEmitterMetadata(state, context.textGeometry!)[1];
    expect(getGlyphEmitterAnchor(glyph, "counter-center")).toEqual(glyph.counterCenter ?? glyph.center);
    expect(getFalloffWeight(0, "linear")).toBe(1);
    expect(getFalloffWeight(1, "smoothstep")).toBe(0);
    expect(getFalloffWeight(0.5, "gaussian")).toBeGreaterThan(0);
  });

  it("builds deterministic fields and neighbor influence changes outside-source contributions", () => {
    const first = buildCompositeWaveField(state, context)!;
    const second = buildCompositeWaveField(state, context)!;
    expect(Array.from(first.data)).toEqual(Array.from(second.data));
    const glyph = first.sourceGlyph;
    const x = glyph.bounds.x + glyph.bounds.width + 30;
    const y = glyph.center.y;
    const none = getEmitterContributionAtPoint({ ...state, emitter: { ...state.emitter, neighborInfluence: 0 } }, glyph, first.anchor, x, y);
    const influenced = getEmitterContributionAtPoint(state, glyph, first.anchor, x, y);
    expect(none).toBe(0);
    expect(influenced).not.toBe(0);
    const glyphs = getGlyphEmitterMetadata(state, context.textGeometry!);
    const other = buildCompositeWaveField({ ...state, emitter: { ...state.emitter, glyphId: glyphs[1].glyphId } }, context)!;
    expect(Array.from(other.data)).not.toEqual(Array.from(first.data));
  });

  it("responds to amplitude, frequency, radius, falloff, and self influence", () => {
    const baseline = buildCompositeWaveField(state, context)!;
    const stronger = buildCompositeWaveField({ ...state, emitter: { ...state.emitter, amplitude: state.emitter.amplitude * 2 } }, context)!;
    expect(Math.max(Math.abs(stronger.min), Math.abs(stronger.max))).toBeGreaterThan(Math.max(Math.abs(baseline.min), Math.abs(baseline.max)));
    const faster = buildCompositeWaveField({ ...state, emitter: { ...state.emitter, frequency: state.emitter.frequency * 1.7 } }, context)!;
    expect(Array.from(faster.data)).not.toEqual(Array.from(baseline.data));

    const glyph = baseline.sourceGlyph;
    const nearEdgeX = baseline.anchor.x + state.emitter.radius * 0.8;
    const smooth = Math.abs(getEmitterContributionAtPoint(state, glyph, baseline.anchor, nearEdgeX, baseline.anchor.y));
    const short = Math.abs(getEmitterContributionAtPoint({ ...state, emitter: { ...state.emitter, radius: state.emitter.radius * 0.5 } }, glyph, baseline.anchor, nearEdgeX, baseline.anchor.y));
    const linear = Math.abs(getEmitterContributionAtPoint({ ...state, emitter: { ...state.emitter, falloff: "linear" } }, glyph, baseline.anchor, nearEdgeX, baseline.anchor.y));
    expect(short).toBe(0);
    expect(linear).not.toBeCloseTo(smooth);

    const sourcePoint = { x: glyph.bounds.x + 2, y: glyph.bounds.y + 2 };
    const noSelf = getEmitterContributionAtPoint({ ...state, emitter: { ...state.emitter, selfInfluence: 0 } }, glyph, baseline.anchor, sourcePoint.x, sourcePoint.y);
    const withSelf = getEmitterContributionAtPoint(state, glyph, baseline.anchor, sourcePoint.x, sourcePoint.y);
    expect(noSelf).toBe(0);
    expect(withSelf).not.toBe(0);
  });

  it("keeps masked-out field values zero and every value finite", () => {
    const field = buildCompositeWaveField(state, context)!;
    field.data.forEach((value, index) => {
      expect(Number.isFinite(value)).toBe(true);
      if (context.substrateData!.mask.data[index] < 0.45) expect(value).toBe(0);
    });
  });

  it("falls back from an invalid glyphId to the first eligible glyph", () => {
    const field = buildCompositeWaveField({ ...state, emitter: { ...state.emitter, glyphId: "removed-glyph" } }, context)!;
    expect(field.sourceGlyph.glyphId).toBe(getGlyphEmitterMetadata(state, context.textGeometry!)[0].glyphId);
  });

  it("produces finite continuous and dotted vector geometry within maxNodes", () => {
    const continuous = getRenderer("wave-contours").generateGeometry(state, context);
    expect(continuous.geometries.length).toBeGreaterThan(0);
    continuous.geometries.forEach((geometry) => {
      expect(geometry.type).toBe("polyline");
      if (geometry.type === "polyline") geometry.points.forEach((point) => expect(Number.isFinite(point.x + point.y)).toBe(true));
    });
    const dotted = getRenderer("wave-contours").generateGeometry({ ...state, waveContourMode: "dotted", maxNodes: 80 }, context);
    expect(dotted.geometries.length).toBeGreaterThan(0);
    expect(dotted.geometries.length).toBeLessThanOrEqual(80);
    dotted.geometries.forEach((geometry) => {
      expect(geometry.type).toBe("circle");
      if (geometry.type === "circle") expect(geometry.radius).toBeGreaterThan(0);
    });
  });

  it("enforces maxNodes in continuous and dotted modes", () => {
    const renderer = getRenderer("wave-contours");
    const continuous = renderer.generateGeometry({ ...state, maxNodes: 80 }, context);
    const continuousPoints = continuous.geometries.reduce((sum, geometry) => sum + (geometry.type === "polyline" ? geometry.points.length : 1), 0);
    expect(continuousPoints).toBeLessThanOrEqual(80);
    const dotted = renderer.generateGeometry({ ...state, waveContourMode: "dotted", maxNodes: 80 }, context);
    expect(dotted.geometries.length).toBeLessThanOrEqual(80);
  });

  it("is deterministic and changes output with the selected glyph", () => {
    const renderer = getRenderer("wave-contours");
    const first = renderer.generateGeometry(state, context);
    const second = renderer.generateGeometry(state, context);
    expect(second.geometries).toEqual(first.geometries);
    const glyphs = getGlyphEmitterMetadata(state, context.textGeometry!);
    const changed = renderer.generateGeometry({ ...state, emitter: { ...state.emitter, glyphId: glyphs[2].glyphId } }, context);
    expect(changed.geometries).not.toEqual(first.geometries);
  });

  it("reports complete field and contour diagnostics", () => {
    const diagnostics = getRenderer("wave-contours").generateGeometry(state, context).diagnostics;
    expect(diagnostics).toMatchObject({
      selectedGlyph: expect.any(String),
      emitterSourceMode: state.emitter.sourceMode,
      fieldWidth: context.substrateData!.width,
      fieldHeight: context.substrateData!.height,
      fieldMembership: "glyph-bounds-approximate",
      waveContourMode: "continuous",
      maxNodesClipped: expect.any(Boolean),
    });
    expect(Number.isFinite(diagnostics!.emitterAnchorX)).toBe(true);
    expect(Number.isFinite(diagnostics!.emitterAnchorY)).toBe(true);
    expect(Number.isFinite(diagnostics!.fieldMin)).toBe(true);
    expect(Number.isFinite(diagnostics!.fieldMax)).toBe(true);
    expect(diagnostics!.fieldBuildTimeMs).toBeGreaterThanOrEqual(0);
    expect(diagnostics!.contourExtractionTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("returns explicit fallback diagnostics without emitter/substrate", () => {
    expect(getRenderer("wave-contours").generateGeometry({ ...state, emitter: { ...state.emitter, enabled: false } }, context).diagnostics).toMatchObject({ fallback: true });
    expect(getRenderer("wave-contours").generateGeometry(state, { timeMs: 0, frame: 0 }).diagnostics).toMatchObject({ fallback: true });
  });

  it("exports parseable vector-only SVG", () => {
    const svg = createSvg(state, context, context.textGeometry);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    expect(svg).toContain("<polyline");
    expect(svg).not.toMatch(/<image|<canvas|data:image/i);
  });
});
