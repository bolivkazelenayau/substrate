import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { rendererGeometryCacheKey } from "../src/engine/rendererRuntime";
import type { ProjectState, RenderContext } from "../src/types";

const context = (overrides: Partial<RenderContext> = {}): RenderContext => ({
  timeMs: 0,
  frame: 0,
  ...overrides,
});

const substrate = (key: string | null = null): RenderContext["substrateData"] => ({
  width: 64,
  height: 64,
  viewportWidth: 1200,
  viewportHeight: 720,
  scaleX: 1,
  scaleY: 1,
  sourceText: "TYPE",
  substrateType: "glyph-paths",
  mask: { width: 64, height: 64, data: new Float32Array(64 * 64) },
  edge: { width: 64, height: 64, data: new Float32Array(64 * 64) },
  distance: { width: 64, height: 64, data: new Float32Array(64 * 64) },
  bounds: null,
  diagnostics: {
    maskCoverage: 0,
    edgePixelCount: 0,
    minDistance: 0,
    maxDistance: 0,
    rasterizeTimeMs: 0,
    edgeMapTimeMs: 0,
    distanceFieldTimeMs: 0,
    buildTimeMs: 0,
  },
});

describe("renderer geometry cache identity", () => {
  it("changes when substrate semantic identity changes", () => {
    const state: ProjectState = { ...baseState, renderer: "sdf-contours" };
    const first = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:a" }));
    const second = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:b" }));
    expect(second).not.toBe(first);
  });

  it("is stable when only the substrate object reference changes", () => {
    const state: ProjectState = { ...baseState, renderer: "sdf-contours" };
    const first = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:a" }));
    const second = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:a" }));
    expect(second).toBe(first);
  });

  it("changes when text geometry semantic identity changes", () => {
    const state: ProjectState = { ...baseState, renderer: "glyph-diffuser" };
    const first = rendererGeometryCacheKey(state, context({ textGeometryKey: "typography:a" }));
    const second = rendererGeometryCacheKey(state, context({ textGeometryKey: "typography:b" }));
    expect(second).not.toBe(first);
  });

  it("is stable when only the text geometry object reference changes", () => {
    const state: ProjectState = { ...baseState, renderer: "glyph-diffuser" };
    const first = rendererGeometryCacheKey(state, context({ textGeometryKey: "typography:a" }));
    const second = rendererGeometryCacheKey(state, context({ textGeometryKey: "typography:a" }));
    expect(second).toBe(first);
  });

  it("does not change when theme or diagnostics change", () => {
    const state: ProjectState = { ...baseState, renderer: "dots" };
    const base = rendererGeometryCacheKey(state, context());
    const recolored: ProjectState = {
      ...state,
      primaryColor: "#ff0000",
      backgroundColor: "#001122",
      transparentBackground: !state.transparentBackground,
      debug: { ...state.debug, frameTime: !state.debug.frameTime },
    };
    expect(rendererGeometryCacheKey(recolored, context())).toBe(base);
  });

  it("does not change when trace enablement changes", () => {
    const state: ProjectState = { ...baseState, renderer: "sdf-contours" };
    const base = rendererGeometryCacheKey(state, context());
    const traced: ProjectState = { ...state, debug: { ...state.debug, glyphBounds: !state.debug.glyphBounds } };
    expect(rendererGeometryCacheKey(traced, context())).toBe(base);
  });

  it("does not change for static renderers when time advances", () => {
    const state: ProjectState = { ...baseState, renderer: "sdf-contours" };
    const base = rendererGeometryCacheKey(state, context({ timeMs: 0, frame: 0 }));
    const later = rendererGeometryCacheKey(state, context({ timeMs: 500, frame: 12 }));
    expect(later).toBe(base);
  });

  it("changes for animated renderers when time advances", () => {
    const state: ProjectState = { ...baseState, renderer: "flow" };
    const base = rendererGeometryCacheKey(state, context({ timeMs: 0, frame: 0 }));
    const later = rendererGeometryCacheKey(state, context({ timeMs: 500, frame: 12 }));
    expect(later).not.toBe(base);
  });
});
