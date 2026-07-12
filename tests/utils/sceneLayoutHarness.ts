import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect } from "vitest";
import { createStaticRenderContext } from "../../src/engine/renderContextLifecycle";
import {
  captureExportSnapshot,
  documentKey,
  resolveFontResolution,
  substrateBuildInputKey,
  typographyInputKey,
  typographyOutputKey,
} from "../../src/engine/exportAuthority";
import { createSvg } from "../../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../../src/engine/fontLoader";
import { layoutGlyphs } from "../../src/engine/glyphLayout";
import { migrateAndRepairProject } from "../../src/engine/projectImport";
import { baseState } from "../../src/engine/presets";
import { rendererGeometryCacheKey } from "../../src/engine/rendererRuntime";
import {
  artboardCenter,
  resolveSceneLayout,
  type ResolvedSceneLayout,
} from "../../src/engine/sceneLayout";
import { SUBSTRATE_RESOLUTIONS } from "../../src/engine/substrate/buildSubstrate";
import { getTextLayout } from "../../src/engine/textLayout";
import type { TextGeometry } from "../../src/engine/glyphGeometry";
import type { ProjectState, RenderContext } from "../../src/types";
import { extractSvgExportSummary } from "./canonicalSvg";

let referenceFontPromise: Promise<LoadedFont> | null = null;

export function loadReferenceFont(): Promise<LoadedFont> {
  referenceFontPromise ??= (async () => {
    const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return parseFontBuffer(buffer, "Basic-Regular.ttf");
  })();
  return referenceFontPromise;
}

export function roundTripState(state: ProjectState, sizes: number[]): ProjectState {
  let current = state;
  for (const fontSize of sizes) {
    current = { ...current, fontSize };
  }
  return current;
}

export function resolveSceneForState(
  state: ProjectState,
  textGeometry: TextGeometry | null = null,
): ResolvedSceneLayout {
  return resolveSceneLayout(state, textGeometry);
}

export function buildProductionSceneFrame(
  state: ProjectState,
  textGeometry: TextGeometry | null = null,
): {
  scene: ResolvedSceneLayout;
  context: RenderContext;
  rendererKey: string;
  svgViewBox: string;
  exportSceneKey: string;
} {
  const scene = resolveSceneLayout(state, textGeometry);
  const context = createStaticRenderContext(state, textGeometry, null, scene.effectiveArtboard);
  const font = resolveFontResolution(state, null);
  const typographyInput = typographyInputKey(state, font.resourceKey!);
  const typographyOutput = typographyOutputKey(typographyInput, font, textGeometry)!;
  const rendererKey = rendererGeometryCacheKey(state, context);
  const svg = createSvg(state, context, textGeometry, undefined, undefined, scene.effectiveArtboard);
  const svgViewBox = extractSvgExportSummary(svg).viewBox;
  const exportSceneKey = captureExportSnapshot({
    state,
    documentKey: documentKey(state),
    font,
    typographyInputKey: typographyInput,
    typographyOutputKey: typographyOutput,
    typographyGeometry: textGeometry,
    substrateInputKey: "unused",
    substrateOutputKey: null,
    substrateData: null,
    context: { mode: state.exportFrameMode, timeMs: 0, frame: 0 },
    appVersion: "test",
    authoredArtboard: scene.authoredArtboard,
    effectiveArtboard: scene.effectiveArtboard,
    sceneLayoutKey: scene.key,
    typographyPlacementKey: scene.typography.key,
  }).sceneLayoutKey;
  return { scene, context, rendererKey, svgViewBox, exportSceneKey };
}

export async function buildSubstrateSceneFrame(state: ProjectState, loadedFont: LoadedFont | null = null) {
  const textGeometry = loadedFont ? layoutGlyphs(state, loadedFont) : null;
  const scene = resolveSceneLayout(state, textGeometry);
  const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));
  const substrateInput = {
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: state.kerningMode,
    resolution: SUBSTRATE_RESOLUTIONS[state.substrateQuality],
    bounds: textGeometry?.bounds ?? null,
    viewport: scene.effectiveArtboard,
  };
  const font = resolveFontResolution(state, loadedFont);
  const typographyInput = typographyInputKey(state, font.resourceKey!);
  const substrateKey = substrateBuildInputKey(substrateInput, typographyInput);
  const context = createStaticRenderContext(state, textGeometry, null, scene.effectiveArtboard);
  return { scene, context, substrateKey, textGeometry };
}

export function assertCenterPreserved(scene: ResolvedSceneLayout) {
  const authoredCenter = {
    x: scene.authoredArtboard.width / 2,
    y: scene.authoredArtboard.height / 2,
  };
  const effectiveCenter = artboardCenter(scene.effectiveArtboard);
  expect(effectiveCenter.x).toBeCloseTo(authoredCenter.x, 3);
  expect(effectiveCenter.y).toBeCloseTo(authoredCenter.y, 3);
}

export function loadLargeV8Project(): ProjectState {
  const input = {
    ...baseState,
    version: 8,
    artboard: { width: 3367, height: 777 },
    fontSize: 148,
    textOffsetY: 0,
  };
  return migrateAndRepairProject(input).project;
}