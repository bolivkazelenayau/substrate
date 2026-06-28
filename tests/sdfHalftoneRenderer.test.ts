import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
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

beforeAll(() => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
  state = {
    ...baseState,
    text: "DOTS",
    font: loaded.metadata,
    renderer: "sdf-halftone",
    density: 56,
    amplitude: 24,
    turbulence: 38,
    edgeInfluence: 54,
    maxNodes: 500,
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

describe("SDF Halftone renderer", () => {
  it("is registered with the renderer registry", () => {
    expect(renderers["sdf-halftone"]).toBeDefined();
    expect(getRenderer("sdf-halftone").label).toBe("SDF Halftone");
  });

  it("produces finite circle geometry inside a visible glyph substrate", () => {
    const group = getRenderer("sdf-halftone").generateGeometry(state, context);
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(group.geometries.every((geometry) => geometry.type === "circle")).toBe(true);
    expect(group.geometries.every((geometry) => {
      if (geometry.type !== "circle") return false;
      return [geometry.center.x, geometry.center.y, geometry.radius, geometry.opacity].every(Number.isFinite)
        && geometry.radius > 0
        && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) >= 0.5;
    })).toBe(true);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: true, fallback: false });
  });

  it("is deterministic for identical state and context, while seed changes placement", () => {
    const renderer = getRenderer("sdf-halftone");
    const first = renderer.generateGeometry(state, context);
    expect(renderer.generateGeometry(state, context)).toEqual(first);
    expect(renderer.generateGeometry({ ...state, seed: state.seed + 1 }, context).geometries).not.toEqual(first.geometries);
  });

  it("responds to density through its candidate or accepted-dot count", () => {
    const renderer = getRenderer("sdf-halftone");
    const low = renderer.generateGeometry({ ...state, density: 18 }, context);
    const high = renderer.generateGeometry({ ...state, density: 76 }, context);
    expect(high.diagnostics?.requestedDots).toBeGreaterThan(low.diagnostics?.requestedDots ?? 0);
    expect(high.geometries.length).not.toBe(low.geometries.length);
  });

  it("uses amplitude to change average dot radius", () => {
    const renderer = getRenderer("sdf-halftone");
    const small = renderer.generateGeometry({ ...state, amplitude: 4 }, context);
    const large = renderer.generateGeometry({ ...state, amplitude: 40 }, context);
    expect(large.diagnostics?.averageRadius).toBeGreaterThan(small.diagnostics?.averageRadius ?? 0);
  });

  it("reacts to the shared glyph field while keeping displaced dots in the mask", () => {
    const renderer = getRenderer("sdf-halftone");
    const enabled = { ...state, emitter: { ...state.emitter, enabled: true }, glyphFieldMode: "strong" as const, glyphFieldInfluence: 100, glyphFieldDisplacement: 24, glyphFieldDensity: 80, glyphFieldRadius: 80 };
    const off = renderer.generateGeometry({ ...enabled, glyphFieldMode: "off" }, context);
    const modulated = renderer.generateGeometry(enabled, context);
    expect(modulated.geometries).not.toEqual(off.geometries);
    expect(modulated.diagnostics).toMatchObject({ glyphFieldEnabled: true, glyphFieldMode: "strong" });
    expect(modulated.geometries.every((geometry) => geometry.type === "circle" && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) >= 0.5)).toBe(true);
  });

  it("uses ring sharpness and band width to structure field-reactive density", () => {
    const renderer = getRenderer("sdf-halftone");
    const enabled = {
      ...state,
      emitter: { ...state.emitter, enabled: true },
      glyphFieldMode: "strong" as const,
      glyphFieldInfluence: 100,
      glyphFieldDensity: 100,
    };
    const broad = renderer.generateGeometry({ ...enabled, ringSharpness: 0.7, bandWidth: 0.7 }, context);
    const sharp = renderer.generateGeometry({ ...enabled, ringSharpness: 6, bandWidth: 0.12 }, context);
    expect(sharp.geometries).not.toEqual(broad.geometries);
    expect(sharp.diagnostics?.averageRingStrength).not.toBe(broad.diagnostics?.averageRingStrength);
    expect(sharp.diagnostics?.acceptedCrestDots).not.toBe(broad.diagnostics?.acceptedCrestDots);
  });

  it("enforces maxNodes as a circle budget", () => {
    const group = getRenderer("sdf-halftone").generateGeometry({ ...state, density: 80, maxNodes: 20 }, context);
    expect(group.geometries.length).toBeLessThanOrEqual(20);
    expect(group.diagnostics?.maxNodesClipped).toBe(true);
  });

  it("returns a clear empty fallback without substrate data", () => {
    const group = getRenderer("sdf-halftone").generateGeometry(state, { timeMs: 0, frame: 0 });
    expect(group.geometries).toEqual([]);
    expect(group.diagnostics).toMatchObject({
      substrateAvailable: false,
      fallback: true,
      acceptedDots: 0,
    });
  });

  it("serializes vector circles and survives XML reload validation", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelectorAll("#generated-artwork circle").length).toBeGreaterThan(0);
    const metadata = JSON.parse(validation.document!.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({ renderer: "SDF Halftone", rendererId: "sdf-halftone", substrateType: "glyph-paths" });
  });
});
