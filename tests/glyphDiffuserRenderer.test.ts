import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { getGlyphEmitterMetadata } from "../src/engine/field/glyphEmitters";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer, renderers } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleMask } from "../src/engine/substrate/sampling";
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
    text: "SONIC",
    font: loaded.metadata,
    renderer: "glyph-diffuser",
    density: 54,
    turbulence: 24,
    maxNodes: 1400,
    diffuserDomain: "text-halo",
    diffuserComposition: "behind-text",
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 300, neighborInfluence: 1, falloff: "gaussian" },
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrateData = buildSubstrate({
    sourceText: state.text, textGeometry, fontSize: state.fontSize, tracking: state.tracking,
    fontFamily: layout.fontFamily, fontWeight: layout.fontWeight, baselineY: layout.baselineY,
    textX: layout.x, resolution: { width: 192, height: 115 }, bounds: textGeometry.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData };
});

describe("Glyph Diffuser renderer", () => {
  it("is registered, static, substrate-backed, and emitter-aware", () => {
    const renderer = renderers["glyph-diffuser"];
    expect(renderer).toBeDefined();
    expect(renderer.usesTime).toBe(false);
    expect(renderer.usesSubstrate).toBe(true);
    expect(renderer.usesGlyphEmitterField).toBe(true);
  });

  it("generates deterministic finite vector dots", () => {
    const renderer = getRenderer("glyph-diffuser");
    const first = renderer.generateGeometry(state, context);
    const second = renderer.generateGeometry(state, context);
    expect(first.geometries.length).toBeGreaterThan(0);
    expect(second.geometries).toEqual(first.geometries);
    first.geometries.forEach((geometry) => {
      expect(geometry.type).toBe("circle");
      if (geometry.type === "circle") {
        expect(Number.isFinite(geometry.center.x + geometry.center.y + geometry.opacity)).toBe(true);
        expect(geometry.radius).toBeGreaterThan(0);
      }
    });
  });

  it("changes distribution for another emitter glyph and radius/falloff", () => {
    const renderer = getRenderer("glyph-diffuser");
    const baseline = renderer.generateGeometry(state, context);
    const glyphs = getGlyphEmitterMetadata(state, context.textGeometry!);
    const other = renderer.generateGeometry({ ...state, emitter: { ...state.emitter, glyphId: glyphs[4].glyphId } }, context);
    const tighter = renderer.generateGeometry({ ...state, emitter: { ...state.emitter, radius: 120, falloff: "linear" } }, context);
    expect(other.geometries).not.toEqual(baseline.geometries);
    expect(tighter.geometries).not.toEqual(baseline.geometries);
  });

  it("enforces maxNodes", () => {
    const group = getRenderer("glyph-diffuser").generateGeometry({ ...state, maxNodes: 60, density: 80 }, context);
    expect(group.geometries.length).toBeLessThanOrEqual(60);
  });

  it("places halo dots outside the glyph mask but clipped mode stays inside", () => {
    const renderer = getRenderer("glyph-diffuser");
    const halo = renderer.generateGeometry(state, context);
    expect(halo.geometries.some((geometry) => geometry.type === "circle" && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) < 0.5)).toBe(true);
    const clipped = renderer.generateGeometry({ ...state, diffuserComposition: "clipped", diffuserDomain: "inside-text" }, context);
    expect(clipped.geometries.length).toBeGreaterThan(0);
    expect(clipped.geometries.every((geometry) => geometry.type === "circle" && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) >= 0.5)).toBe(true);
  });

  it("returns safe fallback diagnostics without emitter or substrate", () => {
    const renderer = getRenderer("glyph-diffuser");
    expect(renderer.generateGeometry({ ...state, emitter: { ...state.emitter, enabled: false } }, context).diagnostics).toMatchObject({ fallback: true, acceptedDots: 0 });
    expect(renderer.generateGeometry(state, { timeMs: 0, frame: 0 }).diagnostics).toMatchObject({ fallback: true });
  });

  it("exports vector-only halo dots and parsed text overlay", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(validateSvgReload(svg).valid).toBe(true);
    expect(parsed.querySelectorAll("#generated-artwork circle").length).toBeGreaterThan(0);
    expect(parsed.querySelector("#diffuser-text-overlay path")).not.toBeNull();
    expect(parsed.querySelector("#generated-artwork")?.hasAttribute("mask")).toBe(false);
    expect(svg).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);
  });

  it("keeps Wave Contours registered and operational", () => {
    const wave = getRenderer("wave-contours").generateGeometry({ ...state, renderer: "wave-contours" }, context);
    expect(wave.diagnostics?.fallback).toBe(false);
    expect(wave.geometries.length).toBeGreaterThan(0);
  });
});
