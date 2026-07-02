import { createSeededRandom } from "../random";
import type { LineSegment } from "../geometry";
import type { VectorRenderer } from "./types";
import { requestedMarkCount, simpleCost } from "./types";
import { resolveSimpleMarkBounds, resolveVisibleGlyphSamplingBounds, sampleBoundsFairly } from "../rendererSampling";
import type { GlyphBounds } from "../glyphGeometry";
import { contextArtboard } from "../artboard";

interface FlowLineBase {
  x: number;
  y: number;
  wavePhase: number;
  noiseUnit: number;
  lengthUnit: number;
  opacityUnit: number;
}

const baseCache = new Map<string, FlowLineBase[]>();
const BASE_CACHE_LIMIT = 12;

function getFlowLineBase(seed: number, count: number, bounds: GlyphBounds[]) {
  const key = `${seed}:${count}:${bounds.map((item) => `${item.x}:${item.y}:${item.width}:${item.height}`).join("|")}`;
  const cached = baseCache.get(key);
  if (cached) return cached;
  const random = createSeededRandom(seed);
  const base = Array.from({ length: count }, (_, index) => {
    const point = sampleBoundsFairly(bounds, index, random);
    return {
      ...point,
      wavePhase: random() * 2,
      noiseUnit: random() - 0.5,
      lengthUnit: random(),
      opacityUnit: random(),
    };
  });
  baseCache.set(key, base);
  if (baseCache.size > BASE_CACHE_LIMIT) baseCache.delete(baseCache.keys().next().value!);
  return base;
}

export const flowLinesRenderer: VectorRenderer = {
  id: "flow",
  label: "Flow lines",
  supportedControls: ["density", "amplitude", "frequency", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "line",
  usesTime: true,
  usesSubstrate: false,
  estimateCost: (state) => simpleCost(state, "paths"),
  generateGeometry(state, context) {
    const artboard = contextArtboard(context);
    const bounds = resolveVisibleGlyphSamplingBounds(state, context, resolveSimpleMarkBounds(state));
    const base = getFlowLineBase(state.seed, requestedMarkCount(state), bounds);
    const geometries: LineSegment[] = [];
    for (const line of base) {
      const { x, y } = line;
      const wave = Math.sin(x / state.frequency + context.timeMs * 0.0018 + line.wavePhase);
      const noise = line.noiseUnit * state.turbulence * 0.035;
      const angle = wave * 1.2 + noise;
      const edgeBand = Math.abs(y - artboard.centerY) < state.fontSize * 0.48 ? 1 : 0.28;
      const length = 5 + line.lengthUnit * state.amplitude;
      geometries.push({
        type: "line",
        start: { x, y },
        end: { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length },
        opacity: Math.min(0.92, 0.18 + edgeBand * state.edgeInfluence / 110 + line.opacityUnit * 0.2),
      });
    }
    return {
      id: "flow-lines",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates: 0,
        averageSampledDistance: 0,
        substrateAvailable: false,
        fallback: false,
        maxNodesClipped: Math.round(state.density * 34) > state.maxNodes,
      },
    };
  },
};
