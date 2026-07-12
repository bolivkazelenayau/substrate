import { describe, expect, it } from "vitest";
import { rendererCapabilitiesFromManifest, resolveRendererRequirements } from "../src/engine/rendererRequirements";
import { rendererManifests } from "../src/engine/renderers/rendererManifest";
import type { RendererId } from "../src/types";

const RENDERER_IDS = Object.keys(rendererManifests) as RendererId[];

describe("renderer requirements", () => {
  it("covers every registered renderer explicitly", () => {
    expect(RENDERER_IDS.length).toBeGreaterThanOrEqual(9);
    for (const id of RENDERER_IDS) {
      const requirements = resolveRendererRequirements(id);
      expect(requirements.scene).toBe(true);
      expect(typeof requirements.substrate).toBe("boolean");
      expect(typeof requirements.typography).toBe("boolean");
    }
  });

  it("does not require substrate for lightweight flow renderers", () => {
    expect(resolveRendererRequirements("flow").substrate).toBe(false);
    expect(resolveRendererRequirements("ripple").substrate).toBe(false);
    expect(resolveRendererRequirements("dots").substrate).toBe(false);
  });

  it("requires substrate for substrate-dependent renderers", () => {
    expect(resolveRendererRequirements("sdf-halftone").substrate).toBe(true);
    expect(resolveRendererRequirements("glyph-diffuser").substrate).toBe(true);
  });

  it("derives glyph field requirements from manifest dependencies", () => {
    expect(rendererCapabilitiesFromManifest(rendererManifests.flow).requiresGlyphField).toBe(false);
    expect(rendererCapabilitiesFromManifest(rendererManifests["sdf-streamlines"]).requiresGlyphField).toBe(true);
  });

  it("is deterministic for repeated calls", () => {
    const first = resolveRendererRequirements("sdf-contours");
    const second = resolveRendererRequirements("sdf-contours");
    expect(second).toEqual(first);
  });
});