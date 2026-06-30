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
import { areOutlineWarpControlsActive, generateWarpedOutline, getFinalOutlineGeometry, NATIVE_OUTLINE_WARP_WARNING, outlineWarpCacheKey } from "../src/engine/outlineWarp";
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

  it("returns fallback diagnostics when emitter is disabled", () => {
    const noEmitterState = { ...state, emitter: { ...state.emitter, enabled: false } };
    const renderer = getRenderer("glyph-diffuser");
    const result = renderer.generateGeometry(noEmitterState, context);
    expect(result.geometries).toHaveLength(0);
    expect(result.diagnostics?.fallback).toBe(true);
    expect(result.diagnostics?.warning).toBe("Glyph Diffuser requires an enabled glyph emitter.");
  });

  it("treats enabled single-emitter strength zero as neutral with zero marks", () => {
    const renderer = getRenderer("glyph-diffuser");
    const zero = {
      ...state,
      emitter: { ...state.emitter, enabled: true, amplitude: 0 },
    };
    const result = renderer.generateGeometry(zero, context);
    expect(result.geometries).toEqual([]);
    expect(result.diagnostics).toMatchObject({
      activeContributingEmitterCount: 0,
      zeroStrengthEmitterCount: 1,
      renderedMarkCountPerEmitter: { [zero.emitter.id]: 0 },
    });
    expect(result.diagnostics?.warning).toContain("no positive-strength emitter contribution");

    const restored = renderer.generateGeometry({
      ...zero,
      emitter: { ...zero.emitter, amplitude: 0.1 },
    }, context);
    expect(restored.geometries.length).toBeGreaterThan(0);

    const svg = createSvg(zero, context, context.textGeometry, result);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    expect(svg).not.toMatch(/<image|<canvas|data:image/i);
  });

  it("responds continuously and monotonically across low strength values", () => {
    const renderer = getRenderer("glyph-diffuser");
    const shared = {
      ...state,
      density: 68,
      maxNodes: 5000,
      diffuserDomain: "halo" as const,
      emitter: { ...state.emitter, radius: 370 },
    };
    const zero = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, amplitude: 0 },
    }, context);
    const subtle = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, amplitude: 0.05 },
    }, context);
    const low = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, amplitude: 0.25 },
    }, context);
    const normal = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, amplitude: 1 },
    }, context);
    expect(zero.geometries).toHaveLength(0);
    expect(subtle.geometries.length).toBeGreaterThan(0);
    expect(subtle.geometries.length).toBeLessThan(low.geometries.length);
    expect(low.geometries.length).toBeLessThan(normal.geometries.length);
    expect(subtle.diagnostics?.effectiveStrengthResponse).toBeLessThan(
      low.diagnostics?.effectiveStrengthResponse ?? 0,
    );
    expect(low.diagnostics?.effectiveStrengthResponse).toBeLessThan(
      normal.diagnostics?.effectiveStrengthResponse ?? 0,
    );
  });

  it("presets using glyph-diffuser enable an emitter by default", () => {
    expect(presets["Sonic Diffuser"].emitter?.enabled).toBe(true);
    expect(presets["Sonic Warp"].emitter?.enabled).toBe(true);
    expect(presets["Sonic Interference"].emitter?.enabled).toBe(true);
  });

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

  it("preserves single-mode geometry and reacts deterministically to multiple emitters", () => {
    const renderer = getRenderer("glyph-diffuser");
    const legacy = renderer.generateGeometry(state, context);
    const ignoredRows = renderer.generateGeometry({
      ...state,
      emitterMode: "single",
      emitters: [
        { ...state.emitters[0], glyphId: "auto-first", phaseOffset: 2, weight: 0.25 },
        { ...state.emitters[0], id: "ignored", glyphId: "auto-last" },
      ],
    }, context);
    expect(ignoredRows.geometries).toEqual(legacy.geometries);

    const unit = { ...state.emitters[0], id: "first", glyphId: "auto-first", label: "First" };
    const multiState = {
      ...state,
      diffuserRingContrast: 0,
      emitterMode: "multiple" as const,
      emitters: [unit, { ...unit, id: "cancel", phaseOffset: Math.PI }],
    };
    const one = renderer.generateGeometry({ ...multiState, emitters: [unit] }, context);
    const multiple = renderer.generateGeometry(multiState, context);
    expect(multiple.geometries).not.toEqual(one.geometries);
    expect(renderer.generateGeometry(multiState, context).geometries).toEqual(multiple.geometries);
    const svg = createSvg(multiState, context, context.textGeometry, multiple);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    expect(svg).not.toMatch(/<image|<canvas|data:image/i);
  });

  it("samples every multiple-emitter domain and reports renderer comparison diagnostics", () => {
    const renderer = getRenderer("glyph-diffuser");
    const first = { ...state.emitters[0], id: "first", glyphId: "auto-first", label: "First" };
    const last = { ...first, id: "last", glyphId: "auto-last", label: "Last" };
    const multiState = {
      ...state,
      density: 80,
      emitterMode: "multiple" as const,
      emitters: [first, last],
    };
    const result = renderer.generateGeometry(multiState, context);
    expect(result.diagnostics).toMatchObject({
      rendererActiveFieldEmitterCount: 2,
      consumedFieldMode: multiState.fieldBlendMode,
      fieldNormalizationMode: "none",
    });
    expect(result.diagnostics?.renderedMarkCountPerEmitter?.first).toBeGreaterThan(0);
    expect(result.diagnostics?.renderedMarkCountPerEmitter?.last).toBeGreaterThan(0);
    expect(result.diagnostics?.emitterDomainDiagnostics).toEqual([
      expect.objectContaining({
        id: "first",
        weight: first.weight,
        radiusMultiplier: first.radiusMultiplier,
        effectiveRadius: multiState.emitter.radius * first.radiusMultiplier,
        sampleCount: expect.any(Number),
        renderedMarkCount: expect.any(Number),
      }),
      expect.objectContaining({
        id: "last",
        weight: last.weight,
        radiusMultiplier: last.radiusMultiplier,
        effectiveRadius: multiState.emitter.radius * last.radiusMultiplier,
        sampleCount: expect.any(Number),
        renderedMarkCount: expect.any(Number),
      }),
    ]);

    const weakerLast = renderer.generateGeometry({
      ...multiState,
      emitters: [first, { ...last, weight: 0.1 }],
    }, context);
    const tighterLast = renderer.generateGeometry({
      ...multiState,
      emitters: [first, { ...last, radiusMultiplier: 0.35 }],
    }, context);
    expect(weakerLast.geometries).not.toEqual(result.geometries);
    expect(tighterLast.geometries).not.toEqual(result.geometries);
    expect(tighterLast.diagnostics?.emitterDomainDiagnostics?.[0].effectiveRadius)
      .toBe(result.diagnostics?.emitterDomainDiagnostics?.[0].effectiveRadius);
    expect(tighterLast.diagnostics?.emitterDomainDiagnostics?.[1].effectiveRadius)
      .toBe(multiState.emitter.radius * 0.35);
  });

  it("excludes zero-weight rows from fields and marks without suppressing other rows", () => {
    const renderer = getRenderer("glyph-diffuser");
    const first = { ...state.emitters[0], id: "first", glyphId: "auto-first", label: "First", weight: 1 };
    const last = { ...first, id: "last", glyphId: "auto-last", label: "Last", weight: 0 };
    const multiState = {
      ...state,
      density: 80,
      emitterMode: "multiple" as const,
      emitters: [first, last],
    };
    const zeroLast = renderer.generateGeometry(multiState, context);
    expect(zeroLast.geometries.length).toBeGreaterThan(0);
    expect(zeroLast.diagnostics).toMatchObject({
      activeContributingEmitterCount: 1,
      zeroStrengthEmitterCount: 1,
      renderedMarkCountPerEmitter: { first: expect.any(Number), last: 0 },
    });
    expect(zeroLast.diagnostics?.renderedMarkCountPerEmitter?.first).toBeGreaterThan(0);
    expect(zeroLast.diagnostics?.emitterDomainDiagnostics?.map((entry) => entry.id)).toEqual(["first"]);

    const activeLast = renderer.generateGeometry({
      ...multiState,
      emitters: [first, { ...last, weight: 1 }],
    }, context);
    expect(activeLast.diagnostics).toMatchObject({
      activeContributingEmitterCount: 2,
      zeroStrengthEmitterCount: 0,
    });
    expect(activeLast.diagnostics?.renderedMarkCountPerEmitter?.last).toBeGreaterThan(0);
    expect(activeLast.geometries).not.toEqual(zeroLast.geometries);
  });

  it("keeps a low-strength second emitter subtle without reducing the first emitter", () => {
    const renderer = getRenderer("glyph-diffuser");
    const first = { ...state.emitters[0], id: "first", glyphId: "auto-first", label: "First", weight: 1 };
    const last = { ...first, id: "last", glyphId: "auto-last", label: "Last" };
    const shared = {
      ...state,
      density: 68,
      maxNodes: 5000,
      emitterMode: "multiple" as const,
    };
    const subtle = renderer.generateGeometry({
      ...shared,
      emitters: [first, { ...last, weight: 0.05 }],
    }, context);
    const normal = renderer.generateGeometry({
      ...shared,
      emitters: [first, { ...last, weight: 1 }],
    }, context);
    expect(subtle.diagnostics?.renderedMarkCountPerEmitter?.first)
      .toBe(normal.diagnostics?.renderedMarkCountPerEmitter?.first);
    expect(subtle.diagnostics?.renderedMarkCountPerEmitter?.last).toBeGreaterThan(0);
    expect(subtle.diagnostics?.renderedMarkCountPerEmitter?.last)
      .toBeLessThan(normal.diagnostics?.renderedMarkCountPerEmitter?.last ?? 0);
  });

  it("preserves single-mode warped outlines and routes multiple mode through the shared field", () => {
    const warpState = {
      ...state,
      overlayMode: "warped-outline" as const,
      outlineWarpAmount: 24,
      outlineWarpMaxDisplacement: 30,
    };
    const legacy = generateWarpedOutline(warpState, warpedContext(warpState));
    const ignoredRows = {
      ...warpState,
      emitterMode: "single" as const,
      emitters: [{ ...warpState.emitters[0], phaseOffset: 2, radiusMultiplier: 0.5 }],
    };
    expect(generateWarpedOutline(ignoredRows, warpedContext(ignoredRows)).paths).toEqual(legacy.paths);

    const first = { ...warpState.emitters[0], id: "first", glyphId: "auto-first" };
    const oneState = { ...warpState, emitterMode: "multiple" as const, emitters: [first] };
    const multipleState = {
      ...oneState,
      emitters: [first, { ...first, id: "last", glyphId: "auto-last", phaseOffset: Math.PI / 2 }],
    };
    const one = generateWarpedOutline(oneState, warpedContext(oneState));
    const multiple = generateWarpedOutline(multipleState, warpedContext(multipleState));
    expect(multiple.paths).not.toEqual(one.paths);
    expect(generateWarpedOutline(multipleState, warpedContext(multipleState)).paths).toEqual(multiple.paths);
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

  it("keeps mark amount density-driven across practical radius changes", () => {
    const renderer = getRenderer("glyph-diffuser");
    const shared = {
      ...state,
      density: 68,
      maxNodes: 1400,
      diffuserDomain: "halo" as const,
      diffuserHaloPadding: 0,
    };
    const compact = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, radius: 260 },
    }, context);
    const broad = renderer.generateGeometry({
      ...shared,
      emitter: { ...shared.emitter, radius: 700 },
    }, context);
    const delta = Math.abs(compact.geometries.length - broad.geometries.length);
    const baseline = Math.max(1, compact.geometries.length, broad.geometries.length);
    expect(delta / baseline).toBeLessThanOrEqual(0.2);
    expect(compact.diagnostics).toMatchObject({
      candidateCount: expect.any(Number),
      preCapAcceptedCount: expect.any(Number),
      cappedCount: expect.any(Number),
      effectiveDensity: expect.any(Number),
    });
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

  it("edge-feathers deterministic large-radius output at intentional artboard bounds", () => {
    const large = {
      ...state,
      density: 30,
      maxNodes: 5000,
      diffuserDomain: "halo" as const,
      diffuserHaloPadding: 400,
      emitter: { ...state.emitter, radius: 1000 },
    };
    const renderer = getRenderer("glyph-diffuser");
    const first = renderer.generateGeometry(large, context);
    const second = renderer.generateGeometry(large, context);
    expect(second.geometries).toEqual(first.geometries);
    expect(first.diagnostics).toMatchObject({
      artboardBoundsClipped: true,
      artboardEdgeFeather: 56,
    });
    expect(first.diagnostics?.warning).toContain("intentionally edge-feathered and clipped to export bounds");
    expect(first.geometries.every((geometry) => geometry.type !== "circle"
      || (geometry.center.x >= 0 && geometry.center.x <= 1200
        && geometry.center.y >= 0 && geometry.center.y <= 720))).toBe(true);
    const edgeMarks = first.geometries.filter((geometry) => geometry.type === "circle"
      && Math.min(geometry.center.x, 1200 - geometry.center.x, geometry.center.y, 720 - geometry.center.y) < 28);
    expect(edgeMarks.every((geometry) => geometry.opacity <= 0.47)).toBe(true);
    const svg = createSvg(large, context, context.textGeometry, first);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    expect(svg).not.toMatch(/<image|<canvas|data:image/i);
  });

  it("keeps artboard and mark-cap diagnostics independent", () => {
    const renderer = getRenderer("glyph-diffuser");
    const contained = {
      ...state,
      density: 80,
      diffuserDomain: "halo" as const,
      diffuserHaloPadding: 0,
      emitter: { ...state.emitter, radius: 80 },
    };
    const normal = renderer.generateGeometry(contained, context);
    expect(normal.diagnostics).toMatchObject({
      artboardBoundsClipped: false,
      artboardEdgeFeather: 0,
      maxNodesClipped: false,
    });
    expect(normal.diagnostics?.warning).toBeUndefined();

    const capped = renderer.generateGeometry({ ...contained, maxNodes: 1 }, context);
    expect(capped.diagnostics).toMatchObject({
      artboardBoundsClipped: false,
      artboardEdgeFeather: 0,
      maxNodesClipped: true,
    });
    expect(capped.diagnostics?.warning).toContain("1 node budget");
    expect(capped.diagnostics?.warning).not.toContain("artboard");
  });

  it("keeps fixed vector-only SVG bounds for feathered output", () => {
    const large = {
      ...state,
      diffuserDomain: "halo" as const,
      diffuserHaloPadding: 400,
      emitter: { ...state.emitter, radius: 1000 },
    };
    const geometry = getRenderer("glyph-diffuser").generateGeometry(large, context);
    const first = createSvg(large, context, context.textGeometry, geometry);
    const second = createSvg(large, context, context.textGeometry, geometry);
    const stripTimestamp = (svg: string) =>
      svg.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "");
    expect(stripTimestamp(second)).toBe(stripTimestamp(first));
    expect(first).toContain('viewBox="0 0 1200 720"');
    expect(first).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);
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
    expect(validateSvgReload(svg, true).valid).toBe(true);
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
    expect(validateSvgReload(svg, true).valid).toBe(true);
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

  it("uses one closed authoritative path set for fill, outline, preview, and export", () => {
    const outlineState = {
      ...state,
      overlayMode: "outline" as const,
      diffuserComposition: "behind-text" as const,
    };
    const warped = generateWarpedOutline(outlineState, context);
    const final = getFinalOutlineGeometry(context.textGeometry, warped, false);
    expect(final.diagnostics).toMatchObject({
      pathCount: context.textGeometry!.glyphs.length,
      openContourCount: 0,
      clippingApplied: false,
      simplificationApplied: false,
      source: "parsed",
    });
    expect(final.diagnostics.subpathCount).toBeGreaterThan(final.diagnostics.pathCount);

    const outlineSvg = new DOMParser().parseFromString(
      createSvg(outlineState, context, context.textGeometry),
      "image/svg+xml",
    );
    const fillSvg = new DOMParser().parseFromString(
      createSvg({ ...outlineState, overlayMode: "solid" }, context, context.textGeometry),
      "image/svg+xml",
    );
    const outlinePaths = [...outlineSvg.querySelectorAll("#diffuser-text-overlay path")].map((path) => path.getAttribute("d"));
    const fillPaths = [...fillSvg.querySelectorAll("#diffuser-text-overlay path")].map((path) => path.getAttribute("d"));
    expect(outlinePaths).toEqual(final.paths.map((path) => path.d));
    expect(fillPaths).toEqual(outlinePaths);
    expect(outlineSvg.querySelector("#diffuser-text-overlay > g")?.getAttribute("fill-rule")).toBe("evenodd");
    expect(outlineSvg.querySelector("#diffuser-text-overlay > g")?.getAttribute("stroke-linejoin")).toBe("round");
    expect(outlineSvg.querySelector("#diffuser-text-overlay > g")?.getAttribute("stroke-linecap")).toBe("round");
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
    expect(validateSvgReload(artwork, true).valid).toBe(true);
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
    expect(validateSvgReload(svg, false).valid).toBe(true);
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
