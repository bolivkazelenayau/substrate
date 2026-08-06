import type { CircleMark } from "../geometry";
import { getRendererManifest } from "../renderers/rendererManifest";
import { sampleDistance, sampleDistanceGradient } from "../substrate";
import type { ProjectState, RenderContext, RendererId } from "../../types";
import { getFalloffWeight } from "./compositeWaveField";

const EPSILON = 1e-6;
const TAU = Math.PI * 2;
const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

export interface GlyphFalloffProbe {
  affected: boolean;
  signedDistance: number;
  contourDistance: number;
  normalizedDistance: number;
  falloff: number;
  ringPhase: number;
  ringSignal: number;
  displacement: number;
  outward: { x: number; y: number };
  sdfReads: number;
}

export interface GlyphFalloffSample {
  mark: CircleMark;
  affected: boolean;
  displacement: number;
  probe: GlyphFalloffProbe;
}

export interface GlyphFalloffMetrics {
  candidateCount: number;
  affectedCount: number;
  sdfReadCount: number;
  safetyClippedCount: number;
  averageDisplacement: number;
  maxDisplacement: number;
  buildTimeMs: number;
}

export interface GlyphFalloffDisplacementSampler {
  active: boolean;
  fieldWidth: number;
  probe(x: number, y: number): GlyphFalloffProbe;
  sampleCircle(mark: CircleMark): GlyphFalloffSample;
  recordSafetyClip(): void;
  metrics(): GlyphFalloffMetrics;
}

function identityProbe(): GlyphFalloffProbe {
  return {
    affected: false,
    signedDistance: 0,
    contourDistance: 0,
    normalizedDistance: Number.POSITIVE_INFINITY,
    falloff: 0,
    ringPhase: 0,
    ringSignal: 0,
    displacement: 0,
    outward: { x: 0, y: 0 },
    sdfReads: 0,
  };
}

function createInactiveSampler(): GlyphFalloffDisplacementSampler {
  const snapshot: GlyphFalloffMetrics = {
    candidateCount: 0,
    affectedCount: 0,
    sdfReadCount: 0,
    safetyClippedCount: 0,
    averageDisplacement: 0,
    maxDisplacement: 0,
    buildTimeMs: 0,
  };
  return {
    active: false,
    fieldWidth: 0,
    probe: () => identityProbe(),
    sampleCircle: (mark) => ({ mark, affected: false, displacement: 0, probe: identityProbe() }),
    recordSafetyClip: () => undefined,
    metrics: () => ({ ...snapshot }),
  };
}

export function glyphFalloffDisplacementCapability(renderer: RendererId) {
  return getRendererManifest(renderer).glyphFalloffDisplacement;
}

export function supportsGlyphFalloffDisplacement(renderer: RendererId) {
  return glyphFalloffDisplacementCapability(renderer) === "supported";
}

export function isGlyphFalloffDisplacementConfigured(state: ProjectState) {
  const settings = state.glyphFalloffDisplacement;
  return supportsGlyphFalloffDisplacement(state.renderer)
    && settings.mode === "contour-rings"
    && settings.strength > 0
    && settings.fieldWidth > 0
    && settings.ringFrequency > 0;
}

/** Disabled state deliberately ignores authored inactive values. */
export function glyphFalloffDisplacementStateKey(state: ProjectState) {
  if (!isGlyphFalloffDisplacementConfigured(state)) return "glyph-falloff:disabled";
  const settings = state.glyphFalloffDisplacement;
  return [
    "glyph-falloff",
    settings.mode,
    settings.strength,
    settings.fieldWidth,
    settings.falloff,
    settings.ringFrequency,
    settings.ringSharpness,
  ].join("~");
}

export function glyphFalloffDisplacementGeometryKey(state: ProjectState, context: RenderContext) {
  const stateKey = glyphFalloffDisplacementStateKey(state);
  if (stateKey === "glyph-falloff:disabled") return stateKey;
  return `${stateKey}|sdf:${context.substrateKey ?? context.textGeometryKey ?? "none"}`;
}

export function createGlyphFalloffDisplacementSampler(
  state: ProjectState,
  context: RenderContext,
): GlyphFalloffDisplacementSampler {
  const substrate = context.substrateData;
  if (!isGlyphFalloffDisplacementConfigured(state)
    || !substrate
    || substrate.substrateType === "empty") {
    return createInactiveSampler();
  }

  const started = now();
  const settings = state.glyphFalloffDisplacement;
  const counters = {
    candidateCount: 0,
    affectedCount: 0,
    sdfReadCount: 0,
    safetyClippedCount: 0,
    maxDisplacement: 0,
  };
  let displacementTotal = 0;

  const probe = (x: number, y: number): GlyphFalloffProbe => {
    const signedDistance = sampleDistance(substrate, x, y);
    counters.sdfReadCount += 1;
    const contourDistance = Math.abs(signedDistance);
    const normalizedDistance = contourDistance / Math.max(EPSILON, settings.fieldWidth);
    const falloff = normalizedDistance < 1
      ? getFalloffWeight(normalizedDistance, settings.falloff)
      : 0;
    const ringPhase = normalizedDistance * settings.ringFrequency * TAU;
    const rawRing = Math.cos(ringPhase);
    const ringSignal = Math.sign(rawRing) * Math.pow(Math.abs(rawRing), settings.ringSharpness);
    const displacement = settings.strength * falloff * ringSignal;
    if (falloff <= EPSILON || Math.abs(displacement) <= EPSILON) {
      return {
        affected: false,
        signedDistance,
        contourDistance,
        normalizedDistance,
        falloff,
        ringPhase,
        ringSignal,
        displacement: 0,
        outward: { x: 0, y: 0 },
        sdfReads: 1,
      };
    }

    // Signed distance is positive in glyph ink, so the negative gradient points
    // toward the exterior on both sides of the authoritative contour.
    const gradient = sampleDistanceGradient(substrate, x, y);
    counters.sdfReadCount += 4;
    if (!Number.isFinite(gradient.magnitude) || gradient.magnitude <= EPSILON) {
      return {
        affected: false,
        signedDistance,
        contourDistance,
        normalizedDistance,
        falloff,
        ringPhase,
        ringSignal,
        displacement: 0,
        outward: { x: 0, y: 0 },
        sdfReads: 5,
      };
    }
    return {
      affected: true,
      signedDistance,
      contourDistance,
      normalizedDistance,
      falloff,
      ringPhase,
      ringSignal,
      displacement,
      outward: {
        x: -gradient.x / gradient.magnitude,
        y: -gradient.y / gradient.magnitude,
      },
      sdfReads: 5,
    };
  };

  return {
    active: true,
    fieldWidth: settings.fieldWidth,
    probe,
    sampleCircle(mark) {
      counters.candidateCount += 1;
      const sampled = probe(mark.center.x, mark.center.y);
      if (!sampled.affected) return { mark, affected: false, displacement: 0, probe: sampled };
      const displaced = {
        ...mark,
        center: {
          x: mark.center.x + sampled.outward.x * sampled.displacement,
          y: mark.center.y + sampled.outward.y * sampled.displacement,
        },
      };
      const displacement = Math.abs(sampled.displacement);
      counters.affectedCount += 1;
      counters.maxDisplacement = Math.max(counters.maxDisplacement, displacement);
      displacementTotal += displacement;
      return { mark: displaced, affected: true, displacement, probe: sampled };
    },
    recordSafetyClip() {
      counters.safetyClippedCount += 1;
    },
    metrics() {
      return {
        ...counters,
        averageDisplacement: counters.affectedCount > 0
          ? displacementTotal / counters.affectedCount
          : 0,
        buildTimeMs: Math.max(0, now() - started),
      };
    },
  };
}

export function glyphFalloffDisplacementDiagnostics(
  state: ProjectState,
  sampler: GlyphFalloffDisplacementSampler,
) {
  const metrics = sampler.metrics();
  return {
    glyphFalloffDisplacementMode: sampler.active ? state.glyphFalloffDisplacement.mode : "disabled",
    glyphFalloffCandidateCount: metrics.candidateCount,
    glyphFalloffAffectedCount: metrics.affectedCount,
    glyphFalloffSdfReadCount: metrics.sdfReadCount,
    glyphFalloffSafetyClippedCount: metrics.safetyClippedCount,
    glyphFalloffAverageDisplacement: metrics.averageDisplacement,
    glyphFalloffMaxDisplacement: metrics.maxDisplacement,
    glyphFalloffBuildTimeMs: metrics.buildTimeMs,
  };
}
