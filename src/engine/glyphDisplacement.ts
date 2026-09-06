import type { GlyphDisplacementSettings, ProjectState } from "../types";
import type {
  GlyphBounds,
  GlyphPathCommand,
  PositionedGlyph,
  TextGeometry,
  TextLineGeometry,
} from "./glyphGeometry";
import { unionBounds } from "./glyphGeometry";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./field/glyphEmitters";
import { getFalloffWeight } from "./field/compositeWaveField";
import {
  eligibleEmitterInfluenceSources,
  emitterInfluenceSourceIdentity,
  resolveEmitterInfluenceSources,
  sampleEmitterInfluence,
  type EmitterInfluenceSource,
} from "./field/emitterInfluence";
import { isDisplayDislocationActive } from "./displayDislocation";

export const GLYPH_DISPLACEMENT_BUDGETS = {
  sourceContourPoints: 30_000,
  fragments: 1_200,
  regions: 512,
  clippingOperations: 160_000,
  radialSectors: 64,
  boundsGrowth: 2_048,
} as const;

export const GLYPH_DISPLACEMENT_PARSED_FONT_WARNING =
  "Glyph displacement requires a loaded .ttf/.otf outline font; native fallback remains undisplaced.";

export interface DisplacementAffineTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface DisplacedTypographyFragment {
  id: string;
  regionIndex: number;
  row: number;
  column: number;
  sourceBounds: GlyphBounds;
  bounds: GlyphBounds;
  transform: DisplacementAffineTransform;
  /** Authored coherent region translation before rotation around the region center. */
  translation: { x: number; y: number };
  responseWeight: number;
  sourcePointCount: number;
  glyphIds: string[];
}

export interface GlyphDisplacementDiagnostics {
  sourceContourPoints: number;
  fragmentCount: number;
  affectedFragmentCount: number;
  clippingOperations: number;
  buildDurationMs: number;
  peakTemporaryArrays: number;
  clippingStatus: "complete" | "budget-limited" | "triangulation-fallback";
  effectiveRegionSize: number;
  anchorCount: number;
  maxDisplacement: number;
  inactiveReason?: "disabled" | "zero-strength" | "incompatible-display-dislocation" | "emitter-disabled" | "no-emitter" | "native-fallback" | "empty-geometry";
}

export interface DisplacedTypographyGeometry {
  sourceTypographyKey: string;
  displacementKey: string;
  geometryKey: string;
  geometry: TextGeometry | null;
  layoutBounds: GlyphBounds | null;
  inkBounds: GlyphBounds | null;
  fragmentBounds: GlyphBounds[];
  fragments: DisplacedTypographyFragment[];
  active: boolean;
  exact: boolean;
  diagnostics: GlyphDisplacementDiagnostics;
}

interface Point {
  x: number;
  y: number;
}

interface Contour {
  points: Point[];
}

interface PreparedContour {
  source: Contour;
  pieces: Point[][];
}

interface PreparedGlyph {
  glyph: PositionedGlyph;
  contours: PreparedContour[];
}

interface DisplacementAnchor {
  id: string;
  x: number;
  y: number;
  weight: number;
  radiusMultiplier: number;
}

interface Region {
  id: string;
  index: number;
  row: number;
  column: number;
  center: Point;
  bounds: GlyphBounds;
  polygon: Point[];
  startAngle?: number;
  endAngle?: number;
  outerRadius?: number;
  innerRadius?: number;
  radialAnchor?: Point;
}

interface RegionMotion {
  transform: DisplacementAffineTransform;
  translation: Point;
  weight: number;
  anchor: DisplacementAnchor;
}

interface BuildCounters {
  sourceContourPoints: number;
  clippingOperations: number;
  peakTemporaryArrays: number;
  budgetLimited: boolean;
  triangulationFallback: boolean;
}

const IDENTITY_TRANSFORM: DisplacementAffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
const EPSILON = 1e-7;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, precision = 1_000_000) {
  const resolved = Math.round(value * precision) / precision;
  return Object.is(resolved, -0) ? 0 : resolved;
}

function boundsRight(bounds: GlyphBounds) {
  return bounds.x + bounds.width;
}

function boundsBottom(bounds: GlyphBounds) {
  return bounds.y + bounds.height;
}

function pointBounds(points: Point[]): GlyphBounds | null {
  if (points.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

function polygonsBounds(polygons: Point[][]): GlyphBounds | null {
  return unionBounds(polygons.map((polygon) => pointBounds(polygon)));
}

function centerOf(bounds: GlyphBounds | null): Point {
  return bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
}

function hashString(value: string) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x85ebca6b);
    b ^= b >>> 13;
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

function scalarHash(x: number, y: number, seed: number) {
  let value = Math.imul((x | 0) ^ 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul((y | 0) ^ 0xc2b2ae35, 0x27d4eb2d);
  value ^= Math.imul(seed | 0, 0x165667b1);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  return (value >>> 0) / 0xffffffff;
}

function smoothstep(value: number) {
  const amount = clamp(value, 0, 1);
  return amount * amount * (3 - 2 * amount);
}

function valueNoise(x: number, y: number, seed: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const top = scalarHash(x0, y0, seed) * (1 - tx) + scalarHash(x0 + 1, y0, seed) * tx;
  const bottom = scalarHash(x0, y0 + 1, seed) * (1 - tx) + scalarHash(x0 + 1, y0 + 1, seed) * tx;
  return (top * (1 - ty) + bottom * ty) * 2 - 1;
}

function signedArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return area / 2;
}

function interpolateQuadratic(a: Point, control: Point, b: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * a.x + 2 * inverse * t * control.x + t * t * b.x,
    y: inverse * inverse * a.y + 2 * inverse * t * control.y + t * t * b.y,
  };
}

function interpolateCubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * a.x + 3 * inverse * inverse * t * c1.x + 3 * inverse * t * t * c2.x + t ** 3 * b.x,
    y: inverse ** 3 * a.y + 3 * inverse * inverse * t * c1.y + 3 * inverse * t * t * c2.y + t ** 3 * b.y,
  };
}

function flattenCommands(commands: GlyphPathCommand[], counters: BuildCounters, curveSteps = 8): Contour[] {
  const contours: Contour[] = [];
  let points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  let stopped = false;
  const push = (point: Point) => {
    if (counters.sourceContourPoints >= GLYPH_DISPLACEMENT_BUDGETS.sourceContourPoints) {
      counters.budgetLimited = true;
      stopped = true;
      return;
    }
    const previous = points[points.length - 1];
    if (!previous || Math.abs(previous.x - point.x) > EPSILON || Math.abs(previous.y - point.y) > EPSILON) {
      points.push(point);
      counters.sourceContourPoints += 1;
    }
  };
  const finish = () => {
    if (points.length > 2) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) points = points.slice(0, -1);
      if (points.length > 2 && Math.abs(signedArea(points)) > EPSILON) contours.push({ points });
    }
    points = [];
  };

  for (const command of commands) {
    if (stopped) break;
    if (command.type === "M" && command.x !== undefined && command.y !== undefined) {
      finish();
      cursor = { x: command.x, y: command.y };
      push(cursor);
    } else if (command.type === "L" && command.x !== undefined && command.y !== undefined) {
      cursor = { x: command.x, y: command.y };
      push(cursor);
    } else if (command.type === "Q" && command.x !== undefined && command.y !== undefined && command.x1 !== undefined && command.y1 !== undefined) {
      const start = cursor;
      const control = { x: command.x1, y: command.y1 };
      const end = { x: command.x, y: command.y };
      for (let step = 1; step <= curveSteps && !stopped; step += 1) push(interpolateQuadratic(start, control, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "C" && command.x !== undefined && command.y !== undefined && command.x1 !== undefined && command.y1 !== undefined && command.x2 !== undefined && command.y2 !== undefined) {
      const start = cursor;
      const control1 = { x: command.x1, y: command.y1 };
      const control2 = { x: command.x2, y: command.y2 };
      const end = { x: command.x, y: command.y };
      for (let step = 1; step <= curveSteps && !stopped; step += 1) push(interpolateCubic(start, control1, control2, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "Z") {
      finish();
    }
  }
  finish();
  return contours;
}

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointInTriangle(point: Point, a: Point, b: Point, c: Point, orientation: number) {
  const ab = cross(a, b, point) * orientation;
  const bc = cross(b, c, point) * orientation;
  const ca = cross(c, a, point) * orientation;
  return ab >= -EPSILON && bc >= -EPSILON && ca >= -EPSILON;
}

function pointStrictlyInTriangle(point: Point, a: Point, b: Point, c: Point, orientation: number) {
  const ab = cross(a, b, point) * orientation;
  const bc = cross(b, c, point) * orientation;
  const ca = cross(c, a, point) * orientation;
  return ab > EPSILON && bc > EPSILON && ca > EPSILON;
}

function triangulateContour(contour: Contour, tolerateBoundaryPoints = false): { pieces: Point[][]; fallback: boolean } {
  const points = contour.points;
  if (points.length === 3) return { pieces: [[...points]], fallback: false };
  const orientation = signedArea(points) >= 0 ? 1 : -1;
  const remaining = points.map((_, index) => index);
  const pieces: Point[][] = [];
  let guard = points.length * points.length;
  while (remaining.length > 3 && guard > 0) {
    guard -= 1;
    let earFound = false;
    for (let cursor = 0; cursor < remaining.length; cursor += 1) {
      const previousIndex = remaining[(cursor - 1 + remaining.length) % remaining.length];
      const currentIndex = remaining[cursor];
      const nextIndex = remaining[(cursor + 1) % remaining.length];
      const a = points[previousIndex];
      const b = points[currentIndex];
      const c = points[nextIndex];
      if (cross(a, b, c) * orientation <= EPSILON) continue;
      let contains = false;
      for (const candidateIndex of remaining) {
        if (candidateIndex === previousIndex || candidateIndex === currentIndex || candidateIndex === nextIndex) continue;
        const inside = tolerateBoundaryPoints
          ? pointStrictlyInTriangle(points[candidateIndex], a, b, c, orientation)
          : pointInTriangle(points[candidateIndex], a, b, c, orientation);
        if (inside) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      pieces.push([a, b, c]);
      remaining.splice(cursor, 1);
      earFound = true;
      break;
    }
    if (!earFound) return { pieces: [[...points]], fallback: true };
  }
  if (remaining.length === 3) pieces.push(remaining.map((index) => points[index]));
  return { pieces, fallback: false };
}

function prepareGlyphs(source: TextGeometry, counters: BuildCounters): PreparedGlyph[] {
  const prepared: PreparedGlyph[] = [];
  for (const glyph of source.glyphs) {
    if (counters.budgetLimited) break;
    const contours = flattenCommands(glyph.path.commands, counters).map((contour) => {
      // Calm Water intentionally smooths neighboring displacement vectors and
      // can leave harmless collinear samples on a broad curve. Treat points on
      // an ear boundary as redundant only for that new source authority; the
      // historical Fragmentation triangulation path remains byte-for-byte.
      const triangulated = triangulateContour(contour, Boolean(source.calmWater));
      if (triangulated.fallback) counters.triangulationFallback = true;
      return { source: contour, pieces: triangulated.pieces };
    });
    counters.peakTemporaryArrays = Math.max(
      counters.peakTemporaryArrays,
      contours.length + contours.reduce((sum, contour) => sum + contour.pieces.length, 0),
    );
    prepared.push({ glyph, contours });
  }
  return prepared;
}

function resolveAnchors(state: ProjectState, source: TextGeometry): DisplacementAnchor[] {
  const fallbackCenter = centerOf(source.bounds ?? source.layoutBounds ?? null);
  const metadata = getGlyphEmitterMetadata(state, source);
  if (state.emitterMode === "single") {
    const glyph = resolveEmitterGlyph(metadata, state.emitter.glyphId);
    const anchor = glyph
      ? getGlyphEmitterAnchor(glyph, state.emitter.sourceMode, { x: state.emitter.customX, y: state.emitter.customY })
      : fallbackCenter;
    return [{ id: glyph?.glyphId ?? "typography-center", x: anchor.x, y: anchor.y, weight: 1, radiusMultiplier: 1 }];
  }
  const resolved = resolveGlyphEmitterSources(state, source).sources.map((sourceEmitter) => ({
    id: sourceEmitter.id,
    x: sourceEmitter.anchor.x,
    y: sourceEmitter.anchor.y,
    weight: sourceEmitter.weight,
    radiusMultiplier: sourceEmitter.radiusMultiplier,
  }));
  return resolved.length > 0
    ? resolved
    : [{ id: "typography-center", x: fallbackCenter.x, y: fallbackCenter.y, weight: 1, radiusMultiplier: 1 }];
}

function anchorIdentity(anchors: DisplacementAnchor[]) {
  return anchors.map((anchor) => ({
    id: anchor.id,
    x: round(anchor.x),
    y: round(anchor.y),
    weight: round(anchor.weight),
    radiusMultiplier: round(anchor.radiusMultiplier),
  }));
}

export function glyphDisplacementIdentity(
  state: ProjectState,
  sourceTypographyKey: string,
  source: TextGeometry | null,
) {
  if (!state.glyphDisplacement.enabled) {
    return { displacementKey: "glyph-displacement:disabled", geometryKey: sourceTypographyKey, active: false as const, reason: "disabled" as const };
  }
  if (state.glyphDisplacement.strength <= 0) {
    return { displacementKey: "glyph-displacement:zero-strength", geometryKey: sourceTypographyKey, active: false as const, reason: "zero-strength" as const };
  }
  // Display Dislocation is the renderer-local inverse-domain authority for the
  // same SDF Halftone dot display. Keep authored Fragmentation state intact for
  // restoration, but never let both stages claim the same glyph-domain input.
  if (isDisplayDislocationActive(state)) {
    return {
      displacementKey: "glyph-displacement:incompatible-display-dislocation",
      geometryKey: sourceTypographyKey,
      active: false as const,
      reason: "incompatible-display-dislocation" as const,
    };
  }
  if (!source?.hasOutlines) {
    return { displacementKey: "glyph-displacement:native-fallback", geometryKey: sourceTypographyKey, active: false as const, reason: "native-fallback" as const };
  }
  if (!source.bounds || source.glyphs.every((glyph) => glyph.path.commands.length === 0)) {
    return { displacementKey: "glyph-displacement:empty-geometry", geometryKey: sourceTypographyKey, active: false as const, reason: "empty-geometry" as const };
  }
  const settings = state.glyphDisplacement;
  const localizedSlice = (settings.mode === "horizontal-slices" || settings.mode === "vertical-slices")
    && settings.sliceInfluence === "emitter-falloff";
  if (localizedSlice && !state.emitter.enabled) {
    return { displacementKey: "glyph-displacement:emitter-disabled", geometryKey: sourceTypographyKey, active: false as const, reason: "emitter-disabled" as const };
  }
  const influenceSources = localizedSlice ? resolveEmitterInfluenceSources(state, source) : [];
  if (localizedSlice && influenceSources.length === 0) {
    return { displacementKey: "glyph-displacement:no-emitter", geometryKey: sourceTypographyKey, active: false as const, reason: "no-emitter" as const };
  }
  const anchors = localizedSlice ? [] : resolveAnchors(state, source);
  const semantic = JSON.stringify({
    sourceTypographyKey,
    mode: settings.mode,
    sliceInfluence: localizedSlice ? settings.sliceInfluence : undefined,
    strength: clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth),
    responseRadius: localizedSlice ? undefined : settings.responseRadius,
    falloff: localizedSlice ? undefined : settings.falloff,
    influence: localizedSlice ? state.glyphInfluence : undefined,
    fragmentSize: settings.fragmentSize,
    gap: settings.gap,
    quantizationSteps: settings.quantizationSteps,
    direction: settings.direction,
    radialTangential: settings.radialTangential,
    jitter: settings.jitter,
    fragmentRotation: settings.fragmentRotation,
    seedInfluence: settings.seedInfluence,
    seed: settings.seedInfluence > 0 ? state.seed : "inactive",
    emitterMode: localizedSlice ? undefined : state.emitterMode,
    sourceMode: localizedSlice ? undefined : state.emitter.sourceMode,
    anchors: localizedSlice
      ? emitterInfluenceSourceIdentity(influenceSources)
      : anchorIdentity(anchors),
  });
  const displacementKey = `glyph-displacement:${hashString(semantic)}`;
  return {
    displacementKey,
    geometryKey: `typography-displaced:${hashString(`${sourceTypographyKey}|${displacementKey}`)}`,
    active: true as const,
    reason: null,
  };
}

function selectAnchor(point: Point, anchors: DisplacementAnchor[], settings: GlyphDisplacementSettings) {
  let selected = anchors[0];
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const anchor of anchors) {
    const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    const radius = Math.max(1, settings.responseRadius * Math.max(0.05, anchor.radiusMultiplier));
    const score = distance / radius / Math.max(0.05, anchor.weight);
    if (score < selectedScore) {
      selectedScore = score;
      selected = anchor;
    }
  }
  return selected;
}

function responseWeight(point: Point, anchor: DisplacementAnchor, settings: GlyphDisplacementSettings) {
  const radius = Math.max(1, settings.responseRadius * Math.max(0.05, anchor.radiusMultiplier));
  const normalized = Math.hypot(point.x - anchor.x, point.y - anchor.y) / radius;
  return getFalloffWeight(normalized, settings.falloff) * clamp(anchor.weight, 0, 2);
}

function mixedDirection(point: Point, anchor: DisplacementAnchor, settings: GlyphDisplacementSettings, noise: number) {
  const authoredAngle = settings.direction * Math.PI / 180;
  const authored = { x: Math.cos(authoredAngle), y: Math.sin(authoredAngle) };
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const magnitude = Math.max(EPSILON, Math.hypot(dx, dy));
  const radial = { x: dx / magnitude, y: dy / magnitude };
  const tangent = { x: -radial.y, y: radial.x };
  const balance = clamp(settings.radialTangential / 100, -1, 1);
  const target = balance >= 0 ? radial : tangent;
  const amount = Math.abs(balance);
  let x = authored.x * (1 - amount) + target.x * amount;
  let y = authored.y * (1 - amount) + target.y * amount;
  const jitterAngle = noise * clamp(settings.jitter / 100, 0, 1) * Math.PI * 0.42;
  const cosine = Math.cos(jitterAngle);
  const sine = Math.sin(jitterAngle);
  const rotatedX = x * cosine - y * sine;
  const rotatedY = x * sine + y * cosine;
  const length = Math.max(EPSILON, Math.hypot(rotatedX, rotatedY));
  x = rotatedX / length;
  y = rotatedY / length;
  return { x, y };
}

function quantizeMagnitude(value: number, settings: GlyphDisplacementSettings) {
  const steps = Math.max(1, Math.round(settings.quantizationSteps));
  if (steps <= 1 || settings.strength <= 0) return value;
  const quantum = clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth) / steps;
  return quantum > EPSILON ? Math.round(value / quantum) * quantum : value;
}

function affineAround(center: Point, translation: Point, rotationRadians: number): DisplacementAffineTransform {
  const cosine = Math.cos(rotationRadians);
  const sine = Math.sin(rotationRadians);
  return {
    a: round(cosine),
    b: round(sine),
    c: round(-sine),
    d: round(cosine),
    e: round(center.x - cosine * center.x + sine * center.y + translation.x),
    f: round(center.y - sine * center.x - cosine * center.y + translation.y),
  };
}

function applyTransform(point: Point, transform: DisplacementAffineTransform): Point {
  return {
    x: round(transform.a * point.x + transform.c * point.y + transform.e),
    y: round(transform.b * point.x + transform.d * point.y + transform.f),
  };
}

export function applyDisplacementTransform(point: Point, transform: DisplacementAffineTransform): Point {
  return applyTransform(point, transform);
}

function resolveRegionMotion(
  state: ProjectState,
  region: Region,
  anchors: DisplacementAnchor[],
): RegionMotion {
  const settings = state.glyphDisplacement;
  const anchor = selectAnchor(region.center, anchors, settings);
  const weight = clamp(responseWeight(region.center, anchor, settings), 0, 1.5);
  const seeded = settings.seedInfluence > 0 ? state.seed : 0;
  const rawNoise = scalarHash(region.row * 4099 + region.index, region.column * 8191 - region.index, seeded) * 2 - 1;
  const noise = rawNoise * clamp(settings.seedInfluence / 100, 0, 1);
  let sign = 1;
  if (settings.mode === "horizontal-slices") sign = Math.abs(region.row) % 2 === 0 ? 1 : -1;
  else if (settings.mode === "vertical-slices") sign = Math.abs(region.column) % 2 === 0 ? 1 : -1;
  else if (settings.mode === "grid") sign = Math.abs(region.row + region.column) % 2 === 0 ? 1 : -1;
  else if (settings.mode === "radial-sectors") sign = region.index % 2 === 0 ? 1 : -1;
  const direction = mixedDirection(region.center, anchor, settings, noise);
  const jitterScale = 1 + noise * clamp(settings.jitter / 100, 0, 1) * 0.32;
  const boundedStrength = clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth);
  const magnitude = clamp(
    quantizeMagnitude(boundedStrength * weight * jitterScale, settings),
    0,
    GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth,
  ) * sign;
  const translation = { x: direction.x * magnitude, y: direction.y * magnitude };
  const rotationNoise = settings.seedInfluence > 0 ? rawNoise : sign * 0.5;
  const rotation = settings.fragmentRotation * Math.PI / 180 * rotationNoise * weight;
  return { transform: affineAround(region.center, translation, rotation), translation, weight, anchor };
}

/**
 * Local Slice keeps the authored slice motion coherent, then applies the
 * normalized envelope to that single fragment transform. Quantization happens
 * before envelope modulation so the exterior decay cannot snap between large
 * displacement steps.
 */
function resolveLocalizedSliceMotion(
  state: ProjectState,
  region: Region,
  anchor: DisplacementAnchor,
  response: number,
): RegionMotion {
  const settings = state.glyphDisplacement;
  const weight = clamp(response, 0, 1);
  if (weight <= EPSILON) {
    return {
      transform: { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 },
      translation: { x: 0, y: 0 },
      weight: 0,
      anchor,
    };
  }
  const seeded = settings.seedInfluence > 0 ? state.seed : 0;
  const rawNoise = scalarHash(region.row * 4099 + region.index, region.column * 8191 - region.index, seeded) * 2 - 1;
  const noise = rawNoise * clamp(settings.seedInfluence / 100, 0, 1);
  const sign = settings.mode === "horizontal-slices"
    ? (Math.abs(region.row) % 2 === 0 ? 1 : -1)
    : (Math.abs(region.column) % 2 === 0 ? 1 : -1);
  const direction = mixedDirection(region.center, anchor, settings, noise);
  const jitterScale = 1 + noise * clamp(settings.jitter / 100, 0, 1) * 0.32;
  const boundedStrength = clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth);
  const coherentMagnitude = clamp(
    quantizeMagnitude(boundedStrength * jitterScale, settings),
    0,
    GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth,
  );
  const magnitude = coherentMagnitude * weight * sign;
  const translation = { x: direction.x * magnitude, y: direction.y * magnitude };
  const rotationNoise = settings.seedInfluence > 0 ? rawNoise : sign * 0.5;
  const rotation = settings.fragmentRotation * Math.PI / 180 * rotationNoise * weight;
  return { transform: affineAround(region.center, translation, rotation), translation, weight, anchor };
}

export function displaceWarpPoint(
  state: ProjectState,
  point: Point,
  source: TextGeometry,
): Point {
  const settings = state.glyphDisplacement;
  const anchors = resolveAnchors(state, source);
  const anchor = selectAnchor(point, anchors, settings);
  const weight = clamp(responseWeight(point, anchor, settings), 0, 1.5);
  if (weight <= EPSILON) return { ...point };
  const scale = Math.max(4, settings.fragmentSize);
  const seed = settings.seedInfluence > 0 ? state.seed : 0;
  const noise = valueNoise(point.x / scale, point.y / scale, seed) * clamp(settings.seedInfluence / 100, 0, 1);
  const direction = mixedDirection(point, anchor, settings, noise);
  const jitterScale = 1 + noise * clamp(settings.jitter / 100, 0, 1) * 0.36;
  const boundedStrength = clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth);
  const magnitude = clamp(
    quantizeMagnitude(boundedStrength * weight * jitterScale, settings),
    0,
    GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth,
  );
  return { x: round(point.x + direction.x * magnitude), y: round(point.y + direction.y * magnitude) };
}

function rectPolygon(x: number, y: number, width: number, height: number): Point[] {
  return [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ];
}

function annularSectorPolygon(
  anchor: Point,
  startAngle: number,
  endAngle: number,
  innerRadius: number,
  outerRadius: number,
): Point[] {
  const outerStart = { x: anchor.x + Math.cos(startAngle) * outerRadius, y: anchor.y + Math.sin(startAngle) * outerRadius };
  const outerEnd = { x: anchor.x + Math.cos(endAngle) * outerRadius, y: anchor.y + Math.sin(endAngle) * outerRadius };
  if (innerRadius <= EPSILON) return [{ ...anchor }, outerStart, outerEnd];
  const innerStart = { x: anchor.x + Math.cos(startAngle) * innerRadius, y: anchor.y + Math.sin(startAngle) * innerRadius };
  const innerEnd = { x: anchor.x + Math.cos(endAngle) * innerRadius, y: anchor.y + Math.sin(endAngle) * innerRadius };
  return [innerStart, outerStart, outerEnd, innerEnd];
}

function maxCornerDistance(bounds: GlyphBounds, point: Point) {
  return Math.max(
    Math.hypot(bounds.x - point.x, bounds.y - point.y),
    Math.hypot(boundsRight(bounds) - point.x, bounds.y - point.y),
    Math.hypot(boundsRight(bounds) - point.x, boundsBottom(bounds) - point.y),
    Math.hypot(bounds.x - point.x, boundsBottom(bounds) - point.y),
  );
}

function buildRegions(
  state: ProjectState,
  sourceBounds: GlyphBounds,
  anchors: DisplacementAnchor[],
): { regions: Region[]; effectiveRegionSize: number; limited: boolean } {
  const settings = state.glyphDisplacement;
  let size = Math.max(4, settings.fragmentSize);
  let limited = false;
  const mode = settings.mode;
  const estimateCount = (candidateSize: number) => {
    if (mode === "horizontal-slices") return Math.max(1, Math.ceil(sourceBounds.height / candidateSize) + 2);
    if (mode === "vertical-slices") return Math.max(1, Math.ceil(sourceBounds.width / candidateSize) + 2);
    if (mode === "grid") return Math.max(1, (Math.ceil(sourceBounds.width / candidateSize) + 2) * (Math.ceil(sourceBounds.height / candidateSize) + 2));
    return 1;
  };
  const estimated = estimateCount(size);
  if (estimated > GLYPH_DISPLACEMENT_BUDGETS.regions) {
    const multiplier = mode === "grid"
      ? Math.ceil(Math.sqrt(estimated / GLYPH_DISPLACEMENT_BUDGETS.regions))
      : Math.ceil(estimated / GLYPH_DISPLACEMENT_BUDGETS.regions);
    size *= multiplier;
    limited = true;
  }

  if (mode === "radial-sectors") {
    const anchor = anchors[0];
    const anchorPoint = { x: anchor.x, y: anchor.y };
    const representativeRadius = Math.max(32, Math.min(settings.responseRadius, maxCornerDistance(sourceBounds, anchorPoint)));
    const boundedStrength = clamp(settings.strength, 0, GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth);
    const outerRadius = maxCornerDistance(sourceBounds, anchorPoint) + boundedStrength + settings.gap + 4;
    let bandSize = size;
    let bandCount = Math.max(1, Math.ceil(outerRadius / bandSize));
    if (bandCount * 4 > GLYPH_DISPLACEMENT_BUDGETS.regions) {
      const multiplier = Math.ceil(bandCount * 4 / GLYPH_DISPLACEMENT_BUDGETS.regions);
      bandSize *= multiplier;
      bandCount = Math.max(1, Math.ceil(outerRadius / bandSize));
      limited = true;
    }
    const requestedSectors = Math.max(4, Math.round(Math.PI * 2 * representativeRadius / size));
    const sectorBudget = Math.max(4, Math.floor(GLYPH_DISPLACEMENT_BUDGETS.regions / bandCount));
    const sectorCount = Math.min(GLYPH_DISPLACEMENT_BUDGETS.radialSectors, requestedSectors, sectorBudget);
    if (sectorCount < requestedSectors || bandSize !== size) limited = true;
    const angularStep = Math.PI * 2 / sectorCount;
    const regions: Region[] = [];
    for (let band = 0; band < bandCount; band += 1) {
      const innerRadius = band * bandSize;
      const bandOuterRadius = Math.min(outerRadius, (band + 1) * bandSize);
      const centerRadius = (innerRadius + bandOuterRadius) / 2;
      for (let sector = 0; sector < sectorCount; sector += 1) {
        const startAngle = -Math.PI + sector * angularStep;
        const endAngle = startAngle + angularStep;
        const angle = (startAngle + endAngle) / 2;
        const center = { x: anchor.x + Math.cos(angle) * centerRadius, y: anchor.y + Math.sin(angle) * centerRadius };
        const polygon = annularSectorPolygon(anchorPoint, startAngle, endAngle, innerRadius, bandOuterRadius);
        regions.push({
          id: `sector-${sector}-band-${band}`,
          index: regions.length,
          row: band,
          column: sector,
          center,
          bounds: pointBounds(polygon)!,
          polygon,
          startAngle,
          endAngle,
          innerRadius,
          outerRadius: bandOuterRadius,
          radialAnchor: anchorPoint,
        });
      }
    }
    return { regions, effectiveRegionSize: bandSize, limited };
  }

  const firstColumn = Math.floor(sourceBounds.x / size);
  const lastColumn = Math.floor((boundsRight(sourceBounds) - EPSILON) / size);
  const firstRow = Math.floor(sourceBounds.y / size);
  const lastRow = Math.floor((boundsBottom(sourceBounds) - EPSILON) / size);
  const regions: Region[] = [];
  const minX = sourceBounds.x - 1;
  const minY = sourceBounds.y - 1;
  const fullWidth = sourceBounds.width + 2;
  const fullHeight = sourceBounds.height + 2;
  if (mode === "horizontal-slices") {
    for (let row = firstRow; row <= lastRow; row += 1) {
      const y = row * size;
      const polygon = rectPolygon(minX, y, fullWidth, size);
      regions.push({ id: `row-${row}`, index: regions.length, row, column: 0, center: { x: minX + fullWidth / 2, y: y + size / 2 }, bounds: { x: minX, y, width: fullWidth, height: size }, polygon });
    }
  } else if (mode === "vertical-slices") {
    for (let column = firstColumn; column <= lastColumn; column += 1) {
      const x = column * size;
      const polygon = rectPolygon(x, minY, size, fullHeight);
      regions.push({ id: `column-${column}`, index: regions.length, row: 0, column, center: { x: x + size / 2, y: minY + fullHeight / 2 }, bounds: { x, y: minY, width: size, height: fullHeight }, polygon });
    }
  } else {
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const x = column * size;
        const y = row * size;
        const polygon = rectPolygon(x, y, size, size);
        regions.push({ id: `cell-${column}-${row}`, index: regions.length, row, column, center: { x: x + size / 2, y: y + size / 2 }, bounds: { x, y, width: size, height: size }, polygon });
      }
    }
  }
  return { regions, effectiveRegionSize: size, limited };
}

function insetRegionPolygon(region: Region, settings: GlyphDisplacementSettings, response: number): Point[] {
  const gap = Math.max(0, settings.gap * clamp(response, 0, 1));
  if (gap <= EPSILON) return region.polygon;
  if (settings.mode === "radial-sectors" && region.startAngle !== undefined && region.endAngle !== undefined && region.outerRadius !== undefined) {
    const span = region.endAngle - region.startAngle;
    const insetAngle = Math.min(span * 0.4, gap / Math.max(8, settings.responseRadius));
    const radialAnchor = region.radialAnchor ?? region.center;
    const innerRadius = Math.min(region.outerRadius, (region.innerRadius ?? 0) + gap / 2);
    const outerRadius = Math.max(innerRadius + EPSILON, region.outerRadius - gap / 2);
    return annularSectorPolygon(radialAnchor, region.startAngle + insetAngle, region.endAngle - insetAngle, innerRadius, outerRadius);
  }
  const maxHorizontalInset = Math.max(0, region.bounds.width / 2 - EPSILON);
  const maxVerticalInset = Math.max(0, region.bounds.height / 2 - EPSILON);
  const insetX = settings.mode === "horizontal-slices" ? 0 : Math.min(gap / 2, maxHorizontalInset);
  const insetY = settings.mode === "vertical-slices" ? 0 : Math.min(gap / 2, maxVerticalInset);
  return rectPolygon(
    region.bounds.x + insetX,
    region.bounds.y + insetY,
    Math.max(EPSILON, region.bounds.width - insetX * 2),
    Math.max(EPSILON, region.bounds.height - insetY * 2),
  );
}

function boundsOverlap(a: GlyphBounds, b: GlyphBounds) {
  return a.x <= boundsRight(b) + EPSILON
    && boundsRight(a) >= b.x - EPSILON
    && a.y <= boundsBottom(b) + EPSILON
    && boundsBottom(a) >= b.y - EPSILON;
}

function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const cdx = d.x - c.x;
  const cdy = d.y - c.y;
  const denominator = abx * cdy - aby * cdx;
  if (Math.abs(denominator) <= EPSILON) return { ...b };
  const amount = ((c.x - a.x) * cdy - (c.y - a.y) * cdx) / denominator;
  return { x: round(a.x + abx * amount), y: round(a.y + aby * amount) };
}

function clipPolygonConvex(subject: Point[], clip: Point[]): Point[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientation = signedArea(clip) >= 0 ? 1 : -1;
  let output = subject.map((point) => ({ ...point }));
  for (let edgeIndex = 0; edgeIndex < clip.length && output.length > 0; edgeIndex += 1) {
    const edgeStart = clip[edgeIndex];
    const edgeEnd = clip[(edgeIndex + 1) % clip.length];
    const input = output;
    output = [];
    let previous = input[input.length - 1];
    let previousInside = cross(edgeStart, edgeEnd, previous) * orientation >= -EPSILON;
    for (const current of input) {
      const currentInside = cross(edgeStart, edgeEnd, current) * orientation >= -EPSILON;
      if (currentInside !== previousInside) output.push(lineIntersection(previous, current, edgeStart, edgeEnd));
      if (currentInside) output.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  const cleaned: Point[] = [];
  for (const point of output) {
    const previous = cleaned[cleaned.length - 1];
    if (!previous || Math.abs(previous.x - point.x) > EPSILON || Math.abs(previous.y - point.y) > EPSILON) cleaned.push(point);
  }
  if (cleaned.length > 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) cleaned.pop();
  }
  return cleaned.length >= 3 && Math.abs(signedArea(cleaned)) > EPSILON ? cleaned : [];
}

function clipPreparedGlyph(
  preparedGlyph: PreparedGlyph,
  clipPolygon: Point[],
  counters: BuildCounters,
): Point[][] | null {
  const clipBounds = pointBounds(clipPolygon);
  if (!clipBounds) return [];
  const output: Point[][] = [];
  for (const contour of preparedGlyph.contours) {
    const clippedPieces: Point[][] = [];
    for (const piece of contour.pieces) {
      const pieceBounds = pointBounds(piece);
      if (!pieceBounds || !boundsOverlap(pieceBounds, clipBounds)) continue;
      counters.clippingOperations += 1;
      if (counters.clippingOperations > GLYPH_DISPLACEMENT_BUDGETS.clippingOperations) {
        counters.budgetLimited = true;
        return null;
      }
      const clipped = clipPolygonConvex(piece, clipPolygon);
      if (clipped.length >= 3) clippedPieces.push(clipped);
    }
    if (clippedPieces.length === 0) continue;
    let loops = extractBoundaryLoops(clippedPieces);
    if (loops.length === 0) {
      loops = clippedPieces;
      counters.triangulationFallback = true;
    }
    output.push(...loops);
    counters.peakTemporaryArrays = Math.max(
      counters.peakTemporaryArrays,
      clippedPieces.length + loops.length + output.length,
    );
  }
  return output;
}

function sampleFragmentEnvelope(
  polygons: Point[][],
  sources: EmitterInfluenceSource[],
  state: ProjectState,
  targetGlyph: PositionedGlyph,
) {
  const samples: Point[] = [];
  const centroidLimit = Math.min(8, polygons.length);
  for (let index = 0; index < centroidLimit; index += 1) {
    const polygon = polygons[Math.floor(index * polygons.length / centroidLimit)];
    samples.push({
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      y: polygon.reduce((sum, point) => sum + point.y, 0) / polygon.length,
    });
  }
  const boundaryPoints = polygons.flat();
  const boundaryBudget = Math.max(1, 24 - samples.length);
  const boundaryCount = Math.min(boundaryBudget, boundaryPoints.length);
  for (let index = 0; index < boundaryCount; index += 1) {
    samples.push(boundaryPoints[Math.floor(index * boundaryPoints.length / boundaryCount)]);
  }
  if (samples.length === 0) return { influence: 0, anchor: null as Point | null };
  let influenceSum = 0;
  let weightedAnchorX = 0;
  let weightedAnchorY = 0;
  let anchorWeight = 0;
  for (const samplePoint of samples) {
    const sample = sampleEmitterInfluence(samplePoint, sources, state.glyphInfluence, targetGlyph);
    influenceSum += sample.influence;
    if (sample.anchor && sample.influence > EPSILON) {
      weightedAnchorX += sample.anchor.x * sample.influence;
      weightedAnchorY += sample.anchor.y * sample.influence;
      anchorWeight += sample.influence;
    }
  }
  return {
    influence: clamp(influenceSum / samples.length, 0, 1),
    anchor: anchorWeight > EPSILON
      ? { x: weightedAnchorX / anchorWeight, y: weightedAnchorY / anchorWeight }
      : null,
  };
}

function pointKey(point: Point) {
  return `${Math.round(point.x * 100_000)},${Math.round(point.y * 100_000)}`;
}

interface BoundaryEdge {
  a: Point;
  b: Point;
  aKey: string;
  bKey: string;
  used: boolean;
}

function extractBoundaryLoops(polygons: Point[][]): Point[][] {
  const directed = new Map<string, BoundaryEdge[]>();
  const pushEdge = (a: Point, b: Point) => {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    if (aKey === bKey) return;
    const reverseKey = `${bKey}>${aKey}`;
    const reverse = directed.get(reverseKey);
    if (reverse?.length) {
      reverse.pop();
      if (reverse.length === 0) directed.delete(reverseKey);
      return;
    }
    const key = `${aKey}>${bKey}`;
    const bucket = directed.get(key) ?? [];
    bucket.push({ a, b, aKey, bKey, used: false });
    directed.set(key, bucket);
  };
  for (const polygon of polygons) {
    for (let index = 0; index < polygon.length; index += 1) pushEdge(polygon[index], polygon[(index + 1) % polygon.length]);
  }
  const edges = [...directed.values()].flat();
  const byStart = new Map<string, BoundaryEdge[]>();
  for (const edge of edges) {
    const bucket = byStart.get(edge.aKey) ?? [];
    bucket.push(edge);
    byStart.set(edge.aKey, bucket);
  }
  for (const bucket of byStart.values()) bucket.sort((a, b) => a.bKey.localeCompare(b.bKey));
  const loops: Point[][] = [];
  for (const firstEdge of edges) {
    if (firstEdge.used) continue;
    firstEdge.used = true;
    const loop = [firstEdge.a, firstEdge.b];
    const startKey = firstEdge.aKey;
    let cursorKey = firstEdge.bKey;
    let guard = edges.length + 1;
    while (cursorKey !== startKey && guard > 0) {
      guard -= 1;
      const next = (byStart.get(cursorKey) ?? []).find((edge) => !edge.used);
      if (!next) break;
      next.used = true;
      loop.push(next.b);
      cursorKey = next.bKey;
    }
    if (cursorKey === startKey && loop.length > 3) loop.pop();
    if (loop.length >= 3 && Math.abs(signedArea(loop)) > EPSILON) loops.push(loop);
  }
  return loops;
}

function serializePolygons(polygons: Point[][]): { d: string; commands: GlyphPathCommand[] } {
  const commands: GlyphPathCommand[] = [];
  const paths: string[] = [];
  for (const polygon of polygons) {
    if (polygon.length < 3) continue;
    const first = polygon[0];
    commands.push({ type: "M", x: first.x, y: first.y });
    let path = `M${round(first.x, 1_000)} ${round(first.y, 1_000)}`;
    for (let index = 1; index < polygon.length; index += 1) {
      const point = polygon[index];
      commands.push({ type: "L", x: point.x, y: point.y });
      path += `L${round(point.x, 1_000)} ${round(point.y, 1_000)}`;
    }
    commands.push({ type: "Z" });
    paths.push(`${path}Z`);
  }
  return { d: paths.join(""), commands };
}

function displacedGlyph(
  sourceGlyph: PositionedGlyph,
  polygons: Point[][],
): PositionedGlyph {
  const bounds = polygonsBounds(polygons);
  const serialized = serializePolygons(polygons);
  const center = bounds ? centerOf(bounds) : sourceGlyph.center;
  return {
    ...sourceGlyph,
    path: { d: serialized.d, bounds, commands: serialized.commands },
    center,
    centroid: center,
    counterCenter: sourceGlyph.counterCenter ? center : null,
    sourceAnchor: sourceGlyph.counterCenter ? center : center,
  };
}

function resolveLines(source: TextGeometry, glyphs: PositionedGlyph[]): TextLineGeometry[] | undefined {
  return source.lines?.map((line) => ({
    ...line,
    bounds: unionBounds(glyphs.filter((glyph) => glyph.lineIndex === line.lineIndex).map((glyph) => glyph.path.bounds)),
  }));
}

function buildWarpGeometry(
  state: ProjectState,
  source: TextGeometry,
  prepared: PreparedGlyph[],
  sourceTypographyKey: string,
  displacementKey: string,
  geometryKey: string,
  counters: BuildCounters,
): { geometry: TextGeometry; fragments: DisplacedTypographyFragment[] } {
  const glyphs = source.glyphs.map((glyph) => {
    const entry = prepared.find((candidate) => candidate.glyph.glyphId === glyph.glyphId);
    const polygons = entry?.contours.map((contour) => contour.source.points.map((point) => displaceWarpPoint(state, point, source))) ?? [];
    return displacedGlyph(glyph, polygons);
  });
  const bounds = unionBounds(glyphs.map((glyph) => glyph.path.bounds));
  const fragments = glyphs.flatMap((glyph, index): DisplacedTypographyFragment[] => {
    if (!glyph.path.bounds) return [];
    return [{
      id: `warp-${glyph.glyphId}`,
      regionIndex: index,
      row: 0,
      column: index,
      sourceBounds: source.glyphs[index]?.path.bounds ?? glyph.path.bounds,
      bounds: glyph.path.bounds,
      transform: IDENTITY_TRANSFORM,
      translation: { x: 0, y: 0 },
      responseWeight: 1,
      sourcePointCount: glyph.path.commands.length,
      glyphIds: [glyph.glyphId],
    }];
  });
  counters.peakTemporaryArrays = Math.max(counters.peakTemporaryArrays, glyphs.length + fragments.length);
  return {
    geometry: {
      ...source,
      glyphs,
      lines: resolveLines(source, glyphs),
      bounds,
      displacement: {
        sourceTypographyKey,
        displacementKey,
        geometryKey,
        mode: state.glyphDisplacement.mode,
        fragmentCount: fragments.length,
        fragmentBounds: fragments.map((fragment) => fragment.bounds),
        clippingStatus: counters.budgetLimited ? "budget-limited" : "complete",
      },
    },
    fragments,
  };
}

function buildFragmentGeometry(
  state: ProjectState,
  source: TextGeometry,
  prepared: PreparedGlyph[],
  sourceTypographyKey: string,
  displacementKey: string,
  geometryKey: string,
  anchors: DisplacementAnchor[],
  counters: BuildCounters,
): { geometry: TextGeometry; fragments: DisplacedTypographyFragment[]; effectiveRegionSize: number } {
  const regionPlan = buildRegions(state, source.bounds!, anchors);
  if (regionPlan.limited) counters.budgetLimited = true;
  const outputByGlyph = new Map<string, Point[][]>(source.glyphs.map((glyph) => [glyph.glyphId, []]));
  const fragments: DisplacedTypographyFragment[] = [];

  regionLoop:
  for (const region of regionPlan.regions) {
    if (fragments.length >= GLYPH_DISPLACEMENT_BUDGETS.fragments) {
      counters.budgetLimited = true;
      break;
    }
    const motion = resolveRegionMotion(state, region, anchors);
    const clipPolygon = insetRegionPolygon(region, state.glyphDisplacement, motion.weight);
    const clipBounds = pointBounds(clipPolygon);
    if (!clipBounds) continue;
    const sourcePolygons: Point[][] = [];
    const displacedPolygons: Point[][] = [];
    const glyphIds = new Set<string>();

    for (const preparedGlyph of prepared) {
      const glyphOutput = outputByGlyph.get(preparedGlyph.glyph.glyphId)!;
      for (const contour of preparedGlyph.contours) {
        const clippedPieces: Point[][] = [];
        for (const piece of contour.pieces) {
          const pieceBounds = pointBounds(piece);
          if (!pieceBounds || !boundsOverlap(pieceBounds, clipBounds)) continue;
          counters.clippingOperations += 1;
          if (counters.clippingOperations > GLYPH_DISPLACEMENT_BUDGETS.clippingOperations) {
            counters.budgetLimited = true;
            break regionLoop;
          }
          const clipped = clipPolygonConvex(piece, clipPolygon);
          if (clipped.length >= 3) clippedPieces.push(clipped);
        }
        if (clippedPieces.length === 0) continue;
        let loops = extractBoundaryLoops(clippedPieces);
        if (loops.length === 0) {
          loops = clippedPieces;
          counters.triangulationFallback = true;
        }
        for (const loop of loops) {
          sourcePolygons.push(loop);
          const displaced = loop.map((point) => applyTransform(point, motion.transform));
          displacedPolygons.push(displaced);
          glyphOutput.push(displaced);
        }
        glyphIds.add(preparedGlyph.glyph.glyphId);
        counters.peakTemporaryArrays = Math.max(
          counters.peakTemporaryArrays,
          clippedPieces.length + loops.length + sourcePolygons.length + displacedPolygons.length,
        );
      }
    }

    const sourceFragmentBounds = polygonsBounds(sourcePolygons);
    const displacedFragmentBounds = polygonsBounds(displacedPolygons);
    if (sourceFragmentBounds && displacedFragmentBounds) {
      fragments.push({
        id: region.id,
        regionIndex: region.index,
        row: region.row,
        column: region.column,
        sourceBounds: sourceFragmentBounds,
        bounds: displacedFragmentBounds,
        transform: motion.transform,
        translation: motion.translation,
        responseWeight: motion.weight,
        sourcePointCount: sourcePolygons.reduce((sum, polygon) => sum + polygon.length, 0),
        glyphIds: [...glyphIds],
      });
    }
  }

  const glyphs = source.glyphs.map((glyph) => displacedGlyph(glyph, outputByGlyph.get(glyph.glyphId) ?? []));
  const bounds = unionBounds(glyphs.map((glyph) => glyph.path.bounds));
  const clippingStatus = counters.budgetLimited
    ? "budget-limited"
    : counters.triangulationFallback
      ? "triangulation-fallback"
      : "complete";
  return {
    geometry: {
      ...source,
      glyphs,
      lines: resolveLines(source, glyphs),
      bounds,
      displacement: {
        sourceTypographyKey,
        displacementKey,
        geometryKey,
        mode: state.glyphDisplacement.mode,
        fragmentCount: fragments.length,
        fragmentBounds: fragments.map((fragment) => fragment.bounds),
        clippingStatus,
      },
    },
    fragments,
    effectiveRegionSize: regionPlan.effectiveRegionSize,
  };
}

function buildEmitterSliceGeometry(
  state: ProjectState,
  source: TextGeometry,
  prepared: PreparedGlyph[],
  sourceTypographyKey: string,
  displacementKey: string,
  geometryKey: string,
  sources: EmitterInfluenceSource[],
  counters: BuildCounters,
): { geometry: TextGeometry; fragments: DisplacedTypographyFragment[]; effectiveRegionSize: number } {
  const planningAnchors: DisplacementAnchor[] = sources.map((source) => ({
    id: source.id,
    x: source.anchor.x,
    y: source.anchor.y,
    weight: source.weight,
    radiusMultiplier: source.radiusMultiplier,
  }));
  const regionPlan = buildRegions(state, source.bounds!, planningAnchors);
  if (regionPlan.limited) counters.budgetLimited = true;
  const outputByGlyph = new Map<string, Point[][]>(source.glyphs.map((glyph) => [glyph.glyphId, []]));
  const scopedSourcesByGlyph = new Map<string, EmitterInfluenceSource[]>();
  for (const glyph of source.glyphs) {
    const scopedSources = eligibleEmitterInfluenceSources(sources, glyph);
    if (scopedSources.length === 0) continue;
    scopedSourcesByGlyph.set(glyph.glyphId, scopedSources);
  }
  const changedGlyphIds = new Set<string>();
  const fragments: DisplacedTypographyFragment[] = [];

  buildLoop:
  for (const region of regionPlan.regions) {
    for (const preparedGlyph of prepared) {
      const scopedSources = scopedSourcesByGlyph.get(preparedGlyph.glyph.glyphId);
      if (!scopedSources) continue;
      if (fragments.length >= GLYPH_DISPLACEMENT_BUDGETS.fragments) {
        counters.budgetLimited = true;
        break buildLoop;
      }
      const rawLoops = clipPreparedGlyph(preparedGlyph, region.polygon, counters);
      if (rawLoops === null) break buildLoop;
      if (rawLoops.length === 0) continue;
      const envelope = sampleFragmentEnvelope(rawLoops, scopedSources, state, preparedGlyph.glyph);
      const localizedClip = insetRegionPolygon(region, state.glyphDisplacement, envelope.influence);
      const gapActive = localizedClip !== region.polygon;
      const sourcePolygons = gapActive
        ? clipPreparedGlyph(preparedGlyph, localizedClip, counters)
        : rawLoops;
      if (sourcePolygons === null) break buildLoop;
      if (sourcePolygons.length === 0) continue;
      const sourceFragmentBounds = polygonsBounds(sourcePolygons);
      if (!sourceFragmentBounds) continue;
      const fragmentCenter = centerOf(sourceFragmentBounds);
      const resolvedAnchor = envelope.anchor ?? sources[0]?.anchor ?? fragmentCenter;
      const anchor: DisplacementAnchor = {
        id: sources[0]?.id ?? "influence-center",
        x: resolvedAnchor.x,
        y: resolvedAnchor.y,
        weight: 1,
        radiusMultiplier: 1,
      };
      const fragmentRegion: Region = {
        ...region,
        id: `${region.id}:${preparedGlyph.glyph.glyphId}`,
        center: fragmentCenter,
        bounds: sourceFragmentBounds,
      };
      const motion = resolveLocalizedSliceMotion(state, fragmentRegion, anchor, envelope.influence);
      const transformChanged = Math.abs(motion.transform.a - 1) > EPSILON
        || Math.abs(motion.transform.b) > EPSILON
        || Math.abs(motion.transform.c) > EPSILON
        || Math.abs(motion.transform.d - 1) > EPSILON
        || Math.abs(motion.transform.e) > EPSILON
        || Math.abs(motion.transform.f) > EPSILON;
      if (envelope.influence > EPSILON && (transformChanged || state.glyphDisplacement.gap > EPSILON)) {
        changedGlyphIds.add(preparedGlyph.glyph.glyphId);
      }
      const displacedPolygons = sourcePolygons.map((polygon) => polygon.map((point) => applyTransform(point, motion.transform)));
      const displacedFragmentBounds = polygonsBounds(displacedPolygons);
      if (!displacedFragmentBounds) continue;
      outputByGlyph.get(preparedGlyph.glyph.glyphId)!.push(...displacedPolygons);
      fragments.push({
        id: fragmentRegion.id,
        regionIndex: region.index,
        row: region.row,
        column: region.column,
        sourceBounds: sourceFragmentBounds,
        bounds: displacedFragmentBounds,
        transform: motion.transform,
        translation: motion.translation,
        responseWeight: motion.weight,
        sourcePointCount: sourcePolygons.reduce((sum, polygon) => sum + polygon.length, 0),
        glyphIds: [preparedGlyph.glyph.glyphId],
      });
      counters.peakTemporaryArrays = Math.max(
        counters.peakTemporaryArrays,
        rawLoops.length + sourcePolygons.length + displacedPolygons.length,
      );
    }
  }

  const glyphs = source.glyphs.map((glyph) => changedGlyphIds.has(glyph.glyphId)
    ? displacedGlyph(glyph, outputByGlyph.get(glyph.glyphId) ?? [])
    : glyph);
  const bounds = unionBounds(glyphs.map((glyph) => glyph.path.bounds));
  const clippingStatus = counters.budgetLimited
    ? "budget-limited"
    : counters.triangulationFallback
      ? "triangulation-fallback"
      : "complete";
  return {
    geometry: {
      ...source,
      glyphs,
      lines: resolveLines(source, glyphs),
      bounds,
      displacement: {
        sourceTypographyKey,
        displacementKey,
        geometryKey,
        mode: state.glyphDisplacement.mode,
        fragmentCount: fragments.length,
        fragmentBounds: fragments.map((fragment) => fragment.bounds),
        clippingStatus,
      },
    },
    fragments,
    effectiveRegionSize: regionPlan.effectiveRegionSize,
  };
}

function inactiveResult(
  sourceTypographyKey: string,
  displacementKey: string,
  geometryKey: string,
  source: TextGeometry | null,
  reason: GlyphDisplacementDiagnostics["inactiveReason"],
  started: number,
): DisplacedTypographyGeometry {
  return {
    sourceTypographyKey,
    displacementKey,
    geometryKey,
    geometry: source,
    layoutBounds: source?.layoutBounds ?? source?.bounds ?? null,
    inkBounds: source?.bounds ?? null,
    fragmentBounds: [],
    fragments: [],
    active: false,
    exact: Boolean(source?.hasOutlines),
    diagnostics: {
      sourceContourPoints: 0,
      fragmentCount: 0,
      affectedFragmentCount: 0,
      clippingOperations: 0,
      buildDurationMs: Math.max(0, now() - started),
      peakTemporaryArrays: 0,
      clippingStatus: "complete",
      effectiveRegionSize: 0,
      anchorCount: 0,
      maxDisplacement: 0,
      inactiveReason: reason,
    },
  };
}

/**
 * Pure geometry derivation (timing diagnostics are observational only). Source
 * typography is never mutated, and a disabled/zero-strength result returns the
 * exact source object and source semantic key.
 */
export function deriveDisplacedTypographyGeometry(
  state: ProjectState,
  source: TextGeometry | null,
  sourceTypographyKey: string,
): DisplacedTypographyGeometry {
  const started = now();
  const identity = glyphDisplacementIdentity(state, sourceTypographyKey, source);
  if (!identity.active) return inactiveResult(sourceTypographyKey, identity.displacementKey, identity.geometryKey, source, identity.reason, started);
  const counters: BuildCounters = {
    sourceContourPoints: 0,
    clippingOperations: 0,
    peakTemporaryArrays: 0,
    budgetLimited: state.glyphDisplacement.strength > GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth,
    triangulationFallback: false,
  };
  const prepared = prepareGlyphs(source!, counters);
  const localizedSlice = (state.glyphDisplacement.mode === "horizontal-slices" || state.glyphDisplacement.mode === "vertical-slices")
    && state.glyphDisplacement.sliceInfluence === "emitter-falloff";
  const influenceSources = localizedSlice ? resolveEmitterInfluenceSources(state, source!) : [];
  const anchors = localizedSlice
    ? influenceSources.map((source) => ({
        id: source.id,
        x: source.anchor.x,
        y: source.anchor.y,
        weight: source.weight,
        radiusMultiplier: source.radiusMultiplier,
      }))
    : resolveAnchors(state, source!);
  const built = state.glyphDisplacement.mode === "warp"
    ? { ...buildWarpGeometry(state, source!, prepared, sourceTypographyKey, identity.displacementKey, identity.geometryKey, counters), effectiveRegionSize: state.glyphDisplacement.fragmentSize }
    : localizedSlice
      ? buildEmitterSliceGeometry(state, source!, prepared, sourceTypographyKey, identity.displacementKey, identity.geometryKey, influenceSources, counters)
      : buildFragmentGeometry(state, source!, prepared, sourceTypographyKey, identity.displacementKey, identity.geometryKey, anchors, counters);
  const fragmentBounds = built.fragments.map((fragment) => fragment.bounds);
  const affectedFragments = built.fragments.filter((fragment) => (
    fragment.responseWeight > EPSILON
    && (Math.hypot(fragment.translation.x, fragment.translation.y) > EPSILON || state.glyphDisplacement.gap > EPSILON)
  ));
  const maxDisplacement = built.fragments.reduce(
    (maximum, fragment) => Math.max(maximum, Math.hypot(fragment.translation.x, fragment.translation.y)),
    0,
  );
  const clippingStatus = counters.budgetLimited
    ? "budget-limited"
    : counters.triangulationFallback
      ? "triangulation-fallback"
      : "complete";
  if (built.geometry.displacement) built.geometry.displacement.clippingStatus = clippingStatus;
  return {
    sourceTypographyKey,
    displacementKey: identity.displacementKey,
    geometryKey: identity.geometryKey,
    geometry: built.geometry,
    layoutBounds: built.geometry.layoutBounds ?? source!.layoutBounds ?? source!.bounds,
    inkBounds: built.geometry.bounds,
    fragmentBounds,
    fragments: built.fragments,
    active: true,
    exact: true,
    diagnostics: {
      sourceContourPoints: counters.sourceContourPoints,
      fragmentCount: built.fragments.length,
      affectedFragmentCount: affectedFragments.length,
      clippingOperations: counters.clippingOperations,
      buildDurationMs: Math.max(0, now() - started),
      peakTemporaryArrays: counters.peakTemporaryArrays,
      clippingStatus,
      effectiveRegionSize: built.effectiveRegionSize,
      anchorCount: anchors.length,
      maxDisplacement,
    },
  };
}
