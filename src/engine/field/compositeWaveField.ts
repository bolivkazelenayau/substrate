import type { GlyphEmitterFalloff, ProjectState, RenderContext } from "../../types";
import { getGlyphEmitterAnchor, getGlyphEmitterMetadata, resolveEmitterGlyph, type GlyphEmitterMetadata } from "./glyphEmitters";

export interface CompositeWaveField {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  data: Float32Array;
  min: number;
  max: number;
  anchor: { x: number; y: number };
  sourceGlyph: GlyphEmitterMetadata;
  buildTimeMs: number;
}

export interface GlyphFieldGradient { x: number; y: number; magnitude: number; finite: boolean }
export interface GlyphFieldDiagnostics {
  min: number;
  max: number;
  buildTimeMs: number;
  resolution: string;
  selectedGlyph: string;
  finiteGradientSamples: number;
  invalidGradientSamples: number;
}

export function getFalloffWeight(normalized: number, falloff: GlyphEmitterFalloff) {
  const t = Math.max(0, Math.min(1, normalized));
  if (falloff === "linear") return 1 - t;
  if (falloff === "gaussian") return Math.exp(-4.5 * t * t) * (t < 1 ? 1 : 0);
  const inverse = 1 - t;
  return inverse * inverse * (3 - 2 * inverse);
}

export function getEmitterContributionAtPoint(
  state: ProjectState,
  glyph: GlyphEmitterMetadata,
  anchor: { x: number; y: number },
  x: number,
  y: number,
) {
  const distance = Math.hypot(x - anchor.x, y - anchor.y);
  if (distance > state.emitter.radius) return 0;
  const weight = getFalloffWeight(distance / state.emitter.radius, state.emitter.falloff);
  const inSourceBounds = x >= glyph.bounds.x && x <= glyph.bounds.x + glyph.bounds.width
    && y >= glyph.bounds.y && y <= glyph.bounds.y + glyph.bounds.height;
  const influence = inSourceBounds ? state.emitter.selfInfluence : state.emitter.neighborInfluence;
  if (influence === 0) return 0;
  const rendererStrength = state.amplitude / 22;
  const rendererFrequency = state.frequency / 18;
  return Math.sin(distance * state.emitter.frequency * rendererFrequency + state.emitter.phase)
    * state.emitter.amplitude * rendererStrength * weight * influence;
}

export function buildCompositeWaveField(state: ProjectState, context: RenderContext): CompositeWaveField | null {
  const substrate = context.substrateData;
  if (!state.emitter.enabled || !substrate || substrate.substrateType === "empty") return null;
  const glyphs = getGlyphEmitterMetadata(state, context.textGeometry ?? null).filter((glyph) => glyph.emitterEligible);
  const sourceGlyph = resolveEmitterGlyph(glyphs, state.emitter.glyphId);
  if (!sourceGlyph) return null;
  const started = performance.now();
  const anchor = getGlyphEmitterAnchor(sourceGlyph, state.emitter.sourceMode, {
    x: state.emitter.customX,
    y: state.emitter.customY,
  });
  const data = new Float32Array(substrate.width * substrate.height);
  let min = Infinity;
  let max = -Infinity;
  for (let y = 0; y < substrate.height; y += 1) {
    const worldY = y / Math.max(1, substrate.height - 1) * substrate.viewportHeight;
    for (let x = 0; x < substrate.width; x += 1) {
      const index = y * substrate.width + x;
      if (substrate.mask.data[index] < 0.45) continue;
      const worldX = x / Math.max(1, substrate.width - 1) * substrate.viewportWidth;
      const value = getEmitterContributionAtPoint(state, sourceGlyph, anchor, worldX, worldY);
      data[index] = value;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return {
    width: substrate.width,
    height: substrate.height,
    viewportWidth: substrate.viewportWidth,
    viewportHeight: substrate.viewportHeight,
    data,
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
    anchor,
    sourceGlyph,
    buildTimeMs: Math.max(0, performance.now() - started),
  };
}

export function sampleGlyphField(field: CompositeWaveField, x: number, y: number) {
  const fx = Math.max(0, Math.min(field.width - 1, x / field.viewportWidth * (field.width - 1)));
  const fy = Math.max(0, Math.min(field.height - 1, y / field.viewportHeight * (field.height - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = field.data[y0 * field.width + x0] * (1 - tx) + field.data[y0 * field.width + x1] * tx;
  const bottom = field.data[y1 * field.width + x0] * (1 - tx) + field.data[y1 * field.width + x1] * tx;
  const value = top * (1 - ty) + bottom * ty;
  return Number.isFinite(value) ? value : 0;
}

export const sampleCompositeWaveField = sampleGlyphField;

export function sampleGlyphFieldGradient(field: CompositeWaveField, x: number, y: number): GlyphFieldGradient {
  const dx = field.viewportWidth / Math.max(1, field.width - 1);
  const dy = field.viewportHeight / Math.max(1, field.height - 1);
  const gx = (sampleGlyphField(field, x + dx, y) - sampleGlyphField(field, x - dx, y)) / (2 * dx);
  const gy = (sampleGlyphField(field, x, y + dy) - sampleGlyphField(field, x, y - dy)) / (2 * dy);
  const magnitude = Math.hypot(gx, gy);
  const finite = Number.isFinite(gx) && Number.isFinite(gy) && Number.isFinite(magnitude);
  return finite ? { x: gx, y: gy, magnitude, finite } : { x: 0, y: 0, magnitude: 0, finite: false };
}

export function createGlyphFieldContext(field: CompositeWaveField | null) {
  if (!field) return {
    glyphField: null,
    sampleGlyphField: (_x: number, _y: number) => 0,
    sampleGlyphFieldGradient: (_x: number, _y: number): GlyphFieldGradient => ({ x: 0, y: 0, magnitude: 0, finite: true }),
    glyphFieldDiagnostics: null,
  };
  let finiteGradientSamples = 0;
  let invalidGradientSamples = 0;
  const diagnostics: GlyphFieldDiagnostics = {
    min: field.min,
    max: field.max,
    buildTimeMs: field.buildTimeMs,
    resolution: `${field.width}×${field.height}`,
    selectedGlyph: `${field.sourceGlyph.textIndex + 1} · ${field.sourceGlyph.character}`,
    finiteGradientSamples,
    invalidGradientSamples,
  };
  return {
    glyphField: field,
    sampleGlyphField: (x: number, y: number) => sampleGlyphField(field, x, y),
    sampleGlyphFieldGradient: (x: number, y: number) => {
      const gradient = sampleGlyphFieldGradient(field, x, y);
      if (gradient.finite) finiteGradientSamples += 1;
      else invalidGradientSamples += 1;
      diagnostics.finiteGradientSamples = finiteGradientSamples;
      diagnostics.invalidGradientSamples = invalidGradientSamples;
      return gradient;
    },
    glyphFieldDiagnostics: diagnostics,
  };
}
