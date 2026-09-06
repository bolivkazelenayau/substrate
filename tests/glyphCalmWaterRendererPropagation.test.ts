import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { authoritativeFootprintClearance, emitterMicroResponseGeometryKey } from "../src/engine/field/emitterMicroResponse";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { deriveGlyphCalmWaterGeometry } from "../src/engine/glyphCalmWater";
import { deriveDisplacedTypographyGeometry } from "../src/engine/glyphDisplacement";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import type { CircleMark } from "../src/engine/geometry";
import { baseState } from "../src/engine/presets";
import { createStaticRenderContext } from "../src/engine/renderContextLifecycle";
import { generateRendererGeometry, rendererGeometryCacheKey } from "../src/engine/rendererRuntime";
import { resolveRendererRequirements } from "../src/engine/rendererRequirements";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { ProjectState, RendererId } from "../src/types";

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

function project(renderer: RendererId, withSlice = false): ProjectState {
  return {
    ...baseState,
    renderer,
    text: "POOL",
    font: loaded.metadata,
    fontSize: 300,
    density: 28,
    maxNodes: 1200,
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 600,
      customY: 360,
      frequency: 0.06,
      phase: 0.35,
    },
    glyphInfluence: { ...baseState.glyphInfluence, radius: 115, edgeSoftness: 180 },
    glyphCalmWater: {
      ...baseState.glyphCalmWater,
      enabled: true,
      strength: 10,
      frequencyMultiplier: 0.6,
      surfaceVariation: 34,
      drift: 8,
      detail: 12,
    },
    glyphDisplacement: {
      ...baseState.glyphDisplacement,
      enabled: withSlice,
      mode: "horizontal-slices",
      sliceInfluence: "emitter-falloff",
      strength: 24,
      fragmentSize: 42,
      gap: 2,
      jitter: 8,
      fragmentRotation: 0,
    },
  };
}

function build(state: ProjectState) {
  const source = layoutGlyphs(state, loaded);
  const water = deriveGlyphCalmWaterGeometry(state, source, "typography:water-renderer");
  const sliced = deriveDisplacedTypographyGeometry(state, water.geometry, water.geometryKey);
  const geometry = sliced.geometry!;
  const geometryKey = sliced.geometryKey;
  const scene = resolveSceneLayout(state, geometry);
  const layout = getTextLayout(state, true);
  const substrate = buildSubstrate({
    sourceText: state.text,
    textGeometry: geometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: state.kerningMode,
    resolution: { width: 340, height: 204 },
    bounds: geometry.bounds,
    domainBounds: scene.effectiveArtboard,
    viewport: scene.effectiveArtboard,
  }, canvasFactory).data;
  const substrateKey = `substrate:${geometryKey}`;
  const context = createStaticRenderContext(
    state,
    geometry,
    substrate,
    scene.effectiveArtboard,
    resolveRendererRequirements(state.renderer),
    geometryKey,
    substrateKey,
  );
  return { source, water, sliced, geometry, geometryKey, substrate, substrateKey, context };
}

describe("Calm Water renderer and exterior-authority propagation", () => {
  for (const renderer of ["sdf-halftone", "sdf-contours", "wave-contours", "glyph-diffuser"] as const) {
    it(`feeds the same water domain through ${renderer}`, () => {
      const state = project(renderer);
      const frame = build(state);
      const output = generateRendererGeometry(state, frame.context);
      expect(frame.water.active).toBe(true);
      expect(frame.context.textGeometry).toBe(frame.water.geometry);
      expect(frame.context.textGeometryKey).toBe(frame.water.geometryKey);
      expect(frame.context.substrateKey).toBe(frame.substrateKey);
      expect(output.geometries.length).toBeGreaterThan(0);
      expect(rendererGeometryCacheKey(state, frame.context)).toContain(frame.geometryKey);
      expect(frame.geometry.glyphs[0].path.d).not.toBe(frame.source.glyphs[0].path.d);
    });
  }

  it("keeps every dispersed particle footprint outside the final Water-plus-Slice silhouette and counters", () => {
    const state: ProjectState = {
      ...project("glyph-diffuser", true),
      emitterMicroResponse: {
        ...baseState.emitterMicroResponse,
        enabled: true,
        positionDetail: 72,
        responseRadius: 260,
        maxDisplacement: 16,
        occupancy: "disperse-exterior",
        exteriorPush: 64,
        tangentialFlow: 30,
        divergence: 16,
        exteriorShell: 52,
      },
    };
    const frame = build(state);
    const output = generateRendererGeometry(state, frame.context);
    const circles = output.geometries.filter((item): item is CircleMark => item.type === "circle");
    expect(frame.water.active).toBe(true);
    expect(frame.sliced.active).toBe(true);
    expect(frame.sliced.sourceTypographyKey).toBe(frame.water.geometryKey);
    expect(frame.context.textGeometry).toBe(frame.sliced.geometry);
    expect(output.diagnostics?.emitterMicroResponseMode).toBe("micro/disperse-exterior");
    expect(output.diagnostics?.emitterMicroAffectedCount).toBeGreaterThan(0);
    expect(output.diagnostics?.emitterMicroFinalFootprintViolations).toBe(0);
    expect(emitterMicroResponseGeometryKey(state, frame.context)).toContain(`sdf:${frame.substrateKey}`);
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.every((circle) => authoritativeFootprintClearance(frame.substrate, circle).valid)).toBe(true);
  });
});
