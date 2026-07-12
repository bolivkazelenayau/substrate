import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { contextArtboard } from "../src/engine/artboard";
import { createStaticRenderContext } from "../src/engine/renderContextLifecycle";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState, presets } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { worldToLocal } from "../src/engine/sceneLayout";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import { buildProductionSceneFrame, buildSubstrateSceneFrame } from "./utils/sceneLayoutHarness";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

const simpleRenderers = ["flow", "ripple", "dots"] as const;
const substrateRenderers = ["sdf-flow", "sdf-halftone", "sdf-streamlines", "sdf-contours", "wave-contours", "glyph-diffuser"] as const;

let loadedFont: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loadedFont = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function expandedState(renderer: typeof simpleRenderers[number] | typeof substrateRenderers[number]) {
  const preset = renderer === "wave-contours"
    ? presets["Glyph Ripple"]
    : renderer === "glyph-diffuser"
      ? presets["Sonic Diffuser"]
      : {};
  return {
    ...baseState,
    ...preset,
    renderer,
    fontSize: 560,
    density: 58,
    maxNodes: 2800,
    emitter: {
      ...baseState.emitter,
      ...(preset.emitter ?? {}),
      enabled: true,
    },
  };
}

function coordinate(geometry: ReturnType<ReturnType<typeof getRenderer>["generateGeometry"]>["geometries"][number]) {
  if (geometry.type === "circle") return geometry.center;
  if (geometry.type === "line") return geometry.start;
  if (geometry.type === "polyline" && geometry.points.length > 0) return geometry.points[0];
  return null;
}

describe("non-zero-origin renderer domains", () => {
  for (const rendererId of simpleRenderers) {
    it(`${rendererId} uses the effective rect origin in context.viewport`, () => {
      const state = expandedState(rendererId);
      const { scene, context } = buildProductionSceneFrame(state, null);
      expect(scene.effectiveArtboard.x).toBeLessThan(0);
      const artboard = contextArtboard(context);
      expect(artboard.x).toBe(scene.effectiveArtboard.x);
      expect(artboard.y).toBe(scene.effectiveArtboard.y);
      const geometry = getRenderer(rendererId).generateGeometry(state, context);
      const points = geometry.geometries.map(coordinate).filter((point): point is { x: number; y: number } => point !== null);
      expect(points.some((point) => point.x < 0 || point.x > state.artboard.width)).toBe(true);
      expect(points.length).toBeGreaterThan(0);
      expect(points.some((point) => worldToLocal(scene.effectiveArtboard, point).x >= 0)).toBe(true);
    });
  }

  for (const rendererId of substrateRenderers) {
    it(`${rendererId} samples within the shifted effective rect`, async () => {
      const state = {
        ...expandedState(rendererId),
        text: "FLOW",
        font: loadedFont.metadata,
      };
      const textGeometry = layoutGlyphs(state, loadedFont);
      const { scene } = await buildSubstrateSceneFrame(state, loadedFont);
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
        kerningMode: state.kerningMode,
        resolution: { width: 192, height: 115 },
        bounds: textGeometry.bounds,
        viewport: scene.effectiveArtboard,
      }, canvasFactory).data;
      const context = createStaticRenderContext(state, textGeometry, substrate, scene.effectiveArtboard);
      const artboard = contextArtboard(context);
      expect(artboard.x).toBe(scene.effectiveArtboard.x);
      const geometry = getRenderer(rendererId).generateGeometry(state, context);
      const points = geometry.geometries.map(coordinate).filter((point): point is { x: number; y: number } => point !== null);
      expect(points.length).toBeGreaterThan(0);
      for (const point of points) {
        const local = worldToLocal(scene.effectiveArtboard, point);
        expect(local.x).toBeGreaterThanOrEqual(-1);
        expect(local.y).toBeGreaterThanOrEqual(-1);
      }
    });
  }
});