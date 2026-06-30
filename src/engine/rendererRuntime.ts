import type { GeometryGroup } from "./geometry";
import { geometryNodeCost } from "./geometry";
import { getRenderer } from "./renderers";
import type { GlyphEmitter, ProjectState, RenderContext } from "../types";
import { measure } from "./performance";
import { glyphModulationCacheKey } from "./controlOwnership";
import { resolveGlyphEmitterSources } from "./field/glyphEmitters";

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

// Compact-string cache key built from renderer-relevant scalar state plus substrate
// identity. Avoids JSON.stringify on every request; debug toggles, preview settings,
// and other non-geometry state must not appear here so they cannot invalidate static
// geometry. Uses `|` as a separator and never recurses into objects except for the
// (small, fixed-shape) emitter config, which is rendered as its own packed string.
function emitterKey(e: GlyphEmitter) {
  return [
    e.enabled ? 1 : 0,
    e.glyphId ?? "",
    e.sourceMode,
    e.amplitude,
    e.frequency,
    e.phase,
    e.radius,
    e.falloff,
    e.selfInfluence,
    e.neighborInfluence,
    e.blendMode,
    e.customX,
    e.customY,
  ].join("~");
}

function multiEmitterKey(state: ProjectState, textGeometry: RenderContext["textGeometry"]) {
  const shared = [
    state.emitter.enabled ? 1 : 0,
    state.emitter.sourceMode,
    state.emitter.amplitude,
    state.emitter.frequency,
    state.emitter.phase,
    state.emitter.radius,
    state.emitter.falloff,
    state.emitter.selfInfluence,
    state.emitter.neighborInfluence,
    state.emitter.customX,
    state.emitter.customY,
  ].join("~");
  if (!state.emitter.enabled) return `multiple~${shared}~${state.fieldBlendMode}~inactive`;
  const resolved = resolveGlyphEmitterSources(state, textGeometry ?? null);
  const active = resolved.sources.map((source) => [
    source.glyphId,
    source.weight,
    source.phaseOffset,
    source.radiusMultiplier,
  ].join("~")).join("^");
  return `multiple~${shared}~${state.fieldBlendMode}~${active}`;
}

export function emitterGeometryKey(state: ProjectState, textGeometry: RenderContext["textGeometry"]) {
  return state.emitterMode === "single"
    ? `single~${emitterKey(state.emitter)}`
    : multiEmitterKey(state, textGeometry);
}

export function rendererGeometryStateKey(state: ProjectState) {
  const {
    primaryColor: _primaryColor,
    outlineColor: _outlineColor,
    backgroundColor: _backgroundColor,
    transparentBackground: _transparentBackground,
    ...geometryState
  } = state;
  return JSON.stringify(geometryState);
}

function cacheKey(state: ProjectState, context: RenderContext) {
  const renderer = getRenderer(state.renderer);
  const substrate = renderer.usesSubstrate ? substrateKey(context) : "unused";
  const time = renderer.usesTime ? `${context.timeMs}:${context.frame}` : "0:0";
  // Use `|` between top-level fields and `~` within the emitter, plus separators
  // that ensure adjacent numeric fields cannot collide. Field order matters.
  return [
    state.renderer,
    substrate,
    state.text,
    state.font?.fileName ?? "native",
    state.fontSize,
    state.tracking,
    state.density,
    state.amplitude,
    state.frequency,
    state.turbulence,
    state.edgeInfluence,
    state.maxNodes,
    state.seed,
    state.substrateQuality,
    emitterGeometryKey(state, context.textGeometry),
    state.waveContourMode,
    state.waveDotSpacing,
    state.waveDotRadius,
    state.diffuserDomain,
    state.diffuserComposition,
    state.diffuserDotRadius,
    state.diffuserRingContrast,
    state.ringSharpness,
    state.bandWidth,
    state.diffuserHaloPadding,
    glyphModulationCacheKey(state),
    time,
  ].join("|");
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
