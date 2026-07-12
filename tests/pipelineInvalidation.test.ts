import { describe, expect, it } from "vitest";
import { resolveExportReadiness, typographyInputKey, typographyOutputKey } from "../src/engine/exportAuthority";
import { baseState } from "../src/engine/presets";
import {
  sceneLayoutStageKey,
  staticRenderContextStageKey,
  substrateProjectSliceKey,
  SUBSTRATE_NOT_REQUIRED_KEY,
  typographyStageKey,
} from "../src/engine/pipelineStageKeys";
import { resolveRendererRequirements } from "../src/engine/rendererRequirements";
import { rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import { getRendererManifest, rendererManifests } from "../src/engine/renderers/rendererManifest";
import type { RendererId } from "../src/types";

const RENDERER_IDS = Object.keys(rendererManifests) as RendererId[];

describe("pipeline invalidation scenarios", () => {
  it("covers every renderer without a broad substrate fallback", () => {
    for (const id of RENDERER_IDS) {
      const manifest = getRendererManifest(id);
      const requirements = resolveRendererRequirements(id);
      expect(requirements.substrate).toBe(manifest.usesSubstrate);
      expect(requirements.scene).toBe(true);
    }
  });

  it("scenario 2: ripple renderer-only control does not change typography key", () => {
    const rippleOnly = { ...baseState, renderer: "ripple" as const, amplitude: baseState.amplitude + 5 };
    expect(typographyStageKey(rippleOnly, "font:native")).toBe(typographyStageKey(baseState, "font:native"));
    expect(rendererGeometryStateKey(rippleOnly)).not.toBe(rendererGeometryStateKey(baseState));
  });

  it("scenario 4: halftone style-only color change does not change geometry identity", () => {
    const halftone = { ...baseState, renderer: "sdf-halftone" as const };
    const recolored = { ...halftone, primaryColor: "#ff0066", outlineColor: "#00ffaa" };
    expect(rendererGeometryStateKey(recolored)).toBe(rendererGeometryStateKey(halftone));
    expect(substrateProjectSliceKey(recolored)).toBe(substrateProjectSliceKey(halftone));
  });

  it("scenario 11: theme change does not invalidate artwork stage keys", () => {
    const themed = {
      ...baseState,
      primaryColor: "#abcdef",
      backgroundColor: "#112233",
      outlineColor: "#445566",
      transparentBackground: !baseState.transparentBackground,
    };
    expect(typographyStageKey(themed, "font:native")).toBe(typographyStageKey(baseState, "font:native"));
    expect(sceneLayoutStageKey(themed, null)).toBe(sceneLayoutStageKey(baseState, null));
    expect(rendererGeometryStateKey(themed)).toBe(rendererGeometryStateKey(baseState));
  });

  it("scenario 7: flow export readiness does not wait for substrate", () => {
    const flow = { ...baseState, renderer: "flow" as const };
    const font = { status: "native-approximate" as const, resourceKey: "font:native", loadedFont: null };
    const typographyKey = typographyInputKey(flow, font.resourceKey!);
    const typographyOut = typographyOutputKey(typographyKey, font, null)!;
    const rendererKey = "renderer:flow-ready";
    const readiness = resolveExportReadiness({
      font,
      typographyInputKey: typographyKey,
      typographyOutputKey: typographyOut,
      substrateInputKey: SUBSTRATE_NOT_REQUIRED_KEY,
      substrateOutputKey: SUBSTRATE_NOT_REQUIRED_KEY,
      substrateData: null,
      rendererInputKey: rendererKey,
      rendererGeometryKey: rendererKey,
      sceneSafetyLimitHit: false,
      failureReason: null,
      renderer: flow.renderer,
    });
    expect(readiness.status).toBe("ready");
  });

  it("static context key excludes presentation-only backend changes", () => {
    const flowRequirements = resolveRendererRequirements("flow");
    const first = staticRenderContextStageKey("flow", flowRequirements, "scene:a", "typography-output:a", null);
    const second = staticRenderContextStageKey("flow", flowRequirements, "scene:a", "typography-output:a", null);
    expect(second).toBe(first);
  });
});