import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer, renderers } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleDistance, sampleMask } from "../src/engine/substrate/sampling";
import { getTextLayout } from "../src/engine/textLayout";
import { validateSvgReload } from "../src/engine/svgValidation";
import { createDisplayDislocationSampler } from "../src/engine/displayDislocation";
import type { ProjectState, RenderContext } from "../src/types";
import { canonicalizeSvgForGolden } from "./utils/canonicalSvg";
import type { CircleMark } from "../src/engine/geometry";
import { authoritativeFootprintClearance } from "../src/engine/field/emitterMicroResponse";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;
let state: ProjectState;
let context: RenderContext;

beforeAll(async () => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
  state = {
    ...baseState,
    text: "DOTS",
    font: loaded.metadata,
    renderer: "sdf-halftone",
    density: 56,
    amplitude: 24,
    turbulence: 38,
    edgeInfluence: 54,
    maxNodes: 500,
  };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrate = buildSubstrate({
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 192, height: 115 },
    bounds: textGeometry.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData: substrate };
});

describe("SDF Halftone renderer", () => {
  it("is registered with the renderer registry", () => {
    expect(renderers["sdf-halftone"]).toBeDefined();
    expect(getRenderer("sdf-halftone").label).toBe("SDF Halftone");
  });

  it("produces finite circle geometry inside a visible glyph substrate", () => {
    const group = getRenderer("sdf-halftone").generateGeometry(state, context);
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(group.geometries.every((geometry) => geometry.type === "circle")).toBe(true);
    expect(group.geometries.every((geometry) => {
      if (geometry.type !== "circle") return false;
      return [geometry.center.x, geometry.center.y, geometry.radius, geometry.opacity].every(Number.isFinite)
        && geometry.radius > 0
        && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) >= 0.5;
    })).toBe(true);
    expect(group.diagnostics).toMatchObject({ substrateAvailable: true, fallback: false });
  });

  it("is deterministic for identical state and context, while seed changes placement", () => {
    const renderer = getRenderer("sdf-halftone");
    const first = renderer.generateGeometry(state, context);
    expect(renderer.generateGeometry(state, context)).toEqual(first);
    expect(renderer.generateGeometry({ ...state, seed: state.seed + 1 }, context).geometries).not.toEqual(first.geometries);
  });

  it("responds to density through its candidate or accepted-dot count", () => {
    const renderer = getRenderer("sdf-halftone");
    const low = renderer.generateGeometry({ ...state, density: 18 }, context);
    const high = renderer.generateGeometry({ ...state, density: 76 }, context);
    expect(high.diagnostics?.requestedDots).toBeGreaterThan(low.diagnostics?.requestedDots ?? 0);
    expect(high.geometries.length).not.toBe(low.geometries.length);
  });

  it("uses amplitude to change average dot radius", () => {
    const renderer = getRenderer("sdf-halftone");
    const small = renderer.generateGeometry({ ...state, amplitude: 4 }, context);
    const large = renderer.generateGeometry({ ...state, amplitude: 40 }, context);
    expect(large.diagnostics?.averageRadius).toBeGreaterThan(small.diagnostics?.averageRadius ?? 0);
  });

  it("reacts to the shared glyph field while keeping displaced dots in the mask", () => {
    const renderer = getRenderer("sdf-halftone");
    const enabled = { ...state, emitter: { ...state.emitter, enabled: true }, glyphFieldMode: "strong" as const, glyphFieldInfluence: 100, glyphFieldDisplacement: 24, glyphFieldDensity: 80, glyphFieldRadius: 80 };
    const off = renderer.generateGeometry({ ...enabled, glyphFieldMode: "off" }, context);
    const modulated = renderer.generateGeometry(enabled, context);
    expect(modulated.geometries).not.toEqual(off.geometries);
    expect(modulated.diagnostics).toMatchObject({ glyphFieldEnabled: true, glyphFieldMode: "strong" });
    expect(modulated.geometries.every((geometry) => geometry.type === "circle" && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) >= 0.5)).toBe(true);
  });

  it("preserves single-mode modulation and responds to multiple shared-field sources", () => {
    const renderer = getRenderer("sdf-halftone");
    const enabled = {
      ...state,
      emitter: { ...state.emitter, enabled: true },
      glyphFieldMode: "strong" as const,
      glyphFieldInfluence: 100,
      glyphFieldDisplacement: 24,
      glyphFieldDensity: 80,
      glyphFieldRadius: 80,
    };
    const legacy = renderer.generateGeometry(enabled, context);
    expect(renderer.generateGeometry({
      ...enabled,
      emitterMode: "single",
      emitters: [{ ...enabled.emitters[0], phaseOffset: 2, weight: 0.2 }],
    }, context).geometries).toEqual(legacy.geometries);
    const first = { ...enabled.emitters[0], id: "first", glyphId: "auto-first" };
    const one = renderer.generateGeometry({ ...enabled, emitterMode: "multiple", emitters: [first] }, context);
    const multipleState = {
      ...enabled,
      emitterMode: "multiple" as const,
      emitters: [first, { ...first, id: "last", glyphId: "auto-last", phaseOffset: Math.PI / 2 }],
    };
    const multiple = renderer.generateGeometry(multipleState, context);
    expect(multiple.geometries).not.toEqual(one.geometries);
    expect(renderer.generateGeometry(multipleState, context).geometries).toEqual(multiple.geometries);
  });

  it("uses ring sharpness and band width to structure field-reactive density", () => {
    const renderer = getRenderer("sdf-halftone");
    const enabled = {
      ...state,
      emitter: { ...state.emitter, enabled: true },
      glyphFieldMode: "strong" as const,
      glyphFieldInfluence: 100,
      glyphFieldDensity: 100,
    };
    const broad = renderer.generateGeometry({ ...enabled, ringSharpness: 0.7, bandWidth: 0.7 }, context);
    const sharp = renderer.generateGeometry({ ...enabled, ringSharpness: 6, bandWidth: 0.12 }, context);
    expect(sharp.geometries).not.toEqual(broad.geometries);
    expect(sharp.diagnostics?.averageRingStrength).not.toBe(broad.diagnostics?.averageRingStrength);
    expect(sharp.diagnostics?.acceptedCrestDots).not.toBe(broad.diagnostics?.acceptedCrestDots);
  });

  it("enforces maxNodes as a circle budget", () => {
    const group = getRenderer("sdf-halftone").generateGeometry({ ...state, density: 80, maxNodes: 20 }, context);
    expect(group.geometries.length).toBeLessThanOrEqual(20);
    expect(group.diagnostics?.maxNodesClipped).toBe(true);
  });

  it("supports deterministic glyph exclusion and orbit shells outside the mask", () => {
    const renderer = getRenderer("sdf-halftone");
    const exclusionState: ProjectState = {
      ...state,
      density: 76,
      maxNodes: 1200,
      emitter: { ...state.emitter, enabled: true, radius: 520 },
      emitterDisplay: {
        ...state.emitterDisplay,
        mode: "exclude",
        distortionStrength: 52,
        distortionRadius: 220,
        interiorSuppression: 100,
      },
    };
    const excluded = renderer.generateGeometry(exclusionState, context);
    expect(excluded.geometries.length).toBeGreaterThan(0);
    expect(excluded.geometries.every((geometry) => geometry.type === "circle"
      && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) < 0.5)).toBe(true);
    expect(excluded.diagnostics).toMatchObject({
      emitterDisplayMode: "exclude",
      emitterDisplaySamples: expect.any(Number),
    });
    expect(excluded.diagnostics?.emitterDisplayInteriorRejections).toBeGreaterThan(0);
    expect(renderer.clipPreviewToText?.(exclusionState)).toBe(false);
    const exclusionSvg = createSvg(exclusionState, context, context.textGeometry, excluded);
    const exclusionDocument = new DOMParser().parseFromString(exclusionSvg, "image/svg+xml");
    expect(exclusionDocument.querySelector("#generated-artwork")?.hasAttribute("mask")).toBe(false);
    expect(JSON.parse(exclusionDocument.querySelector("metadata")!.textContent!).project)
      .toMatchObject({ version: 9, emitterDisplay: { mode: "exclude", interiorSuppression: 100 } });

    const orbitState: ProjectState = {
      ...exclusionState,
      emitterDisplay: { ...exclusionState.emitterDisplay, mode: "orbit", orbitAmount: 88, divergence: 28 },
    };
    const orbit = renderer.generateGeometry(orbitState, context);
    expect(orbit.geometries.length).toBeGreaterThan(0);
    expect(renderer.generateGeometry(orbitState, context).geometries).toEqual(orbit.geometries);
    expect(orbit.geometries).not.toEqual(excluded.geometries);
    expect(orbit.geometries.every((geometry) => geometry.type === "circle"
      && sampleMask(context.substrateData!, geometry.center.x, geometry.center.y) < 0.5)).toBe(true);
  });

  it("returns the exact legacy regular Halftone geometry when Display Dislocation is disabled", () => {
    const legacyRegular: ProjectState = {
      ...state,
      maxNodes: 5000,
      emitter: { ...state.emitter, enabled: true, sourceMode: "custom", customX: 600, customY: 360 },
      emitterDisplay: { ...state.emitterDisplay, mode: "field" },
      dotGrid: { ...state.dotGrid, enabled: true, spacing: 10, radius: 1.9 },
      displayDislocation: { ...state.displayDislocation, enabled: false },
    };
    const configuredButDisabled: ProjectState = {
      ...legacyRegular,
      displayDislocation: {
        ...legacyRegular.displayDislocation,
        enabled: false,
        mode: "blocks",
        responseRadius: 700,
        displacementAmount: 155,
        regionSize: 17,
        gap: 15,
        seed: 999999,
      },
    };
    const renderer = getRenderer("sdf-halftone");
    expect(renderer.generateGeometry(configuredButDisabled, context))
      .toEqual(renderer.generateGeometry(legacyRegular, context));
  });

  it("pull-samples the original mask into coherent local regions on the fixed vector lattice", () => {
    const displayState: ProjectState = {
      ...state,
      maxNodes: 5000,
      emitter: {
        ...state.emitter,
        enabled: true,
        sourceMode: "custom",
        customX: 600,
        customY: 360,
      },
      emitterDisplay: { ...state.emitterDisplay, mode: "field" },
      glyphDisplacement: { ...state.glyphDisplacement, enabled: false },
      dotGrid: {
        ...state.dotGrid,
        enabled: true,
        spacing: 10,
        radius: 1.9,
        threshold: 0.5,
        edgeSoftness: 0,
      },
      displayDislocation: {
        ...state.displayDislocation,
        enabled: true,
        mode: "horizontal-bands",
        responseRadius: 110,
        displacementAmount: 64,
        regionSize: 40,
        gap: 8,
        quantizationSteps: 8,
        direction: 0,
        alternatingOffset: 100,
        radialBias: 0,
        seed: 27183,
      },
    };
    const renderer = getRenderer("sdf-halftone");
    const baseline = renderer.generateGeometry({
      ...displayState,
      displayDislocation: { ...displayState.displayDislocation, enabled: false },
    }, context);
    const dislocated = renderer.generateGeometry(displayState, context);
    const sampler = createDisplayDislocationSampler(displayState, context);
    const circles = dislocated.geometries.filter((geometry) => geometry.type === "circle");

    expect(dislocated.geometries).not.toEqual(baseline.geometries);
    expect(circles).toHaveLength(dislocated.geometries.length);
    expect(circles.every((circle) => (
      Math.abs(circle.center.x / displayState.dotGrid.spacing - Math.round(circle.center.x / displayState.dotGrid.spacing)) < 1e-9
      && Math.abs(circle.center.y / displayState.dotGrid.spacing - Math.round(circle.center.y / displayState.dotGrid.spacing)) < 1e-9
    ))).toBe(true);
    expect(circles.every((circle) => {
      const inverse = sampler.sample(circle.center.x, circle.center.y);
      return !inverse.gapRejected
        && sampleMask(context.substrateData!, inverse.source.x, inverse.source.y) >= displayState.dotGrid.threshold;
    })).toBe(true);
    expect(circles.some((circle) => {
      const inverse = sampler.sample(circle.center.x, circle.center.y);
      return inverse.affected
        && sampleMask(context.substrateData!, circle.center.x, circle.center.y) < displayState.dotGrid.threshold
        && sampleMask(context.substrateData!, inverse.source.x, inverse.source.y) >= displayState.dotGrid.threshold;
    })).toBe(true);

    const baselineOutside = baseline.geometries.filter((geometry): geometry is CircleMark => geometry.type === "circle"
      && Math.hypot(geometry.center.x - 600, geometry.center.y - 360) > displayState.displayDislocation.responseRadius);
    const activeByCenter = new Map(circles.map((circle) => [`${circle.center.x},${circle.center.y}`, circle]));
    expect(baselineOutside.length).toBeGreaterThan(0);
    for (const circle of baselineOutside) {
      expect(activeByCenter.get(`${circle.center.x},${circle.center.y}`)).toEqual(circle);
    }

    expect(dislocated.diagnostics).toMatchObject({
      dotGridRegular: true,
      dotGridSpacing: 10,
      displayDislocationMode: "horizontal-bands",
      displayDislocationSourceDomain: "original-glyph",
      displayDislocationClippingState: "none",
    });
    expect(dislocated.diagnostics?.displayDislocationRegionCount).toBeGreaterThanOrEqual(2);
    expect(dislocated.diagnostics?.displayDislocationGapRejections).toBeGreaterThan(0);
    expect(dislocated.diagnostics?.displayDislocationAffectedCandidates).toBeGreaterThan(0);
    expect(dislocated.diagnostics?.displayDislocationAcceptedCandidates).toBeGreaterThan(0);
    expect(dislocated.diagnostics?.displayDislocationBuildTimeMs).toBeGreaterThanOrEqual(0);
    expect(renderer.clipPreviewToText?.(displayState)).toBe(false);

    const suppliedGeometrySvg = createSvg(displayState, context, context.textGeometry, dislocated);
    const regeneratedSvg = createSvg(displayState, context, context.textGeometry);
    expect(canonicalizeSvgForGolden(regeneratedSvg)).toBe(canonicalizeSvgForGolden(suppliedGeometrySvg));
    const document = new DOMParser().parseFromString(suppliedGeometrySvg, "image/svg+xml");
    expect(document.querySelectorAll("#generated-artwork circle")).toHaveLength(dislocated.geometries.length);
    expect(document.querySelectorAll("#generated-artwork path")).toHaveLength(0);
    expect(document.querySelector("#generated-artwork")?.hasAttribute("mask")).toBe(false);
  });

  it("composes fine microdetail after coherent Display Dislocation and disables exactly", () => {
    const displayState: ProjectState = {
      ...state,
      maxNodes: 5000,
      emitter: {
        ...state.emitter,
        enabled: true,
        sourceMode: "custom",
        customX: 600,
        customY: 360,
      },
      emitterDisplay: { ...state.emitterDisplay, mode: "field" },
      dotGrid: { ...state.dotGrid, enabled: true, spacing: 10, radius: 1.9, threshold: 0.5, edgeSoftness: 0 },
      displayDislocation: {
        ...state.displayDislocation,
        enabled: true,
        mode: "horizontal-bands",
        responseRadius: 150,
        displacementAmount: 54,
        regionSize: 40,
        gap: 0,
        quantizationSteps: 6,
        alternatingOffset: 100,
      },
    };
    const renderer = getRenderer("sdf-halftone");
    const baseline = renderer.generateGeometry(displayState, context);
    const configuredButDisabled = renderer.generateGeometry({
      ...displayState,
      emitterMicroResponse: {
        ...displayState.emitterMicroResponse,
        enabled: false,
        occupancy: "legacy",
        positionDetail: 99,
        densityBreakup: 99,
        detailScale: 4,
      },
    }, context);
    const detailedState: ProjectState = {
      ...displayState,
      emitterMicroResponse: {
        ...displayState.emitterMicroResponse,
        enabled: true,
        positionDetail: 82,
        densityBreakup: 0,
        detailScale: 9,
        responseRadius: 60,
        maxDisplacement: 7,
        occupancy: "legacy",
      },
    };
    const detailed = renderer.generateGeometry(detailedState, context);

    expect(configuredButDisabled.geometries).toEqual(baseline.geometries);
    expect(configuredButDisabled.diagnostics?.displayDislocationAcceptedCandidates)
      .toBe(baseline.diagnostics?.displayDislocationAcceptedCandidates);
    expect(detailed.geometries).not.toEqual(baseline.geometries);
    expect(detailed.diagnostics).toMatchObject({
      displayDislocationMode: "horizontal-bands",
      displayDislocationRegionCount: baseline.diagnostics?.displayDislocationRegionCount,
      displayDislocationSourceDomain: "original-glyph",
      emitterMicroResponseMode: "micro/legacy",
      dotGridRegular: false,
    });
    expect(detailed.diagnostics?.emitterMicroAdjustedCount).toBeGreaterThan(0);
    expect(detailed.diagnostics?.emitterMicroRejectedCount).toBe(0);

    const occupiedState: ProjectState = {
      ...detailedState,
      emitterMicroResponse: {
        ...detailedState.emitterMicroResponse,
        responseRadius: 190,
        occupancy: "disperse-exterior",
        exteriorPush: 64,
        tangentialFlow: 38,
        divergence: 20,
        exteriorShell: 44,
      },
    };
    const occupied = renderer.generateGeometry(occupiedState, context);
    const occupiedCircles = occupied.geometries.filter(
      (geometry): geometry is CircleMark => geometry.type === "circle",
    );
    expect(occupied.diagnostics).toMatchObject({
      displayDislocationMode: "horizontal-bands",
      displayDislocationSourceDomain: "original-glyph",
      emitterMicroResponseMode: "micro/disperse-exterior",
      emitterMicroFinalFootprintViolations: 0,
    });
    expect(occupied.diagnostics?.emitterMicroRelocatedCount).toBeGreaterThan(0);
    expect(occupiedCircles.length).toBeGreaterThan(0);
    expect(occupiedCircles.every((circle) => (
      authoritativeFootprintClearance(context.substrateData!, circle).valid
    ))).toBe(true);

    const detailedByCenter = new Set(detailed.geometries
      .filter((geometry): geometry is CircleMark => geometry.type === "circle")
      .map((circle) => `${circle.center.x},${circle.center.y},${circle.radius},${circle.opacity}`));
    const baselineOutside = baseline.geometries.filter((geometry): geometry is CircleMark => geometry.type === "circle"
      && Math.hypot(geometry.center.x - 600, geometry.center.y - 360) >= detailedState.emitterMicroResponse.responseRadius);
    expect(baselineOutside.length).toBeGreaterThan(0);
    expect(baselineOutside.every((circle) => detailedByCenter.has(
      `${circle.center.x},${circle.center.y},${circle.radius},${circle.opacity}`,
    ))).toBe(true);

    expect(renderer.generateGeometry({
      ...detailedState,
      emitterMicroResponse: { ...detailedState.emitterMicroResponse, enabled: false },
    }, context).geometries).toEqual(baseline.geometries);
  });

  it("relocates full footprints into the local exterior instead of only deleting them", () => {
    const baseResponseState: ProjectState = {
      ...state,
      maxNodes: 5000,
      emitter: {
        ...state.emitter,
        enabled: true,
        sourceMode: "custom",
        customX: 600,
        customY: 360,
      },
      emitterDisplay: { ...state.emitterDisplay, mode: "field" },
      dotGrid: { ...state.dotGrid, enabled: true, spacing: 8, radius: 2.4, threshold: 0.5, edgeSoftness: 0 },
      displayDislocation: { ...state.displayDislocation, enabled: false },
      emitterMicroResponse: {
        ...state.emitterMicroResponse,
        enabled: false,
        responseRadius: 190,
        occupancy: "exclude-interior",
        exteriorShell: 34,
      },
    };
    const renderer = getRenderer("sdf-halftone");
    const excluded = renderer.generateGeometry(baseResponseState, context);
    const dispersedState: ProjectState = {
      ...baseResponseState,
      emitterMicroResponse: {
        ...baseResponseState.emitterMicroResponse,
        occupancy: "disperse-exterior",
        exteriorPush: 48,
        tangentialFlow: 34,
        divergence: 18,
      },
    };
    const dispersed = renderer.generateGeometry(dispersedState, context);
    const finalCircles = dispersed.geometries.filter((geometry): geometry is CircleMark => geometry.type === "circle");

    expect(excluded.diagnostics?.emitterMicroFootprintInvalidCount).toBeGreaterThan(0);
    expect(excluded.diagnostics?.emitterMicroRelocatedCount).toBe(0);
    expect(dispersed.diagnostics?.emitterMicroInteriorCount).toBeGreaterThan(0);
    expect(dispersed.diagnostics?.emitterMicroRelocatedCount).toBeGreaterThan(0);
    expect(dispersed.diagnostics?.emitterMicroFinalExteriorCount).toBeGreaterThan(0);
    expect(dispersed.diagnostics?.emitterMicroFinalFootprintViolations).toBe(0);
    expect(dispersed.geometries.length).toBeGreaterThan(excluded.geometries.length);
    expect(finalCircles.length).toBeGreaterThan(0);
    expect(finalCircles.every((circle) => authoritativeFootprintClearance(context.substrateData!, circle).valid)).toBe(true);
    expect(renderer.clipPreviewToText?.(dispersedState)).toBe(false);

    const svg = createSvg(dispersedState, context, context.textGeometry, dispersed);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    expect(document.querySelectorAll("#generated-artwork circle")).toHaveLength(dispersed.geometries.length);
    expect(document.querySelectorAll("#generated-artwork image, #generated-artwork canvas")).toHaveLength(0);
  });

  it("returns a clear empty fallback without substrate data", () => {
    const group = getRenderer("sdf-halftone").generateGeometry(state, { timeMs: 0, frame: 0 });
    expect(group.geometries).toEqual([]);
    expect(group.diagnostics).toMatchObject({
      substrateAvailable: false,
      fallback: true,
      acceptedDots: 0,
    });
  });

  it("serializes vector circles and survives XML reload validation", () => {
    const svg = createSvg(state, context, context.textGeometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelectorAll("#generated-artwork circle").length).toBeGreaterThan(0);
    const metadata = JSON.parse(validation.document!.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({ renderer: "SDF Halftone", rendererId: "sdf-halftone", substrateType: "glyph-paths" });
  });
});
