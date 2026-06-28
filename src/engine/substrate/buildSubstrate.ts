import { VIEWPORT } from "../constants";
import { buildSignedDistanceField } from "./distanceField";
import { buildEdgeMap } from "./edgeMap";
import { rasterizeGlyphs, type RasterSurfaceFactory } from "./rasterizeGlyphs";
import type { SubstrateBuildInput, SubstrateBuildResult, SubstrateData } from "./types";
import { measure } from "../performance";

export const DEFAULT_SUBSTRATE_RESOLUTION = {
  width: 384,
  height: Math.round(384 * VIEWPORT.height / VIEWPORT.width),
} as const;

export const SUBSTRATE_RESOLUTIONS = {
  low: { width: 256, height: Math.round(256 * VIEWPORT.height / VIEWPORT.width) },
  medium: DEFAULT_SUBSTRATE_RESOLUTION,
  high: { width: 512, height: Math.round(512 * VIEWPORT.height / VIEWPORT.width) },
  ultra: { width: 768, height: Math.round(768 * VIEWPORT.height / VIEWPORT.width) },
} as const;

const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

function emptySubstrate(input: SubstrateBuildInput, buildTimeMs: number): SubstrateData {
  const count = input.resolution.width * input.resolution.height;
  const scaleX = VIEWPORT.width / input.resolution.width;
  const scaleY = VIEWPORT.height / input.resolution.height;
  const mask = { ...input.resolution, data: new Float32Array(count) };
  const edge = { ...input.resolution, data: new Float32Array(count) };
  const distance = buildSignedDistanceField(mask, edge, scaleX, scaleY);
  let minDistance = Number.POSITIVE_INFINITY;
  let maxDistance = Number.NEGATIVE_INFINITY;
  for (const value of distance.data) {
    minDistance = Math.min(minDistance, value);
    maxDistance = Math.max(maxDistance, value);
  }
  return {
    ...input.resolution,
    viewportWidth: VIEWPORT.width,
    viewportHeight: VIEWPORT.height,
    scaleX,
    scaleY,
    sourceText: input.sourceText,
    substrateType: "empty",
    mask,
    edge,
    distance,
    bounds: input.bounds,
    diagnostics: {
      maskCoverage: 0,
      edgePixelCount: 0,
      minDistance,
      maxDistance,
      rasterizeTimeMs: 0,
      edgeMapTimeMs: 0,
      distanceFieldTimeMs: buildTimeMs,
      buildTimeMs,
    },
  };
}

export function buildSubstrate(input: SubstrateBuildInput, factory?: RasterSurfaceFactory): SubstrateBuildResult {
  const started = now();
  try {
    const rasterTiming = measure(() => rasterizeGlyphs(input, factory));
    const raster = rasterTiming.value;
    const edgeTiming = measure(() => buildEdgeMap(raster.mask));
    const edge = edgeTiming.value;
    const scaleX = VIEWPORT.width / input.resolution.width;
    const scaleY = VIEWPORT.height / input.resolution.height;
    const distanceTiming = measure(() => buildSignedDistanceField(raster.mask, edge, scaleX, scaleY));
    const distance = distanceTiming.value;
    let coverageTotal = 0;
    let edgePixelCount = 0;
    let minDistance = Number.POSITIVE_INFINITY;
    let maxDistance = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < raster.mask.data.length; index += 1) {
      coverageTotal += raster.mask.data[index];
      if (edge.data[index] > 0) edgePixelCount += 1;
      minDistance = Math.min(minDistance, distance.data[index]);
      maxDistance = Math.max(maxDistance, distance.data[index]);
    }
    return {
      data: {
        ...input.resolution,
        viewportWidth: VIEWPORT.width,
        viewportHeight: VIEWPORT.height,
        scaleX,
        scaleY,
        sourceText: input.sourceText,
        substrateType: raster.substrateType,
        mask: raster.mask,
        edge,
        distance,
        bounds: input.bounds,
        diagnostics: {
          maskCoverage: coverageTotal / raster.mask.data.length,
          edgePixelCount,
          minDistance,
          maxDistance,
          rasterizeTimeMs: rasterTiming.durationMs,
          edgeMapTimeMs: edgeTiming.durationMs,
          distanceFieldTimeMs: distanceTiming.durationMs,
          buildTimeMs: now() - started,
        },
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown substrate build failure.";
    return { data: emptySubstrate(input, now() - started), error: message };
  }
}
