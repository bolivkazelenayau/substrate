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
    text: "FLOW",
    font: loaded.metadata,
    renderer: "sdf-flow",
    density: 2,
    maxNodes: 60,
    edgeInfluence: 72,
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

describe("SDF Flow renderer", () => {
  it("is registered with the renderer registry", () => {
    expect(renderers["sdf-flow"]).toBeDefined();
    expect(getRenderer("sdf-flow").label).toBe("SDF Flow");
  });

  it("produces finite line geometry from a visible glyph substrate", () => {
    const group = getRenderer("sdf-flow").generateGeometry(state, context);
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(group.geometries.every((geometry) => geometry.type === "line")).toBe(true);
    expect(group.geometries.every((geometry) => {
      if (geometry.type !== "line") return false;
      return [geometry.start.x, geometry.start.y, geometry.end.x, geometry.end.y, geometry.opacity].every(Number.isFinite);
    })).toBe(true);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: true, fallback: false });
  });

  it("is deterministic for the same state, seed, and context", () => {
    const renderer = getRenderer("sdf-flow");
    expect(renderer.generateGeometry(state, context)).toEqual(renderer.generateGeometry(state, context));
  });

  it("changes output when the seed changes", () => {
    const renderer = getRenderer("sdf-flow");
    const first = renderer.generateGeometry(state, context);
    const second = renderer.generateGeometry({ ...state, seed: state.seed + 1 }, context);
    expect(second.geometries).not.toEqual(first.geometries);
  });

  it("returns a clear empty fallback without substrate data", () => {
    const group = getRenderer("sdf-flow").generateGeometry(state, { timeMs: 0, frame: 0 });
    expect(group.geometries).toEqual([]);
    expect(group.diagnostics).toMatchObject({
      substrateAvailable: false,
      fallback: true,
      acceptedCandidates: 0,
    });
  });

  it("places accepted candidate origins inside the sampled glyph mask", () => {
    const group = getRenderer("sdf-flow").generateGeometry(state, context);
    const substrate = context.substrateData!;
    const inside = group.geometries.filter((geometry) =>
      geometry.type === "line" && sampleMask(substrate, geometry.start.x, geometry.start.y) >= 0.45);
    expect(inside.length / group.geometries.length).toBeGreaterThan(0.95);
  });

  it("survives vector SVG serialization and XML reload validation", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelectorAll("#generated-artwork path").length).toBeGreaterThan(0);
    const metadata = JSON.parse(validation.document!.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({ renderer: "SDF Flow", rendererId: "sdf-flow", substrateType: "glyph-paths" });
  });
});
