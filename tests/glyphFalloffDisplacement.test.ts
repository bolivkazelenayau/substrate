import { describe, expect, it } from "vitest";
import {
  createGlyphFalloffDisplacementSampler,
  glyphFalloffDisplacementGeometryKey,
  glyphFalloffDisplacementStateKey,
} from "../src/engine/field/glyphFalloffDisplacement";
import type { CircleMark } from "../src/engine/geometry";
import { baseState } from "../src/engine/presets";
import { buildSignedDistanceField } from "../src/engine/substrate/distanceField";
import { buildEdgeMap } from "../src/engine/substrate/edgeMap";
import type { RasterMask, SubstrateData } from "../src/engine/substrate/types";
import type { ProjectState, RenderContext } from "../src/types";

function substrateFixture(): SubstrateData {
  const width = 101;
  const height = 101;
  const mask: RasterMask = { width, height, data: new Float32Array(width * height) };
  for (let y = 25; y <= 75; y += 1) {
    for (let x = 35; x <= 65; x += 1) mask.data[y * width + x] = 1;
  }
  const edge = buildEdgeMap(mask);
  const distance = buildSignedDistanceField(mask, edge, 1, 1);
  return {
    width,
    height,
    viewportWidth: 100,
    viewportHeight: 100,
    scaleX: 1,
    scaleY: 1,
    sourceText: "I",
    substrateType: "glyph-paths",
    mask,
    edge,
    distance,
    bounds: { x: 35, y: 25, width: 30, height: 50 },
    domainBounds: { x: 0, y: 0, width: 100, height: 100 },
    diagnostics: {
      maskCoverage: 0.15,
      edgePixelCount: 160,
      minDistance: -50,
      maxDistance: 15,
      rasterizeTimeMs: 0,
      edgeMapTimeMs: 0,
      distanceFieldTimeMs: 0,
      buildTimeMs: 0,
    },
  };
}

function fieldState(
  overrides: Partial<ProjectState["glyphFalloffDisplacement"]> = {},
): ProjectState {
  return {
    ...baseState,
    renderer: "sdf-halftone",
    glyphFalloffDisplacement: {
      ...baseState.glyphFalloffDisplacement,
      mode: "contour-rings",
      strength: 12,
      fieldWidth: 12,
      ringFrequency: 1,
      ringSharpness: 1,
      ...overrides,
    },
  };
}

function context(substrateKey = "fixture-sdf"): RenderContext {
  return {
    timeMs: 0,
    frame: 0,
    substrateData: substrateFixture(),
    substrateKey,
    textGeometryKey: "fixture-typography",
  };
}

const mark = (x: number, y: number): CircleMark => ({
  type: "circle",
  center: { x, y },
  radius: 1.5,
  opacity: 0.8,
});

function signChanges(values: number[]) {
  let changes = 0;
  let previous = Math.sign(values[0]);
  for (const value of values.slice(1)) {
    const next = Math.sign(value);
    if (next !== 0 && previous !== 0 && next !== previous) changes += 1;
    if (next !== 0) previous = next;
  }
  return changes;
}

describe("Glyph Falloff Field", () => {
  it("is an exact no-op when the independent mode is off", () => {
    const state = fieldState({
      mode: "off",
      strength: 96,
      fieldWidth: 320,
      ringFrequency: 16,
      ringSharpness: 8,
    });
    const sampler = createGlyphFalloffDisplacementSampler(state, context());
    const candidate = mark(37, 50);

    expect(sampler.active).toBe(false);
    expect(sampler.sampleCircle(candidate).mark).toBe(candidate);
    expect(glyphFalloffDisplacementStateKey(state)).toBe("glyph-falloff:disabled");
  });

  it("uses the authoritative signed-distance contour and fades outside the field width", () => {
    const sampler = createGlyphFalloffDisplacementSampler(fieldState(), context());
    const near = sampler.sampleCircle(mark(37, 50));
    const far = sampler.sampleCircle(mark(50, 50));

    expect(near.affected).toBe(true);
    expect(near.probe.signedDistance).toBeGreaterThan(0);
    expect(near.probe.outward.x).toBeLessThan(0);
    expect(near.mark.center.x).toBeLessThan(37);
    expect(near.displacement).toBeGreaterThan(0);
    expect(far.affected).toBe(false);
    expect(far.mark).toEqual(mark(50, 50));
    expect(sampler.metrics()).toMatchObject({
      candidateCount: 2,
      affectedCount: 1,
      sdfReadCount: 6,
    });
  });

  it("makes low and high ring frequency spatially distinct along the glyph outline", () => {
    const low = createGlyphFalloffDisplacementSampler(
      fieldState({ ringFrequency: 1 }),
      context(),
    );
    const high = createGlyphFalloffDisplacementSampler(
      fieldState({ ringFrequency: 7 }),
      context(),
    );
    const xs = Array.from({ length: 11 }, (_, index) => 34 - index);
    const lowSignals = xs.map((x) => low.probe(x, 50).ringSignal);
    const highSignals = xs.map((x) => high.probe(x, 50).ringSignal);

    expect(signChanges(highSignals)).toBeGreaterThan(signChanges(lowSignals));
    expect(highSignals).not.toEqual(lowSignals);
  });

  it("binds active geometry identity to field parameters and the authoritative SDF", () => {
    const active = fieldState();
    const higherFrequency = fieldState({ ringFrequency: 8 });
    expect(glyphFalloffDisplacementStateKey(higherFrequency))
      .not.toBe(glyphFalloffDisplacementStateKey(active));
    expect(glyphFalloffDisplacementGeometryKey(active, context("sdf:a")))
      .not.toBe(glyphFalloffDisplacementGeometryKey(active, context("sdf:b")));

    const disabled = fieldState({ mode: "off" });
    expect(glyphFalloffDisplacementGeometryKey(disabled, context("sdf:a")))
      .toBe(glyphFalloffDisplacementGeometryKey({
        ...disabled,
        glyphFalloffDisplacement: { ...disabled.glyphFalloffDisplacement, ringFrequency: 15 },
      }, context("sdf:b")));
  });
});
