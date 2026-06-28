import type { ProjectState, RenderContext } from "../../types";
import { buildCompositeWaveField, sampleGlyphField, sampleGlyphFieldGradient } from "./compositeWaveField";

export function getGlyphFieldSampler(state: ProjectState, context: RenderContext) {
  const field = context.glyphField ?? buildCompositeWaveField(state, context);
  const modeScale = state.glyphFieldMode === "strong" ? 1 : state.glyphFieldMode === "subtle" ? 0.42 : 0;
  const enabled = Boolean(field && state.emitter.enabled && modeScale > 0 && state.glyphFieldInfluence > 0);
  const peak = field ? Math.max(0.001, Math.abs(field.min), Math.abs(field.max)) : 1;
  return {
    field,
    enabled,
    strength: modeScale * state.glyphFieldInfluence / 100,
    value(x: number, y: number) {
      if (!field || !enabled) return 0;
      const value = context.sampleGlyphField?.(x, y) ?? sampleGlyphField(field, x, y);
      return Math.max(-1, Math.min(1, value / peak));
    },
    gradient(x: number, y: number) {
      if (!field || !enabled) return { x: 0, y: 0, magnitude: 0, finite: true };
      return context.sampleGlyphFieldGradient?.(x, y) ?? sampleGlyphFieldGradient(field, x, y);
    },
  };
}
