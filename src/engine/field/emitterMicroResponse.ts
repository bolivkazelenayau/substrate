import type { CircleMark, Point } from "../geometry";
import { getRendererManifest } from "../renderers/rendererManifest";
import { sampleDistance, type RasterMask, type SubstrateData } from "../substrate";
import { buildEdgeMap } from "../substrate/edgeMap";
import { buildSignedDistanceField } from "../substrate/distanceField";
import type { ProjectState, RenderContext, RendererId } from "../../types";
import { getFalloffWeight } from "./compositeWaveField";
import {
  getGlyphEmitterAnchor,
  getGlyphEmitterMetadata,
  resolveEmitterGlyph,
  resolveGlyphEmitterSources,
} from "./glyphEmitters";

/** The authoring UI already caps emitter rows at eight. Keeping the same hard
 * limit avoids an O(candidates × unbounded sources) response path. */
export const EMITTER_MICRO_MAX_CONTRIBUTIONS = 8;
export const EMITTER_MICRO_NOISE_OCTAVES = 2;
export const EMITTER_MICRO_CORRECTION_STEPS = 4;

const UINT32_RANGE = 0x1_0000_0000;
const EPSILON = 1e-6;
const OCCUPANCY_MASK_THRESHOLD = 0.5;

interface SealedOccupancySubstrate {
  substrate: SubstrateData;
  sealedCounterPixelCount: number;
}

const sealedOccupancyCache = new WeakMap<SubstrateData, SealedOccupancySubstrate>();

/**
 * Builds the occupancy obstacle from the final authoritative glyph raster.
 * Exterior background is flood-filled from the raster boundary; every remaining
 * enclosed void is a counter/hole and is sealed into the forbidden silhouette.
 */
export function getSealedGlyphOccupancySubstrate(source: SubstrateData): SealedOccupancySubstrate {
  const cached = sealedOccupancyCache.get(source);
  if (cached) return cached;

  const { width, height } = source.mask;
  const count = width * height;
  const exterior = new Uint8Array(count);
  const queue = new Int32Array(count);
  let queueStart = 0;
  let queueEnd = 0;
  const enqueue = (x: number, y: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const index = y * width + x;
    if (exterior[index] || source.mask.data[index] >= OCCUPANCY_MASK_THRESHOLD) return;
    exterior[index] = 1;
    queue[queueEnd] = index;
    queueEnd += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x, 0);
    enqueue(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(0, y);
    enqueue(width - 1, y);
  }
  while (queueStart < queueEnd) {
    const index = queue[queueStart];
    queueStart += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
        if (offsetX === 0 && offsetY === 0) continue;
        enqueue(x + offsetX, y + offsetY);
      }
    }
  }

  const data = new Float32Array(source.mask.data);
  let sealedCounterPixelCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (!exterior[index] && data[index] < OCCUPANCY_MASK_THRESHOLD) {
      data[index] = 1;
      sealedCounterPixelCount += 1;
    }
  }
  const mask: RasterMask = { width, height, data };
  const edge = buildEdgeMap(mask, OCCUPANCY_MASK_THRESHOLD);
  const distance = buildSignedDistanceField(mask, edge, source.scaleX, source.scaleY);
  const result = {
    substrate: { ...source, mask, edge, distance },
    sealedCounterPixelCount,
  };
  sealedOccupancyCache.set(source, result);
  return result;
}

interface MicroSource {
  id: string;
  anchor: Point;
  weight: number;
  radiusMultiplier: number;
}

interface SourceContribution extends MicroSource {
  influence: number;
}

export interface EmitterMicroProbe {
  affected: boolean;
  influence: number;
  anchor: Point;
  contributions: number;
}

export interface EmitterMicroSample {
  mark: CircleMark;
  affected: boolean;
  keep: boolean;
  microAdjusted: boolean;
  densityRejected: boolean;
  insideGlyph: boolean;
  footprintInvalid: boolean;
  relocated: boolean;
  finalExterior: boolean;
  correctionRejected: boolean;
  displacement: number;
  relocationDistance: number;
  correctionSteps: number;
  sdfReads: number;
}

export interface EmitterMicroMetrics {
  candidateCount: number;
  affectedCount: number;
  microAdjustedCount: number;
  densityRejectedCount: number;
  interiorCount: number;
  footprintInvalidCount: number;
  relocatedCount: number;
  correctionRejectedCount: number;
  rejectedCount: number;
  finalExteriorCount: number;
  finalFootprintViolationCount: number;
  sealedCounterPixelCount: number;
  sdfReadCount: number;
  correctionStepCount: number;
  safetyClippedCount: number;
  averageDisplacement: number;
  maxDisplacement: number;
  sourceCount: number;
  maxEmitterContributions: number;
  buildTimeMs: number;
}

export interface EmitterMicroResponseSampler {
  active: boolean;
  microActive: boolean;
  occupancyActive: boolean;
  exterior: boolean;
  responseRadius: number;
  shellWidth: number;
  candidatePadding: number;
  sourceCount: number;
  rasterTolerance: number;
  probe(x: number, y: number): EmitterMicroProbe;
  acceptsExteriorCandidate(x: number, y: number, signedDistance: number, footprintRadius?: number): boolean;
  sampleCircle(mark: CircleMark, salt: number): EmitterMicroSample;
  recordSafetyClip(): void;
  metrics(): EmitterMicroMetrics;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smoothstep = (value: number) => {
  const amount = clamp01(value);
  return amount * amount * (3 - 2 * amount);
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

function valueNoise(x: number, y: number, seed: number, salt: number) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(x - x0);
  const ty = smoothstep(y - y0);
  const a = hashUnit(x0, y0, seed, salt);
  const b = hashUnit(x0 + 1, y0, seed, salt);
  const c = hashUnit(x0, y0 + 1, seed, salt);
  const d = hashUnit(x0 + 1, y0 + 1, seed, salt);
  const top = a + (b - a) * tx;
  const bottom = c + (d - c) * tx;
  return (top + (bottom - top) * ty) * 2 - 1;
}

function fractalNoise(x: number, y: number, scale: number, seed: number, salt: number) {
  let total = 0;
  let amplitude = 1;
  let normalization = 0;
  let frequency = 1 / Math.max(2, scale);
  for (let octave = 0; octave < EMITTER_MICRO_NOISE_OCTAVES; octave += 1) {
    total += valueNoise(x * frequency, y * frequency, seed, salt + octave * 0x9e37) * amplitude;
    normalization += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return normalization > 0 ? total / normalization : 0;
}

function resolveSources(state: ProjectState, context: RenderContext): MicroSource[] {
  if (state.emitterMode === "multiple") {
    return resolveGlyphEmitterSources(state, context.textGeometry ?? null).sources
      .filter((source) => source.weight > 0)
      .slice(0, EMITTER_MICRO_MAX_CONTRIBUTIONS)
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

export function emitterMicroResponseCapability(renderer: RendererId) {
  return getRendererManifest(renderer).emitterMicroResponse;
}

export function supportsEmitterMicroResponse(renderer: RendererId) {
  return emitterMicroResponseCapability(renderer) === "supported";
}

export function isEmitterMicroResponseConfigured(state: ProjectState) {
  const response = state.emitterMicroResponse;
  const microActive = response.enabled
    && (response.densityBreakup > 0 || (response.positionDetail > 0 && response.maxDisplacement > 0));
  return state.emitter.enabled
    && supportsEmitterMicroResponse(state.renderer)
    && (microActive || response.occupancy !== "legacy");
}

export function emitterMicroResponseUsesExterior(state: ProjectState) {
  return isEmitterMicroResponseConfigured(state)
    && state.emitterMicroResponse.occupancy !== "legacy";
}

/** Mode-aware state identity. Context-owned emitter anchors and SDF identity are
 * added by `emitterMicroResponseGeometryKey`. */
export function emitterMicroResponseStateKey(state: ProjectState) {
  if (!isEmitterMicroResponseConfigured(state)) return "emitter-micro:disabled";
  const response = state.emitterMicroResponse;
  const parts: Array<string | number> = [
    "emitter-micro",
    response.occupancy,
    response.responseRadius,
    response.falloff,
  ];
  if (response.enabled) {
    parts.push(
      "micro",
      response.positionDetail,
      response.densityBreakup,
      response.detailScale,
      response.maxDisplacement,
      state.seed,
    );
  }
  if (response.occupancy !== "legacy") {
    parts.push(
      "shell",
      response.exteriorShell,
      "sealed-counters",
    );
  }
  if (response.occupancy === "disperse-exterior") {
    parts.push(
      "flow",
      response.exteriorPush,
      response.tangentialFlow,
      response.divergence,
      state.seed,
    );
  }
  return parts.join("~");
}

export function emitterMicroResponseGeometryKey(state: ProjectState, context: RenderContext) {
  const stateKey = emitterMicroResponseStateKey(state);
  if (stateKey === "emitter-micro:disabled") return stateKey;
  const sources = resolveSources(state, context);
  const sourceKey = sources.map((source) => [
    source.id,
    source.anchor.x.toFixed(4),
    source.anchor.y.toFixed(4),
    source.weight,
    source.radiusMultiplier,
  ].join("@")).join("^");
  const sdfKey = context.substrateKey ?? context.textGeometryKey ?? "sdf:none";
  return `${stateKey}|sources:${sourceKey}|sdf:${sdfKey}`;
}

function emptyMetrics(sourceCount = 0): EmitterMicroMetrics {
  return {
    candidateCount: 0,
    affectedCount: 0,
    microAdjustedCount: 0,
    densityRejectedCount: 0,
    interiorCount: 0,
    footprintInvalidCount: 0,
    relocatedCount: 0,
    correctionRejectedCount: 0,
    rejectedCount: 0,
    finalExteriorCount: 0,
    finalFootprintViolationCount: 0,
    sealedCounterPixelCount: 0,
    sdfReadCount: 0,
    correctionStepCount: 0,
    safetyClippedCount: 0,
    averageDisplacement: 0,
    maxDisplacement: 0,
    sourceCount,
    maxEmitterContributions: 0,
    buildTimeMs: 0,
  };
}

function identityProbe(x: number, y: number): EmitterMicroProbe {
  return { affected: false, influence: 0, anchor: { x, y }, contributions: 0 };
}

function identitySample(mark: CircleMark): EmitterMicroSample {
  return {
    mark,
    affected: false,
    keep: true,
    microAdjusted: false,
    densityRejected: false,
    insideGlyph: false,
    footprintInvalid: false,
    relocated: false,
    finalExterior: false,
    correctionRejected: false,
    displacement: 0,
    relocationDistance: 0,
    correctionSteps: 0,
    sdfReads: 0,
  };
}

function createInactiveSampler(sourceCount = 0): EmitterMicroResponseSampler {
  const snapshot = emptyMetrics(sourceCount);
  return {
    active: false,
    microActive: false,
    occupancyActive: false,
    exterior: false,
    responseRadius: 0,
    shellWidth: 0,
    candidatePadding: 0,
    sourceCount,
    rasterTolerance: 0,
    probe: identityProbe,
    acceptsExteriorCandidate: () => false,
    sampleCircle: (mark) => identitySample(mark),
    recordSafetyClip: () => undefined,
    metrics: () => ({ ...snapshot }),
  };
}

export function createEmitterMicroResponseSampler(
  state: ProjectState,
  context: RenderContext,
): EmitterMicroResponseSampler {
  const substrate = context.substrateData;
  const sources = state.emitter.enabled ? resolveSources(state, context) : [];
  if (!isEmitterMicroResponseConfigured(state)
    || !substrate
    || substrate.substrateType === "empty"
    || sources.length === 0) {
    return createInactiveSampler(sources.length);
  }

  const started = performance.now();
  const response = state.emitterMicroResponse;
  const microActive = response.enabled
    && (response.densityBreakup > 0 || (response.positionDetail > 0 && response.maxDisplacement > 0));
  const occupancyActive = response.occupancy !== "legacy";
  const occupancyDomain = occupancyActive
    ? getSealedGlyphOccupancySubstrate(substrate)
    : { substrate, sealedCounterPixelCount: 0 };
  const rasterTolerance = Math.max(0.25, Math.hypot(substrate.scaleX, substrate.scaleY) * 0.55);
  const shellWidth = Math.max(1, response.exteriorShell);
  const candidatePadding = occupancyActive
    ? shellWidth + (microActive ? response.maxDisplacement : 0) + rasterTolerance
    : microActive ? response.maxDisplacement : 0;
  const counters = emptyMetrics(sources.length);
  counters.sealedCounterPixelCount = occupancyDomain.sealedCounterPixelCount;
  let displacementTotal = 0;

  const contributionsAt = (x: number, y: number): SourceContribution[] => sources
    .map((source) => {
      const radius = Math.max(1, response.responseRadius * source.radiusMultiplier);
      const normalized = Math.hypot(x - source.anchor.x, y - source.anchor.y) / radius;
      const falloff = normalized < 1 ? getFalloffWeight(normalized, response.falloff) : 0;
      return { ...source, influence: clamp01(falloff * Math.max(0, source.weight)) };
    })
    .filter((source) => source.influence > EPSILON)
    .slice(0, EMITTER_MICRO_MAX_CONTRIBUTIONS);

  const probe = (x: number, y: number): EmitterMicroProbe => {
    const contributions = contributionsAt(x, y);
    if (contributions.length === 0) return identityProbe(x, y);
    let inverseUnion = 1;
    let weightedX = 0;
    let weightedY = 0;
    let weightTotal = 0;
    for (const source of contributions) {
      inverseUnion *= 1 - source.influence;
      weightedX += source.anchor.x * source.influence;
      weightedY += source.anchor.y * source.influence;
      weightTotal += source.influence;
    }
    return {
      affected: weightTotal > EPSILON,
      influence: clamp01(1 - inverseUnion),
      anchor: weightTotal > EPSILON
        ? { x: weightedX / weightTotal, y: weightedY / weightTotal }
        : { x, y },
      contributions: contributions.length,
    };
  };

  const acceptsExteriorCandidate = (
    x: number,
    y: number,
    signedDistance: number,
    footprintRadius = 0,
  ) => occupancyActive
    && probe(x, y).affected
    && Math.abs(signedDistance) <= shellWidth + Math.max(0, footprintRadius) + rasterTolerance;

  const sampleCircle = (mark: CircleMark, _salt: number): EmitterMicroSample => {
    counters.candidateCount += 1;
    const initialX = mark.center.x;
    const initialY = mark.center.y;
    const sampleStartReads = counters.sdfReadCount;
    const readDistance = (x: number, y: number) => {
      counters.sdfReadCount += 1;
      return sampleDistance(occupancyDomain.substrate, x, y);
    };
    const recordFinalExterior = (signedDistance: number, clearance: number) => {
      counters.finalExteriorCount += 1;
      if (signedDistance > -clearance) counters.finalFootprintViolationCount += 1;
    };
    const contributions = contributionsAt(initialX, initialY);
    if (contributions.length === 0) {
      if (!occupancyActive) return identitySample(mark);

      // Occupancy is a final-output invariant, not merely a local emitter effect.
      // Marks outside emitter influence receive no motion, but still pass the same
      // authoritative SDF footprint gate as locally displaced/relocated marks.
      const clearance = Math.max(0, mark.radius) + rasterTolerance;
      const signedDistance = readDistance(initialX, initialY);
      const insideGlyph = signedDistance > 0;
      const footprintInvalid = signedDistance > -clearance;
      if (insideGlyph) counters.interiorCount += 1;
      if (footprintInvalid) counters.footprintInvalidCount += 1;
      if (footprintInvalid) {
        counters.correctionRejectedCount += 1;
        counters.rejectedCount += 1;
        return {
          ...identitySample(mark),
          keep: false,
          insideGlyph,
          footprintInvalid: true,
          correctionRejected: true,
          sdfReads: counters.sdfReadCount - sampleStartReads,
        };
      }

      recordFinalExterior(signedDistance, clearance);
      return {
        ...identitySample(mark),
        finalExterior: true,
        sdfReads: counters.sdfReadCount - sampleStartReads,
      };
    }

    let inverseUnion = 1;
    let weightTotal = 0;
    let anchorX = 0;
    let anchorY = 0;
    let normalNoise = 0;
    let tangentNoise = 0;
    let densityDecision = 0;
    for (const source of contributions) {
      inverseUnion *= 1 - source.influence;
      weightTotal += source.influence;
      anchorX += source.anchor.x * source.influence;
      anchorY += source.anchor.y * source.influence;
      const sourceSalt = stringHash(source.id);
      normalNoise += fractalNoise(initialX, initialY, response.detailScale, state.seed, sourceSalt + 17)
        * source.influence;
      tangentNoise += fractalNoise(initialX, initialY, response.detailScale, state.seed, sourceSalt + 71)
        * source.influence;
      const cellScale = Math.max(2, response.detailScale * 0.72);
      densityDecision += hashUnit(
        Math.floor(initialX / cellScale),
        Math.floor(initialY / cellScale),
        state.seed,
        sourceSalt + 193,
      ) * source.influence;
    }
    const influence = clamp01(1 - inverseUnion);
    const anchor = weightTotal > EPSILON
      ? { x: anchorX / weightTotal, y: anchorY / weightTotal }
      : { x: initialX, y: initialY };
    normalNoise = weightTotal > EPSILON ? normalNoise / weightTotal : 0;
    tangentNoise = weightTotal > EPSILON ? tangentNoise / weightTotal : 0;
    densityDecision = weightTotal > EPSILON ? densityDecision / weightTotal : 1;
    counters.affectedCount += 1;
    counters.maxEmitterContributions = Math.max(counters.maxEmitterContributions, contributions.length);

    const gradientAt = (x: number, y: number) => {
      const stepX = Math.max(EPSILON, substrate.scaleX);
      const stepY = Math.max(EPSILON, substrate.scaleY);
      const gx = (readDistance(x + stepX, y) - readDistance(x - stepX, y)) / (stepX * 2);
      const gy = (readDistance(x, y + stepY) - readDistance(x, y - stepY)) / (stepY * 2);
      return { x: gx, y: gy, magnitude: Math.hypot(gx, gy) };
    };
    const outwardAt = (x: number, y: number) => {
      const gradient = gradientAt(x, y);
      if (Number.isFinite(gradient.magnitude) && gradient.magnitude > EPSILON) {
        // This repository's SDF is positive inside, so the negative gradient is
        // the semantic outward normal. Occupancy modes sample the sealed glyph
        // silhouette, so enclosed counters point toward the outer boundary.
        return { x: -gradient.x / gradient.magnitude, y: -gradient.y / gradient.magnitude };
      }
      const radialX = x - anchor.x;
      const radialY = y - anchor.y;
      const radialLength = Math.hypot(radialX, radialY);
      if (radialLength > EPSILON) return { x: radialX / radialLength, y: radialY / radialLength };
      const angle = hashUnit(Math.floor(x), Math.floor(y), state.seed, 0x85ebca6b) * Math.PI * 2;
      return { x: Math.cos(angle), y: Math.sin(angle) };
    };

    let x = initialX;
    let y = initialY;
    let microAdjusted = false;
    if (microActive && response.positionDetail > 0 && response.maxDisplacement > 0) {
      const outward = outwardAt(x, y);
      const tangent = { x: -outward.y, y: outward.x };
      let vectorX = outward.x * normalNoise * 0.62 + tangent.x * tangentNoise;
      let vectorY = outward.y * normalNoise * 0.62 + tangent.y * tangentNoise;
      const vectorLength = Math.hypot(vectorX, vectorY);
      if (vectorLength > 1) {
        vectorX /= vectorLength;
        vectorY /= vectorLength;
      }
      const limit = response.maxDisplacement * (response.positionDetail / 100) * influence;
      const quantum = Math.max(0.2, Math.min(1.5, response.detailScale * 0.04));
      const dx = Math.round(vectorX * limit / quantum) * quantum;
      const dy = Math.round(vectorY * limit / quantum) * quantum;
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > EPSILON) {
        x += dx;
        y += dy;
        microAdjusted = true;
        counters.microAdjustedCount += 1;
      }
    }

    const breakupThreshold = microActive
      ? clamp01(response.densityBreakup / 100 * influence * 0.72)
      : 0;
    if (breakupThreshold > 0 && densityDecision < breakupThreshold) {
      counters.densityRejectedCount += 1;
      counters.rejectedCount += 1;
      return {
        ...identitySample(mark),
        affected: true,
        keep: false,
        microAdjusted,
        densityRejected: true,
        displacement: Math.hypot(x - initialX, y - initialY),
        sdfReads: counters.sdfReadCount - sampleStartReads,
      };
    }

    if (!occupancyActive) {
      const displacement = Math.hypot(x - initialX, y - initialY);
      displacementTotal += displacement;
      counters.maxDisplacement = Math.max(counters.maxDisplacement, displacement);
      return {
        ...identitySample(mark),
        mark: { ...mark, center: { x, y } },
        affected: true,
        microAdjusted,
        displacement,
        sdfReads: counters.sdfReadCount - sampleStartReads,
      };
    }

    const clearance = Math.max(0, mark.radius) + rasterTolerance;
    let signedDistance = readDistance(x, y);
    const insideGlyph = signedDistance > 0;
    const footprintInvalid = signedDistance > -clearance;
    if (insideGlyph) counters.interiorCount += 1;
    if (footprintInvalid) counters.footprintInvalidCount += 1;

    if (response.occupancy === "exclude-interior" && footprintInvalid) {
      counters.rejectedCount += 1;
      return {
        ...identitySample(mark),
        affected: true,
        keep: false,
        microAdjusted,
        insideGlyph,
        footprintInvalid: true,
        correctionRejected: true,
        displacement: Math.hypot(x - initialX, y - initialY),
        sdfReads: counters.sdfReadCount - sampleStartReads,
      };
    }

    let relocated = false;
    let correctionSteps = 0;
    let relocationDistance = 0;
    const relocationOrigin = { x, y };
    if (response.occupancy === "disperse-exterior" && footprintInvalid) {
      const push = shellWidth * 0.32 * response.exteriorPush / 100 * influence;
      const tangentAmount = shellWidth * 0.22 * response.tangentialFlow / 100 * influence;
      const divergenceAmount = shellWidth * 0.18 * response.divergence / 100 * influence;
      const tangentSign = hashUnit(
        Math.floor(initialX / Math.max(2, response.detailScale)),
        Math.floor(initialY / Math.max(2, response.detailScale)),
        state.seed,
        0x9e3779b9,
      ) < 0.5 ? -1 : 1;
      const maximumRelocation = Math.max(
        clearance + shellWidth,
        Math.min(response.responseRadius + shellWidth, Math.max(0, signedDistance) + clearance + shellWidth + push),
      );

      for (let iteration = 0; iteration < EMITTER_MICRO_CORRECTION_STEPS; iteration += 1) {
        if (signedDistance <= -clearance) break;
        const outward = outwardAt(x, y);
        const tangent = { x: -outward.y * tangentSign, y: outward.x * tangentSign };
        const radialX = x - anchor.x;
        const radialY = y - anchor.y;
        const radialLength = Math.hypot(radialX, radialY);
        const radial = radialLength > EPSILON
          ? { x: radialX / radialLength, y: radialY / radialLength }
          : outward;
        const deficit = Math.max(rasterTolerance, signedDistance + clearance + push / (iteration + 1));
        let stepX = outward.x * deficit
          + tangent.x * tangentAmount / (iteration + 1)
          + radial.x * divergenceAmount / (iteration + 1);
        let stepY = outward.y * deficit
          + tangent.y * tangentAmount / (iteration + 1)
          + radial.y * divergenceAmount / (iteration + 1);
        const stepLength = Math.hypot(stepX, stepY);
        const remaining = maximumRelocation - relocationDistance;
        if (!Number.isFinite(stepLength) || stepLength <= EPSILON || remaining <= EPSILON) break;
        if (stepLength > remaining) {
          stepX *= remaining / stepLength;
          stepY *= remaining / stepLength;
        }
        x += stepX;
        y += stepY;
        relocationDistance = Math.hypot(x - relocationOrigin.x, y - relocationOrigin.y);
        correctionSteps += 1;
        signedDistance = readDistance(x, y);
      }
      relocated = signedDistance <= -clearance;
      counters.correctionStepCount += correctionSteps;
      if (relocated) counters.relocatedCount += 1;
    }

    const finalExterior = signedDistance <= -clearance;
    const withinShell = -signedDistance <= shellWidth + clearance
      + shellWidth * 0.32 * response.exteriorPush / 100
      + (microActive ? response.maxDisplacement : 0);
    if (!finalExterior || !withinShell) {
      counters.correctionRejectedCount += 1;
      counters.rejectedCount += 1;
      return {
        ...identitySample(mark),
        affected: true,
        keep: false,
        microAdjusted,
        insideGlyph,
        footprintInvalid,
        relocated: false,
        finalExterior: false,
        correctionRejected: true,
        displacement: Math.hypot(x - initialX, y - initialY),
        relocationDistance,
        correctionSteps,
        sdfReads: counters.sdfReadCount - sampleStartReads,
      };
    }

    recordFinalExterior(signedDistance, clearance);
    const displacement = Math.hypot(x - initialX, y - initialY);
    displacementTotal += displacement;
    counters.maxDisplacement = Math.max(counters.maxDisplacement, displacement);
    return {
      mark: { ...mark, center: { x, y } },
      affected: true,
      keep: true,
      microAdjusted,
      densityRejected: false,
      insideGlyph,
      footprintInvalid,
      relocated,
      finalExterior,
      correctionRejected: false,
      displacement,
      relocationDistance,
      correctionSteps,
      sdfReads: counters.sdfReadCount - sampleStartReads,
    };
  };

  return {
    active: true,
    microActive,
    occupancyActive,
    exterior: occupancyActive,
    responseRadius: response.responseRadius,
    shellWidth,
    candidatePadding,
    sourceCount: sources.length,
    rasterTolerance,
    probe,
    acceptsExteriorCandidate,
    sampleCircle,
    recordSafetyClip() {
      counters.safetyClippedCount += 1;
    },
    metrics() {
      return {
        ...counters,
        averageDisplacement: counters.affectedCount > 0 ? displacementTotal / counters.affectedCount : 0,
        buildTimeMs: Math.max(0, performance.now() - started),
      };
    },
  };
}

export function circleInsideArtboard(
  mark: CircleMark,
  bounds: { x: number; y: number; width: number; height: number },
) {
  return mark.center.x - mark.radius >= bounds.x
    && mark.center.y - mark.radius >= bounds.y
    && mark.center.x + mark.radius <= bounds.x + bounds.width
    && mark.center.y + mark.radius <= bounds.y + bounds.height;
}

export function authoritativeFootprintClearance(
  substrate: SubstrateData,
  mark: Pick<CircleMark, "center" | "radius">,
  rasterTolerance = Math.max(0.25, Math.hypot(substrate.scaleX, substrate.scaleY) * 0.55),
) {
  const occupancySubstrate = getSealedGlyphOccupancySubstrate(substrate).substrate;
  const signedDistance = sampleDistance(occupancySubstrate, mark.center.x, mark.center.y);
  const required = Math.max(0, mark.radius) + rasterTolerance;
  return {
    signedDistance,
    required,
    clearance: -signedDistance - required,
    valid: signedDistance <= -required,
  };
}

export function emitterMicroResponseDiagnostics(
  state: ProjectState,
  sampler: EmitterMicroResponseSampler,
) {
  const metrics = sampler.metrics();
  return {
    emitterMicroResponseMode: sampler.active
      ? `${state.emitterMicroResponse.enabled ? "micro" : "no-micro"}/${state.emitterMicroResponse.occupancy}`
      : "disabled",
    emitterMicroCandidateCount: metrics.candidateCount,
    emitterMicroAffectedCount: metrics.affectedCount,
    emitterMicroAdjustedCount: metrics.microAdjustedCount,
    emitterMicroDensityRejections: metrics.densityRejectedCount,
    emitterMicroInteriorCount: metrics.interiorCount,
    emitterMicroFootprintInvalidCount: metrics.footprintInvalidCount,
    emitterMicroRelocatedCount: metrics.relocatedCount,
    emitterMicroCorrectionRejections: metrics.correctionRejectedCount,
    emitterMicroRejectedCount: metrics.rejectedCount,
    emitterMicroFinalExteriorCount: metrics.finalExteriorCount,
    emitterMicroFinalFootprintViolations: metrics.finalFootprintViolationCount,
    emitterMicroSealedCounterPixels: metrics.sealedCounterPixelCount,
    emitterMicroSdfReadCount: metrics.sdfReadCount,
    emitterMicroCorrectionStepCount: metrics.correctionStepCount,
    emitterMicroSafetyClippedCount: metrics.safetyClippedCount,
    emitterMicroAverageDisplacement: metrics.averageDisplacement,
    emitterMicroMaxDisplacement: metrics.maxDisplacement,
    emitterMicroSourceCount: metrics.sourceCount,
    emitterMicroMaxEmitterContributions: metrics.maxEmitterContributions,
    emitterMicroBuildTimeMs: metrics.buildTimeMs,
  };
}
