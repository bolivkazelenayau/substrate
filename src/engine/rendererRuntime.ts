import type { GeometryGroup } from "./geometry";
import { geometryNodeCost } from "./geometry";
import { getRenderer } from "./renderers";
import type { ProjectState, RenderContext } from "../types";
import { measure } from "./performance";

const substrateIds = new WeakMap<object, number>();
let nextSubstrateId = 1;
const geometryCache = new Map<string, GeometryGroup>();
const geometryTimings = new WeakMap<GeometryGroup, { durationMs: number; cached: boolean }>();
const CACHE_LIMIT = 24;

function substrateKey(context: RenderContext) {
  const substrate = context.substrateData;
  if (!substrate) return "none";
  let id = substrateIds.get(substrate);
  if (!id) {
    id = nextSubstrateId++;
    substrateIds.set(substrate, id);
  }
  return `${id}:${substrate.width}x${substrate.height}:${substrate.substrateType}`;
}

function cacheKey(state: ProjectState, context: RenderContext) {
  const renderer = getRenderer(state.renderer);
  return JSON.stringify({
    renderer: state.renderer,
    text: state.text,
    font: state.font?.fileName ?? "native",
    fontSize: state.fontSize,
    tracking: state.tracking,
    density: state.density,
    amplitude: state.amplitude,
    frequency: state.frequency,
    turbulence: state.turbulence,
    edgeInfluence: state.edgeInfluence,
    maxNodes: state.maxNodes,
    seed: state.seed,
    substrateQuality: state.substrateQuality,
    emitter: state.emitter,
    waveContourMode: state.waveContourMode,
    waveDotSpacing: state.waveDotSpacing,
    waveDotRadius: state.waveDotRadius,
    diffuserDomain: state.diffuserDomain,
    diffuserComposition: state.diffuserComposition,
    diffuserDotRadius: state.diffuserDotRadius,
    diffuserRingContrast: state.diffuserRingContrast,
    diffuserHaloPadding: state.diffuserHaloPadding,
    substrate: renderer.usesSubstrate ? substrateKey(context) : "unused",
    timeMs: renderer.usesTime ? context.timeMs : 0,
    frame: renderer.usesTime ? context.frame : 0,
  });
}

export function generateRendererGeometry(state: ProjectState, context: RenderContext): GeometryGroup {
  const renderer = getRenderer(state.renderer);
  if (renderer.usesTime) {
    const result = measure(() => renderer.generateGeometry(state, context));
    geometryTimings.set(result.value, { durationMs: result.durationMs, cached: false });
    return result.value;
  }
  const key = cacheKey(state, context);
  const cached = geometryCache.get(key);
  if (cached) {
    const timing = geometryTimings.get(cached);
    geometryTimings.set(cached, { durationMs: timing?.durationMs ?? 0, cached: true });
    return cached;
  }
  const result = measure(() => renderer.generateGeometry(state, context));
  const geometry = result.value;
  geometryTimings.set(geometry, { durationMs: result.durationMs, cached: false });
  geometryCache.set(key, geometry);
  if (geometryCache.size > CACHE_LIMIT) geometryCache.delete(geometryCache.keys().next().value!);
  return geometry;
}

export function getRendererTiming(group: GeometryGroup) {
  return geometryTimings.get(group) ?? { durationMs: 0, cached: false };
}

export function clearRendererGeometryCache() {
  geometryCache.clear();
}

export interface GeometrySummary {
  geometryType: string;
  elementCount: number;
  pointCount: number;
  estimatedSvgNodes: number;
  estimatedByteSize: number;
  maxNodesClipped: boolean;
}

export function summarizeGeometry(group: GeometryGroup): GeometrySummary {
  const types = new Set(group.geometries.map((geometry) => geometry.type));
  const pointCount = group.geometries.reduce((total, geometry) => {
    if (geometry.type === "polyline") return total + geometry.points.length;
    if (geometry.type === "line") return total + 2;
    return total + 1;
  }, 0);
  const estimatedSvgNodes = geometryNodeCost(group);
  return {
    geometryType: types.size === 0 ? "empty" : types.size === 1 ? [...types][0] : "mixed",
    elementCount: group.geometries.length,
    pointCount,
    estimatedSvgNodes,
    estimatedByteSize: 900 + group.geometries.length * 62 + pointCount * 18,
    maxNodesClipped: Boolean(group.diagnostics?.maxNodesClipped),
  };
}
