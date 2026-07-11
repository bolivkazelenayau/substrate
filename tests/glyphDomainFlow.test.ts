import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { clearRendererGeometryCache, generateRendererGeometry } from "../src/engine/rendererRuntime";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { artboardViewport } from "../src/engine/artboard";
import { resolveSceneLayout } from "../src/engine/artboardExpansion";
import {
  resolveGlyphDomains,
  resolveSamplingBounds,
  owningGlyphDomain,
  pointInGlyph,
  contains as domainContains,
} from "../src/engine/glyphDomain";
import { buildGlyphSamplingDiagnostics } from "../src/engine/rendererSampling";
import type { GlyphBounds, GlyphDomain } from "../src/engine/glyphGeometry";
import type { Point } from "../src/engine/geometry";
import type { ProjectState, RenderContext } from "../src/types";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function buildContext(state: ProjectState, textGeometry: RenderContext["textGeometry"]): RenderContext {
  const effective = resolveSceneLayout(state, textGeometry).effectiveArtboard;
  return { timeMs: 0, frame: 0, textGeometry, viewport: artboardViewport(effective) };
}

function markOrigins(group: ReturnType<typeof generateRendererGeometry>): Point[] {
  return group.geometries.flatMap((geometry) => {
    if (geometry.type === "circle") return [geometry.center];
    if (geometry.type === "line") return [geometry.start];
    if (geometry.type === "polyline" && geometry.points.length > 0) return [geometry.points[0]];
    return [];
  });
}

/** Asset the contract: every mark origin is inside the authoritative glyph
 *  world domain — outline for parsed fonts, AABB for native fallback — and
 *  the renderer reports no overflow. */
function assertMarksInsideDomains(state: ProjectState, context: RenderContext) {
  clearRendererGeometryCache();
  const group = generateRendererGeometry(state, context);
  const domains = resolveGlyphDomains(state, context);
  const eligible = domains
    .filter((domain) => domain.eligible && domain.worldBounds) as GlyphDomain[];
  expect(eligible.length).toBeGreaterThan(0);
  const origins = markOrigins(group);
  expect(origins.length).toBeGreaterThan(0);
  for (const origin of origins) {
    const inside = eligible.some((domain) => pointInGlyph(domain, origin));
    if (!inside) {
      const owners = eligible.map((domain) => ({ id: domain.glyphId, character: domain.character, bounds: domain.worldBounds, hasOutline: Boolean(domain.outline) }));
      throw new Error(`Mark origin (${origin.x}, ${origin.y}) escaped every glyph domain containment. Visible domains: ${JSON.stringify(owners)}`);
    }
  }
  expect(group.diagnostics?.firstOverflowGlyphId).toBe(null);
}

describe("Flow preset glyph-domain contract", () => {
  it("places parsed-font marks inside per-glyph worldBounds at the default size 148", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow" };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    assertMarksInsideDomains(state, context);
  });

  it("places parsed-font marks inside per-glyph worldBounds at the large size 540", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", fontSize: 540, font: loaded.metadata, renderer: "flow", maxNodes: 5000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    assertMarksInsideDomains(state, context);
  });

  it("places native-fallback marks inside the approximate glyph worldBounds (same contract)", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", font: null, renderer: "flow" };
    const textGeometry = null;
    const context = buildContext(state, textGeometry);
    assertMarksInsideDomains(state, context);
    const domains = resolveGlyphDomains(state, context);
    expect(domains.length).toBeGreaterThan(0);
    expect(domains.every((domain) => domain.approximate)).toBe(true);
  });

  it("keeps every mark inside bounds across the 148 -> 540 -> 148 transform cycle, and returns glyph placement exactly", () => {
    const start: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow" };
    const startGeometry = layoutGlyphs(start, loaded);
    const startBounds = startGeometry.glyphs.map((glyph) => glyph.path.bounds) as GlyphBounds[];

    const large: ProjectState = { ...start, fontSize: 540, maxNodes: 5000 };
    const largeGeometry = layoutGlyphs(large, loaded);
    assertMarksInsideDomains(large, buildContext(large, largeGeometry));

    const back: ProjectState = { ...start };
    const backGeometry = layoutGlyphs(back, loaded);
    const backBounds = backGeometry.glyphs.map((glyph) => glyph.path.bounds) as GlyphBounds[];
    expect(backBounds).toEqual(startBounds);
    assertMarksInsideDomains(back, buildContext(back, backGeometry));
  });

  it("moves diagnostics and renderer sampling identically when textOffsetY changes", () => {
    const base: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow" };
    const offsetA = 0;
    const offsetB = 64;

    const stateA: ProjectState = { ...base, textOffsetY: offsetA };
    const geomA = layoutGlyphs(stateA, loaded);
    const ctxA = buildContext(stateA, geomA);
    const domainsA = resolveGlyphDomains(stateA, ctxA);

    const stateB: ProjectState = { ...base, textOffsetY: offsetB };
    const geomB = layoutGlyphs(stateB, loaded);
    const ctxB = buildContext(stateB, geomB);
    const domainsB = resolveGlyphDomains(stateB, ctxB);

    expect(domainsA.length).toBe(domainsB.length);
    const shiftY = -offsetB; // larger textOffsetY moves baseline down, so bounds Y increases by offsetB
    for (let index = 0; index < domainsA.length; index += 1) {
      expect(domainsB[index].worldBounds!.y).toBeCloseTo(domainsA[index].worldBounds!.y - shiftY, 6);
      expect(domainsB[index].worldBounds!.x).toBeCloseTo(domainsA[index].worldBounds!.x, 9);
    }
    assertMarksInsideDomains(stateA, ctxA);
    assertMarksInsideDomains(stateB, ctxB);
  });

  it("does not change glyph-local mapping when the effective artboard expands for large type", () => {
    const authored: ProjectState = { ...baseState, text: "AB", fontSize: 540, font: loaded.metadata, renderer: "flow", maxNodes: 5000 };
    const textGeometry = layoutGlyphs(authored, loaded);
    const glyphBoundsAtAuthored = textGeometry.glyphs.map((glyph) => glyph.path.bounds) as GlyphBounds[];

    // Same state, but with a larger authored artboard so the effective artboard
    // does not need to grow. Glyph placement is anchored to the authored
    // artboard's center, so glyph-local ink bounds must remain byte-identical.
    const expanded: ProjectState = { ...authored, artboard: { width: 2400, height: 1440 } };
    const expandedGeometry = layoutGlyphs(expanded, loaded);
    const glyphBoundsExpanded = expandedGeometry.glyphs.map((glyph) => glyph.path.bounds) as GlyphBounds[];

    // Coords scale because the artboard center moved (centerX+originX shifts),
    // so compare the offset from originX instead (the glyph-local invariant).
    const authoredLocal = textGeometry.glyphs.map((glyph, index) => ({
      dx: glyphBoundsAtAuthored[index].x - textGeometry.originX,
      dy: glyphBoundsAtAuthored[index].y - textGeometry.baselineY,
      width: glyphBoundsAtAuthored[index].width,
      height: glyphBoundsAtAuthored[index].height,
    }));
    const expandedLocal = expandedGeometry.glyphs.map((glyph, index) => ({
      dx: glyphBoundsExpanded[index].x - expandedGeometry.originX,
      dy: glyphBoundsExpanded[index].y - expandedGeometry.baselineY,
      width: glyphBoundsExpanded[index].width,
      height: glyphBoundsExpanded[index].height,
    }));
    expect(expandedLocal).toEqual(authoredLocal);

    const ctx = buildContext(expanded, expandedGeometry);
    assertMarksInsideDomains(expanded, ctx);
  });

  it("sampling diagnostics use the same worldBounds contract as the renderer", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow" };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    const domains = resolveGlyphDomains(state, context);
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, context);
    const origins = markOrigins(group);
    const diagnostics = buildGlyphSamplingDiagnostics(domains, [], origins);
    expect(diagnostics.length).toBe(domains.length);
    // Every domain reports a worldBounds identical to resolveGlyphDomains.
    for (let index = 0; index < domains.length; index += 1) {
      expect(diagnostics[index].visibleBounds).toEqual(domains[index].worldBounds);
      expect(diagnostics[index].glyphId).toBe(domains[index].glyphId);
      expect(diagnostics[index].approximate).toBe(false);
    }
    // No produced origin should be absent from every diagnostic visible bounds.
    for (const origin of origins) {
      expect(diagnostics.some((diagnostic) => domainContains(diagnostic.visibleBounds, origin))).toBe(true);
    }
  });

  it("owningGlyphDomain attributes the same locality the diagnostics measure", () => {
    const state: ProjectState = { ...baseState, text: "AB", fontSize: 148, font: loaded.metadata, renderer: "flow" };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    const domains = resolveGlyphDomains(state, context);
    const eligible = domains.filter((domain) => domain.eligible && domain.worldBounds) as GlyphDomain[];
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, context);
    const origins = markOrigins(group);
    expect(origins.length).toBeGreaterThan(0);
    // For every origin, the owning domain's visibleBounds must contain it. This
    // proves the canonical domain is identical to the renderer diagnostic source.
    for (const origin of origins) {
      const owner = owningGlyphDomain(eligible, origin);
      if (!owner) throw new Error(`Origin (${origin.x}, ${origin.y}) has no owning domain via the canonical contract`);
      expect(domainContains(owner.worldBounds, origin)).toBe(true);
    }
  });

  it("resolveSamplingBounds never returns the artboard fallback when visible glyph domains exist", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow" };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    const domains = resolveGlyphDomains(state, context);
    const artboard = artboardViewport(resolveSceneLayout(state, textGeometry).effectiveArtboard);
    const fallback: GlyphBounds = { x: artboard.x ?? 0, y: artboard.y ?? 0, width: artboard.width, height: artboard.height };
    const resolved = resolveSamplingBounds(domains, fallback);
    // Glyph domains exist for every non-whitespace character, so resolved must
    // never drain to the whole-artboard fallback.
    expect(resolved).not.toEqual([fallback]);
    // And every resolved bound must lie within a visible glyph worldBounds.
    expect(resolved.every((bounds) => domains.some((domain) => domain.worldBounds
      && bounds.x >= domain.worldBounds.x - 1e-6
      && bounds.y >= domain.worldBounds.y - 1e-6
      && bounds.x + bounds.width <= domain.worldBounds.x + domain.worldBounds.width + 1e-6
      && bounds.y + bounds.height <= domain.worldBounds.y + domain.worldBounds.height + 1e-6))).toBe(true);
  });

  it("places parsed-font marks inside the actual glyph outline, not merely the AABB", () => {
    const state: ProjectState = { ...baseState, text: "SUBSTRATE", font: loaded.metadata, renderer: "flow", density: 64, maxNodes: 6000 };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, context);
    const domains = resolveGlyphDomains(state, context).filter((domain) => domain.eligible && domain.outline) as GlyphDomain[];
    const origins = markOrigins(group);
    expect(origins.length).toBeGreaterThan(0);
    // Every accepted origin must be inside its authoritative outline (nonzero
    // winding). AABB-only sampling would also satisfy this for "O" because
    // of the closing counter, so fail it explicitly here by ensuring no
    // accepted mark lives in a counter-only cell.
    for (const origin of origins) {
      const owner = domains.find((domain) => pointInGlyph(domain, origin));
      expect(owner).toBeDefined();
    }
  });

  it.each(["B", "O", "R", "A", "U"] as const)("never emits a mark origin inside the counter of %s", (character) => {
    const state: ProjectState = { ...baseState, text: character, font: loaded.metadata, renderer: "flow", density: 80, maxNodes: 8000, seed: 90123 };
    const textGeometry = layoutGlyphs(state, loaded);
    const context = buildContext(state, textGeometry);
    const domains = resolveGlyphDomains(state, context);
    const outlineDomains = domains.filter((domain) => domain.eligible && domain.outline) as GlyphDomain[];
    expect(outlineDomains.length).toBe(1);
    const domain = outlineDomains[0];
    const wb = domain.worldBounds!;
    // Confirm this glyph actually has counters (cells inside the AABB but
    // outside the outline). The font's metrics and our flattening both shape
    // this assertion.
    const probeGrid = 12;
    let counterCells = 0;
    let inkCells = 0;
    for (let i = 0; i < probeGrid; i += 1) {
      for (let j = 0; j < probeGrid; j += 1) {
        const cx = wb.x + (i + 0.5) * wb.width / probeGrid;
        const cy = wb.y + (j + 0.5) * wb.height / probeGrid;
        if (!domainContains(domain.worldBounds, { x: cx, y: cy })) continue;
        if (pointInGlyph(domain, { x: cx, y: cy })) inkCells += 1;
        else counterCells += 1;
      }
    }
    expect(inkCells).toBeGreaterThan(0);
    expect(counterCells).toBeGreaterThan(0);

    // Stricted contract: every accepted mark origin lying inside this glyph's
    // AABB must also lie inside the glyph outline (pointInGlyph === true).
    clearRendererGeometryCache();
    const group = generateRendererGeometry(state, context);
    const origins = markOrigins(group);
    expect(origins.length).toBeGreaterThan(0);
    const counterMarks = origins.filter((p) => domainContains(domain.worldBounds, p) && !pointInGlyph(domain, p));
    if (counterMarks.length > 0) {
      throw new Error(`Counter-mark leak for "${character}": ${counterMarks.length} mark(s) inside AABB but outside outline. First: ${JSON.stringify(counterMarks[0])}`);
    }
    expect(counterMarks.length).toBe(0);
    expect(group.diagnostics?.firstOverflowGlyphId).toBe(null);
  });
});