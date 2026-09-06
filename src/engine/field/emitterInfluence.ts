import type { EmitterInfluenceScope, GlyphInfluenceSettings, ProjectState } from "../../types";
import type { GlyphBounds, PositionedGlyph, TextGeometry } from "../glyphGeometry";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./glyphEmitters";

export const MAX_GLYPH_INFLUENCE_EMITTERS = 8;

export interface EmitterInfluencePoint {
  x: number;
  y: number;
}

export interface EmitterInfluenceSource {
  id: string;
  anchor: EmitterInfluencePoint;
  weight: number;
  radiusMultiplier: number;
  phaseOffset: number;
  scope: EmitterInfluenceScope;
  neighborhoodSize: number;
  sourceGlyphId: string | null;
  sourceTextIndex: number | null;
  sourceLineIndex: number | null;
  sourceGlyphIndexInLine: number | null;
  sourceGlobalGlyphIndex: number | null;
}

export type EmitterInfluenceTarget = Pick<
  PositionedGlyph,
  "glyphId" | "textIndex" | "lineIndex" | "glyphIndexInLine" | "globalGlyphIndex"
>;

export interface EmitterInfluenceContribution {
  source: EmitterInfluenceSource;
  influence: number;
}

export interface EmitterInfluenceSample {
  /** Seam-free normalized union of every relevant emitter contribution. */
  influence: number;
  /** Contribution-weighted center used by coherent directional effects. */
  anchor: EmitterInfluencePoint | null;
  contributions: EmitterInfluenceContribution[];
}

const EPSILON = 1e-7;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function centerOf(source: TextGeometry) {
  const bounds = source.bounds ?? source.layoutBounds;
  return bounds
    ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    : { x: 0, y: 0 };
}

function resolvedSourceScope(
  requested: EmitterInfluenceScope,
  glyph: { glyphId: string } | null,
  customPosition: boolean,
) {
  return glyph && !customPosition ? requested : "all-typography" as const;
}

function semanticSource(
  glyph: ReturnType<typeof resolveEmitterGlyph>,
  customPosition: boolean,
) {
  if (!glyph || customPosition) {
    return {
      sourceGlyphId: null,
      sourceTextIndex: null,
      sourceLineIndex: null,
      sourceGlyphIndexInLine: null,
      sourceGlobalGlyphIndex: null,
    };
  }
  return {
    sourceGlyphId: glyph.glyphId,
    sourceTextIndex: glyph.textIndex,
    sourceLineIndex: glyph.lineIndex,
    sourceGlyphIndexInLine: glyph.glyphIndexInLine,
    sourceGlobalGlyphIndex: glyph.globalGlyphIndex,
  };
}

/**
 * Pure core-plus-exterior-decay envelope. The response remains at full strength
 * through `radius`, then reaches exact zero only after `edgeSoftness` more world
 * units. No geometry is clipped at either boundary.
 */
export function emitterInfluenceAtDistance(
  distance: number,
  settings: GlyphInfluenceSettings,
  radiusMultiplier = 1,
) {
  const multiplier = Math.max(0.05, radiusMultiplier);
  const coreRadius = Math.max(0, settings.radius) * multiplier;
  const edgeSoftness = Math.max(0, settings.edgeSoftness) * multiplier;
  const resolvedDistance = Math.max(0, distance);
  if (resolvedDistance <= coreRadius) return 1;
  if (edgeSoftness <= EPSILON || resolvedDistance >= coreRadius + edgeSoftness) return 0;
  const transition = clamp01((resolvedDistance - coreRadius) / edgeSoftness);
  if (settings.falloff === "linear") return 1 - transition;
  if (settings.falloff === "gaussian") {
    const edge = Math.exp(-4.5);
    return clamp01((Math.exp(-4.5 * transition * transition) - edge) / (1 - edge));
  }
  const smooth = transition * transition * (3 - 2 * transition);
  return 1 - smooth;
}

/** Resolve the bounded emitter set once per glyph-domain build. */
export function resolveEmitterInfluenceSources(
  state: ProjectState,
  source: TextGeometry,
): EmitterInfluenceSource[] {
  if (!state.emitter.enabled) return [];
  if (state.emitterMode === "multiple") {
    const customPosition = state.emitter.sourceMode === "custom";
    return resolveGlyphEmitterSources(state, source).sources
      .filter((emitter) => emitter.weight > 0)
      .slice(0, MAX_GLYPH_INFLUENCE_EMITTERS)
      .map((emitter) => ({
        id: emitter.id,
        anchor: emitter.anchor,
        weight: emitter.weight,
        radiusMultiplier: emitter.radiusMultiplier,
        phaseOffset: state.emitter.phase + emitter.phaseOffset,
        scope: resolvedSourceScope(emitter.influenceScope, emitter.glyph, customPosition),
        neighborhoodSize: Math.max(0, Math.floor(emitter.neighborhoodSize)),
        ...semanticSource(emitter.glyph, customPosition),
      }));
  }
  const metadata = getGlyphEmitterMetadata(state, source).filter((glyph) => glyph.emitterEligible);
  const glyph = resolveEmitterGlyph(metadata, state.emitter.glyphId);
  const anchor = glyph
    ? getGlyphEmitterAnchor(glyph, state.emitter.sourceMode, {
        x: state.emitter.customX,
        y: state.emitter.customY,
      })
    : centerOf(source);
  const customPosition = state.emitter.sourceMode === "custom";
  return [{
    id: state.emitter.id,
    anchor,
    weight: 1,
    radiusMultiplier: 1,
    phaseOffset: state.emitter.phase,
    scope: resolvedSourceScope(state.emitter.influenceScope, glyph, customPosition),
    neighborhoodSize: Math.max(0, Math.floor(state.emitter.neighborhoodSize)),
    ...semanticSource(glyph, customPosition),
  }];
}

/** Authoritative semantic eligibility; world-space position never participates. */
export function isEmitterInfluenceTargetEligible(
  source: EmitterInfluenceSource,
  target: EmitterInfluenceTarget,
) {
  if (source.scope === "all-typography") return true;
  if (!source.sourceGlyphId) return false;
  if (source.scope === "source-glyph") return target.glyphId === source.sourceGlyphId;
  const targetLineIndex = target.lineIndex ?? null;
  if (targetLineIndex === null || source.sourceLineIndex === null || targetLineIndex !== source.sourceLineIndex) {
    return false;
  }
  if (source.scope === "source-line") return true;
  if (target.glyphId === source.sourceGlyphId) return true;
  const targetIndexInLine = target.glyphIndexInLine ?? null;
  if (targetIndexInLine === null || source.sourceGlyphIndexInLine === null) return false;
  return Math.abs(targetIndexInLine - source.sourceGlyphIndexInLine) <= source.neighborhoodSize;
}

export function eligibleEmitterInfluenceSources(
  sources: EmitterInfluenceSource[],
  target: EmitterInfluenceTarget,
) {
  return sources.filter((source) => isEmitterInfluenceTargetEligible(source, target));
}

export function emitterInfluenceIntersectsBounds(
  source: EmitterInfluenceSource,
  bounds: GlyphBounds,
  settings: GlyphInfluenceSettings,
  target: EmitterInfluenceTarget,
) {
  if (source.weight <= EPSILON || !isEmitterInfluenceTargetEligible(source, target)) return false;
  const nearestX = Math.max(bounds.x, Math.min(source.anchor.x, bounds.x + bounds.width));
  const nearestY = Math.max(bounds.y, Math.min(source.anchor.y, bounds.y + bounds.height));
  const nearestDistance = Math.hypot(source.anchor.x - nearestX, source.anchor.y - nearestY);
  return emitterInfluenceAtDistance(nearestDistance, settings, source.radiusMultiplier) * source.weight > EPSILON;
}

/**
 * Smooth-union blending avoids nearest-emitter ownership and its Voronoi seams.
 * The weighted center is auxiliary; the normalized envelope remains the sole
 * amplitude authority.
 */
export function sampleEmitterInfluence(
  point: EmitterInfluencePoint,
  sources: EmitterInfluenceSource[],
  settings: GlyphInfluenceSettings,
  target?: EmitterInfluenceTarget,
): EmitterInfluenceSample {
  const contributions: EmitterInfluenceContribution[] = [];
  let unionInfluence = 0;
  let weightedX = 0;
  let weightedY = 0;
  let weightSum = 0;
  const sourceCount = Math.min(sources.length, MAX_GLYPH_INFLUENCE_EMITTERS);
  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex += 1) {
    const source = sources[sourceIndex];
    if (target && !isEmitterInfluenceTargetEligible(source, target)) continue;
    const distance = Math.hypot(point.x - source.anchor.x, point.y - source.anchor.y);
    const influence = clamp01(
      emitterInfluenceAtDistance(distance, settings, source.radiusMultiplier)
      * Math.max(0, source.weight),
    );
    if (influence <= EPSILON) continue;
    contributions.push({ source, influence });
    unionInfluence = 1 - (1 - unionInfluence) * (1 - influence);
    weightedX += source.anchor.x * influence;
    weightedY += source.anchor.y * influence;
    weightSum += influence;
  }
  return {
    influence: clamp01(unionInfluence),
    anchor: weightSum > EPSILON
      ? { x: weightedX / weightSum, y: weightedY / weightSum }
      : null,
    contributions,
  };
}

export function emitterInfluenceSourceIdentity(sources: EmitterInfluenceSource[]) {
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  return sources.map((source) => ({
    id: source.id,
    x: round(source.anchor.x),
    y: round(source.anchor.y),
    weight: round(source.weight),
    radiusMultiplier: round(source.radiusMultiplier),
    phaseOffset: round(source.phaseOffset),
    scope: source.scope,
    neighborhoodSize: source.neighborhoodSize,
    sourceGlyphId: source.sourceGlyphId,
    sourceTextIndex: source.sourceTextIndex,
    sourceLineIndex: source.sourceLineIndex,
    sourceGlyphIndexInLine: source.sourceGlyphIndexInLine,
    sourceGlobalGlyphIndex: source.sourceGlobalGlyphIndex,
  }));
}
