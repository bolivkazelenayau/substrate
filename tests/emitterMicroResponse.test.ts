import { describe, expect, it } from "vitest";
import {
  EMITTER_MICRO_CORRECTION_STEPS,
  authoritativeFootprintClearance,
  createEmitterMicroResponseSampler,
  emitterMicroResponseGeometryKey,
  emitterMicroResponseStateKey,
  getSealedGlyphOccupancySubstrate,
} from "../src/engine/field/emitterMicroResponse";
import { getGlyphEmitterMetadata } from "../src/engine/field/glyphEmitters";
import type { CircleMark } from "../src/engine/geometry";
import { baseState } from "../src/engine/presets";
import { buildSignedDistanceField } from "../src/engine/substrate/distanceField";
import { buildEdgeMap } from "../src/engine/substrate/edgeMap";
import { sampleDistance } from "../src/engine/substrate/sampling";
import type { RasterMask, SubstrateData } from "../src/engine/substrate/types";
import type { ProjectState, RenderContext } from "../src/types";

function substrateFixture({
  type = "glyph-paths",
  origin = { x: 0, y: 0 },
  counter = false,
}: {
  type?: SubstrateData["substrateType"];
  origin?: { x: number; y: number };
  counter?: boolean;
} = {}): SubstrateData {
  const width = 101;
  const height = 101;
  const mask: RasterMask = { width, height, data: new Float32Array(width * height) };
  for (let y = 25; y <= 75; y += 1) {
    for (let x = 35; x <= 65; x += 1) {
      const inCounter = counter && x >= 44 && x <= 56 && y >= 42 && y <= 58;
      if (!inCounter) mask.data[y * width + x] = 1;
    }
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
    sourceText: "O",
    substrateType: type,
    mask,
    edge,
    distance,
    bounds: { x: origin.x + 35, y: origin.y + 25, width: 30, height: 50 },
    domainBounds: { x: origin.x, y: origin.y, width: 100, height: 100 },
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

function constantInsideSubstrate(): SubstrateData {
  const substrate = substrateFixture();
  substrate.mask.data.fill(1);
  substrate.distance.data.fill(50);
  return substrate;
}

function responseState(
  overrides: Partial<ProjectState["emitterMicroResponse"]> = {},
  stateOverrides: Partial<ProjectState> = {},
): ProjectState {
  return {
    ...baseState,
    ...stateOverrides,
    artboard: stateOverrides.artboard ?? { width: 100, height: 100 },
    text: stateOverrides.text ?? "O",
    fontSize: stateOverrides.fontSize ?? 540,
    renderer: stateOverrides.renderer ?? "sdf-halftone",
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 50,
      customY: 50,
      ...stateOverrides.emitter,
    },
    emitterMicroResponse: {
      ...baseState.emitterMicroResponse,
      enabled: true,
      positionDetail: 75,
      densityBreakup: 0,
      detailScale: 10,
      responseRadius: 48,
      maxDisplacement: 12,
      occupancy: "legacy",
      exteriorPush: 45,
      tangentialFlow: 35,
      divergence: 20,
      exteriorShell: 24,
      ...overrides,
    },
  };
}

function context(substrate = substrateFixture(), viewport = { x: 0, y: 0, width: 100, height: 100 }) : RenderContext {
  return {
    timeMs: 0,
    frame: 0,
    substrateData: substrate,
    substrateKey: "fixture-sdf",
    textGeometryKey: "fixture-typography",
    viewport: {
      ...viewport,
      centerX: viewport.x + viewport.width / 2,
      centerY: viewport.y + viewport.height / 2,
    },
  };
}

const mark = (x: number, y: number, radius = 2): CircleMark => ({
  type: "circle",
  center: { x, y },
  radius,
  opacity: 0.8,
});

describe("Emitter Micro Response sampler", () => {
  it("is an exact no-op in disabled legacy state", () => {
    const state = responseState({ enabled: false, occupancy: "legacy" });
    const sampler = createEmitterMicroResponseSampler(state, context());
    const candidate = mark(50, 50);

    expect(sampler.active).toBe(false);
    expect(sampler.sampleCircle(candidate, 1).mark).toBe(candidate);
    expect(emitterMicroResponseStateKey(state)).toBe("emitter-micro:disabled");
  });

  it("keeps position and acceptance exactly unchanged outside the response radius", () => {
    const sampler = createEmitterMicroResponseSampler(responseState({ responseRadius: 20 }), context());
    const candidate = mark(82, 50);
    const sample = sampler.sampleCircle(candidate, 3);

    expect(sample.affected).toBe(false);
    expect(sample.keep).toBe(true);
    expect(sample.mark).toBe(candidate);
    expect(sample.displacement).toBe(0);
  });

  it("enforces occupancy globally after local response motion", () => {
    const sampler = createEmitterMicroResponseSampler(responseState({
      enabled: false,
      occupancy: "exclude-interior",
      responseRadius: 8,
    }), context());
    const interiorOutsideResponse = sampler.sampleCircle(mark(40, 50, 2), 3);
    const exteriorOutsideResponse = sampler.sampleCircle(mark(20, 50, 2), 4);

    expect(interiorOutsideResponse.affected).toBe(false);
    expect(interiorOutsideResponse.keep).toBe(false);
    expect(interiorOutsideResponse.footprintInvalid).toBe(true);
    expect(exteriorOutsideResponse.affected).toBe(false);
    expect(exteriorOutsideResponse.keep).toBe(true);
    expect(exteriorOutsideResponse.finalExterior).toBe(true);
    expect(sampler.metrics()).toMatchObject({
      candidateCount: 2,
      footprintInvalidCount: 1,
      rejectedCount: 1,
      finalExteriorCount: 1,
      finalFootprintViolationCount: 0,
    });
  });

  it("produces deterministic, bounded microstructure and responds to the project seed", () => {
    const state = responseState();
    const candidate = mark(58, 44);
    const first = createEmitterMicroResponseSampler(state, context()).sampleCircle(candidate, 7);
    const repeat = createEmitterMicroResponseSampler(state, context()).sampleCircle(candidate, 999);
    const reseeded = createEmitterMicroResponseSampler({ ...state, seed: state.seed + 1 }, context())
      .sampleCircle(candidate, 7);

    expect(repeat).toEqual(first);
    expect(first.keep).toBe(true);
    expect(first.microAdjusted).toBe(true);
    expect(first.displacement).toBeLessThanOrEqual(state.emitterMicroResponse.maxDisplacement + 1e-8);
    expect(reseeded.mark.center).not.toEqual(first.mark.center);
  });

  it("uses world coordinates rather than viewport, camera, or DPR state", () => {
    const state = responseState();
    const candidate = mark(54, 38);
    const firstContext = context(substrateFixture(), { x: 0, y: 0, width: 100, height: 100 });
    const shiftedContext = context(substrateFixture(), { x: -250, y: 80, width: 900, height: 500 });

    expect(createEmitterMicroResponseSampler(state, firstContext).sampleCircle(candidate, 1))
      .toEqual(createEmitterMicroResponseSampler(state, shiftedContext).sampleCircle(candidate, 1));
  });

  it("blends overlapping emitters continuously instead of selecting a nearest-source seam", () => {
    const state = responseState({ responseRadius: 720 }, {
      text: "OO",
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true, sourceMode: "center" },
      emitters: [
        { ...baseState.emitters[0], id: "left", glyphId: "auto-first", enabled: true },
        { ...baseState.emitters[0], id: "right", glyphId: "auto-last", enabled: true },
      ],
    });
    const glyphs = getGlyphEmitterMetadata(state, null);
    const midpoint = (glyphs[0].center.x + glyphs[1].center.x) / 2;
    const y = glyphs[0].center.y;
    const sampler = createEmitterMicroResponseSampler(state, context());
    const left = sampler.probe(midpoint - 0.01, y);
    const right = sampler.probe(midpoint + 0.01, y);

    expect(left.contributions).toBe(2);
    expect(right.contributions).toBe(2);
    expect(Math.abs(left.influence - right.influence)).toBeLessThan(0.001);
    expect(Math.hypot(left.anchor.x - right.anchor.x, left.anchor.y - right.anchor.y)).toBeLessThan(0.1);
  });

  it("keeps positional disturbance independent from density breakup", () => {
    const candidate = mark(56, 46);
    const positionOnly = createEmitterMicroResponseSampler(
      responseState({ positionDetail: 100, densityBreakup: 0 }),
      context(),
    ).sampleCircle(candidate, 1);
    const densityOnlySampler = createEmitterMicroResponseSampler(
      responseState({ positionDetail: 0, maxDisplacement: 0, densityBreakup: 100 }),
      context(),
    );
    const densitySamples = [42, 46, 50, 54, 58].flatMap((x) =>
      [34, 42, 50, 58, 66].map((y) => densityOnlySampler.sampleCircle(mark(x, y), x * 101 + y)));

    expect(positionOnly.microAdjusted).toBe(true);
    expect(positionOnly.densityRejected).toBe(false);
    expect(densitySamples.some((sample) => sample.densityRejected)).toBe(true);
    expect(densitySamples.every((sample) => sample.mark.center.x % 1 === 0 && sample.mark.center.y % 1 === 0)).toBe(true);
  });

  it("rejects center-outside circles whose complete footprint intersects glyph ink", () => {
    const state = responseState({ enabled: false, occupancy: "exclude-interior" });
    const sampler = createEmitterMicroResponseSampler(state, context());
    const sample = sampler.sampleCircle(mark(32.5, 50, 4), 1);

    expect(sample.insideGlyph).toBe(false);
    expect(sample.footprintInvalid).toBe(true);
    expect(sample.keep).toBe(false);
  });

  it("seals glyph counters into the forbidden silhouette and disperses them past the outer contour", () => {
    const substrate = substrateFixture({ counter: true });
    const solidObstacle = getSealedGlyphOccupancySubstrate(substrate);
    const excluded = createEmitterMicroResponseSampler(
      responseState({ enabled: false, occupancy: "exclude-interior" }),
      context(substrate),
    );
    const exclusion = excluded.sampleCircle(mark(50, 50, 2), 1);
    const dispersed = createEmitterMicroResponseSampler(
      responseState({ enabled: false, occupancy: "disperse-exterior" }),
      context(substrate),
    );
    const dispersion = dispersed.sampleCircle(mark(50, 50, 2), 1);
    expect(sampleDistance(substrate, 50, 50)).toBeLessThan(0);
    expect(sampleDistance(solidObstacle.substrate, 50, 50)).toBeGreaterThan(0);
    expect(substrate.mask.data[50 * substrate.width + 50]).toBe(0);
    expect(solidObstacle.substrate.mask.data[50 * substrate.width + 50]).toBe(1);
    expect(exclusion.keep).toBe(false);
    expect(exclusion.insideGlyph).toBe(true);
    expect(excluded.metrics().sealedCounterPixelCount).toBeGreaterThan(0);
    expect(dispersion.keep).toBe(true);
    expect(dispersion.relocated).toBe(true);
    expect(
      dispersion.mark.center.x < 35 || dispersion.mark.center.x > 65
      || dispersion.mark.center.y < 25 || dispersion.mark.center.y > 75,
    ).toBe(true);
    expect(authoritativeFootprintClearance(substrate, dispersion.mark, dispersed.rasterTolerance).valid).toBe(true);
  });

  it("relocates intersecting candidates into the exterior shell with final clearance", () => {
    const substrate = substrateFixture();
    const state = responseState({ enabled: false, occupancy: "disperse-exterior" });
    const sampler = createEmitterMicroResponseSampler(state, context(substrate));
    const sample = sampler.sampleCircle(mark(60, 50, 2), 2);

    expect(sample.footprintInvalid).toBe(true);
    expect(sample.keep).toBe(true);
    expect(sample.relocated).toBe(true);
    expect(sample.relocationDistance).toBeGreaterThan(0);
    expect(authoritativeFootprintClearance(substrate, sample.mark, sampler.rasterTolerance).valid).toBe(true);
    expect(sampler.metrics()).toMatchObject({
      interiorCount: 1,
      relocatedCount: 1,
      finalExteriorCount: 1,
      finalFootprintViolationCount: 0,
    });
  });

  it("uses a bounded correction budget and rejects safely when the SDF cannot produce an exterior", () => {
    const state = responseState({ enabled: false, occupancy: "disperse-exterior", exteriorShell: 4 });
    const sampler = createEmitterMicroResponseSampler(state, context(constantInsideSubstrate()));
    const sample = sampler.sampleCircle(mark(50, 50, 2), 1);

    expect(sample.keep).toBe(false);
    expect(sample.correctionRejected).toBe(true);
    expect(sample.correctionSteps).toBeLessThanOrEqual(EMITTER_MICRO_CORRECTION_STEPS);
    expect(sample.sdfReads).toBeLessThanOrEqual(1 + EMITTER_MICRO_CORRECTION_STEPS * 5);
  });

  it("honors non-zero authoritative-domain origins", () => {
    const origin = { x: -50, y: 25 };
    const substrate = substrateFixture({ origin });
    const state = responseState(
      { enabled: false, occupancy: "exclude-interior", responseRadius: 60 },
      { emitter: { ...baseState.emitter, enabled: true, sourceMode: "custom", customX: 0, customY: 75 } },
    );
    const sampler = createEmitterMicroResponseSampler(state, context(substrate, { x: -50, y: 25, width: 100, height: 100 }));
    const sample = sampler.sampleCircle(mark(-17.5, 75, 4), 1);

    expect(sample.affected).toBe(true);
    expect(sample.insideGlyph).toBe(false);
    expect(sample.footprintInvalid).toBe(true);
    expect(sample.keep).toBe(false);
  });

  it("uses the same footprint contract for parsed paths and documented native fallback masks", () => {
    const state = responseState({ enabled: false, occupancy: "exclude-interior" });
    const candidate = mark(32.5, 50, 4);
    const parsed = createEmitterMicroResponseSampler(state, context(substrateFixture({ type: "glyph-paths" })))
      .sampleCircle(candidate, 1);
    const native = createEmitterMicroResponseSampler(state, context(substrateFixture({ type: "native-text-fallback" })))
      .sampleCircle(candidate, 1);

    expect(native).toEqual(parsed);
  });

  it("builds focused, mode-aware identity from only consumed settings", () => {
    const disabled = responseState({ enabled: false, occupancy: "legacy" });
    const disabledChanged = responseState({
      enabled: false,
      occupancy: "legacy",
      positionDetail: 99,
      densityBreakup: 99,
      tangentialFlow: 99,
    });
    expect(emitterMicroResponseStateKey(disabledChanged)).toBe(emitterMicroResponseStateKey(disabled));

    const excluded = responseState({ enabled: false, occupancy: "exclude-interior" });
    const excludedExteriorChanged = responseState({
      enabled: false,
      occupancy: "exclude-interior",
      exteriorPush: 99,
      tangentialFlow: 99,
      divergence: 99,
    });
    expect(emitterMicroResponseStateKey(excludedExteriorChanged)).toBe(emitterMicroResponseStateKey(excluded));
    const dispersed = responseState({ enabled: false, occupancy: "disperse-exterior" });
    expect(emitterMicroResponseStateKey({
      ...dispersed,
      emitterMicroResponse: { ...dispersed.emitterMicroResponse, tangentialFlow: 99 },
    })).not.toBe(emitterMicroResponseStateKey(dispersed));

    const firstContext = context();
    const cameraOnly = context(substrateFixture(), { x: -100, y: -100, width: 300, height: 300 });
    expect(emitterMicroResponseGeometryKey(dispersed, cameraOnly))
      .toBe(emitterMicroResponseGeometryKey(dispersed, firstContext));
    expect(emitterMicroResponseGeometryKey(dispersed, { ...firstContext, substrateKey: "other-sdf" }))
      .not.toBe(emitterMicroResponseGeometryKey(dispersed, firstContext));
  });

  it.each([
    ["legacy", false, false],
    ["exclude-interior", true, true],
    ["disperse-exterior", true, true],
  ] as const)("maps the UI occupancy mode %s to one deterministic sampler state", (occupancy, active, exterior) => {
    const state = responseState({ enabled: false, occupancy });
    const sampler = createEmitterMicroResponseSampler(state, context());
    const repeat = createEmitterMicroResponseSampler(state, context());

    expect(sampler.occupancyActive).toBe(active);
    expect(sampler.exterior).toBe(exterior);
    expect(emitterMicroResponseStateKey(state)).toBe(emitterMicroResponseStateKey({ ...state }));
    expect(sampler.sampleCircle(mark(20, 50), 1)).toEqual(repeat.sampleCircle(mark(20, 50), 1));
  });
});
