import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { buildCompositeWaveField, createGlyphFieldContext } from "../../src/engine/field/compositeWaveField";
import { createSvg } from "../../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../../src/engine/fontLoader";
import { layoutGlyphs } from "../../src/engine/glyphLayout";
import { migrateAndRepairProject } from "../../src/engine/projectImport";
import { generateRendererGeometry } from "../../src/engine/rendererRuntime";
import { buildSubstrate, SUBSTRATE_RESOLUTIONS } from "../../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../../src/engine/textLayout";
import type { ProjectState, RenderContext } from "../../src/types";
import { extractSvgExportSummary, type SvgExportSummary } from "./canonicalSvg";

export const goldenProjectNames = [
  "edge-current-native",
  "dot-field-native",
  "sdf-contours-native",
  "sdf-halftone-native",
  "wave-contours-native",
  "glyph-diffuser-native",
] as const;

export type GoldenProjectName = typeof goldenProjectNames[number];

let referenceFontPromise: Promise<LoadedFont> | null = null;
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

function loadReferenceFont(): Promise<LoadedFont> {
  referenceFontPromise ??= (() => {
    const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return parseFontBuffer(buffer, "Basic-Regular.ttf");
  })();
  return referenceFontPromise;
}

export function readGoldenProject(name: GoldenProjectName): ProjectState {
  const input = JSON.parse(readFileSync(
    resolve(`tests/fixtures/projects/${name}.substrate.json`),
    "utf8",
  )) as unknown;
  return migrateAndRepairProject(input).project;
}

export async function generateGoldenExport(name: GoldenProjectName): Promise<{
  project: ProjectState;
  svg: string;
  summary: SvgExportSummary;
}> {
  const project = readGoldenProject(name);
  const referenceFont = await loadReferenceFont();
  const referenceGeometry = layoutGlyphs(project, referenceFont);
  const layout = getTextLayout(project, false);
  const substrate = buildSubstrate({
    sourceText: project.text,
    textGeometry: referenceGeometry,
    fontSize: project.fontSize,
    tracking: project.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: project.kerningMode,
    resolution: SUBSTRATE_RESOLUTIONS[project.substrateQuality],
    bounds: referenceGeometry.bounds,
  }, canvasFactory).data;
  const baseContext: RenderContext = {
    timeMs: 0,
    frame: 0,
    textGeometry: referenceGeometry,
    substrateData: substrate,
  };
  const field = buildCompositeWaveField(project, baseContext);
  const context: RenderContext = { ...baseContext, ...createGlyphFieldContext(field) };
  const geometry = generateRendererGeometry(project, context);

  // The checked-in projects use native fallback. Reference geometry stabilizes
  // the test substrate only and is deliberately not passed to SVG serialization.
  const svg = createSvg(project, context, null, geometry);
  return { project, svg, summary: extractSvgExportSummary(svg) };
}
