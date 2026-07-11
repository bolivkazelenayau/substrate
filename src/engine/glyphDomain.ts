import type { GlyphBounds, GlyphDomain, GlyphOutline, GlyphPathCommand, PositionedGlyph } from "./glyphGeometry";
import { intersectArtboard } from "./rendererSampling";
import { contextArtboard } from "./artboard";
import { getTextLayout } from "./textLayout";
import type { ProjectState, RenderContext } from "../types";

const IDENTITY_TRANSFORM = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 } as const;

/**
 * The single authority for sampling glyph world space.
 *
 * Both renderers and diagnostics call this function instead of touching
 * `PositionedGlyph.path.bounds` directly. Returns one domain per parsed glyph
 * when outlines are available, or one approximate domain per layout line for
 * native fallback. Both branches emit identical `GlyphDomain` shapes so that
 * no consumer branches on "is this parsed or approximated".
 *
 * World space is authored-artboard space (the same space `layoutGlyphs`
 * writes). `worldBounds` intersects `bounds` with the effective artboard
 * (context.viewport) so that any consumer sampling inside a domain can never
 * produce coordinates outside the visible region.
 */
export function resolveGlyphDomains(state: ProjectState, context: RenderContext): GlyphDomain[] {
  const artboard = contextArtboard(context);
  const glyphs = context.textGeometry?.hasOutlines ? context.textGeometry!.glyphs : [];
  if (glyphs.length > 0) return parsedGlyphDomains(glyphs, artboard);
  return approximateNativeDomains(state, artboard);
}

function parsedGlyphDomains(glyphs: PositionedGlyph[], artboard: { x?: number; y?: number; width: number; height: number }): GlyphDomain[] {
  return glyphs.map((glyph) => {
    const bounds: GlyphBounds = glyph.path.bounds ?? {
      x: glyph.x,
      y: glyph.y,
      width: glyph.advanceWidth,
      height: 0,
    };
    const commands = glyph.path.commands;
    const d = glyph.path.d;
    const outline: GlyphOutline | null = Array.isArray(commands) && commands.length > 0 && typeof d === "string" && d.length > 0
      ? { d, commands }
      : null;
    return toDomain(glyph.glyphId, glyph.character, glyph.textIndex, glyph.glyphIndex, bounds, artboard, glyph.emitterEligible, false, outline);
  });
}

function approximateNativeDomains(state: ProjectState, artboard: { x?: number; y?: number; width: number; height: number }): GlyphDomain[] {
  // Native fallback has no parsed outlines. Per-line layout bounds are the
  // tightest authoritative approximation available from the layout engine; they
  // share position/baseline with the rendered `<text>` overlay and therefore
  // move identically with textOffsetY / textAlign / size changes.
  const layout = getTextLayout(state, false);
  const domains: GlyphDomain[] = [];
  for (const line of layout.lines) {
    if (!line.text.length) continue;
    const bounds: GlyphBounds = {
      x: line.originX,
      y: line.baselineY - state.fontSize,
      width: line.advanceWidth,
      height: state.fontSize * 1.18,
    };
    const domain = toDomain(`line-${line.lineIndex}`, line.text, line.lineIndex, undefined, bounds, artboard, line.text.trim().length > 0, true, null);
    if (!domain.worldBounds) continue;
    domains.push(domain);
  }
  return domains;
}

function toDomain(
  glyphId: string,
  character: string,
  textIndex: number,
  glyphIndex: number | undefined,
  bounds: GlyphBounds,
  artboard: { x?: number; y?: number; width: number; height: number },
  eligible: boolean,
  approximate: boolean,
  outline: GlyphOutline | null,
): GlyphDomain {
  const rawArea = Math.max(0, bounds.width) * Math.max(0, bounds.height);
  const worldBounds = intersectArtboard(bounds, artboard);
  const visibleArea = worldBounds ? worldBounds.width * worldBounds.height : 0;
  const visible: GlyphDomain["visible"] = !worldBounds
    ? "outside"
    : rawArea > 0 && visibleArea + 0.001 < rawArea
      ? "partial"
      : "inside";
  return { glyphId, character, textIndex, glyphIndex, bounds, worldBounds, outline, worldTransform: IDENTITY_TRANSFORM, visible, eligible, approximate };
}

/** Returns the bounds renderers should sample from. Never empty unless there
 *  is no visible glyph domain at all, in which case the fallback is returned. */
export function resolveSamplingBounds(
  domains: GlyphDomain[],
  fallback: GlyphBounds,
): GlyphBounds[] {
  const visible = domains
    .filter((domain) => domain.eligible && domain.worldBounds)
    .map((domain) => domain.worldBounds!) as GlyphBounds[];
  return visible.length > 0 ? visible : [fallback];
}

/** AABB containment test. Use as a prefilter to the outline test only; never
 *  as the authoritative containment check for parsed glyphs. */
export function contains(bounds: GlyphBounds | null, point: { x: number; y: number }): boolean {
  return Boolean(bounds
    && point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height);
}

/**
 * Authoritative point-in-glyph test. The contract:
 *
 * 1. AABB prefilter against `worldBounds` (cheap rejection).
 * 2. When `outline` is present, nonzero-winding ray cast against the
 *    flattened glyph outline (matches `opentype.js` fill semantics and the
 *    substrate/canvas rasterizer).
 * 3. When `outline` is null (native fallback, approximate geometry), the AABB
 *    pass is the authoritive acceptance.
 *
 * Performance: the flattened polygons are cached per `outline.d` string so
 * repeated calls across frames and candidates share the same geometry.
 */
export function pointInGlyph(domain: GlyphDomain, point: { x: number; y: number }): boolean {
  if (!contains(domain.worldBounds, point)) return false;
  if (!domain.outline) return true;
  return pointInOutline(domain.outline, point);
}

export function owningGlyphDomain(domains: GlyphDomain[], origin: { x: number; y: number }): GlyphDomain | undefined {
  return domains.find((domain) => domain.eligible && pointInGlyph(domain, origin));
}

// ---------------------------------------------------------------------------
// Nonzero-winding point-in-outline.
//
// Subdivides quadratic and cubic Bezier curves against a chord/flatness
// tolerance, accumulates per-subpath polygons, then sums signed crossings of a
// +x ray cast from the query point. The rule matches `opentype.js` and the
// SVG `fill` / Canvas `context.fill` default (nonzero), so glyph counters
// (wound opposite to the outer contour) report as outside.
// ---------------------------------------------------------------------------

type Polygon = Array<{ x: number; y: number }>;

const FLATTEN_TOLERANCE = 0.5;

const polygonCache = new Map<string, Polygon[]>();
const POLYGON_CACHE_LIMIT = 512;

interface Point2 { x: number; y: number }

function pointInOutline(outline: GlyphOutline, point: { x: number; y: number }): boolean {
  const polygons = getPolygons(outline);
  if (polygons.length === 0) return false;
  let winding = 0;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length - 1; i += 1) {
      winding += edgeContribution(point, polygon[i], polygon[i + 1]);
    }
    if (polygon.length > 1 && (polygon[polygon.length - 1].x !== polygon[0].x || polygon[polygon.length - 1].y !== polygon[0].y)) {
      winding += edgeContribution(point, polygon[polygon.length - 1], polygon[0]);
    }
  }
  return winding !== 0;
}

function getPolygons(outline: GlyphOutline): Polygon[] {
  const cached = polygonCache.get(outline.d);
  if (cached) return cached;
  const polygons = flattenCommands(outline.commands, FLATTEN_TOLERANCE);
  polygonCache.set(outline.d, polygons);
  if (polygonCache.size > POLYGON_CACHE_LIMIT) polygonCache.delete(polygonCache.keys().next().value!);
  return polygons;
}

function edgeContribution(p: Point2, a: Point2, b: Point2): number {
  const py = p.y;
  if (a.y <= py && b.y > py) {
    const cross = (b.x - a.x) * (py - a.y) - (p.x - a.x) * (b.y - a.y);
    return cross > 0 ? 1 : 0;
  }
  if (a.y > py && b.y <= py) {
    const cross = (b.x - a.x) * (py - a.y) - (p.x - a.x) * (b.y - a.y);
    return cross < 0 ? -1 : 0;
  }
  return 0;
}

function flattenCommands(commands: GlyphPathCommand[], tolerance: number): Polygon[] {
  const polygons: Polygon[] = [];
  let current: Polygon = [];
  let cursor: Point2 | null = null;
  let contourStart: Point2 | null = null;
  const beginContour = (p: Point2) => {
    if (current.length > 1) polygons.push(current);
    current = [p];
    cursor = p;
    contourStart = p;
  };
  const lineTo = (p: Point2) => {
    current.push(p);
    cursor = p;
  };
  const closeContour = () => {
    if (current.length > 1 && contourStart) {
      const last = current[current.length - 1];
      if (last.x !== contourStart.x || last.y !== contourStart.y) current.push(contourStart);
      polygons.push(current);
    }
    current = [];
    cursor = contourStart;
  };
  for (const cmd of commands) {
    if (cmd.type === "M") {
      beginContour({ x: cmd.x!, y: cmd.y! });
    } else if (cmd.type === "L") {
      lineTo({ x: cmd.x!, y: cmd.y! });
    } else if (cmd.type === "Q") {
      flattenQuadratic(cursor ?? { x: cmd.x!, y: cmd.y! }, { x: cmd.x1!, y: cmd.y1! }, { x: cmd.x!, y: cmd.y! }, lineTo, tolerance);
    } else if (cmd.type === "C") {
      flattenCubic(cursor ?? { x: cmd.x!, y: cmd.y! }, { x: cmd.x1!, y: cmd.y1! }, { x: cmd.x2!, y: cmd.y2! }, { x: cmd.x!, y: cmd.y! }, lineTo, tolerance);
    } else if (cmd.type === "Z") {
      closeContour();
    }
  }
  if (current.length > 1) polygons.push(current);
  return polygons;
}

function flattenQuadratic(p0: Point2, p1: Point2, p2: Point2, emit: (p: Point2) => void, tolerance: number, depth = 16) {
  if (depth <= 0 || quadFlatEnough(p0, p1, p2, tolerance)) {
    emit(p2);
    return;
  }
  const m01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const m12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const m = { x: (m01.x + m12.x) / 2, y: (m01.y + m12.y) / 2 };
  flattenQuadratic(p0, m01, m, emit, tolerance, depth - 1);
  flattenQuadratic(m, m12, p2, emit, tolerance, depth - 1);
}

function flattenCubic(p0: Point2, p1: Point2, p2: Point2, p3: Point2, emit: (p: Point2) => void, tolerance: number, depth = 16) {
  if (depth <= 0 || cubicFlatEnough(p0, p1, p2, p3, tolerance)) {
    emit(p3);
    return;
  }
  const m01 = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const m12 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const m23 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const m012 = { x: (m01.x + m12.x) / 2, y: (m01.y + m12.y) / 2 };
  const m123 = { x: (m12.x + m23.x) / 2, y: (m12.y + m23.y) / 2 };
  const m = { x: (m012.x + m123.x) / 2, y: (m012.y + m123.y) / 2 };
  flattenCubic(p0, m01, m012, m, emit, tolerance, depth - 1);
  flattenCubic(m, m123, m23, p3, emit, tolerance, depth - 1);
}

function quadFlatEnough(p0: Point2, p1: Point2, p2: Point2, tolerance: number): boolean {
  const chord = chordLength(p0, p2);
  if (chord < tolerance) return true;
  const dx = p2.x - p0.x;
  const dy = p2.y - p0.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p1.x - p0.x, p1.y - p0.y) < tolerance;
  const t = ((p1.x - p0.x) * dx + (p1.y - p0.y) * dy) / len2;
  const tx = p0.x + t * dx;
  const ty = p0.y + t * dy;
  return Math.hypot(p1.x - tx, p1.y - ty) < tolerance;
}

function cubicFlatEnough(p0: Point2, p1: Point2, p2: Point2, p3: Point2, tolerance: number): boolean {
  const chord = chordLength(p0, p3);
  if (chord < tolerance) return true;
  const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const d2 = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  return d1 + d2 < tolerance;
}

function chordLength(a: Point2, b: Point2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Stable hash of a GlyphDomain[] for cache keying. Includes glyph outline
 *  identity (parsed) or approximate bounds identity (native fallback) so two
 *  differently-shaped fonts at the same AABB never share Flow base points. */
export function glyphDomainHash(domains: GlyphDomain[]): string {
  let h = 2166136261;
  for (const domain of domains) {
    const id = typeof domain.glyphId === "string" ? domain.glyphId : "";
    h = Math.imul(h ^ id.length, 16777619);
    if (domain.outline) {
      const d = domain.outline.d;
      for (let i = 0; i < d.length; i += 1) h = Math.imul(h ^ d.charCodeAt(i), 16777619);
    } else {
      h = Math.imul(h ^ Math.round(domain.bounds.x * 32), 16777619);
      h = Math.imul(h ^ Math.round(domain.bounds.y * 32), 16777619);
      h = Math.imul(h ^ Math.round(domain.bounds.width * 32), 16777619);
      h = Math.imul(h ^ Math.round(domain.bounds.height * 32), 16777619);
    }
  }
  return (h >>> 0).toString(16);
}