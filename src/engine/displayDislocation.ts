import type { ProjectState, RenderContext } from "../types";
import { getFalloffWeight } from "./field/compositeWaveField";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./field/glyphEmitters";

export const DISPLAY_DISLOCATION_MAX_DISPLACEMENT = 160;

interface DisplayDislocationSource {
  id: string;
  anchor: { x: number; y: number };
  weight: number;
  radiusMultiplier: number;
}

export interface DisplayDislocationSample {
  target: { x: number; y: number };
  source: { x: number; y: number };
  translation: { x: number; y: number };
  regionId: string | null;
  sourceId: string | null;
  influence: number;
  displacement: number;
  affected: boolean;
  gapRejected: boolean;
}

export interface DisplayDislocationSampler {
  active: boolean;
  maxDisplacement: number;
  sourceCount: number;
  sample(x: number, y: number): DisplayDislocationSample;
}

interface Region {
  id: string;
  row: number;
  column: number;
  center: { x: number; y: number };
  distanceFromAnchor: number;
  gapDistance: number;
}

const UINT32_RANGE = 4294967296;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function stringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(row: number, column: number, seed: number, salt: number) {
  let hash = Math.imul(row | 0, 0x1f123bb5)
    ^ Math.imul(column | 0, 0x5f356495)
    ^ Math.imul(seed | 0, 0x6c8e9cf5)
    ^ Math.imul(salt | 0, 0x27d4eb2d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  hash = Math.imul(hash, 0x297a2d39);
  hash ^= hash >>> 15;
  return (hash >>> 0) / UINT32_RANGE;
}

function fallbackAnchor(state: ProjectState, context: RenderContext) {
  if (state.emitter.sourceMode === "custom") {
    return { x: state.emitter.customX, y: state.emitter.customY };
  }
  const bounds = context.textGeometry?.bounds ?? context.textGeometry?.layoutBounds;
  if (bounds) return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (context.viewport) return { x: context.viewport.centerX, y: context.viewport.centerY };
  return { x: state.artboard.width / 2, y: state.artboard.height / 2 };
}

function resolveSources(state: ProjectState, context: RenderContext): DisplayDislocationSource[] {
  if (state.emitterMode === "multiple") {
    const multiple = resolveGlyphEmitterSources(state, context.textGeometry ?? null).sources
      .filter((source) => source.weight > 0)
      .map((source) => ({
        id: source.id,
        anchor: source.anchor,
        weight: source.weight,
        radiusMultiplier: source.radiusMultiplier,
      }));
    if (multiple.length > 0) return multiple;
  } else {
    const glyphs = getGlyphEmitterMetadata(state, context.textGeometry ?? null)
      .filter((glyph) => glyph.emitterEligible);
    const glyph = resolveEmitterGlyph(glyphs, state.emitter.glyphId);
    if (glyph) {
      return [{
        id: state.emitter.id,
        anchor: getGlyphEmitterAnchor(glyph, state.emitter.sourceMode, {
          x: state.emitter.customX,
          y: state.emitter.customY,
        }),
        weight: 1,
        radiusMultiplier: 1,
      }];
    }
  }
  return [{ id: "display-fallback", anchor: fallbackAnchor(state, context), weight: 1, radiusMultiplier: 1 }];
}

function positiveModulo(value: number, divisor: number) {
  return ((value % divisor) + divisor) % divisor;
}

function distanceToInterval(value: number, min: number, max: number) {
  return value < min ? min - value : value > max ? value - max : 0;
}

function resolveRegion(
  state: ProjectState,
  source: DisplayDislocationSource,
  x: number,
  y: number,
): Region {
  const settings = state.displayDislocation;
  const size = clamp(settings.regionSize, 4, 320);
  const row = Math.floor(y / size);
  const column = Math.floor(x / size);
  const localX = positiveModulo(x, size);
  const localY = positiveModulo(y, size);
  const edgeX = Math.min(localX, size - localX);
  const edgeY = Math.min(localY, size - localY);

  if (settings.mode === "horizontal-bands") {
    const minY = row * size;
    const maxY = minY + size;
    return {
      id: `${source.id}:h:${row}`,
      row,
      column: 0,
      center: { x: source.anchor.x, y: minY + size / 2 },
      distanceFromAnchor: distanceToInterval(source.anchor.y, minY, maxY),
      gapDistance: edgeY,
    };
  }
  if (settings.mode === "vertical-bands") {
    const minX = column * size;
    const maxX = minX + size;
    return {
      id: `${source.id}:v:${column}`,
      row: 0,
      column,
      center: { x: minX + size / 2, y: source.anchor.y },
      distanceFromAnchor: distanceToInterval(source.anchor.x, minX, maxX),
      gapDistance: edgeX,
    };
  }

  const minX = column * size;
  const minY = row * size;
  const nearestX = clamp(source.anchor.x, minX, minX + size);
  const nearestY = clamp(source.anchor.y, minY, minY + size);
  return {
    id: `${source.id}:b:${column}:${row}`,
    row,
    column,
    center: { x: minX + size / 2, y: minY + size / 2 },
    distanceFromAnchor: Math.hypot(nearestX - source.anchor.x, nearestY - source.anchor.y),
    gapDistance: Math.min(edgeX, edgeY),
  };
}

function nearestSource(
  sources: DisplayDislocationSource[],
  state: ProjectState,
  x: number,
  y: number,
) {
  let nearest = sources[0];
  let normalizedDistance = Math.hypot(x - nearest.anchor.x, y - nearest.anchor.y)
    / Math.max(1, state.displayDislocation.responseRadius * nearest.radiusMultiplier);
  for (let index = 1; index < sources.length; index += 1) {
    const source = sources[index];
    const candidate = Math.hypot(x - source.anchor.x, y - source.anchor.y)
      / Math.max(1, state.displayDislocation.responseRadius * source.radiusMultiplier);
    if (candidate < normalizedDistance) {
      nearest = source;
      normalizedDistance = candidate;
    }
  }
  return { source: nearest, normalizedDistance };
}

function identitySample(x: number, y: number, sourceId: string | null = null): DisplayDislocationSample {
  return {
    target: { x, y },
    source: { x, y },
    translation: { x: 0, y: 0 },
    regionId: null,
    sourceId,
    influence: 0,
    displacement: 0,
    affected: false,
    gapRejected: false,
  };
}

export function isDisplayDislocationActive(state: ProjectState) {
  return state.displayDislocation.enabled
    && state.displayDislocation.displacementAmount > 0
    && state.displayDislocation.responseRadius > 0
    && state.emitter.enabled
    && state.renderer === "sdf-halftone"
    && state.dotGrid.enabled;
}

export function displayDislocationGeometryKey(state: ProjectState) {
  if (!isDisplayDislocationActive(state)) return "display-dislocation:disabled";
  return `display-dislocation:${JSON.stringify(state.displayDislocation)}`;
}

/**
 * Builds a constant-time pull sampler. Target dots stay on the canonical world
 * lattice; only the source point used for glyph membership is translated.
 */
export function createDisplayDislocationSampler(
  state: ProjectState,
  context: RenderContext,
): DisplayDislocationSampler {
  const active = isDisplayDislocationActive(state);
  const sources = active ? resolveSources(state, context) : [];
  const configuredAmount = clamp(
    state.displayDislocation.displacementAmount,
    0,
    DISPLAY_DISLOCATION_MAX_DISPLACEMENT,
  );
  if (!active || sources.length === 0 || configuredAmount <= 0) {
    return {
      active: false,
      maxDisplacement: 0,
      sourceCount: 0,
      sample: (x, y) => identitySample(x, y),
    };
  }

  const settings = state.displayDislocation;
  const quantizationSteps = Math.max(1, Math.min(32, Math.round(settings.quantizationSteps)));
  const quantizationUnit = configuredAmount / quantizationSteps;
  const authoredRadians = settings.direction * Math.PI / 180;
  const authoredDirection = { x: Math.cos(authoredRadians), y: Math.sin(authoredRadians) };
  const radialBias = clamp01(settings.radialBias / 100);
  const alternatingOffset = clamp01(settings.alternatingOffset / 100);
  const gapHalfWidth = Math.min(settings.regionSize * 0.4, Math.max(0, settings.gap) / 2);
  const modeSalt = stringHash(settings.mode);

  return {
    active: true,
    maxDisplacement: configuredAmount,
    sourceCount: sources.length,
    sample(x, y) {
      const nearest = nearestSource(sources, state, x, y);
      const selected = nearest.source;
      // Locality is point-exact: a region may intersect the response circle,
      // but target candidates outside it always retain identity sampling.
      if (nearest.normalizedDistance > 1) return identitySample(x, y, selected.id);

      const region = resolveRegion(state, selected, x, y);
      const effectiveRadius = Math.max(1, settings.responseRadius * selected.radiusMultiplier);
      const regionFalloff = getFalloffWeight(region.distanceFromAnchor / effectiveRadius, settings.falloff);
      const influence = clamp01(regionFalloff * Math.max(0, selected.weight));
      if (influence <= 0) return identitySample(x, y, selected.id);

      const salt = modeSalt ^ stringHash(selected.id);
      const magnitudeNoise = 0.55 + hashUnit(region.row, region.column, settings.seed, salt) * 0.45;
      const rawMagnitude = configuredAmount * influence * magnitudeNoise;
      const magnitude = Math.min(
        configuredAmount,
        Math.round(rawMagnitude / Math.max(Number.EPSILON, quantizationUnit)) * quantizationUnit,
      );
      if (magnitude <= 0) return identitySample(x, y, selected.id);

      const paritySign = Math.abs(region.row + region.column) % 2 === 0 ? 1 : -1;
      const randomSign = hashUnit(region.row, region.column, settings.seed, salt ^ 0x9e3779b9) < 0.5 ? -1 : 1;
      const useAlternating = hashUnit(region.row, region.column, settings.seed, salt ^ 0x85ebca6b) < alternatingOffset;
      const sign = useAlternating ? paritySign : randomSign;

      const radialX = region.center.x - selected.anchor.x;
      const radialY = region.center.y - selected.anchor.y;
      const radialLength = Math.hypot(radialX, radialY);
      const normalizedRadial = radialLength > 1e-6
        ? { x: radialX / radialLength, y: radialY / radialLength }
        : authoredDirection;
      const blendedX = authoredDirection.x * (1 - radialBias) + normalizedRadial.x * radialBias;
      const blendedY = authoredDirection.y * (1 - radialBias) + normalizedRadial.y * radialBias;
      const blendedLength = Math.max(1e-6, Math.hypot(blendedX, blendedY));
      const translation = {
        x: sign * magnitude * blendedX / blendedLength,
        y: sign * magnitude * blendedY / blendedLength,
      };
      const gapRejected = gapHalfWidth > 0 && region.gapDistance < gapHalfWidth;
      return {
        target: { x, y },
        source: { x: x - translation.x, y: y - translation.y },
        translation,
        regionId: region.id,
        sourceId: selected.id,
        influence,
        displacement: magnitude,
        affected: true,
        gapRejected,
      };
    },
  };
}
