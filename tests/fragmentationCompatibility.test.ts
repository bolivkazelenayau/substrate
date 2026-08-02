import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { buildCompositeWaveField, createGlyphFieldContext } from "../src/engine/field/compositeWaveField";
import { authoritativeFootprintClearance } from "../src/engine/field/emitterMicroResponse";
import { deriveDisplacedTypographyGeometry } from "../src/engine/glyphDisplacement";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { generateRendererGeometry, rendererGeometryCacheKey, summarizeGeometry } from "../src/engine/rendererRuntime";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { buildSubstrate, SUBSTRATE_RESOLUTIONS } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { GlyphBounds } from "../src/engine/glyphGeometry";
import type { CircleMark } from "../src/engine/geometry";
import type { LoadedFont } from "../src/engine/fontLoader";
import type { ProjectState, RenderContext } from "../src/types";
import { currentFragmentationFixtures, protectedFragmentationModes } from "./fixtures/currentFragmentationProjects";
import { extractSvgExportSummary } from "./utils/canonicalSvg";
import { loadReferenceFont } from "./utils/sceneLayoutHarness";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundedBounds = (bounds: GlyphBounds | null) => bounds && ({
  x: round(bounds.x),
  y: round(bounds.y),
  width: round(bounds.width),
  height: round(bounds.height),
});

function fragmentBoundsHash(bounds: GlyphBounds[]): string {
  return createHash("sha256")
    .update(JSON.stringify(bounds.map(roundedBounds)))
    .digest("hex")
    .slice(0, 20);
}

async function fragmentationArtifacts(state: ProjectState, font: LoadedFont) {
  const source = layoutGlyphs(state, font);
  const displaced = deriveDisplacedTypographyGeometry(
    state,
    source,
    "typography-output:protected-fragmentation-fixture",
  );
  const activeGeometry = displaced.geometry!;
  const scene = resolveSceneLayout(state, activeGeometry);
  const layout = getTextLayout(state, true);
  const substrate = buildSubstrate({
    sourceText: state.text,
    textGeometry: activeGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: state.kerningMode,
    resolution: SUBSTRATE_RESOLUTIONS[state.substrateQuality],
    bounds: activeGeometry.bounds,
    viewport: scene.effectiveArtboard,
  }, canvasFactory).data;
  const baseContext: RenderContext = {
    timeMs: 0,
    frame: 0,
    textGeometry: activeGeometry,
    textGeometryKey: displaced.geometryKey,
    substrateData: substrate,
    substrateKey: `substrate:${displaced.geometryKey}`,
    viewport: {
      ...scene.effectiveArtboard,
      centerX: scene.effectiveArtboard.x + scene.effectiveArtboard.width / 2,
      centerY: scene.effectiveArtboard.y + scene.effectiveArtboard.height / 2,
    },
  };
  const field = buildCompositeWaveField(state, baseContext);
  const context: RenderContext = { ...baseContext, ...createGlyphFieldContext(field) };
  const geometry = generateRendererGeometry(state, context);
  const rendererKey = rendererGeometryCacheKey(state, context);
  const svg = createSvg(
    state,
    context,
    activeGeometry,
    geometry,
    { timeMs: 0, frame: 0 },
    scene.effectiveArtboard,
    { typographyKey: displaced.geometryKey, sceneKey: scene.key, rendererKey },
  );

  return { displaced, activeGeometry, scene, substrate, context, geometry, rendererKey, svg };
}

async function fragmentationSummary(state: ProjectState, font: LoadedFont) {
  const { displaced, scene, geometry, rendererKey, svg } = await fragmentationArtifacts(state, font);

  return {
    displacementKey: displaced.displacementKey,
    geometryKey: displaced.geometryKey,
    fragmentCount: displaced.fragments.length,
    clippingStatus: displaced.diagnostics.clippingStatus,
    inkBounds: roundedBounds(displaced.inkBounds),
    fragmentBoundsHash: fragmentBoundsHash(displaced.fragmentBounds),
    sceneKey: scene.key,
    rendererKey,
    renderer: summarizeGeometry(geometry),
    svg: extractSvgExportSummary(svg),
  };
}

describe("protected current glyph fragmentation structural output", () => {
  let font: LoadedFont;

  beforeAll(async () => {
    font = await loadReferenceFont();
  });

  it("keeps every current mode's geometry, preview structure, and vector export stable", async () => {
    const summaries = Object.fromEntries(await Promise.all(
      protectedFragmentationModes.map(async (mode) => [mode, await fragmentationSummary(currentFragmentationFixtures[mode], font)]),
    ));

    const expected = JSON.parse(readFileSync(
      resolve("tests/fixtures/fragmentation-summaries.json"),
      "utf8",
    )) as unknown;
    expect(summaries).toEqual(expected);
  });

  it("uses fragmented typography as the authoritative exterior obstacle", async () => {
    const baseline = currentFragmentationFixtures.grid;
    const state: ProjectState = {
      ...baseline,
      maxNodes: 5000,
      emitterMicroResponse: {
        ...baseline.emitterMicroResponse,
        enabled: true,
        positionDetail: 34,
        densityBreakup: 0,
        responseRadius: 520,
        maxDisplacement: 14,
        occupancy: "disperse-exterior",
        exteriorPush: 64,
        tangentialFlow: 30,
        divergence: 18,
        exteriorShell: 52,
      },
    };
    const { displaced, substrate, context, geometry } = await fragmentationArtifacts(state, font);
    const circles = geometry.geometries.filter(
      (item): item is CircleMark => item.type === "circle",
    );
    const diagnostics = geometry.diagnostics!;

    expect(displaced.fragments.length).toBeGreaterThan(0);
    expect(context.substrateKey).toBe(`substrate:${displaced.geometryKey}`);
    expect(diagnostics.emitterMicroInteriorCount).toBeGreaterThan(0);
    expect(diagnostics.emitterMicroRelocatedCount).toBeGreaterThan(0);
    expect(diagnostics.emitterMicroFinalExteriorCount).toBeGreaterThan(0);
    expect(diagnostics.emitterMicroFinalFootprintViolations).toBe(0);
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.every((circle) => (
      authoritativeFootprintClearance(substrate, circle).valid
    ))).toBe(true);
  });
});
