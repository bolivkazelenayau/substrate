import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createStaticRenderContext } from "../src/engine/renderContextLifecycle";
import {
  captureExportSnapshot,
  documentKey,
  resolveFontResolution,
  substrateBuildInputKey,
  typographyInputKey,
  typographyOutputKey,
} from "../src/engine/exportAuthority";
import { createTimedSvgFromSnapshot } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import type { ProjectState, RendererId } from "../src/types";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loadedFont: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loadedFont = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});



function exportSubstrateSnapshot(state: ProjectState, rendererId: RendererId) {
  const stateWithRenderer = { ...state, renderer: rendererId };
  const textGeometry = layoutGlyphs(stateWithRenderer, loadedFont);
  const scene = resolveSceneLayout(stateWithRenderer, textGeometry);
  const layout = getTextLayout(stateWithRenderer, true);
  const substrate = buildSubstrate({
    sourceText: stateWithRenderer.text,
    textGeometry,
    fontSize: stateWithRenderer.fontSize,
    tracking: stateWithRenderer.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: stateWithRenderer.kerningMode,
    resolution: { width: 384, height: 230 },
    bounds: textGeometry.bounds,
    domainBounds: scene.effectiveArtboard,
    viewport: scene.effectiveArtboard,
  }, canvasFactory).data;
  const font = resolveFontResolution(stateWithRenderer, loadedFont);
  const typographyInput = typographyInputKey(stateWithRenderer, font.resourceKey!);
  const typographyOutput = typographyOutputKey(typographyInput, font, textGeometry)!;
  const substrateInputKey = substrateBuildInputKey({
    sourceText: stateWithRenderer.text,
    textGeometry,
    fontSize: stateWithRenderer.fontSize,
    tracking: stateWithRenderer.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: stateWithRenderer.kerningMode,
    resolution: { width: 384, height: 230 },
    bounds: textGeometry.bounds,
    domainBounds: scene.effectiveArtboard,
    viewport: scene.effectiveArtboard,
  }, typographyInput);
  const context = createStaticRenderContext(stateWithRenderer, textGeometry, substrate, scene.effectiveArtboard);
  const geometry = getRenderer(rendererId).generateGeometry(stateWithRenderer, context);
  const snapshot = captureExportSnapshot({
    state: stateWithRenderer,
    documentKey: documentKey(stateWithRenderer),
    font,
    typographyInputKey: typographyInput,
    typographyOutputKey: typographyOutput,
    typographyGeometry: textGeometry,
    substrateInputKey,
    substrateOutputKey: substrateInputKey,
    substrateData: substrate,
    context: { mode: "time-zero", timeMs: 0, frame: 0 },
    appVersion: "test",
    authoredArtboard: scene.authoredArtboard,
    effectiveArtboard: scene.effectiveArtboard,
    sceneLayoutKey: scene.key,
    typographyPlacementKey: scene.typography.key,
  });
  const { svg } = createTimedSvgFromSnapshot(snapshot);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const item of geometry.geometries) {
    const points = item.type === "circle" ? [item.center]
      : item.type === "line" ? [item.start, item.end]
      : item.type === "polyline" ? item.points
      : [];
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { svg, scene, geometry, bounds: { minX, minY, maxX, maxY } };
}

describe.each([
  { rendererId: "sdf-contours" as const, label: "default artboard" },
  { rendererId: "sdf-halftone" as const, label: "default artboard" },
  { rendererId: "sdf-streamlines" as const, label: "default artboard" },
  { rendererId: "sdf-contours" as const, label: "vertically expanded artboard" },
  { rendererId: "sdf-halftone" as const, label: "vertically expanded artboard" },
  { rendererId: "sdf-streamlines" as const, label: "vertically expanded artboard" },
])("$rendererId export spans effective artboard ($label)", ({ rendererId, label }) => {
  it("does not clip geometry to the authored domain", () => {
    const state = label === "default artboard"
      ? {
          ...baseState,
          text: "SUBSTRATE",
          font: loadedFont.metadata,
          fontSize: 414,
          density: 58,
          maxNodes: 5000,
        }
      : {
          ...baseState,
          text: "SUBSTRATE",
          artboard: { width: 1200, height: 600 },
          font: loadedFont.metadata,
          fontSize: 500,
          density: 58,
          maxNodes: 5000,
        };
    const { scene, bounds } = exportSubstrateSnapshot(state, rendererId);
    const effective = scene.effectiveArtboard;
    expect(effective.width).toBeGreaterThan(state.artboard.width);
    const geometryWidth = bounds.maxX - bounds.minX;
    expect(geometryWidth).toBeGreaterThan(effective.width * 0.7);
    expect(bounds.minX).toBeLessThan(effective.x + effective.width * 0.15);
    expect(bounds.maxX).toBeGreaterThan(effective.x + effective.width * 0.85);
    expect(bounds.minX).toBeGreaterThanOrEqual(effective.x - 2);
    expect(bounds.maxX).toBeLessThanOrEqual(effective.x + effective.width + 2);
    expect(bounds.minY).toBeGreaterThanOrEqual(effective.y - 2);
    expect(bounds.maxY).toBeLessThanOrEqual(effective.y + effective.height + 2);
  });
});
