import { describe, expect, it } from "vitest";
import type { PresetId } from "../src/types";
import { resolveGlyphEmitterSources } from "../src/engine/field/glyphEmitters";
import { applyPreset, baseState, getPresetDisplayLabel, getPresetScopeLabel, presetIds, presetMetadata, presetScopes, presets } from "../src/engine/presets";

const expectedPresetIds: PresetId[] = [
  "Edge Current", "Sonic Ripple", "Signal Dust", "SDF Current", "Contour Thread",
  "Topographic Type", "Halftone Press", "Glyph Ripple", "Dotted Diffuser",
  "Sonic Halftone", "Sonic Contours", "Sonic Stream", "Sonic Diffuser",
  "Sonic Warp", "Sonic Interference", "Counter Resonance", "Split Field", "Fragment Matrix", "Display Dislocation",
  "Calm Current", "Tidal Slice", "Custom",
];

const multiEmitterPresetIds = ["Sonic Interference", "Counter Resonance", "Split Field"] as const;
const legacyPresetIds = Object.keys(presets).filter(
  (preset): preset is Exclude<PresetId, "Custom"> =>
    !multiEmitterPresetIds.includes(preset as (typeof multiEmitterPresetIds)[number]),
);

describe("presets", () => {
  it("preserves compatibility IDs and preset order", () => {
    expect(presetIds).toEqual(expectedPresetIds);
    expect(Object.keys(presets)).toEqual(expectedPresetIds.slice(0, -1));
  });

  it("inherits the legacy-visible contour thickness without preset overrides", () => {
    expect(baseState.contourStrokeWidth).toBe(1.4);
    Object.values(presets).forEach((preset) => {
      expect(preset).not.toHaveProperty("contourStrokeWidth");
    });
  });

  it("provides unique, formatted study metadata for every built-in preset", () => {
    const builtInIds = presetIds.slice(0, -1);
    const builtInMetadata = builtInIds.map((preset) => presetMetadata[preset]);
    const studyCodes = builtInMetadata.map((metadata) => metadata.studyCode);

    expect(studyCodes).toHaveLength(21);
    expect(new Set(studyCodes).size).toBe(studyCodes.length);
    studyCodes.forEach((studyCode) => expect(studyCode).toMatch(/^[A-Z]+ \/ \d{2}$/));
    builtInMetadata.forEach((metadata, index) => {
      expect(metadata.legacyName).toBe(builtInIds[index]);
      expect(metadata.legacyName).not.toBe("");
      expect(metadata.family).not.toBe("custom");
      expect(metadata.description).not.toBe("");
    });
  });

  it("declares an explicit semantic scope for every preset", () => {
    const builtInIds = presetIds.slice(0, -1) as Exclude<PresetId, "Custom">[];
    expect(Object.keys(presetScopes)).toEqual(builtInIds);
    builtInIds.forEach((preset) => expect(presetScopes[preset].length).toBeGreaterThan(0));
    expect(presetScopes["Display Dislocation"]).toEqual(["full-project"]);
    expect(getPresetScopeLabel("Display Dislocation")).toBe("Full project snapshot");
    expect(getPresetScopeLabel("Edge Current")).toBe("Renderer · Core field · Emitter");
  });

  it("keeps Custom unnumbered and formats presentation labels without changing values", () => {
    expect(presetMetadata.Custom).toEqual({
      legacyName: "Custom",
      family: "custom",
      description: "User-modified project state.",
    });
    expect(getPresetDisplayLabel("Edge Current")).toBe("TRACE / 01 — Edge Current");
    expect(getPresetDisplayLabel("Custom")).toBe("Custom");

    const applied = applyPreset(baseState, "Edge Current");
    expect(applied).toEqual({ ...baseState, ...presets["Edge Current"], preset: "Edge Current" });
    expect(applied).not.toHaveProperty("studyCode");
    expect(applied).not.toHaveProperty("legacyName");
    expect(applied).not.toHaveProperty("family");
    expect(applied).not.toHaveProperty("description");
  });

  it.each(legacyPresetIds)("%s restores historical single-emitter state after a multi-emitter preset", (preset) => {
    const afterMultiEmitter = applyPreset(applyPreset(baseState, "Sonic Interference"), preset);

    expect(afterMultiEmitter.emitterMode).toBe("single");
    expect(afterMultiEmitter).toEqual(expect.objectContaining({ ...presets[preset], preset }));
  });

  it.each(legacyPresetIds)("%s explicitly opts into single-emitter mode", (preset) => {
    expect(presets[preset]).toHaveProperty("emitterMode", "single");
  });

  it("scoped presets preserve unrelated authored response and deformation state", () => {
    const configured = {
      ...baseState,
      emitterDisplay: { ...baseState.emitterDisplay, mode: "orbit" as const, gridAmount: 100 },
      emitterMicroResponse: { ...baseState.emitterMicroResponse, enabled: true, occupancy: "disperse-exterior" as const },
      glyphMicroWarp: { ...baseState.glyphMicroWarp, enabled: true, strength: 88 },
      glyphCalmWater: { ...baseState.glyphCalmWater, enabled: true, strength: 19 },
      glyphDisplacement: { ...baseState.glyphDisplacement, enabled: true, mode: "grid" as const, strength: 47 },
      displayDislocation: { ...baseState.displayDislocation, enabled: true },
    };
    const applied = applyPreset(configured, "Signal Dust");
    expect(applied.emitterDisplay).toEqual(configured.emitterDisplay);
    expect(applied.emitterMicroResponse).toEqual(configured.emitterMicroResponse);
    expect(applied.glyphMicroWarp).toEqual(configured.glyphMicroWarp);
    expect(applied.glyphCalmWater).toEqual(configured.glyphCalmWater);
    expect(applied.glyphDisplacement).toEqual(configured.glyphDisplacement);
    expect(applied.displayDislocation).toEqual(configured.displayDislocation);
    expect(applied.renderer).toBe("dots");
  });

  it("makes Display Dislocation's full-project replacement explicit", () => {
    const loadedFont = { family: "Basic", fullName: "Basic Regular", fileName: "Basic-Regular.ttf", unitsPerEm: 1000, ascender: 800, descender: -200 };
    const configured = {
      ...baseState,
      text: "AUTHORED",
      font: loadedFont,
      glyphMicroWarp: { ...baseState.glyphMicroWarp, enabled: true, strength: 88 },
      emitterMicroResponse: { ...baseState.emitterMicroResponse, enabled: true, occupancy: "disperse-exterior" as const },
      backgroundColor: "#123456",
    };
    const display = applyPreset(configured, "Display Dislocation");
    expect(display).toMatchObject({
      text: "DISPLAY",
      renderer: "sdf-halftone",
      font: loadedFont,
      glyphMicroWarp: baseState.glyphMicroWarp,
      emitterMicroResponse: baseState.emitterMicroResponse,
      glyphDisplacement: { enabled: false },
      dotGrid: { enabled: true },
      displayDislocation: { enabled: true, mode: "horizontal-bands" },
      overlayMode: "hidden",
    });
    expect(display.backgroundColor).toBe(baseState.backgroundColor);
  });

  it("makes competing effect recipes hand the domain authority to their selected effect", () => {
    const display = applyPreset(baseState, "Display Dislocation");
    const fragmentation = applyPreset(display, "Fragment Matrix");
    expect(fragmentation.displayDislocation).toEqual(baseState.displayDislocation);
    expect(fragmentation.glyphDisplacement.enabled).toBe(true);
  });

  it.each(presetIds.slice(0, -1) as Exclude<PresetId, "Custom">[])("%s is deterministic when applied repeatedly", (preset) => {
    const configured = { ...baseState, text: "AUTHORED", seed: 777 };
    expect(applyPreset(configured, preset)).toEqual(applyPreset(configured, preset));
  });

  it("adds discoverable water presets without changing the existing experimental systems", () => {
    const calm = applyPreset(baseState, "Calm Current");
    expect(calm).toMatchObject({
      glyphCalmWater: { enabled: true, frequencyLinked: true },
      glyphDisplacement: { enabled: false },
      emitter: { enabled: true },
    });
    const tidal = applyPreset(baseState, "Tidal Slice");
    expect(tidal).toMatchObject({
      glyphCalmWater: { enabled: true },
      glyphDisplacement: { enabled: true, mode: "horizontal-slices", sliceInfluence: "emitter-falloff" },
      emitter: { enabled: true },
    });
    expect(presets["Fragment Matrix"].glyphDisplacement?.mode).toBe("grid");
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
