import { describe, expect, it } from "vitest";
import { CONTROL_OWNERSHIP, GLYPH_MODULATION_MACRO_RECIPES, getControlOwnership, getProductFeatureState, getProductSurface, PHASE_2_CANDIDATES } from "../src/engine/parameterOwnership";
import { applyPreset, baseState } from "../src/engine/presets";

describe("semantic control ownership", () => {
  it("classifies every registered control with a stage, owner, tier, and locality contract", () => {
    const entries = Object.entries(CONTROL_OWNERSHIP);
    expect(entries.length).toBeGreaterThan(70);
    entries.forEach(([, descriptor]) => {
      expect(descriptor.stage).toBeTruthy();
      expect(descriptor.owner).toBeTruthy();
      expect(["primary", "advanced", "diagnostic"]).toContain(descriptor.tier);
      expect(typeof descriptor.shared).toBe("boolean");
      expect(typeof descriptor.rendererLocal).toBe("boolean");
      expect(["PRIMARY", "ADVANCED", "TUNING", "SAFETY", "PERFORMANCE", "DIAGNOSTICS", "LEGACY"]).toContain(descriptor.productSurface);
    });
  });

  it("keeps emitter definition, geometry, mark response, and renderer-local ownership distinct", () => {
    expect(getControlOwnership("emitter.amplitude")).toMatchObject({
      stage: "emitters",
      owner: "Emitter field definition",
      rendererLocal: false,
    });
    expect(getControlOwnership("glyphCalmWater.strength")).toMatchObject({
      stage: "glyph-geometry",
      owner: "Calm Water",
    });
    expect(getControlOwnership("emitterMicroResponse.occupancy")).toMatchObject({
      stage: "mark-response",
      owner: "Emitter Micro Response",
      rendererLocal: true,
    });
    expect(getControlOwnership("displayDislocation.mode")).toMatchObject({
      stage: "renderer",
      owner: "Display Dislocation",
      rendererLocal: true,
    });
  });

  it("uses wildcard ownership for nested authored parameters without making labels identity", () => {
    expect(getControlOwnership("glyphMicroWarp.tangentialDisplacement")).toMatchObject({
      stage: "glyph-geometry",
      owner: "Glyph Micro Warp",
      tier: "advanced",
    });
    expect(getControlOwnership("preview.backend")).toMatchObject({
      stage: "preview-export",
      owner: "Preview",
    });
  });

  it("classifies Phase 1 surfaces without changing semantic ownership", () => {
    expect(getProductSurface("glyphMicroWarp.detailOctaves")).toBe("TUNING");
    expect(getProductSurface("glyphMicroWarp.edgeTurbulence")).toBe("ADVANCED");
    expect(getProductSurface("glyphMicroWarp.maxDisplacement")).toBe("SAFETY");
    expect(getProductSurface("preview.fpsCap")).toBe("PERFORMANCE");
    expect(getProductSurface("emitterDisplay.interiorSuppression")).toBe("LEGACY");
    expect(PHASE_2_CANDIDATES.length).toBeGreaterThan(0);
  });

  it("does not mark default or canonical preset recipes as custom", () => {
    expect(getProductFeatureState(baseState, "micro-warp").state).toBe("default");
    expect(getProductFeatureState(applyPreset(baseState, "Sonic Halftone"), "glyph-modulation").state).toBe("tuned");
    const inherited = { ...applyPreset(baseState, "Sonic Diffuser"), preset: "Custom" as const, density: 17 };
    expect(getProductFeatureState(inherited, "glyph-diffuser").state).toBe("tuned");
  });

  it("retains exact custom values and recognizes canonical Glyph Modulation macros", () => {
    const canonical = {
      ...baseState,
      preset: "Custom" as const,
      glyphFieldMode: "strong" as const,
      ...GLYPH_MODULATION_MACRO_RECIPES.strong,
    };
    expect(getProductFeatureState(canonical, "glyph-modulation").state).toBe("default");

    const custom = {
      ...canonical,
      glyphFieldDensity: canonical.glyphFieldDensity + 1,
    };
    expect(getProductFeatureState(custom, "glyph-modulation")).toMatchObject({ state: "custom", hasNonDefaultValues: true });
    expect(custom.glyphFieldDensity).toBe(GLYPH_MODULATION_MACRO_RECIPES.strong.glyphFieldDensity + 1);
  });

  it("exposes retained legacy suppression as legacy truth", () => {
    const legacy = {
      ...baseState,
      preset: "Custom" as const,
      emitterDisplay: { ...baseState.emitterDisplay, mode: "exclude" as const, interiorSuppression: 73 },
    };
    expect(getProductFeatureState(legacy, "legacy-interior-suppression").state).toBe("legacy");
  });
});
