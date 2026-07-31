import type { Point } from "../geometry";
import { resolveSdfScaleContext } from "../sdfScale";
import { sampleDistance, sampleDistanceGradient, sampleMask } from "../substrate";
import type { ProjectState, RenderContext, RendererId } from "../../types";
import { getFalloffWeight } from "./compositeWaveField";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./glyphEmitters";

const DISPLAY_RENDERERS = new Set<RendererId>(["sdf-halftone", "glyph-diffuser"]);
const UINT32_RANGE = 0x1_0000_0000;

interface DisplaySource {
  id: string;
  anchor: Point;
  weight: number;
  radiusMultiplier: number;
}

export interface EmitterDisplayProbe {
  affected: boolean;
  insideGlyph: boolean;
  signedDistance: number;
  influence: number;
  radialFalloff: number;
  edgeProximity: number;
  sourceId: string | null;
}

export interface EmitterDisplaySample extends EmitterDisplayProbe {
  point: Point;
  keep: boolean;
  displacement: number;
  quantized: boolean;
  radiusScale: number;
  opacityScale: number;
  interiorRejected: boolean;
  breakupRejected: boolean;
}

export interface EmitterDisplaySampler {
  active: boolean;
  exterior: boolean;
  shellRadius: number;
  probe(x: number, y: number): EmitterDisplayProbe;
  sample(x: number, y: number, salt: number): EmitterDisplaySample;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function stringHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(x: number, y: number, seed: number, salt: number) {
  let hash = Math.imul(x | 0, 0x1f123bb5)
    ^ Math.imul(y | 0, 0x5f356495)
    ^ Math.imul(seed | 0, 0x6c8e9cf5)
    ^ Math.imul(salt | 0, 0x27d4eb2d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x2c1b3c6d);
  hash ^= hash >>> 12;
  hash = Math.imul(hash, 0x297a2d39);
  hash ^= hash >>> 15;
  return (hash >>> 0) / UINT32_RANGE;
}

function resolveDisplaySources(state: ProjectState, context: RenderContext): DisplaySource[] {
  if (state.emitterMode === "multiple") {
    return resolveGlyphEmitterSources(state, context.textGeometry ?? null).sources
      .filter((source) => source.weight > 0)
      .map((source) => ({
        id: source.id,
        anchor: source.anchor,
        weight: source.weight,
        radiusMultiplier: source.radiusMultiplier,
      }));
  }
  const glyphs = getGlyphEmitterMetadata(state, context.textGeometry ?? null)
    .filter((glyph) => glyph.emitterEligible);
  const glyph = resolveEmitterGlyph(glyphs, state.emitter.glyphId);
  if (!glyph) return [];
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

export function supportsEmitterDisplay(renderer: RendererId) {
  return DISPLAY_RENDERERS.has(renderer);
}

export function emitterDisplayUsesExterior(state: ProjectState) {
  return state.emitter.enabled
    && (state.emitterDisplay.mode === "exclude" || state.emitterDisplay.mode === "orbit");
}

export function emitterDisplayGeometryKey(state: ProjectState) {
  const display = state.emitterDisplay;
  return [
    display.mode,
    display.distortionStrength,
    display.distortionRadius,
    display.noiseScale,
    display.gridSize,
    display.gridAmount,
    display.interiorSuppression,
    display.edgeBias,
    display.orbitAmount,
    display.divergence,
  ].join("~");
}

export function createEmitterDisplaySampler(
  state: ProjectState,
  context: RenderContext,
): EmitterDisplaySampler {
  const substrate = context.substrateData;
  const display = state.emitterDisplay;
  const sources = state.emitter.enabled ? resolveDisplaySources(state, context) : [];
  const active = display.mode !== "field"
    && Boolean(substrate && substrate.substrateType !== "empty" && sources.length > 0);
  const exterior = active && (display.mode === "exclude" || display.mode === "orbit");
  const scale = resolveSdfScaleContext(state);
  const shellRadius = scale.world(display.distortionRadius, 1);
  const noiseScale = scale.world(display.noiseScale, 0.5);
  const gridSize = display.gridSize > 0 ? scale.world(display.gridSize, 0.5) : 0;
  const originX = context.viewport?.x ?? substrate?.domainBounds?.x ?? 0;
  const originY = context.viewport?.y ?? substrate?.domainBounds?.y ?? 0;

  const inactiveProbe = (): EmitterDisplayProbe => ({
    affected: false,
    insideGlyph: false,
    signedDistance: 0,
    influence: 0,
    radialFalloff: 0,
    edgeProximity: 0,
    sourceId: null,
  });

  const probe = (x: number, y: number): EmitterDisplayProbe => {
    if (!active || !substrate) return inactiveProbe();
    let nearest = sources[0];
    let normalizedDistance = Math.hypot(x - nearest.anchor.x, y - nearest.anchor.y)
      / Math.max(1, state.emitter.radius * nearest.radiusMultiplier);
    for (let index = 1; index < sources.length; index += 1) {
      const source = sources[index];
      const candidate = Math.hypot(x - source.anchor.x, y - source.anchor.y)
        / Math.max(1, state.emitter.radius * source.radiusMultiplier);
      if (candidate < normalizedDistance) {
        nearest = source;
        normalizedDistance = candidate;
      }
    }
    const withinEmitter = normalizedDistance <= 1;
    const radialFalloff = withinEmitter
      ? getFalloffWeight(normalizedDistance, state.emitter.falloff)
      : 0;
    const signedDistance = sampleDistance(substrate, x, y);
    const edgeProximity = smoothstep(1 - Math.abs(signedDistance) / shellRadius);
    const edgeBias = display.edgeBias / 100;
    const edgeWeight = (1 - edgeBias) + edgeBias * edgeProximity;
    const sourceWeight = Math.min(1.25, Math.max(0, nearest.weight));
    const influence = clamp01(radialFalloff * edgeWeight * sourceWeight);
    return {
      affected: withinEmitter && radialFalloff > 1e-6,
      insideGlyph: sampleMask(substrate, x, y) >= 0.5,
      signedDistance,
      influence,
      radialFalloff,
      edgeProximity,
      sourceId: nearest.id,
    };
  };

  const sample = (x: number, y: number, salt: number): EmitterDisplaySample => {
    const initial = probe(x, y);
    if (!active || !substrate || !initial.affected || !initial.sourceId) {
      return {
        ...initial,
        point: { x, y },
        keep: true,
        displacement: 0,
        quantized: false,
        radiusScale: 1,
        opacityScale: 1,
        interiorRejected: false,
        breakupRejected: false,
      };
    }

    const source = sources.find((candidate) => candidate.id === initial.sourceId) ?? sources[0];
    const cellX = Math.floor((x - originX) / noiseScale);
    const cellY = Math.floor((y - originY) / noiseScale);
    const sourceSalt = stringHash(source.id);
    const normalNoise = hashUnit(cellX, cellY, state.seed, sourceSalt + 17) * 2 - 1;
    const tangentNoise = hashUnit(cellX, cellY, state.seed, sourceSalt + 53) * 2 - 1;
    const decision = hashUnit(cellX, cellY, state.seed, sourceSalt + salt * 11 + 97);
    const detail = hashUnit(cellX, cellY, state.seed, sourceSalt + salt * 17 + 193);
    const gradient = sampleDistanceGradient(substrate, x, y);
    let outwardX = 0;
    let outwardY = 0;
    if (Number.isFinite(gradient.magnitude) && gradient.magnitude > 1e-6) {
      // The signed field is positive inside glyphs, so its gradient points
      // inward. Negating it yields the shared outward contour normal.
      outwardX = -gradient.x / gradient.magnitude;
      outwardY = -gradient.y / gradient.magnitude;
    } else {
      const radialX = x - source.anchor.x;
      const radialY = y - source.anchor.y;
      const radialMagnitude = Math.hypot(radialX, radialY);
      if (radialMagnitude > 1e-6) {
        outwardX = radialX / radialMagnitude;
        outwardY = radialY / radialMagnitude;
      } else {
        const angle = detail * Math.PI * 2;
        outwardX = Math.cos(angle);
        outwardY = Math.sin(angle);
      }
    }
    const tangentX = -outwardY;
    const tangentY = outwardX;
    const strength = display.distortionStrength / 100;
    const effect = strength * initial.influence;
    const microLimit = Math.min(shellRadius * 0.18, scale.world(64, 1));
    const micro = microLimit * effect;
    let nextX = x
      + outwardX * normalNoise * micro * 0.62
      + tangentX * tangentNoise * micro;
    let nextY = y
      + outwardY * normalNoise * micro * 0.62
      + tangentY * tangentNoise * micro;

    if (display.mode === "orbit") {
      const orbitDirection = hashUnit(
        Math.round(source.anchor.x),
        Math.round(source.anchor.y),
        state.seed,
        sourceSalt + 257,
      ) >= 0.5 ? 1 : -1;
      const contourWeight = 0.32 + initial.edgeProximity * 0.68;
      const orbit = shellRadius * 0.42 * (display.orbitAmount / 100)
        * initial.radialFalloff * contourWeight * orbitDirection;
      const divergence = shellRadius * 0.32 * (display.divergence / 100)
        * initial.radialFalloff * contourWeight;
      nextX += tangentX * orbit + outwardX * divergence;
      nextY += tangentY * orbit + outwardY * divergence;
    }

    let quantized = false;
    if (gridSize > 0 && display.gridAmount > 0 && effect > 0) {
      const snappedX = originX + Math.round((nextX - originX) / gridSize) * gridSize;
      const snappedY = originY + Math.round((nextY - originY) / gridSize) * gridSize;
      const gridMix = Math.min(0.86, display.gridAmount / 100 * effect);
      nextX += (snappedX - nextX) * gridMix;
      nextY += (snappedY - nextY) * gridMix;
      quantized = gridMix > 0.02 && Math.hypot(snappedX - nextX, snappedY - nextY) > 0.01;
    }

    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) {
      nextX = x;
      nextY = y;
    }
    const finalInside = sampleMask(substrate, nextX, nextY) >= 0.5;
    const interiorRejected = exterior
      && finalInside
      && decision < display.interiorSuppression / 100;
    const breakup = Math.min(0.28, effect * (0.16 + display.edgeBias / 100 * 0.12));
    const breakupRejected = detail < breakup;
    const displacement = Math.hypot(nextX - x, nextY - y);
    return {
      ...initial,
      insideGlyph: finalInside,
      signedDistance: sampleDistance(substrate, nextX, nextY),
      point: { x: nextX, y: nextY },
      keep: !interiorRejected && !breakupRejected,
      displacement,
      quantized,
      radiusScale: Math.max(0.58, Math.min(1.36, 1 + (detail - 0.5) * effect * 0.9)),
      opacityScale: Math.max(0.62, Math.min(1.2, 1 + (decision - 0.5) * effect * 0.5)),
      interiorRejected,
      breakupRejected,
    };
  };

  return { active, exterior, shellRadius, probe, sample };
}
