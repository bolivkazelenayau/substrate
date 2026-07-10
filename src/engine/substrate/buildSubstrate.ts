import { VIEWPORT } from "../constants";
import { buildSignedDistanceField } from "./distanceField";
import { buildEdgeMap } from "./edgeMap";
import { rasterizeGlyphs, type RasterSurfaceFactory } from "./rasterizeGlyphs";
import type { SubstrateBuildInput, SubstrateBuildResult, SubstrateData } from "./types";
import { measure } from "../performance";
import { DEFAULT_ARTBOARD } from "../artboard";
import { planSubstrateRaster } from "../safetyBudget";

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
  const viewport = input.viewport ?? DEFAULT_ARTBOARD;
  const domain = input.domainBounds ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
  const plan = input.rasterPlan ?? planSubstrateRaster({ requestedWidth: input.resolution.width, requestedHeight: input.resolution.height });
  const resolution = { width: plan.width, height: plan.height };
  const count = plan.cells;
  const scaleX = domain.width / resolution.width;
  const scaleY = domain.height / resolution.height;
  const mask = { ...resolution, data: new Float32Array(count) };
  const edge = { ...resolution, data: new Float32Array(count) };
  const distance = buildSignedDistanceField(mask, edge, scaleX, scaleY);
  let minDistance = Number.POSITIVE_INFINITY;
  let maxDistance = Number.NEGATIVE_INFINITY;
  for (const value of distance.data) {
    minDistance = Math.min(minDistance, value);
    maxDistance = Math.max(maxDistance, value);
  }
  return {
    ...resolution,
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    scaleX,
    scaleY,
    sourceText: input.sourceText,
    substrateType: "empty",
    mask,
    edge,
    distance,
    bounds: input.bounds,
    domainBounds: domain,
    diagnostics: {
      maskCoverage: 0,
      edgePixelCount: 0,
      minDistance,
      maxDistance,
      rasterizeTimeMs: 0,
      edgeMapTimeMs: 0,
      distanceFieldTimeMs: buildTimeMs,
      buildTimeMs,
      rasterPlan: plan,
    },
  };
}

export function buildSubstrate(input: SubstrateBuildInput, factory?: RasterSurfaceFactory): SubstrateBuildResult {
  const started = now();
  const rasterPlan = input.rasterPlan ?? planSubstrateRaster({ requestedWidth: input.resolution.width, requestedHeight: input.resolution.height });
  const safeInput: SubstrateBuildInput = { ...input, resolution: { width: rasterPlan.width, height: rasterPlan.height }, rasterPlan };
  try {
    const viewport = safeInput.viewport ?? DEFAULT_ARTBOARD;
    const rasterTiming = measure(() => rasterizeGlyphs(safeInput, factory));
    const raster = rasterTiming.value;
    const edgeTiming = measure(() => buildEdgeMap(raster.mask));
    const edge = edgeTiming.value;
    const domain = safeInput.domainBounds ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const scaleX = domain.width / safeInput.resolution.width;
    const scaleY = domain.height / safeInput.resolution.height;
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
        ...safeInput.resolution,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
        scaleX,
        scaleY,
        sourceText: input.sourceText,
        substrateType: raster.substrateType,
        mask: raster.mask,
        edge,
        distance,
        bounds: input.bounds,
        domainBounds: domain,
        diagnostics: {
          maskCoverage: coverageTotal / raster.mask.data.length,
          edgePixelCount,
          minDistance,
          maxDistance,
          rasterizeTimeMs: rasterTiming.durationMs,
          edgeMapTimeMs: edgeTiming.durationMs,
          distanceFieldTimeMs: distanceTiming.durationMs,
          buildTimeMs: now() - started,
          rasterPlan,
        },
      },
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown substrate build failure.";
    return { data: emptySubstrate(safeInput, now() - started), error: message };
  }
}
