import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import {
  clearRendererGeometryCache,
  generateRendererGeometry,
  rendererGeometryCacheKey,
  rendererGeometryStateKey,
} from "../src/engine/rendererRuntime";
import { rendererList } from "../src/engine/renderers";
import { rendererManifests } from "../src/engine/renderers/rendererManifest";
import { createRendererNodeDefinition } from "../src/graph/rendererNodeAdapter";
import type { ProjectState, RenderContext } from "../src/types";
import type { SubstrateData } from "../src/engine/substrate/types";

const context = (overrides: Partial<RenderContext> = {}): RenderContext => ({
  timeMs: 0,
  frame: 0,
  ...overrides,
});

const substrate = (width = 64): SubstrateData => ({
  width,
  height: 64,
  viewportWidth: 1200,
  viewportHeight: 720,
  scaleX: 1,
  scaleY: 1,
  sourceText: "TYPE",
  substrateType: "glyph-paths",
  mask: { width, height: 64, data: new Float32Array(width * 64) },
  edge: { width, height: 64, data: new Float32Array(width * 64) },
  distance: { width, height: 64, data: new Float32Array(width * 64) },
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

describe("renderer manifests", () => {
  it("covers every registered renderer and mirrors compatibility fields", () => {
    expect(Object.keys(rendererManifests)).toHaveLength(rendererList.length);
    for (const renderer of rendererList) {
      const manifest = rendererManifests[renderer.id];
      expect(manifest).toBeDefined();
      expect(manifest.id).toBe(renderer.id);
      expect(manifest.label).toBe(renderer.label);
      expect(manifest.usesTime).toBe(renderer.usesTime);
      expect(manifest.usesSubstrate).toBe(renderer.usesSubstrate);
      expect(manifest.supportedControls).toEqual(renderer.supportedControls);
    }
  });

  it("creates a geometry-producing graph node for every renderer", () => {
    for (const renderer of rendererList) {
      const definition = createRendererNodeDefinition(renderer);
      expect(definition.category).toBe("renderer");
      expect(definition.type).toBe(`renderer.${renderer.id}`);
      expect(definition.outputs).toContainEqual({
        id: "geometry",
        label: "Geometry",
        kind: "geometry",
        direction: "output",
      });
    }
  });

  it("centrally classifies glyph-domain displacement support for every renderer", () => {
    for (const renderer of rendererList) {
      expect(["supported", "base-only", "unsupported"]).toContain(rendererManifests[renderer.id].glyphDomainDisplacement);
    }
    expect(rendererManifests["sdf-halftone"].glyphDomainDisplacement).toBe("supported");
    expect(rendererManifests["sdf-contours"].glyphDomainDisplacement).toBe("supported");
    expect(rendererManifests["wave-contours"].glyphDomainDisplacement).toBe("supported");
    expect(rendererManifests["glyph-diffuser"].glyphDomainDisplacement).toBe("supported");
  });

  it("centrally classifies Emitter Micro Response support without silently consuming other renderers", () => {
    for (const renderer of rendererList) {
      expect(["supported", "unaffected", "unsupported"])
        .toContain(rendererManifests[renderer.id].emitterMicroResponse);
    }
    expect(rendererManifests["glyph-diffuser"].emitterMicroResponse).toBe("supported");
    expect(rendererManifests["sdf-halftone"].emitterMicroResponse).toBe("supported");
    expect(rendererManifests.flow.emitterMicroResponse).toBe("unaffected");
    expect(rendererManifests.ripple.emitterMicroResponse).toBe("unaffected");
    expect(rendererManifests["wave-contours"].emitterMicroResponse).toBe("unaffected");
    expect(rendererManifests.dots.emitterMicroResponse).toBe("unsupported");
    expect(rendererManifests["sdf-flow"].emitterMicroResponse).toBe("unsupported");
    expect(rendererManifests["sdf-streamlines"].emitterMicroResponse).toBe("unsupported");
    expect(rendererManifests["sdf-contours"].emitterMicroResponse).toBe("unsupported");
  });

  it("centrally limits Glyph Falloff Field to final-circle renderers with an authoritative SDF", () => {
    for (const renderer of rendererList) {
      expect(["supported", "unaffected", "unsupported"])
        .toContain(rendererManifests[renderer.id].glyphFalloffDisplacement);
    }
    expect(rendererManifests["glyph-diffuser"].glyphFalloffDisplacement).toBe("supported");
    expect(rendererManifests["sdf-halftone"].glyphFalloffDisplacement).toBe("supported");
    expect(rendererManifests.flow.glyphFalloffDisplacement).toBe("unaffected");
    expect(rendererManifests["sdf-contours"].glyphFalloffDisplacement).toBe("unsupported");
  });
});

describe("manifest dependency and cache identity", () => {
  it("never caches time-dependent renderers as static geometry", () => {
    clearRendererGeometryCache();
    for (const renderer of rendererList.filter(({ id }) => rendererManifests[id].dependencies.includes("time"))) {
      const state = { ...baseState, renderer: renderer.id };
      const first = generateRendererGeometry(state, context({ timeMs: 10, frame: 1 }));
      const second = generateRendererGeometry(state, context({ timeMs: 10, frame: 1 }));
      expect(second).not.toBe(first);
    }
  });

  it("excludes color-only appearance from geometry identity", () => {
    const recolored: ProjectState = {
      ...baseState,
      primaryColor: "#000000",
      outlineColor: "#ffffff",
      backgroundColor: "#ff00ff",
      transparentBackground: !baseState.transparentBackground,
    };
    expect(rendererGeometryStateKey(recolored)).toBe(rendererGeometryStateKey(baseState));
    expect(rendererGeometryCacheKey(recolored, context())).toBe(rendererGeometryCacheKey(baseState, context()));
  });

  it("represents substrate semantic identity for every substrate renderer", () => {
    for (const renderer of rendererList.filter(({ id }) => rendererManifests[id].dependencies.includes("substrate"))) {
      const state = { ...baseState, renderer: renderer.id };
      const first = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:a" }));
      const second = rendererGeometryCacheKey(state, context({ substrateData: substrate(), substrateKey: "substrate:b" }));
      expect(second).not.toBe(first);
    }
  });

  it("covers representative emitter, field, glyph-modulation, contour, halftone, and diffuser state", () => {
    const cases: Array<[keyof typeof rendererManifests, ProjectState]> = [
      ["glyph-diffuser", { ...baseState, renderer: "glyph-diffuser", emitter: { ...baseState.emitter, amplitude: baseState.emitter.amplitude + 1 } }],
      ["wave-contours", { ...baseState, renderer: "wave-contours", emitter: { ...baseState.emitter, frequency: baseState.emitter.frequency + 0.01 } }],
      ["sdf-streamlines", { ...baseState, renderer: "sdf-streamlines", glyphFieldDisplacement: baseState.glyphFieldDisplacement + 1 }],
      ["sdf-contours", { ...baseState, renderer: "sdf-contours", density: baseState.density + 1 }],
      ["sdf-halftone", { ...baseState, renderer: "sdf-halftone", glyphFieldRadius: baseState.glyphFieldRadius + 1 }],
      ["glyph-diffuser", { ...baseState, renderer: "glyph-diffuser", diffuserDotRadius: baseState.diffuserDotRadius + 0.1 }],
    ];
    for (const [rendererId, changed] of cases) {
      const baseline = { ...baseState, renderer: rendererId };
      expect(rendererGeometryCacheKey(changed, context())).not.toBe(rendererGeometryCacheKey(baseline, context()));
    }
  });

  it("lets the active typography key carry displacement identity without broad renderer-state churn", () => {
    const displacedSettings: ProjectState = {
      ...baseState,
      glyphDisplacement: { ...baseState.glyphDisplacement, enabled: true, strength: 96 },
    };
    expect(rendererGeometryStateKey(displacedSettings)).toBe(rendererGeometryStateKey(baseState));
    const before = rendererGeometryCacheKey(baseState, context({ textGeometryKey: "typography:base" }));
    const after = rendererGeometryCacheKey(displacedSettings, context({ textGeometryKey: "typography:displaced" }));
    expect(after).not.toBe(before);
  });

  it("scopes dot-grid state to SDF Halftone geometry", () => {
    const changed = { ...baseState, dotGrid: { ...baseState.dotGrid, enabled: true, spacing: 17 } };
    expect(rendererGeometryStateKey({ ...changed, renderer: "sdf-halftone" }))
      .not.toBe(rendererGeometryStateKey({ ...baseState, renderer: "sdf-halftone" }));
    expect(rendererGeometryStateKey({ ...changed, renderer: "sdf-contours" }))
      .toBe(rendererGeometryStateKey({ ...baseState, renderer: "sdf-contours" }));
  });

  it("scopes Glyph Falloff Field identity to supported renderers and ignores disabled values", () => {
    const halftone = { ...baseState, renderer: "sdf-halftone" as const };
    const enabled = {
      ...halftone,
      glyphFalloffDisplacement: {
        ...halftone.glyphFalloffDisplacement,
        mode: "contour-rings" as const,
        ringFrequency: 8,
      },
    };
    const configuredButDisabled = {
      ...halftone,
      glyphFalloffDisplacement: {
        ...halftone.glyphFalloffDisplacement,
        mode: "off" as const,
        strength: 96,
        ringFrequency: 16,
      },
    };

    expect(rendererGeometryStateKey(enabled)).not.toBe(rendererGeometryStateKey(halftone));
    expect(rendererGeometryCacheKey(enabled, context({ substrateKey: "sdf:a" })))
      .not.toBe(rendererGeometryCacheKey(enabled, context({ substrateKey: "sdf:b" })));
    expect(rendererGeometryStateKey(configuredButDisabled)).toBe(rendererGeometryStateKey(halftone));
    expect(rendererGeometryCacheKey(configuredButDisabled, context())).toBe(rendererGeometryCacheKey(halftone, context()));
    expect(rendererGeometryStateKey({ ...enabled, renderer: "sdf-contours" }))
      .toBe(rendererGeometryStateKey({ ...halftone, renderer: "sdf-contours" }));
  });

  it("scopes enabled Display Dislocation state to SDF Halftone's regular grid", () => {
    const halftone = {
      ...baseState,
      renderer: "sdf-halftone" as const,
      emitter: { ...baseState.emitter, enabled: true },
      dotGrid: { ...baseState.dotGrid, enabled: true },
    };
    const enabled = {
      ...halftone,
      displayDislocation: { ...baseState.displayDislocation, enabled: true },
    };
    const configuredButDisabled = {
      ...halftone,
      displayDislocation: { ...baseState.displayDislocation, enabled: false, seed: 99999 },
    };
    expect(rendererGeometryStateKey(enabled)).not.toBe(rendererGeometryStateKey(halftone));
    expect(rendererGeometryCacheKey(enabled, context())).not.toBe(rendererGeometryCacheKey(halftone, context()));
    expect(rendererGeometryStateKey(configuredButDisabled)).toBe(rendererGeometryStateKey(halftone));
    expect(rendererGeometryCacheKey(configuredButDisabled, context())).toBe(rendererGeometryCacheKey(halftone, context()));
    expect(rendererGeometryStateKey({ ...enabled, renderer: "sdf-contours" }))
      .toBe(rendererGeometryStateKey({ ...halftone, renderer: "sdf-contours" }));
  });
});
