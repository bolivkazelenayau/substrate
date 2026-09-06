import type { ProjectState } from "../types";
import type { GlyphBounds, GlyphPathCommand, PositionedGlyph, TextGeometry, TextLineGeometry } from "./glyphGeometry";
import { unionBounds } from "./glyphGeometry";
import {
  flattenGlyphMicroWarpCommands,
  glyphMicroWarpSignedArea,
  type GlyphMicroWarpContour,
  type GlyphMicroWarpPoint,
} from "./glyphMicroWarp";
import {
  eligibleEmitterInfluenceSources,
  emitterInfluenceSourceIdentity,
  resolveEmitterInfluenceSources,
  sampleEmitterInfluence,
  type EmitterInfluenceSource,
} from "./field/emitterInfluence";

export const GLYPH_CALM_WATER_BUDGETS = {
  sourceContourPoints: 30_000,
  emitterContributions: 8,
  /** Maximum pair tests for one source or candidate contour. */
  topologyChecks: 140_000,
  maxDisplacement: 64,
} as const;

export const GLYPH_CALM_WATER_PARSED_FONT_WARNING =
  "Calm Water requires a loaded .ttf/.otf outline font; native fallback remains exactly undeformed.";

export type GlyphCalmWaterInactiveReason =
  | "disabled"
  | "zero-strength"
  | "emitter-disabled"
  | "no-emitter"
  | "native-fallback"
  | "empty-geometry";

export interface GlyphCalmWaterDiagnostics {
  sourcePointCount: number;
  deformedPointCount: number;
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
  changedGlyphs: Array<{
    glyphId: string;
    textIndex: number;
    lineIndex: number;
    changedPointCount: number;
  }>;
  inactiveReason?: GlyphCalmWaterInactiveReason;
}

export interface GlyphCalmWaterGeometry {
  sourceTypographyKey: string;
  waterKey: string;
  geometryKey: string;
  geometry: TextGeometry | null;
  inkBounds: GlyphBounds | null;
  active: boolean;
  exact: boolean;
  diagnostics: GlyphCalmWaterDiagnostics;
}

interface BuildCounters {
  sourcePointCount: number;
  deformedPointCount: number;
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

const EPSILON = 1e-7;
const TAU = Math.PI * 2;

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
  const b = hash32(`${value}|calm-water`);
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}`;
}

function hashUnit(value: string) {
  return hash32(value) / 0xffffffff;
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

function contoursBounds(contours: GlyphMicroWarpContour[]) {
  return unionBounds(contours.map((contour) => pointBounds(contour.points)));
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
  return cross(a, b, c) * cross(a, b, d) < -EPSILON
    && cross(c, d, a) * cross(c, d, b) < -EPSILON;
}

function hasSelfIntersection(points: GlyphMicroWarpPoint[], counters: BuildCounters) {
  let localChecks = 0;
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length;
    for (let second = first + 2; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length;
      if (first === secondNext || firstNext === second) continue;
      counters.topologyChecks += 1;
      localChecks += 1;
      if (localChecks > GLYPH_CALM_WATER_BUDGETS.topologyChecks) {
        counters.topologyCheckLimited = true;
        return { intersects: false, limited: true };
      }
      if (segmentIntersection(points[first], points[firstNext], points[second], points[secondNext])) {
        return { intersects: true, limited: false };
      }
    }
  }
  return { intersects: false, limited: false };
}

function safeContour(source: GlyphMicroWarpPoint[], candidate: GlyphMicroWarpPoint[], counters: BuildCounters) {
  const sourceArea = glyphMicroWarpSignedArea(source);
  const candidateArea = glyphMicroWarpSignedArea(candidate);
  if (!Number.isFinite(candidateArea) || Math.sign(sourceArea) !== Math.sign(candidateArea) || Math.abs(candidateArea) < Math.abs(sourceArea) * 0.25) return false;
  if (source.length > 512) return true;
  const sourceCheck = hasSelfIntersection(source, counters);
  if (sourceCheck.limited || sourceCheck.intersects) return true;
  const candidateCheck = hasSelfIntersection(candidate, counters);
  return candidateCheck.limited || !candidateCheck.intersects;
}

function blendTowardSource(source: GlyphMicroWarpPoint[], target: GlyphMicroWarpPoint[], amount: number) {
  return target.map((point, index) => ({
    x: source[index].x + (point.x - source[index].x) * amount,
    y: source[index].y + (point.y - source[index].y) * amount,
  }));
}

function smoothContourDisplacements(
  source: GlyphMicroWarpPoint[],
  target: GlyphMicroWarpPoint[],
  passes = 2,
) {
  let current = target;
  for (let pass = 0; pass < passes; pass += 1) {
    current = current.map((point, index) => {
      const previousIndex = (index - 1 + current.length) % current.length;
      const nextIndex = (index + 1) % current.length;
      const currentDx = point.x - source[index].x;
      const currentDy = point.y - source[index].y;
      const previousDx = current[previousIndex].x - source[previousIndex].x;
      const previousDy = current[previousIndex].y - source[previousIndex].y;
      const nextDx = current[nextIndex].x - source[nextIndex].x;
      const nextDy = current[nextIndex].y - source[nextIndex].y;
      return {
        x: source[index].x + currentDx * 0.5 + (previousDx + nextDx) * 0.25,
        y: source[index].y + currentDy * 0.5 + (previousDy + nextDy) * 0.25,
      };
    });
  }
  return current;
}

function resolvedWaveNumber(state: ProjectState) {
  const settings = state.glyphCalmWater;
  return settings.frequencyLinked
    ? Math.max(0.0001, state.emitter.frequency * settings.frequencyMultiplier)
    : TAU / Math.max(1, settings.wavelength);
}

function surfaceAtPoint(
  state: ProjectState,
  point: GlyphMicroWarpPoint,
  emitter: EmitterInfluenceSource,
  waveNumber: number,
) {
  const settings = state.glyphCalmWater;
  const seedKey = `${state.seed}|${emitter.id}`;
  const baseAngle = Math.PI * (0.18 + hashUnit(`${seedKey}|orientation`) * 0.22);
  const secondaryAngle = baseAngle + Math.PI * (0.36 + hashUnit(`${seedKey}|cross`) * 0.16);
  const detailAngle = baseAngle - Math.PI * (0.21 + hashUnit(`${seedKey}|detail`) * 0.13);
  const localX = point.x - emitter.anchor.x;
  const localY = point.y - emitter.anchor.y;
  const project = (angle: number) => localX * Math.cos(angle) + localY * Math.sin(angle);
  const primary = Math.sin(project(baseAngle) * waveNumber + emitter.phaseOffset);
  const variation = clamp(settings.surfaceVariation / 100, 0, 1);
  const secondary = Math.sin(
    project(secondaryAngle) * waveNumber * 0.731
    + emitter.phaseOffset * 0.83
    + 0.7
    + hashUnit(`${seedKey}|phase`) * 0.8,
  );
  const detailAmount = clamp(settings.detail / 100, 0, 1) * 0.16;
  const detail = Math.sin(
    project(detailAngle) * waveNumber * 1.83
    - emitter.phaseOffset * 0.61
    + 1.9,
  );
  const primaryWeight = 1 - variation * 0.28;
  const surface = primary * primaryWeight + secondary * variation * 0.28 + detail * detailAmount;
  const drift = Math.cos(project(secondaryAngle) * waveNumber * 0.67 + emitter.phaseOffset + 0.35);
  return { surface: clamp(surface, -1, 1), drift };
}

function deformContour(
  state: ProjectState,
  contour: GlyphMicroWarpContour,
  emitters: EmitterInfluenceSource[],
  targetGlyph: PositionedGlyph,
  isCounter: boolean,
  counters: BuildCounters,
) {
  const settings = state.glyphCalmWater;
  const strength = clamp(settings.strength, 0, GLYPH_CALM_WATER_BUDGETS.maxDisplacement);
  const driftAmount = clamp(settings.drift / 100, 0, 1) * 0.18;
  const counterScale = settings.preserveCounters && isCounter ? 0.65 : 1;
  const waveNumber = resolvedWaveNumber(state);
  let contourAffected = false;
  const candidate = contour.points.map((point, index) => {
    const previous = contour.points[(index - 1 + contour.points.length) % contour.points.length];
    const next = contour.points[(index + 1) % contour.points.length];
    const tangentLength = Math.max(EPSILON, Math.hypot(next.x - previous.x, next.y - previous.y));
    const tangent = { x: (next.x - previous.x) / tangentLength, y: (next.y - previous.y) / tangentLength };
    const normal = { x: -tangent.y, y: tangent.x };
    const influenceSample = sampleEmitterInfluence(point, emitters, state.glyphInfluence, targetGlyph);
    if (influenceSample.influence <= EPSILON || influenceSample.contributions.length === 0) return { ...point };
    let surface = 0;
    let drift = 0;
    let contributionWeight = 0;
    for (const contribution of influenceSample.contributions) {
      const field = surfaceAtPoint(state, point, contribution.source, waveNumber);
      surface += field.surface * contribution.influence;
      drift += field.drift * contribution.influence;
      contributionWeight += contribution.influence;
    }
    if (contributionWeight <= EPSILON) return { ...point };
    surface /= contributionWeight;
    drift /= contributionWeight;
    contourAffected = true;
    counters.affectedPointCount += 1;
    counters.emitterContributionCount += influenceSample.contributions.length;
    counters.maxEmitterContributions = Math.max(counters.maxEmitterContributions, influenceSample.contributions.length);
    const amplitude = strength * counterScale * influenceSample.influence;
    let dx = normal.x * surface * amplitude + tangent.x * drift * amplitude * driftAmount;
    let dy = normal.y * surface * amplitude + tangent.y * drift * amplitude * driftAmount;
    let magnitude = Math.hypot(dx, dy);
    let allowed = strength;
    if (settings.preserveCounters) {
      const localSpan = (distance(point, previous) + distance(point, next)) / 2;
      allowed = Math.min(allowed, Math.max(2, localSpan * (isCounter ? 0.65 : 0.85)));
    }
    if (magnitude > allowed && magnitude > EPSILON) {
      dx *= allowed / magnitude;
      dy *= allowed / magnitude;
      magnitude = allowed;
      counters.clampedPointCount += 1;
    }
    return { x: point.x + dx, y: point.y + dy };
  });

  const smoothedCandidate = contourAffected
    ? smoothContourDisplacements(contour.points, candidate)
    : candidate;
  if (contourAffected) {
    smoothedCandidate.forEach((point, index) => {
      const magnitude = distance(point, contour.points[index]);
      counters.maxDisplacement = Math.max(counters.maxDisplacement, magnitude);
      if (magnitude > EPSILON) counters.affectedPoints.push(contour.points[index], point);
    });
  }

  if (!contourAffected || !settings.preserveCounters || safeContour(contour.points, smoothedCandidate, counters)) {
    return { contour: { points: smoothedCandidate }, affected: contourAffected };
  }
  for (const amount of [0.65, 0.4, 0.2]) {
    const guarded = blendTowardSource(contour.points, smoothedCandidate, amount);
    if (safeContour(contour.points, guarded, counters)) {
      counters.topologyGuardCount += 1;
      return { contour: { points: guarded }, affected: true };
    }
  }
  counters.topologyGuardCount += 1;
  return { contour: { points: contour.points.map((point) => ({ ...point })) }, affected: false };
}

function changedPointCount(
  source: GlyphMicroWarpContour[],
  target: GlyphMicroWarpContour[],
) {
  let changed = 0;
  for (let contourIndex = 0; contourIndex < source.length; contourIndex += 1) {
    const sourcePoints = source[contourIndex]?.points ?? [];
    const targetPoints = target[contourIndex]?.points ?? [];
    const pointCount = Math.max(sourcePoints.length, targetPoints.length);
    for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
      const sourcePoint = sourcePoints[pointIndex];
      const targetPoint = targetPoints[pointIndex];
      if (!sourcePoint || !targetPoint || Math.abs(sourcePoint.x - targetPoint.x) > EPSILON || Math.abs(sourcePoint.y - targetPoint.y) > EPSILON) {
        changed += 1;
      }
    }
  }
  return changed;
}

function resolveLines(source: TextGeometry, glyphs: PositionedGlyph[]): TextLineGeometry[] | undefined {
  return source.lines?.map((line) => ({
    ...line,
    bounds: unionBounds(glyphs.filter((glyph) => glyph.lineIndex === line.lineIndex).map((glyph) => glyph.path.bounds)),
  }));
}

function safetyStatus(counters: BuildCounters): GlyphCalmWaterDiagnostics["safetyStatus"] {
  if (counters.pointBudgetLimited) return "point-budget-limited";
  if (counters.topologyGuardCount > 0) return "topology-guarded";
  if (counters.clampedPointCount > 0) return "displacement-clamped";
  return "complete";
}

export function glyphCalmWaterIdentity(
  state: ProjectState,
  sourceTypographyKey: string,
  source: TextGeometry | null,
) {
  const inactive = (reason: GlyphCalmWaterInactiveReason) => ({
    waterKey: `glyph-calm-water:${reason}`,
    geometryKey: sourceTypographyKey,
    active: false as const,
    reason,
  });
  const settings = state.glyphCalmWater;
  if (!settings.enabled) return inactive("disabled");
  if (settings.strength <= 0) return inactive("zero-strength");
  if (!state.emitter.enabled) return inactive("emitter-disabled");
  if (!source?.hasOutlines) return inactive("native-fallback");
  if (!source.bounds || source.glyphs.every((glyph) => glyph.path.commands.length === 0)) return inactive("empty-geometry");
  const emitters = resolveEmitterInfluenceSources(state, source);
  if (emitters.length === 0) return inactive("no-emitter");
  const semantic = JSON.stringify({
    sourceTypographyKey,
    strength: settings.strength,
    frequencyLinked: settings.frequencyLinked,
    emitterFrequency: settings.frequencyLinked ? state.emitter.frequency : undefined,
    frequencyMultiplier: settings.frequencyLinked ? settings.frequencyMultiplier : undefined,
    wavelength: settings.frequencyLinked ? undefined : settings.wavelength,
    surfaceVariation: settings.surfaceVariation,
    drift: settings.drift,
    detail: settings.detail,
    preserveCounters: settings.preserveCounters,
    influence: state.glyphInfluence,
    seed: state.seed,
    emitters: emitterInfluenceSourceIdentity(emitters),
  });
  const waterKey = `glyph-calm-water:${hashString(semantic)}`;
  return {
    waterKey,
    geometryKey: `typography-calm-water:${hashString(`${sourceTypographyKey}|${waterKey}`)}`,
    active: true as const,
    reason: null,
  };
}

function inactiveResult(
  sourceTypographyKey: string,
  waterKey: string,
  geometryKey: string,
  source: TextGeometry | null,
  reason: GlyphCalmWaterInactiveReason,
  started: number,
): GlyphCalmWaterGeometry {
  return {
    sourceTypographyKey,
    waterKey,
    geometryKey,
    geometry: source,
    inkBounds: source?.bounds ?? null,
    active: false,
    exact: Boolean(source?.hasOutlines),
    diagnostics: {
      sourcePointCount: 0,
      deformedPointCount: 0,
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
      changedGlyphs: [],
      inactiveReason: reason,
    },
  };
}

/** Build the liquid outline before Fragmentation so slices cut stable water-deformed contours. */
export function deriveGlyphCalmWaterGeometry(
  state: ProjectState,
  source: TextGeometry | null,
  sourceTypographyKey: string,
): GlyphCalmWaterGeometry {
  const started = now();
  const identity = glyphCalmWaterIdentity(state, sourceTypographyKey, source);
  if (!identity.active) return inactiveResult(sourceTypographyKey, identity.waterKey, identity.geometryKey, source, identity.reason, started);
  const emitters = resolveEmitterInfluenceSources(state, source!);
  const counters: BuildCounters = {
    sourcePointCount: 0,
    deformedPointCount: 0,
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
  const changedGlyphs: GlyphCalmWaterDiagnostics["changedGlyphs"] = [];
  const glyphs = source!.glyphs.map((glyph) => {
    const glyphEmitters = eligibleEmitterInfluenceSources(emitters, glyph);
    if (glyphEmitters.length === 0) return glyph;
    const remaining = GLYPH_CALM_WATER_BUDGETS.sourceContourPoints - counters.sourcePointCount;
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
    const deformedContours = flattened.contours.map((contour, index) => {
      const isCounter = Math.sign(areas[index]) !== outerSign;
      const deformed = deformContour(state, contour, glyphEmitters, glyph, isCounter, counters);
      glyphAffected ||= deformed.affected;
      return deformed.contour;
    });
    counters.deformedPointCount += deformedContours.reduce((sum, contour) => sum + contour.points.length, 0);
    const glyphChangedPointCount = changedPointCount(flattened.contours, deformedContours);
    if (!glyphAffected || glyphChangedPointCount === 0) return glyph;
    changedGlyphs.push({
      glyphId: glyph.glyphId,
      textIndex: glyph.textIndex,
      lineIndex: glyph.lineIndex ?? 0,
      changedPointCount: glyphChangedPointCount,
    });
    const bounds = contoursBounds(deformedContours);
    const serialized = serializeContours(deformedContours);
    const center = bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : glyph.center;
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
    calmWater: {
      sourceTypographyKey,
      waterKey: identity.waterKey,
      geometryKey: identity.geometryKey,
      sourcePointCount: counters.sourcePointCount,
      deformedPointCount: counters.deformedPointCount,
      affectedPointCount: counters.affectedPointCount,
      emitterCount: emitters.length,
      maxDisplacement: counters.maxDisplacement,
      affectedBounds,
      safetyStatus: status,
      changedGlyphs,
    },
  };
  return {
    sourceTypographyKey,
    waterKey: identity.waterKey,
    geometryKey: identity.geometryKey,
    geometry,
    inkBounds: bounds,
    active: true,
    exact: true,
    diagnostics: {
      sourcePointCount: counters.sourcePointCount,
      deformedPointCount: counters.deformedPointCount,
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
      changedGlyphs,
    },
  };
}
