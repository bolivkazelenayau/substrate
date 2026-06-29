import { describe, expect, it } from "vitest";
import type { PresetId } from "../src/types";
import { resolveGlyphEmitterSources } from "../src/engine/field/glyphEmitters";
import { applyPreset, baseState, presets } from "../src/engine/presets";

const multiEmitterPresetIds = ["Sonic Interference", "Counter Resonance", "Split Field"] as const;
const legacyPresetIds = Object.keys(presets).filter(
  (preset): preset is Exclude<PresetId, "Custom"> =>
    !multiEmitterPresetIds.includes(preset as (typeof multiEmitterPresetIds)[number]),
);

describe("presets", () => {
  it.each(legacyPresetIds)("%s restores historical single-emitter state after a multi-emitter preset", (preset) => {
    const afterMultiEmitter = applyPreset(applyPreset(baseState, "Sonic Interference"), preset);

    expect(afterMultiEmitter.emitterMode).toBe("single");
    expect(afterMultiEmitter).toEqual(expect.objectContaining({ ...presets[preset], preset }));
  });

  it.each(legacyPresetIds)("%s explicitly opts into single-emitter mode", (preset) => {
    expect(presets[preset]).toHaveProperty("emitterMode", "single");
  });

  it("Sonic Interference creates multiple enabled sources when text permits", () => {
    const state = { ...applyPreset(baseState, "Sonic Interference"), text: "SONIC" };
    expect(resolveGlyphEmitterSources(state, null).sources.length).toBeGreaterThan(1);
  });

  it("Counter Resonance prefers a counter and degrades safely without one", () => {
    const withCounter = resolveGlyphEmitterSources({ ...applyPreset(baseState, "Counter Resonance"), text: "SONIC" }, null);
    const withoutCounter = resolveGlyphEmitterSources({ ...applyPreset(baseState, "Counter Resonance"), text: "XYZ" }, null);
    expect(withCounter.sources[0].glyph.character).toBe("O");
    expect(withCounter.sources[0].fallbackReason).toBeUndefined();
    expect(withoutCounter.sources[0].fallbackReason).toBe("counter-unavailable");
  });

  it("Split Field creates an asymmetric multi-emitter setup", () => {
    const state = applyPreset(baseState, "Split Field");
    expect(state.emitterMode).toBe("multiple");
    expect(state.emitters).toHaveLength(2);
    expect(state.emitters[0].weight).not.toBe(state.emitters[1].weight);
    expect(state.emitters[0].phaseOffset).not.toBe(state.emitters[1].phaseOffset);
    expect(state.emitters[0].radiusMultiplier).not.toBe(state.emitters[1].radiusMultiplier);
  });

  it.each(multiEmitterPresetIds)("%s is deterministic and safe across text fallbacks", (preset) => {
    for (const text of ["SONIC", "X", "", "   ", "XYZ"]) {
      const state = { ...applyPreset(baseState, preset), text, font: null };
      expect(() => resolveGlyphEmitterSources(state, null)).not.toThrow();
      expect(resolveGlyphEmitterSources(state, null)).toEqual(resolveGlyphEmitterSources(state, null));
    }
  });
});
