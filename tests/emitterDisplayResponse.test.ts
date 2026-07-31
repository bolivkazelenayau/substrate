import { describe, expect, it } from "vitest";
import { createEmitterDisplaySampler } from "../src/engine/field/emitterDisplayResponse";
import { baseState } from "../src/engine/presets";
import { buildSignedDistanceField } from "../src/engine/substrate/distanceField";
import { buildEdgeMap } from "../src/engine/substrate/edgeMap";
import type { RasterMask, SubstrateData } from "../src/engine/substrate/types";
import type { ProjectState, RenderContext } from "../src/types";

function squareSubstrate(): SubstrateData {
  const width = 100;
  const height = 100;
  const mask: RasterMask = { width, height, data: new Float32Array(width * height) };
  for (let y = 30; y <= 70; y += 1) {
    for (let x = 40; x <= 60; x += 1) mask.data[y * width + x] = 1;
  }
  const edge = buildEdgeMap(mask);
  const distance = buildSignedDistanceField(mask, edge, 1, 1);
  return {
    width,
    height,
    viewportWidth: width,
    viewportHeight: height,
    scaleX: 1,
    scaleY: 1,
    sourceText: "O",
    substrateType: "native-text-fallback",
    mask,
    edge,
    distance,
    bounds: { x: 40, y: 30, width: 20, height: 40 },
    domainBounds: { x: 0, y: 0, width, height },
    diagnostics: {
      maskCoverage: 0.0861,
      edgePixelCount: 120,
      minDistance: -50,
      maxDistance: 10,
      rasterizeTimeMs: 0,
      edgeMapTimeMs: 0,
      distanceFieldTimeMs: 0,
      buildTimeMs: 0,
    },
  };
}

function fixture(mode: ProjectState["emitterDisplay"]["mode"]): { state: ProjectState; context: RenderContext } {
  const state: ProjectState = {
    ...baseState,
    artboard: { width: 100, height: 100 },
    text: "O",
    fontSize: 540,
    renderer: "sdf-halftone",
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 50,
      customY: 50,
      radius: 60,
      falloff: "smoothstep",
    },
    emitterDisplay: {
      ...baseState.emitterDisplay,
      mode,
      distortionStrength: 0,
      distortionRadius: 20,
      noiseScale: 10,
      gridSize: 0,
      gridAmount: 0,
      interiorSuppression: 100,
      edgeBias: 100,
      orbitAmount: 100,
      divergence: 0,
    },
  };
  return {
    state,
    context: {
      timeMs: 0,
      frame: 0,
      substrateData: squareSubstrate(),
      viewport: { x: 0, y: 0, width: 100, height: 100, centerX: 50, centerY: 50 },
    },
  };
}

describe("emitter display response", () => {
  it("suppresses glyph interiors while retaining the exterior shell", () => {
    const { state, context } = fixture("exclude");
    const sampler = createEmitterDisplaySampler(state, context);
    const interior = sampler.sample(50, 50, 1);
    const exterior = sampler.sample(36, 50, 2);

    expect(sampler.active).toBe(true);
    expect(sampler.exterior).toBe(true);
    expect(interior).toMatchObject({ keep: false, insideGlyph: true, interiorRejected: true });
    expect(exterior.keep).toBe(true);
    expect(exterior.insideGlyph).toBe(false);
    expect(sampler.probe(36, 50).influence).toBeGreaterThan(sampler.probe(10, 50).influence);
  });

  it("adds deterministic tangential orbit motion without settling inside", () => {
    const { state, context } = fixture("orbit");
    const sampler = createEmitterDisplaySampler(state, context);
    const first = sampler.sample(36, 50, 7);
    const second = sampler.sample(36, 50, 7);
    const exclusion = createEmitterDisplaySampler({
      ...state,
      emitterDisplay: { ...state.emitterDisplay, mode: "exclude" },
    }, context).sample(36, 50, 7);

    expect(second).toEqual(first);
    expect(first.keep).toBe(true);
    expect(first.insideGlyph).toBe(false);
    expect(first.point.y).not.toBeCloseTo(exclusion.point.y);
    expect(first.displacement).toBeGreaterThan(0);
  });

  it("quantizes and micro-displaces points from stable coordinate noise", () => {
    const { state, context } = fixture("distort");
    const sampler = createEmitterDisplaySampler({
      ...state,
      emitterDisplay: {
        ...state.emitterDisplay,
        distortionStrength: 100,
        gridSize: 6,
        gridAmount: 100,
      },
    }, context);
    const first = sampler.sample(42.4, 34.7, 11);
    const second = sampler.sample(42.4, 34.7, 11);

    expect(second).toEqual(first);
    expect(first.quantized).toBe(true);
    expect(first.displacement).toBeGreaterThan(0);
  });
});
