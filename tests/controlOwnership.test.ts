import { describe, expect, it } from "vitest";
import { getControlActivity } from "../src/engine/controlOwnership";
import { applyPreset, baseState } from "../src/engine/presets";

describe("shared control activity", () => {
  it("reports Display Dislocation as active and Fragmentation as retained but inactive", () => {
    const state = {
      ...applyPreset(baseState, "Display Dislocation"),
      glyphDisplacement: { ...baseState.glyphDisplacement, enabled: true },
    };
    const activity = getControlActivity(state, true);

    expect(activity.displayDislocation).toMatchObject({
      enabledByState: true,
      supported: true,
      active: true,
      retained: false,
      incompatibleWith: "Glyph Fragmentation",
    });
    expect(activity.glyphDisplacement).toMatchObject({
      enabledByState: true,
      supported: true,
      active: false,
      retained: true,
      incompatibleWith: "Display Dislocation",
    });
  });

  it("reports retained Display Dislocation as unsupported after a renderer switch", () => {
    const state = {
      ...applyPreset(baseState, "Display Dislocation"),
      renderer: "sdf-contours" as const,
    };
    const activity = getControlActivity(state, true);

    expect(activity.displayDislocation).toMatchObject({
      enabledByState: true,
      supported: false,
      active: false,
      retained: true,
    });
    expect(activity.displayDislocation.reason).toContain("SDF Halftone");
  });

  it("reports disabled and renderer-inactive systems without conflating authored state with pipeline activity", () => {
    const state = {
      ...baseState,
      renderer: "flow" as const,
      emitter: { ...baseState.emitter, enabled: false },
      glyphMicroWarp: { ...baseState.glyphMicroWarp, enabled: true },
      glyphCalmWater: { ...baseState.glyphCalmWater, enabled: true },
      emitterMicroResponse: { ...baseState.emitterMicroResponse, enabled: true },
      glyphFalloffDisplacement: { ...baseState.glyphFalloffDisplacement, mode: "contour-rings" as const },
      dotGrid: { ...baseState.dotGrid, enabled: true },
    };
    const activity = getControlActivity(state, true);

    expect(activity.glyphMicroWarpActivity).toMatchObject({ enabledByState: true, active: false, retained: true });
    expect(activity.glyphCalmWaterActivity).toMatchObject({ enabledByState: true, active: false, retained: true });
    expect(activity.emitterMicroResponseActivity).toMatchObject({ enabledByState: true, supported: false, active: false, retained: true });
    expect(activity.glyphFalloffDisplacementActivity).toMatchObject({ enabledByState: true, supported: false, active: false, retained: true });
    expect(activity.dotGrid).toMatchObject({ enabledByState: true, supported: false, active: false, retained: true });
  });
});
