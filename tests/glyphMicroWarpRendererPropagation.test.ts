import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createStaticRenderContext } from "../src/engine/renderContextLifecycle";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { deriveGlyphMicroWarpGeometry } from "../src/engine/glyphMicroWarp";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry, rendererGeometryCacheKey } from "../src/engine/rendererRuntime";
import { resolveRendererRequirements } from "../src/engine/rendererRequirements";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { ProjectState, RendererId } from "../src/types";
import { authoritativeFootprintClearance, emitterMicroResponseGeometryKey } from "../src/engine/field/emitterMicroResponse";
import type { CircleMark } from "../src/engine/geometry";

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

function project(renderer: RendererId, active: boolean): ProjectState {
  return {
    ...baseState,
    renderer,
    text: "OX",
    font: loaded.metadata,
    fontSize: 380,
    density: 22,
    maxNodes: 800,
    emitter: {
      ...baseState.emitter,
      enabled: true,
      glyphId: null,
      sourceMode: "counter-center",
    },
    glyphMicroWarp: {
      ...baseState.glyphMicroWarp,
      enabled: active,
      strength: 92,
      responseRadius: 180,
      detailScale: 18,
      normalDisplacement: 92,
      tangentialDisplacement: 18,
      maxDisplacement: 20,
      preserveCounters: false,
    },
  };
}

function substrateFor(state: ProjectState, textGeometry: ReturnType<typeof layoutGlyphs>) {
  const scene = resolveSceneLayout(state, textGeometry);
  const layout = getTextLayout(state, true);
  const data = buildSubstrate({
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    kerningMode: state.kerningMode,
    resolution: { width: 320, height: 192 },
    bounds: textGeometry.bounds,
    domainBounds: scene.effectiveArtboard,
    viewport: scene.effectiveArtboard,
  }, canvasFactory).data;
  return { scene, data };
}

function frame(renderer: RendererId, active: boolean) {
  const state = project(renderer, active);
  const source = layoutGlyphs(state, loaded);
  const micro = deriveGlyphMicroWarpGeometry(state, source, "typography:renderer-propagation");
  const textGeometry = micro.geometry!;
  const substrate = substrateFor(state, textGeometry);
  const typographyKey = micro.geometryKey;
  const substrateKey = `substrate:${typographyKey}`;
  const context = createStaticRenderContext(
    state,
    textGeometry,
    substrate.data,
    substrate.scene.effectiveArtboard,
    resolveRendererRequirements(renderer),
    typographyKey,
    substrateKey,
  );
  return {
    state,
    source,
    micro,
    context,
    substrate: substrate.data,
    renderer: generateRendererGeometry(state, context),
    rendererKey: rendererGeometryCacheKey(state, context),
  };
}

describe("Glyph Micro Warp downstream renderer propagation", () => {
  for (const renderer of ["sdf-halftone", "sdf-contours", "wave-contours", "glyph-diffuser"] as const) {
    it(`feeds one warped mask/SDF authority into ${renderer}`, () => {
      const baseline = frame(renderer, false);
      const warped = frame(renderer, true);
      expect(warped.micro.active).toBe(true);
      expect(warped.context.textGeometry).toBe(warped.micro.geometry);
      expect(warped.context.textGeometryKey).toBe(warped.micro.geometryKey);
      expect(warped.micro.geometry?.microWarp?.geometryKey).toBe(warped.micro.geometryKey);
      expect(warped.renderer.geometries.length).toBeGreaterThan(0);
      expect(warped.rendererKey).not.toBe(baseline.rendererKey);
      expect(warped.context.substrateKey).not.toBe(baseline.context.substrateKey);
      expect(warped.micro.geometry?.glyphs[0].path.d).not.toBe(baseline.source.glyphs[0].path.d);
      const maskProof = {
        baselineInk: Array.from(baseline.substrate.mask.data).filter((value) => value > 0).length,
        warpedInk: Array.from(warped.substrate.mask.data).filter((value) => value > 0).length,
        changedPixels: Array.from(warped.substrate.mask.data).filter((value, index) => value !== baseline.substrate.mask.data[index]).length,
      };
      expect(maskProof.baselineInk).toBeGreaterThan(0);
      expect(maskProof.warpedInk).toBeGreaterThan(0);
      expect(maskProof.changedPixels, JSON.stringify(maskProof)).toBeGreaterThan(0);
    });
  }

  it("composes the warped domain with existing Display Dislocation", () => {
    const state: ProjectState = {
      ...project("sdf-halftone", true),
      dotGrid: { ...baseState.dotGrid, enabled: true, spacing: 10 },
      displayDislocation: {
        ...baseState.displayDislocation,
        enabled: true,
        displacementAmount: 34,
        responseRadius: 280,
      },
    };
    const source = layoutGlyphs(state, loaded);
    const micro = deriveGlyphMicroWarpGeometry(state, source, "typography:display-composition");
    const substrate = substrateFor(state, micro.geometry!);
    const context = createStaticRenderContext(
      state,
      micro.geometry,
      substrate.data,
      substrate.scene.effectiveArtboard,
      resolveRendererRequirements(state.renderer),
      micro.geometryKey,
      `substrate:${micro.geometryKey}`,
    );
    const geometry = generateRendererGeometry(state, context);
    expect(context.textGeometry?.microWarp?.warpKey).toBe(micro.warpKey);
    expect(geometry.diagnostics?.displayDislocationMode).toBe(state.displayDislocation.mode);
    expect(geometry.diagnostics?.displayDislocationCandidateCount).toBeGreaterThan(0);
  });

  it("keeps footprint-safe Emitter Micro Response downstream of the warped authoritative domain", () => {
    const state: ProjectState = {
      ...project("glyph-diffuser", true),
      emitterMicroResponse: {
        ...baseState.emitterMicroResponse,
        enabled: true,
        positionDetail: 88,
        responseRadius: 260,
        maxDisplacement: 18,
        occupancy: "disperse-exterior",
        exteriorPush: 68,
        tangentialFlow: 34,
        divergence: 18,
        exteriorShell: 48,
      },
    };
    const source = layoutGlyphs(state, loaded);
    const micro = deriveGlyphMicroWarpGeometry(state, source, "typography:mark-composition");
    const markOnlyChanged = deriveGlyphMicroWarpGeometry({
      ...state,
      emitterMicroResponse: { ...state.emitterMicroResponse, positionDetail: 5, densityBreakup: 99 },
    }, source, "typography:mark-composition");
    expect(markOnlyChanged.geometryKey).toBe(micro.geometryKey);
    expect(markOnlyChanged.geometry?.glyphs[0].path.d).toBe(micro.geometry?.glyphs[0].path.d);

    const substrate = substrateFor(state, micro.geometry!);
    const context = createStaticRenderContext(
      state,
      micro.geometry,
      substrate.data,
      substrate.scene.effectiveArtboard,
      resolveRendererRequirements(state.renderer),
      micro.geometryKey,
      `substrate:${micro.geometryKey}`,
    );
    const geometry = generateRendererGeometry(state, context);
    const circles = geometry.geometries.filter(
      (item): item is CircleMark => item.type === "circle",
    );
    expect(geometry.diagnostics?.emitterMicroResponseMode).toBe("micro/disperse-exterior");
    expect(geometry.diagnostics?.emitterMicroAffectedCount).toBeGreaterThan(0);
    expect(geometry.diagnostics?.emitterMicroRelocatedCount).toBeGreaterThan(0);
    expect(geometry.diagnostics?.emitterMicroFinalFootprintViolations).toBe(0);
    expect(context.textGeometry?.microWarp?.geometryKey).toBe(micro.geometryKey);
    expect(context.substrateKey).toBe(`substrate:${micro.geometryKey}`);
    expect(emitterMicroResponseGeometryKey(state, context)).toContain(`sdf:substrate:${micro.geometryKey}`);
    expect(circles.length).toBeGreaterThan(0);
    expect(circles.every((circle) => (
      authoritativeFootprintClearance(substrate.data, circle).valid
    ))).toBe(true);
  });
});
