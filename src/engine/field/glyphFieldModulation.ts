import type { ProjectState, RenderContext } from "../../types";
import { buildCompositeWaveField, sampleGlyphField, sampleGlyphFieldGradient, type CompositeWaveField, type GlyphFieldGradient } from "./compositeWaveField";

const ZERO_GRADIENT: GlyphFieldGradient = { x: 0, y: 0, magnitude: 0, finite: true };

export interface GlyphFieldSampler {
  field: CompositeWaveField | null;
  enabled: boolean;
  strength: number;
  value(x: number, y: number): number;
  gradient(x: number, y: number): GlyphFieldGradient;
  // Per-effect flags. Renderers can gate math on these to avoid even calling the
  // samplers (and the downstream arithmetic) when an effect is effectively zero.
  // Each flag is `false` when the modulator is disabled OR the related scalar is 0.
  displacementEnabled: boolean;
  densityEnabled: boolean;
  radiusEnabled: boolean;
  opacityEnabled: boolean;
}

export function getGlyphFieldSampler(state: ProjectState, context: RenderContext): GlyphFieldSampler {
  const field = context.glyphField ?? buildCompositeWaveField(state, context);
  const modeScale = state.glyphFieldMode === "strong" ? 1 : state.glyphFieldMode === "subtle" ? 0.42 : 0;
  const enabled = Boolean(field && state.emitter.enabled && modeScale > 0 && state.glyphFieldInfluence > 0);
  const peak = field ? Math.max(0.001, Math.abs(field.min), Math.abs(field.max)) : 1;
  const displacementEnabled = enabled && state.glyphFieldDisplacement > 0;
  const densityEnabled = enabled && state.glyphFieldDensity > 0;
  const radiusEnabled = enabled && state.glyphFieldRadius > 0;
  const opacityEnabled = enabled && state.glyphFieldOpacity > 0;
  return {
    field,
    enabled,
    strength: modeScale * state.glyphFieldInfluence / 100,
    displacementEnabled,
    densityEnabled,
    radiusEnabled,
    opacityEnabled,
    value(x: number, y: number) {
      if (!field || !enabled) return 0;
      const v = context.sampleGlyphField?.(x, y) ?? sampleGlyphField(field, x, y);
      return Math.max(-1, Math.min(1, v / peak));
    },
    gradient(x: number, y: number) {
      // Gradients only feed displacement math; skip the central-difference sampling
      // when displacement is disabled to avoid 16 array reads per call. The `field`
      // is guaranteed non-null here because `displacementEnabled` requires `enabled`,
      // which in turn requires `field` to be truthy.
      if (!displacementEnabled) return ZERO_GRADIENT;
      return context.sampleGlyphFieldGradient?.(x, y) ?? sampleGlyphFieldGradient(field!, x, y);
    },
  };
}
