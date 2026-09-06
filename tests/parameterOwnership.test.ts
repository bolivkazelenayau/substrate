import { describe, expect, it } from "vitest";
import { CONTROL_OWNERSHIP, getControlOwnership } from "../src/engine/parameterOwnership";

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
});
