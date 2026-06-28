import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { getGlyphEmitterMetadata } from "../src/engine/field/glyphEmitters";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState, presets } from "../src/engine/presets";
import { getRenderer, renderers } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleMask } from "../src/engine/substrate/sampling";
import { getTextLayout } from "../src/engine/textLayout";
import { validateSvgReload } from "../src/engine/svgValidation";
import { generateEdgeErosionMarks, MAX_EDGE_EROSION_MARKS } from "../src/engine/edgeErosion";
import { buildCompositeWaveField, createGlyphFieldContext } from "../src/engine/field/compositeWaveField";
import { areOutlineWarpControlsActive, generateWarpedOutline, NATIVE_OUTLINE_WARP_WARNING, outlineWarpCacheKey } from "../src/engine/outlineWarp";
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
  function warpedContext(warpState: ProjectState) {
    const baseContext = { ...context, textGeometry: context.textGeometry };
    const field = buildCompositeWaveField(warpState, baseContext);
    return { ...baseContext, ...createGlyphFieldContext(field) };
  }

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

  it("changes crest distribution when ring sharpness and band width change", () => {
    const renderer = getRenderer("glyph-diffuser");
    const broad = renderer.generateGeometry({ ...state, ringSharpness: 0.8, bandWidth: 0.65 }, context);
    const sharp = renderer.generateGeometry({ ...state, ringSharpness: 5.5, bandWidth: 0.14 }, context);
    expect(sharp.geometries).not.toEqual(broad.geometries);
    expect(sharp.diagnostics?.averageRingStrength).not.toBe(broad.diagnostics?.averageRingStrength);
    expect(sharp.diagnostics?.acceptedCrestDots).not.toBe(broad.diagnostics?.acceptedCrestDots);
  });

  it("suppresses far-field dust with shaped falloff", () => {
    const group = getRenderer("glyph-diffuser").generateGeometry({
      ...state,
      density: 80,
      emitter: { ...state.emitter, radius: 220, falloff: "gaussian" },
      diffuserHaloPadding: 180,
    }, context);
    const anchorX = group.diagnostics?.emitterAnchorX ?? 0;
    const anchorY = group.diagnostics?.emitterAnchorY ?? 0;
    const farDots = group.geometries.filter((geometry) => geometry.type === "circle"
      && Math.hypot(geometry.center.x - anchorX, geometry.center.y - anchorY) > 248);
    expect(group.diagnostics?.rejectedFarFieldCandidates).toBeGreaterThan(0);
    expect(farDots.length).toBeLessThan(group.geometries.length * 0.25);
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

  it("keeps the Sonic Diffuser overlay solid while localizing erosion to vector bite marks", () => {
    const sonic = { ...state, ...presets["Sonic Diffuser"], font: loaded.metadata };
    const svg = createSvg(sonic, context, context.textGeometry);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    const overlay = parsed.querySelector("#diffuser-text-overlay");
    const erosionFill = parsed.querySelector("#diffuser-overlay-mask g[fill='white']");
    const erosionMarks = parsed.querySelectorAll("#diffuser-erosion-marks circle");
    const maskedFill = parsed.querySelector("#diffuser-text-overlay > g");
    expect(sonic.overlayMode).toBe("solid");
    expect(sonic.textOverlayOpacity).toBe(1);
    expect(overlay?.getAttribute("opacity")).toBe("1");
    expect(erosionFill).not.toBeNull();
    expect(erosionMarks.length).toBeGreaterThan(0);
    expect(parsed.querySelector("#diffuser-overlay-mask g[stroke='black']")).toBeNull();
    expect(maskedFill?.getAttribute("mask")).toBe("url(#diffuser-overlay-mask)");
  });

  it("generates deterministic, bounded subtractive marks only when erosion is enabled", () => {
    const strong = {
      ...state,
      diffuserComposition: "edge-eroded" as const,
      overlayMode: "solid" as const,
      edgeErosionAmount: 1,
      edgeErosionWidth: 32,
      interiorProtection: 0.2,
    };
    const first = generateEdgeErosionMarks(strong, context);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(MAX_EDGE_EROSION_MARKS);
    expect(generateEdgeErosionMarks(strong, context)).toEqual(first);
    expect(generateEdgeErosionMarks({ ...strong, edgeErosionAmount: 0 }, context)).toEqual([]);
  });

  it("strong erosion exports localized circles rather than a continuous subtractive stroke", () => {
    const strong = {
      ...state,
      diffuserComposition: "edge-eroded" as const,
      overlayMode: "solid" as const,
      edgeErosionAmount: 1,
      edgeErosionWidth: 32,
      interiorProtection: 0.2,
    };
    const parsed = new DOMParser().parseFromString(createSvg(strong, context, context.textGeometry), "image/svg+xml");
    expect(parsed.querySelectorAll("#diffuser-erosion-marks circle").length).toBeGreaterThan(0);
    expect(parsed.querySelector("#diffuser-overlay-mask [stroke='black']")).toBeNull();
    expect(parsed.querySelector("#diffuser-text-overlay")?.getAttribute("opacity")).toBe("1");
  });

  it.each(["Sonic Diffuser", "Sonic Halftone"] as const)("%s export remains vector-only", (preset) => {
    const presetState = { ...state, ...presets[preset], font: loaded.metadata };
    const svg = createSvg(presetState, context, context.textGeometry);
    expect(validateSvgReload(svg).valid).toBe(true);
    expect(svg).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);
    expect(svg).toMatch(/<(circle|polyline|path)\b/);
  });

  it("supports warped-outline mode and deforms parsed glyph paths deterministically", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata };
    const warpContext = warpedContext(warpState);
    const first = generateWarpedOutline(warpState, warpContext);
    const second = generateWarpedOutline(warpState, warpContext);
    expect(warpState.overlayMode).toBe("warped-outline");
    expect(first).toEqual(second);
    expect(first.paths.length).toBeGreaterThan(0);
    expect(first.diagnostics.warpedGlyphCount).toBe(first.paths.length);
    expect(first.diagnostics).toMatchObject({
      requestedOverlay: "warped-outline",
      effectiveOverlay: "warped-outline",
      glyphPathSource: "parsed-font",
      active: true,
    });
    expect(first.diagnostics.sampledOutlinePoints).toBeGreaterThan(0);
    expect(first.diagnostics.averageDisplacement).toBeGreaterThan(0);
    expect(first.diagnostics.effectiveWarpStrength).toBeGreaterThan(first.diagnostics.averageDisplacement * 0.8);
    expect(first.diagnostics.activeEmitterGlyph).toMatch(/·/);
    expect(first.paths[0].d).not.toBe(context.textGeometry!.glyphs[0].path.d);
    expect(first.paths.some((path) => path.d.includes("Z"))).toBe(true);
  });

  it("changes warped geometry with emitter frequency and amplitude", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata };
    const baseline = generateWarpedOutline(warpState, warpedContext(warpState));
    const changed = {
      ...warpState,
      amplitude: warpState.amplitude + 12,
      emitter: { ...warpState.emitter, frequency: warpState.emitter.frequency * 1.4 },
    };
    expect(generateWarpedOutline(changed, warpedContext(changed)).paths).not.toEqual(baseline.paths);
  });

  it("clamps strong outline displacement and preserves counter diagnostics", () => {
    const strong = {
      ...state,
      ...presets["Sonic Warp"],
      font: loaded.metadata,
      outlineWarpAmount: 60,
      outlineWarpMaxDisplacement: 3,
      preserveCounters: true,
    };
    const result = generateWarpedOutline(strong, warpedContext(strong));
    expect(result.diagnostics.maxDisplacement).toBeLessThanOrEqual(3);
    expect(result.diagnostics.clampedPoints).toBeGreaterThan(0);
  });

  it("makes every warp shape control affect geometry or sampling diagnostics", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata, outlineWarpAmount: 20 };
    const baseline = generateWarpedOutline(warpState, warpedContext(warpState));
    const variants = [
      { ...warpState, outlineWarpScale: 1.7 },
      { ...warpState, outlineWarpSmoothing: 0.1 },
      { ...warpState, outlineWarpEdgeBias: 0.9 },
      { ...warpState, preserveCounters: !warpState.preserveCounters },
    ];
    variants.forEach((variant) => {
      const result = generateWarpedOutline(variant, warpedContext(variant));
      expect(result.paths).not.toEqual(baseline.paths);
    });
  });

  it("uses max displacement to visibly change and clamp strong geometry", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata, outlineWarpAmount: 60 };
    const tight = { ...warpState, outlineWarpMaxDisplacement: 2 };
    const loose = { ...warpState, outlineWarpMaxDisplacement: 30 };
    const tightResult = generateWarpedOutline(tight, warpedContext(tight));
    const looseResult = generateWarpedOutline(loose, warpedContext(loose));
    expect(tightResult.paths).not.toEqual(looseResult.paths);
    expect(tightResult.diagnostics.maxDisplacement).toBeLessThanOrEqual(2);
    expect(tightResult.diagnostics.clampedPoints).toBeGreaterThan(looseResult.diagnostics.clampedPoints);
  });

  it("returns exact original parsed paths when Warp Amount is zero", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata, outlineWarpAmount: 0 };
    const result = generateWarpedOutline(warpState, warpedContext(warpState));
    expect(result.paths.map((path) => path.d)).toEqual(context.textGeometry!.glyphs.filter((glyph) => glyph.path.d).map((glyph) => glyph.path.d));
    expect(result.diagnostics.averageDisplacement).toBe(0);
    expect(result.diagnostics.maxDisplacement).toBe(0);
  });

  it("invalidates the overlay cache for every warp control but not debug settings", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata };
    const baseline = outlineWarpCacheKey(warpState);
    const variants = [
      { ...warpState, outlineWarpAmount: warpState.outlineWarpAmount + 1 },
      { ...warpState, outlineWarpScale: warpState.outlineWarpScale + 0.1 },
      { ...warpState, outlineWarpSmoothing: warpState.outlineWarpSmoothing - 0.1 },
      { ...warpState, outlineWarpEdgeBias: warpState.outlineWarpEdgeBias + 0.1 },
      { ...warpState, outlineWarpMaxDisplacement: warpState.outlineWarpMaxDisplacement + 1 },
      { ...warpState, preserveCounters: !warpState.preserveCounters },
    ];
    variants.forEach((variant) => expect(outlineWarpCacheKey(variant)).not.toBe(baseline));
    expect(outlineWarpCacheKey({ ...warpState, debug: { ...warpState.debug, glyphBounds: !warpState.debug.glyphBounds } })).toBe(baseline);
  });

  it("exports warped paths as vector-only Final Artwork and keeps Editable Text native", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: loaded.metadata };
    const warpContext = warpedContext(warpState);
    const artwork = createSvg(warpState, warpContext, context.textGeometry);
    const parsedArtwork = new DOMParser().parseFromString(artwork, "image/svg+xml");
    expect(validateSvgReload(artwork).valid).toBe(true);
    expect(parsedArtwork.querySelectorAll("#diffuser-text-overlay path[data-warped-glyph]").length).toBeGreaterThan(0);
    expect(artwork).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);

    const editable = createSvg({ ...warpState, exportMode: "editable" }, warpContext, context.textGeometry);
    const parsedEditable = new DOMParser().parseFromString(editable, "image/svg+xml");
    expect(parsedEditable.querySelector("#generated-artwork text")?.textContent).toBe(warpState.text);
    expect(parsedEditable.querySelector("[data-warped-glyph]")).toBeNull();
  });

  it("falls back safely for native text without pretending to deform it", () => {
    const warpState = { ...state, ...presets["Sonic Warp"], font: null };
    const result = generateWarpedOutline(warpState, { ...warpedContext(warpState), textGeometry: null });
    expect(result.paths).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      requestedOverlay: "warped-outline",
      effectiveOverlay: "solid-fallback",
      active: false,
      glyphPathSource: "native-fallback",
      inactiveReason: "no parsed glyph paths",
      nativeFallbackLimitation: NATIVE_OUTLINE_WARP_WARNING,
    });
    expect(areOutlineWarpControlsActive("warped-outline", false)).toBe(false);
    expect(areOutlineWarpControlsActive("warped-outline", true)).toBe(true);
    const svg = createSvg(warpState, { ...warpedContext(warpState), textGeometry: null }, null);
    expect(validateSvgReload(svg).valid).toBe(true);
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(parsed.querySelector("#diffuser-text-overlay text")).not.toBeNull();
    const metadata = JSON.parse(parsed.querySelector("metadata")!.textContent!);
    expect(metadata.outlineWarp).toMatchObject({
      requestedOverlay: "warped-outline",
      effectiveOverlay: "solid-fallback",
      inactiveReason: "no parsed glyph paths",
    });
    expect(svg).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);
  });

  it("keeps Wave Contours registered and operational", () => {
    const wave = getRenderer("wave-contours").generateGeometry({ ...state, renderer: "wave-contours" }, context);
    expect(wave.diagnostics?.fallback).toBe(false);
    expect(wave.geometries.length).toBeGreaterThan(0);
  });
});
