import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { artboardViewport, projectArtboard } from "../src/engine/artboard";
import { resolveSceneLayout } from "../src/engine/artboardExpansion";
import { clearRendererGeometryCache, generateRendererGeometry } from "../src/engine/rendererRuntime";
import { pointInGlyph, resolveGlyphDomains } from "../src/engine/glyphDomain";
import type { GlyphDomain } from "../src/engine/glyphGeometry";
import type { Point } from "../src/engine/geometry";
import type { ProjectState, RenderContext } from "../src/types";

let loaded: LoadedFont;
beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function markOrigins(group: ReturnType<typeof generateRendererGeometry>): Point[] {
  return group.geometries.flatMap((geometry) => {
    if (geometry.type === "circle") return [geometry.center];
    if (geometry.type === "line") return [geometry.start];
    if (geometry.type === "polyline" && geometry.points.length > 0) return [geometry.points[0]];
    return [];
  });
}

/** Mirrors CanvasFlowPreview.draw: viewport only carries {textGeometry, viewport}. */
function canvasRenderContext(state: ProjectState, textGeometry: RenderContext["textGeometry"]): RenderContext {
  const effective = resolveSceneLayout(state, textGeometry).effectiveArtboard;
  return { timeMs: 0, frame: 0, textGeometry, viewport: artboardViewport(effective) };
}

/** Mirrors App's renderContext: adds substrateData, glyphField, sampleGlyphField
 *  via createStaticRenderContext.  */
function svgRenderContext(state: ProjectState, textGeometry: RenderContext["textGeometry"]): RenderContext {
  // createStaticRenderContext pulls substrate/glyphField but Flow doesn't use
  // them; we still construct the same shape to flush out any consumer that
  // accidentally inspects those fields.
  const base = canvasRenderContext(state, textGeometry);
  return {
    ...base,
    substrateData: undefined,
    sampleGlyphField: () => 0,
    sampleGlyphFieldGradient: () => ({ x: 0, y: 0, magnitude: 0 }),
    glyphField: undefined,
    glyphFieldDiagnostics: undefined,
  };
}

describe("Canvas vs SVG glyph mapping contract", () => {
  it("parsed font: SVG and Canvas renderContexts produce identical Flow mark origins", () => {
    const state: ProjectState = { ...baseState, text: "CANVAS", font: loaded.metadata, renderer: "flow", maxNodes: 6000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const canvasCtx = canvasRenderContext(state, textGeometry);
    const svgCtx = svgRenderContext(state, textGeometry);

    clearRendererGeometryCache();
    const canvasGeometry = generateRendererGeometry(state, canvasCtx);
    clearRendererGeometryCache();
    const svgGeometry = generateRendererGeometry(state, svgCtx);

    expect(canvasGeometry.geometries).toEqual(svgGeometry.geometries);
  });

  it.each([148, 540] as const)("parsed font: every Canvas mark origin lies inside its authoritative outline at size %i", (fontSize) => {
    const state: ProjectState = { ...baseState, text: "CANVAS", fontSize, font: loaded.metadata, renderer: "flow", maxNodes: fontSize > 220 ? 6000 : 3000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const ctx = canvasRenderContext(state, textGeometry);
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, ctx);
    const domains = resolveGlyphDomains(state, ctx);
    const eligibleOutline = domains.filter((d) => d.eligible && d.outline) as GlyphDomain[];
    expect(eligibleOutline.length).toBeGreaterThan(0);
    const origins = markOrigins(group);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      const inside = eligibleOutline.some((domain) => pointInGlyph(domain, origin));
      expect(inside).toBe(true);
    }
  });

  it("native fallback (no parsed outlines): every Canvas mark origin lies inside its approximate glyph domain AABB", () => {
    const state: ProjectState = { ...baseState, text: "FALLBACK", font: null, renderer: "flow", maxNodes: 3000 };
    const textGeometry = null;
    const ctx = canvasRenderContext(state, textGeometry);
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, ctx);
    const domains = resolveGlyphDomains(state, ctx);
    expect(domains.length).toBeGreaterThan(0);
    expect(domains.every((d) => d.approximate)).toBe(true);
    expect(domains.every((d) => d.outline === null)).toBe(true);
    const eligible = domains.filter((d) => d.eligible && d.worldBounds) as GlyphDomain[];
    expect(eligible.length).toBeGreaterThan(0);
    const origins = markOrigins(group);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      const inside = eligible.some((domain) => pointInGlyph(domain, origin));
      expect(inside).toBe(true);
    }
  });

  it("Canvas setTransform translation matches the SVG viewBox origin (effective artboard)", () => {
    const state: ProjectState = { ...baseState, text: "ORIGIN", fontSize: 540, font: loaded.metadata, renderer: "flow", maxNodes: 6000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const scene = resolveSceneLayout(state, textGeometry);
    const effectiveRect = scene.effectiveArtboard;
    // SVG viewBox = `${displayArtboard.x} ${displayArtboard.y} ${width} ${height}`.
    // Canvas setTransform = (scaleX, 0, 0, scaleY, -x*scaleX, -y*scaleY).
    // For world coord w: SVG pixel-position relative to viewBox origin is w.
    // Canvas backing-pixel position is (w - x) * scaleX.
    // Centred world coord = effectiveCenter (x + width/2) should land at width*scaleX/2 in both.
    const artboard = artboardViewport(effectiveRect);
    const cssWidth = 800;
    const cssHeight = Math.round(cssWidth * effectiveRect.height / effectiveRect.width);
    const dpr = 2;
    const backingWidth = cssWidth * dpr;
    const backingHeight = cssHeight * dpr;
    const scaleX = backingWidth / artboard.width;
    const scaleY = backingHeight / artboard.height;
    const worldCenterX = artboard.x + artboard.width / 2;
    const worldCenterY = artboard.y + artboard.height / 2;
    const canvasCenterPixelX = worldCenterX * scaleX + (-artboard.x * scaleX);
    const canvasCenterPixelY = worldCenterY * scaleY + (-artboard.y * scaleY);
    expect(canvasCenterPixelX).toBeCloseTo(backingWidth / 2, 6);
    expect(canvasCenterPixelY).toBeCloseTo(backingHeight / 2, 6);
    expect(scaleX).toBeCloseTo(scaleY, 6);
  });

  it.each([
    { zoom: 0.5, label: "50%" },
    { zoom: 1, label: "100%" },
    { zoom: 2, label: "200%" },
  ] as const)("Canvas setTransform stays centred and within the visible backing box at zoom %s (%s)", ({ zoom }) => {
    // The canvas-effect setup sizes the backing store from the *post-zoom*
    // `getBoundingClientRect()` width. scaleX is therefore a function of zoom
    // too, but the per-zoom math keeps the world center on backing center.
    const state: ProjectState = { ...baseState, text: "ZOOM", fontSize: 540, font: loaded.metadata, renderer: "flow", maxNodes: 6000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const scene = resolveSceneLayout(state, textGeometry);
    const artboard = artboardViewport(scene.effectiveArtboard);
    const stageCssWidth = 800;
    const rectWidth = stageCssWidth * zoom;
    const cssWidth = rectWidth || stageCssWidth;
    const dpr = 2;
    const backingWidth = Math.round(cssWidth * dpr);
    const backingHeight = Math.round(backingWidth * artboard.height / artboard.width);
    const scaleX = backingWidth / artboard.width;
    const scaleY = backingHeight / artboard.height;
    const worldCenterX = artboard.x + artboard.width / 2;
    const worldCenterY = artboard.y + artboard.height / 2;
    const e = -artboard.x * scaleX;
    const f = -artboard.y * scaleY;
    const canvasCenterPixelX = worldCenterX * scaleX + e;
    const canvasCenterPixelY = worldCenterY * scaleY + f;
    expect(canvasCenterPixelX).toBeCloseTo(backingWidth / 2, 6);
    expect(canvasCenterPixelY).toBeCloseTo(backingHeight / 2, 6);
    // The visible occupied span at zoom=2 still covers the entire world artboard
    // without slack: world coord artboard.x -> 0, artboard.x + width -> backing.
    const leftEdgePixel = artboard.x * scaleX + e;
    const rightEdgePixel = (artboard.x + artboard.width) * scaleX + e;
    expect(Math.abs(leftEdgePixel)).toBeLessThan(2);
    expect(Math.abs(rightEdgePixel - backingWidth)).toBeLessThan(2);
  });

  it("parsed font: marks stay inside glyph outline across 148 -> 540 -> 148 transform cycle", () => {
    const make = (fontSize: number): { ctx: RenderContext; group: ReturnType<typeof generateRendererGeometry>; domains: GlyphDomain[] } => {
      const state: ProjectState = { ...baseState, text: "CYCLE", fontSize, font: loaded.metadata, renderer: "flow", maxNodes: fontSize > 220 ? 6000 : 3000 };
      const textGeometry = layoutGlyphs(state, loaded);
      const ctx = canvasRenderContext(state, textGeometry);
      clearRendererGeometryCache();
      const group = generateRendererGeometry(state, ctx);
      const domains = resolveGlyphDomains(state, ctx);
      return { ctx, group, domains };
    };
    const initial = make(148);
    const initialGlyphBounds = initial.domains[0].bounds;
    const large = make(540);
    const largeEligible = large.domains.filter((d) => d.eligible && d.outline) as GlyphDomain[];
    expect(largeEligible.length).toBeGreaterThan(0);
    const largeOrigins = markOrigins(large.group);
    for (const p of largeOrigins) {
      expect(largeEligible.some((d) => pointInGlyph(d, p))).toBe(true);
    }
    const back = make(148);
    expect(back.domains[0].bounds).toEqual(initialGlyphBounds);
    const backEligible = back.domains.filter((d) => d.eligible && d.outline) as GlyphDomain[];
    expect(backEligible.length).toBeGreaterThan(0);
    const backOrigins = markOrigins(back.group);
    for (const p of backOrigins) {
      expect(backEligible.some((d) => pointInGlyph(d, p))).toBe(true);
    }
  });

  it("parsed font: every simulated Canvas moveTo user-coord equals a renderer-sampled mark origin and stays inside its glyph domain", () => {
    const state: ProjectState = { ...baseState, text: "MOVETO", fontSize: 540, font: loaded.metadata, renderer: "flow", maxNodes: 6000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const ctx = canvasRenderContext(state, textGeometry);
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, ctx);
    const domains = resolveGlyphDomains(state, ctx).filter((d) => d.eligible && d.worldBounds) as GlyphDomain[];
    const rendererOrigins = new Set(markOrigins(group).map((p) => `${p.x.toFixed(6)}|${p.y.toFixed(6)}`));

    // Simulate CanvasFlowPreview.batchFlowLinesForCanvas reversing the renderer
    // output. The renderer's line segments are bucketed by opacity, but each
    // segment.start = a sampled mark origin and each segment.end = a
    // direction-shifted continuation. The Canvas calls moveTo with these
    // user-coords (= world coords, because setTransform translates only). For
    // every moveTo, the same world coord must exist in the renderer's output
    // and lie inside an eligible glyph domain.
    for (const line of group.geometries as Array<{ start: Point; end: Point; opacity: number; type: string }>) {
      const origin = line.start;
      expect(rendererOrigins.has(`${origin.x.toFixed(6)}|${origin.y.toFixed(6)}`)).toBe(true);
      const inside = domains.some((d) => pointInGlyph(d, origin));
      if (!inside) {
        throw new Error(`Canvas moveTo user-coord (${origin.x}, ${origin.y}) escapes glyph domain containment`);
      }
    }
  });
});
