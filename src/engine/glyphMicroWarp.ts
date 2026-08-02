import type { ProjectState } from "../types";
import type {
  GlyphBounds,
  GlyphPathCommand,
  PositionedGlyph,
  TextGeometry,
  TextLineGeometry,
} from "./glyphGeometry";
import { unionBounds } from "./glyphGeometry";
import { getFalloffWeight } from "./field/compositeWaveField";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./field/glyphEmitters";

export const GLYPH_MICRO_WARP_BUDGETS = {
  sourceContourPoints: 30_000,
  curveSteps: 10,
  emitterContributions: 8,
  detailOctaves: 3,
  topologyChecks: 120_000,
  maxDisplacement: 48,
} as const;

export const GLYPH_MICRO_WARP_PARSED_FONT_WARNING =
  "Glyph Micro Warp requires a loaded .ttf/.otf outline font; native fallback remains exactly unwarped.";

export interface GlyphMicroWarpPoint {
  x: number;
  y: number;
}

export interface GlyphMicroWarpContour {
  points: GlyphMicroWarpPoint[];
}

interface WarpEmitter {
  id: string;
  anchor: GlyphMicroWarpPoint;
  weight: number;
  radiusMultiplier: number;
  phaseOffset: number;
}

interface BuildCounters {
  sourcePointCount: number;
  warpedPointCount: number;
  affectedPointCount: number;
  clampedPointCount: number;
  topologyGuardCount: number;
  emitterContributionCount: number;
  maxEmitterContributions: number;
  maxDisplacement: number;
  pointBudgetLimited: boolean;
  topologyChecks: number;
  topologyCheckLimited: boolean;
  affectedPoints: GlyphMicroWarpPoint[];
}

export type GlyphMicroWarpInactiveReason =
  | "disabled"
  | "zero-strength"
  | "emitter-disabled"
  | "no-emitter"
  | "native-fallback"
  | "empty-geometry";

export interface GlyphMicroWarpDiagnostics {
  sourcePointCount: number;
  warpedPointCount: number;
  affectedPointCount: number;
  clampedPointCount: number;
  topologyGuardCount: number;
  emitterContributionCount: number;
  maxEmitterContributions: number;
  emitterCount: number;
  maxDisplacement: number;
  buildDurationMs: number;
  safetyStatus: "complete" | "displacement-clamped" | "topology-guarded" | "point-budget-limited";
  topologyCheckLimited: boolean;
  affectedBounds: GlyphBounds | null;
  inactiveReason?: GlyphMicroWarpInactiveReason;
}

export interface GlyphMicroWarpGeometry {
  sourceTypographyKey: string;
  warpKey: string;
  geometryKey: string;
  geometry: TextGeometry | null;
  inkBounds: GlyphBounds | null;
  active: boolean;
  exact: boolean;
  diagnostics: GlyphMicroWarpDiagnostics;
}

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

function hash32(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
    hash ^= hash >>> 13;
  }
  return hash >>> 0;
}

function hashString(value: string) {
  const a = hash32(value);
  const b = hash32(`${value}|micro-warp`);
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function scalarHash(x: number, y: number, seed: number) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(y | 0, 0x5f356495) ^ seed;
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

function coherentDetail(
  point: GlyphMicroWarpPoint,
  scale: number,
  octaves: number,
  seed: number,
  phaseOffset: number,
) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let normalization = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise(
      point.x / scale * frequency + phaseOffset * 3.17,
      point.y / scale * frequency - phaseOffset * 2.11,
      seed + octave * 0x9e3779b9,
    ) * amplitude;
    normalization += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return normalization > 0 ? total / normalization : 0;
}

function pointBounds(points: GlyphMicroWarpPoint[]): GlyphBounds | null {
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

function contoursBounds(contours: GlyphMicroWarpContour[]): GlyphBounds | null {
  return unionBounds(contours.map((contour) => pointBounds(contour.points)));
}

export function glyphMicroWarpSignedArea(points: GlyphMicroWarpPoint[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return area / 2;
}

function interpolateQuadratic(a: GlyphMicroWarpPoint, control: GlyphMicroWarpPoint, b: GlyphMicroWarpPoint, t: number) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * a.x + 2 * inverse * t * control.x + t * t * b.x,
    y: inverse * inverse * a.y + 2 * inverse * t * control.y + t * t * b.y,
  };
}

function interpolateCubic(
  a: GlyphMicroWarpPoint,
  c1: GlyphMicroWarpPoint,
  c2: GlyphMicroWarpPoint,
  b: GlyphMicroWarpPoint,
  t: number,
) {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * a.x + 3 * inverse * inverse * t * c1.x + 3 * inverse * t * t * c2.x + t ** 3 * b.x,
    y: inverse ** 3 * a.y + 3 * inverse * inverse * t * c1.y + 3 * inverse * t * t * c2.y + t ** 3 * b.y,
  };
}

/** Deterministic path flattening shared with focused geometry assertions. */
export function flattenGlyphMicroWarpCommands(
  commands: GlyphPathCommand[],
  pointLimit: number = GLYPH_MICRO_WARP_BUDGETS.sourceContourPoints,
  curveSteps: number = GLYPH_MICRO_WARP_BUDGETS.curveSteps,
) {
  const contours: GlyphMicroWarpContour[] = [];
  let points: GlyphMicroWarpPoint[] = [];
  let cursor: GlyphMicroWarpPoint = { x: 0, y: 0 };
  let pointCount = 0;
  let complete = true;
  const push = (point: GlyphMicroWarpPoint) => {
    if (pointCount >= pointLimit) {
      complete = false;
      return;
    }
    const previous = points[points.length - 1];
    if (!previous || Math.abs(previous.x - point.x) > EPSILON || Math.abs(previous.y - point.y) > EPSILON) {
      points.push(point);
      pointCount += 1;
    }
  };
  const finish = () => {
    if (points.length > 2) {
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.abs(first.x - last.x) <= EPSILON && Math.abs(first.y - last.y) <= EPSILON) points = points.slice(0, -1);
      if (points.length > 2 && Math.abs(glyphMicroWarpSignedArea(points)) > EPSILON) contours.push({ points });
    }
    points = [];
  };

  for (const command of commands) {
    if (!complete) break;
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
      for (let step = 1; step <= curveSteps && complete; step += 1) push(interpolateQuadratic(start, control, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "C" && command.x !== undefined && command.y !== undefined && command.x1 !== undefined && command.y1 !== undefined && command.x2 !== undefined && command.y2 !== undefined) {
      const start = cursor;
      const control1 = { x: command.x1, y: command.y1 };
      const control2 = { x: command.x2, y: command.y2 };
      const end = { x: command.x, y: command.y };
      for (let step = 1; step <= curveSteps && complete; step += 1) push(interpolateCubic(start, control1, control2, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "Z") {
      finish();
    }
  }
  finish();
  return { contours, pointCount, complete };
}

function serializeContours(contours: GlyphMicroWarpContour[]) {
  const commands: GlyphPathCommand[] = [];
  const paths: string[] = [];
  for (const contour of contours) {
    if (contour.points.length < 3) continue;
    const first = contour.points[0];
    commands.push({ type: "M", x: first.x, y: first.y });
    let path = `M${round(first.x, 1_000)} ${round(first.y, 1_000)}`;
    for (let index = 1; index < contour.points.length; index += 1) {
      const point = contour.points[index];
      commands.push({ type: "L", x: point.x, y: point.y });
      path += `L${round(point.x, 1_000)} ${round(point.y, 1_000)}`;
    }
    commands.push({ type: "Z" });
    paths.push(`${path}Z`);
  }
  return { d: paths.join(""), commands };
}

function centerOf(bounds: GlyphBounds | null) {
  return bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
}

function resolveEmitters(state: ProjectState, source: TextGeometry): WarpEmitter[] {
  if (!state.emitter.enabled) return [];
  if (state.emitterMode === "multiple") {
    return resolveGlyphEmitterSources(state, source).sources
      .filter((emitter) => emitter.weight > 0)
      .slice(0, GLYPH_MICRO_WARP_BUDGETS.emitterContributions)
      .map((emitter) => ({
        id: emitter.id,
        anchor: emitter.anchor,
        weight: emitter.weight,
        radiusMultiplier: emitter.radiusMultiplier,
        phaseOffset: emitter.phaseOffset,
      }));
  }
  const metadata = getGlyphEmitterMetadata(state, source).filter((glyph) => glyph.emitterEligible);
  const glyph = resolveEmitterGlyph(metadata, state.emitter.glyphId);
  const anchor = glyph
    ? getGlyphEmitterAnchor(glyph, state.emitter.sourceMode, { x: state.emitter.customX, y: state.emitter.customY })
    : centerOf(source.bounds ?? source.layoutBounds ?? null);
  return [{
    id: state.emitter.id,
    anchor,
    weight: 1,
    radiusMultiplier: 1,
    phaseOffset: state.emitter.phase,
  }];
}

function emitterIdentity(emitters: WarpEmitter[]) {
  return emitters.map((emitter) => ({
    id: emitter.id,
    x: round(emitter.anchor.x),
    y: round(emitter.anchor.y),
    weight: round(emitter.weight),
    radiusMultiplier: round(emitter.radiusMultiplier),
    phaseOffset: round(emitter.phaseOffset),
  }));
}

export function glyphMicroWarpIdentity(
  state: ProjectState,
  sourceTypographyKey: string,
  source: TextGeometry | null,
) {
  const inactive = (reason: GlyphMicroWarpInactiveReason, suffix = reason) => ({
    warpKey: `glyph-micro-warp:${suffix}`,
    geometryKey: sourceTypographyKey,
    active: false as const,
    reason,
  });
  const settings = state.glyphMicroWarp;
  if (!settings.enabled) return inactive("disabled");
  if (settings.strength <= 0 || settings.maxDisplacement <= 0 || (settings.normalDisplacement <= 0 && settings.tangentialDisplacement <= 0)) {
    return inactive("zero-strength");
  }
  if (!state.emitter.enabled) return inactive("emitter-disabled");
  if (!source?.hasOutlines) return inactive("native-fallback");
  if (!source.bounds || source.glyphs.every((glyph) => glyph.path.commands.length === 0)) return inactive("empty-geometry");
  const emitters = resolveEmitters(state, source);
  if (emitters.length === 0) return inactive("no-emitter");
  const semantic = JSON.stringify({
    sourceTypographyKey,
    strength: settings.strength,
    responseRadius: settings.responseRadius,
    falloff: settings.falloff,
    detailScale: settings.detailScale,
    detailOctaves: settings.detailOctaves,
    normalDisplacement: settings.normalDisplacement,
    tangentialDisplacement: settings.tangentialDisplacement,
    edgeTurbulence: settings.edgeTurbulence,
    quantizationSteps: settings.quantizationSteps,
    maxDisplacement: settings.maxDisplacement,
    preserveCounters: settings.preserveCounters,
    seedInfluence: settings.seedInfluence,
    seed: settings.seedInfluence > 0 ? state.seed : "inactive",
    emitters: emitterIdentity(emitters),
  });
  const warpKey = `glyph-micro-warp:${hashString(semantic)}`;
  return {
    warpKey,
    geometryKey: `typography-micro-warped:${hashString(`${sourceTypographyKey}|${warpKey}`)}`,
    active: true as const,
    reason: null,
  };
}

function distance(a: GlyphMicroWarpPoint, b: GlyphMicroWarpPoint) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentIntersection(
  a: GlyphMicroWarpPoint,
  b: GlyphMicroWarpPoint,
  c: GlyphMicroWarpPoint,
  d: GlyphMicroWarpPoint,
) {
  const cross = (p: GlyphMicroWarpPoint, q: GlyphMicroWarpPoint, r: GlyphMicroWarpPoint) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  return abC * abD < -EPSILON && cdA * cdB < -EPSILON;
}

function hasSelfIntersection(points: GlyphMicroWarpPoint[], counters: BuildCounters) {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 2; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === secondNext || firstNext === second) continue;
      counters.topologyChecks += 1;
      if (counters.topologyChecks > GLYPH_MICRO_WARP_BUDGETS.topologyChecks) {
        counters.topologyCheckLimited = true;
        return false;
      }
      if (segmentIntersection(points[first], points[firstNext], points[second], points[secondNext])) return true;
    }
  }
  return false;
}

function safeContour(
  source: GlyphMicroWarpPoint[],
  candidate: GlyphMicroWarpPoint[],
  counters: BuildCounters,
) {
  const sourceArea = glyphMicroWarpSignedArea(source);
  const candidateArea = glyphMicroWarpSignedArea(candidate);
  if (!Number.isFinite(candidateArea) || Math.sign(sourceArea) !== Math.sign(candidateArea) || Math.abs(candidateArea) < Math.abs(sourceArea) * 0.2) return false;
  if (counters.topologyCheckLimited || source.length > 512) return true;
  const sourceIntersects = hasSelfIntersection(source, counters);
  if (counters.topologyCheckLimited || sourceIntersects) return true;
  return !hasSelfIntersection(candidate, counters);
}

function blendTowardSource(source: GlyphMicroWarpPoint[], target: GlyphMicroWarpPoint[], amount: number) {
  return target.map((point, index) => ({
    x: source[index].x + (point.x - source[index].x) * amount,
    y: source[index].y + (point.y - source[index].y) * amount,
  }));
}

function warpContour(
  state: ProjectState,
  contour: GlyphMicroWarpContour,
  emitters: WarpEmitter[],
  isCounter: boolean,
  counters: BuildCounters,
) {
  const settings = state.glyphMicroWarp;
  const strength = clamp(settings.strength / 100, 0, 1);
  const normalAmount = clamp(settings.normalDisplacement / 100, 0, 1);
  const tangentAmount = clamp(settings.tangentialDisplacement / 100, 0, 1);
  const turbulence = clamp(settings.edgeTurbulence / 100, 0, 1);
  const maxDisplacement = clamp(settings.maxDisplacement, 0, GLYPH_MICRO_WARP_BUDGETS.maxDisplacement);
  const scale = Math.max(4, settings.detailScale);
  const octaves = Math.round(clamp(settings.detailOctaves, 1, GLYPH_MICRO_WARP_BUDGETS.detailOctaves));
  let contourAffected = false;

  const candidate = contour.points.map((point, index) => {
    const previous = contour.points[(index - 1 + contour.points.length) % contour.points.length];
    const next = contour.points[(index + 1) % contour.points.length];
    const tangentMagnitude = Math.max(EPSILON, Math.hypot(next.x - previous.x, next.y - previous.y));
    const tangent = { x: (next.x - previous.x) / tangentMagnitude, y: (next.y - previous.y) / tangentMagnitude };
    const normal = { x: -tangent.y, y: tangent.x };
    let weightedX = 0;
    let weightedY = 0;
    let weightSum = 0;
    let unionInfluence = 0;
    let contributionCount = 0;

    for (const emitter of emitters) {
      const radius = Math.max(1, settings.responseRadius * Math.max(0.05, emitter.radiusMultiplier));
      const normalizedDistance = distance(point, emitter.anchor) / radius;
      if (normalizedDistance >= 1) continue;
      const influence = clamp(getFalloffWeight(normalizedDistance, settings.falloff) * Math.max(0, emitter.weight), 0, 1);
      if (influence <= EPSILON) continue;
      const seedFactor = clamp(settings.seedInfluence / 100, 0, 1);
      const projectSeed = Math.imul(Math.trunc(state.seed), Math.round(seedFactor * 65_535));
      const seed = (hash32(emitter.id) ^ projectSeed) >>> 0;
      const baseNormal = coherentDetail(point, scale, octaves, seed, emitter.phaseOffset);
      const fineNormal = coherentDetail(point, Math.max(4, scale * 0.5), octaves, seed ^ 0x68bc21eb, emitter.phaseOffset);
      const tangentDetail = coherentDetail(point, scale * 1.17, octaves, seed ^ 0x02e5be93, -emitter.phaseOffset);
      const normalDetail = baseNormal * (1 - turbulence * 0.55) + fineNormal * turbulence * 0.55;
      const counterScale = settings.preserveCounters && isCounter ? 0.55 : 1;
      const amplitude = maxDisplacement * strength * counterScale;
      const dx = normal.x * normalDetail * amplitude * normalAmount
        + tangent.x * tangentDetail * amplitude * tangentAmount;
      const dy = normal.y * normalDetail * amplitude * normalAmount
        + tangent.y * tangentDetail * amplitude * tangentAmount;
      weightedX += dx * influence;
      weightedY += dy * influence;
      weightSum += influence;
      unionInfluence = 1 - (1 - unionInfluence) * (1 - influence);
      contributionCount += 1;
    }

    if (weightSum <= EPSILON) return { ...point };
    contourAffected = true;
    counters.affectedPointCount += 1;
    counters.emitterContributionCount += contributionCount;
    counters.maxEmitterContributions = Math.max(counters.maxEmitterContributions, contributionCount);
    let dx = weightedX / weightSum * unionInfluence;
    let dy = weightedY / weightSum * unionInfluence;
    let magnitude = Math.hypot(dx, dy);
    if (settings.quantizationSteps > 0 && magnitude > EPSILON) {
      const quantum = maxDisplacement / Math.max(1, settings.quantizationSteps);
      const quantized = Math.min(maxDisplacement, Math.round(magnitude / quantum) * quantum);
      dx *= quantized / magnitude;
      dy *= quantized / magnitude;
      magnitude = quantized;
    }
    let allowed = maxDisplacement;
    if (settings.preserveCounters) {
      const localSpan = (distance(point, previous) + distance(point, next)) / 2;
      allowed = Math.min(allowed, Math.max(0.75, localSpan * (isCounter ? 0.35 : 0.5)));
    }
    if (magnitude > allowed && magnitude > EPSILON) {
      dx *= allowed / magnitude;
      dy *= allowed / magnitude;
      magnitude = allowed;
      counters.clampedPointCount += 1;
    }
    counters.maxDisplacement = Math.max(counters.maxDisplacement, magnitude);
    const warped = { x: point.x + dx, y: point.y + dy };
    counters.affectedPoints.push(point, warped);
    return warped;
  });

  if (!contourAffected || !settings.preserveCounters || safeContour(contour.points, candidate, counters)) {
    return { contour: { points: candidate }, affected: contourAffected };
  }
  for (const amount of [0.5, 0.25, 0.125]) {
    const guarded = blendTowardSource(contour.points, candidate, amount);
    if (safeContour(contour.points, guarded, counters)) {
      counters.topologyGuardCount += 1;
      return { contour: { points: guarded }, affected: true };
    }
  }
  counters.topologyGuardCount += 1;
  return { contour: { points: contour.points.map((point) => ({ ...point })) }, affected: false };
}

function resolveLines(source: TextGeometry, glyphs: PositionedGlyph[]): TextLineGeometry[] | undefined {
  return source.lines?.map((line) => ({
    ...line,
    bounds: unionBounds(glyphs.filter((glyph) => glyph.lineIndex === line.lineIndex).map((glyph) => glyph.path.bounds)),
  }));
}

function safetyStatus(counters: BuildCounters): GlyphMicroWarpDiagnostics["safetyStatus"] {
  if (counters.pointBudgetLimited) return "point-budget-limited";
  if (counters.topologyGuardCount > 0) return "topology-guarded";
  if (counters.clampedPointCount > 0) return "displacement-clamped";
  return "complete";
}

function inactiveResult(
  sourceTypographyKey: string,
  warpKey: string,
  geometryKey: string,
  source: TextGeometry | null,
  reason: GlyphMicroWarpInactiveReason,
  started: number,
): GlyphMicroWarpGeometry {
  return {
    sourceTypographyKey,
    warpKey,
    geometryKey,
    geometry: source,
    inkBounds: source?.bounds ?? null,
    active: false,
    exact: Boolean(source?.hasOutlines),
    diagnostics: {
      sourcePointCount: 0,
      warpedPointCount: 0,
      affectedPointCount: 0,
      clampedPointCount: 0,
      topologyGuardCount: 0,
      emitterContributionCount: 0,
      maxEmitterContributions: 0,
      emitterCount: 0,
      maxDisplacement: 0,
      buildDurationMs: Math.max(0, now() - started),
      safetyStatus: "complete",
      topologyCheckLimited: false,
      affectedBounds: null,
      inactiveReason: reason,
    },
  };
}

/**
 * Builds the single parsed-outline authority consumed by every downstream
 * stage. Timing is diagnostic only and never participates in semantic output.
 */
export function deriveGlyphMicroWarpGeometry(
  state: ProjectState,
  source: TextGeometry | null,
  sourceTypographyKey: string,
): GlyphMicroWarpGeometry {
  const started = now();
  const identity = glyphMicroWarpIdentity(state, sourceTypographyKey, source);
  if (!identity.active) return inactiveResult(sourceTypographyKey, identity.warpKey, identity.geometryKey, source, identity.reason, started);
  const emitters = resolveEmitters(state, source!);
  const counters: BuildCounters = {
    sourcePointCount: 0,
    warpedPointCount: 0,
    affectedPointCount: 0,
    clampedPointCount: 0,
    topologyGuardCount: 0,
    emitterContributionCount: 0,
    maxEmitterContributions: 0,
    maxDisplacement: 0,
    pointBudgetLimited: false,
    topologyChecks: 0,
    topologyCheckLimited: false,
    affectedPoints: [],
  };

  const glyphs = source!.glyphs.map((glyph) => {
    const remaining = GLYPH_MICRO_WARP_BUDGETS.sourceContourPoints - counters.sourcePointCount;
    if (remaining <= 0) {
      counters.pointBudgetLimited = true;
      return glyph;
    }
    const flattened = flattenGlyphMicroWarpCommands(glyph.path.commands, remaining);
    counters.sourcePointCount += flattened.pointCount;
    if (!flattened.complete) {
      counters.pointBudgetLimited = true;
      return glyph;
    }
    if (flattened.contours.length === 0) return glyph;
    const areas = flattened.contours.map((contour) => glyphMicroWarpSignedArea(contour.points));
    const largestIndex = areas.reduce((best, area, index) => Math.abs(area) > Math.abs(areas[best] ?? 0) ? index : best, 0);
    const outerSign = Math.sign(areas[largestIndex]) || 1;
    let glyphAffected = false;
    const warpedContours = flattened.contours.map((contour, index) => {
      const isCounter = Math.sign(areas[index]) !== outerSign;
      const warped = warpContour(state, contour, emitters, isCounter, counters);
      glyphAffected ||= warped.affected;
      return warped.contour;
    });
    counters.warpedPointCount += warpedContours.reduce((sum, contour) => sum + contour.points.length, 0);
    if (!glyphAffected) return glyph;
    const bounds = contoursBounds(warpedContours);
    const serialized = serializeContours(warpedContours);
    const center = bounds ? centerOf(bounds) : glyph.center;
    return {
      ...glyph,
      path: { d: serialized.d, bounds, commands: serialized.commands },
      center,
      centroid: center,
      counterCenter: glyph.counterCenter ? { ...glyph.counterCenter } : null,
      sourceAnchor: glyph.counterCenter ? { ...glyph.counterCenter } : center,
    };
  });
  const bounds = unionBounds(glyphs.map((glyph) => glyph.path.bounds));
  const status = safetyStatus(counters);
  const affectedBounds = pointBounds(counters.affectedPoints);
  const geometry: TextGeometry = {
    ...source!,
    glyphs,
    lines: resolveLines(source!, glyphs),
    bounds,
    microWarp: {
      sourceTypographyKey,
      warpKey: identity.warpKey,
      geometryKey: identity.geometryKey,
      sourcePointCount: counters.sourcePointCount,
      warpedPointCount: counters.warpedPointCount,
      affectedPointCount: counters.affectedPointCount,
      emitterCount: emitters.length,
      maxDisplacement: counters.maxDisplacement,
      affectedBounds,
      safetyStatus: status,
    },
  };
  return {
    sourceTypographyKey,
    warpKey: identity.warpKey,
    geometryKey: identity.geometryKey,
    geometry,
    inkBounds: bounds,
    active: true,
    exact: true,
    diagnostics: {
      sourcePointCount: counters.sourcePointCount,
      warpedPointCount: counters.warpedPointCount,
      affectedPointCount: counters.affectedPointCount,
      clampedPointCount: counters.clampedPointCount,
      topologyGuardCount: counters.topologyGuardCount,
      emitterContributionCount: counters.emitterContributionCount,
      maxEmitterContributions: counters.maxEmitterContributions,
      emitterCount: emitters.length,
      maxDisplacement: counters.maxDisplacement,
      buildDurationMs: Math.max(0, now() - started),
      safetyStatus: status,
      topologyCheckLimited: counters.topologyCheckLimited,
      affectedBounds,
    },
  };
}
