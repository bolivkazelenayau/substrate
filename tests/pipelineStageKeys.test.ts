import { describe, expect, it } from "vitest";
import { typographyInputKey } from "../src/engine/exportAuthority";
import { baseState } from "../src/engine/presets";
import {
  sceneLayoutStageKey,
  staticRenderContextStageKey,
  substrateProjectSliceKey,
  substrateStageKey,
  typographyStageKey,
} from "../src/engine/pipelineStageKeys";
import { resolveRendererRequirements } from "../src/engine/rendererRequirements";
import { rendererGeometryStateKey } from "../src/engine/rendererRuntime";

describe("pipeline stage keys", () => {
  it("matches export typography key for the same inputs", () => {
    expect(typographyStageKey(baseState, "font:native")).toBe(typographyInputKey(baseState, "font:native"));
  });

  it("excludes diagnostics from typography and scene keys", () => {
    const debugged = {
      ...baseState,
      debug: { ...baseState.debug, glyphBounds: !baseState.debug.glyphBounds, baseline: true },
    };
    expect(typographyStageKey(debugged, "font:native")).toBe(typographyStageKey(baseState, "font:native"));
    expect(sceneLayoutStageKey(debugged, null)).toBe(sceneLayoutStageKey(baseState, null));
    expect(rendererGeometryStateKey(debugged)).toBe(rendererGeometryStateKey(baseState));
  });

  it("excludes theme colors from renderer geometry state", () => {
    const recolored = { ...baseState, primaryColor: "#ff0066", backgroundColor: "#001122" };
    expect(rendererGeometryStateKey(recolored)).toBe(rendererGeometryStateKey(baseState));
  });

  it("changes typography key when text changes", () => {
    const changed = { ...baseState, text: `${baseState.text}!` };
    expect(typographyStageKey(changed, "font:native")).not.toBe(typographyStageKey(baseState, "font:native"));
  });

  it("changes typography key when fontSize changes and restores it on round trip", () => {
    const key148 = typographyStageKey({ ...baseState, fontSize: 148 }, "font:fixture");
    const key540 = typographyStageKey({ ...baseState, fontSize: 540 }, "font:fixture");
    const keyBack148 = typographyStageKey({ ...baseState, fontSize: 148 }, "font:fixture");
    expect(key540).not.toBe(key148);
    expect(keyBack148).toBe(key148);
  });

  it("excludes preview backend from substrate project slice", () => {
    expect(substrateProjectSliceKey(baseState)).toBe(substrateProjectSliceKey({ ...baseState, debug: { ...baseState.debug, frameTime: !baseState.debug.frameTime } }));
  });

  it("changes static context key when renderer requirements change", () => {
    const flow = staticRenderContextStageKey("flow", resolveRendererRequirements("flow"), "scene:a", "typography:a", null);
    const halftone = staticRenderContextStageKey("sdf-halftone", resolveRendererRequirements("sdf-halftone"), "scene:a", "typography:a", "substrate:a");
    expect(halftone).not.toBe(flow);
  });

  it("changes substrate key when viewport changes", () => {
    const input = {
      sourceText: baseState.text,
      textGeometry: null,
      fontSize: baseState.fontSize,
      tracking: baseState.tracking,
      fontFamily: "sans-serif",
      fontWeight: 400,
      baselineY: 360,
      textX: 600,
      lineHeight: baseState.lineHeight,
      textAlign: baseState.textAlign,
      kerningMode: baseState.kerningMode,
      resolution: { width: 256, height: 154 },
      bounds: null,
      domainBounds: { x: 0, y: 0, width: 1200, height: 720 },
      viewport: { x: 0, y: 0, width: 1200, height: 720 },
    };
    const shifted = {
      ...input,
      viewport: { x: -40, y: -20, width: 1280, height: 760 },
      domainBounds: { x: -40, y: -20, width: 1280, height: 760 },
    };
    const typography = typographyStageKey(baseState, "font:native");
    expect(substrateStageKey(shifted, typography)).not.toBe(substrateStageKey(input, typography));
  });
});