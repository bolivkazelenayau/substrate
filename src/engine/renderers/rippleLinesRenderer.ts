import { createSeededRandom } from "../random";
import type { LineSegment } from "../geometry";
import type { VectorRenderer } from "./types";
import { requestedMarkCount, simpleCost } from "./types";
import { resolveSimpleMarkBounds, resolveVisibleGlyphSamplingBounds, sampleBoundsFairly } from "../rendererSampling";
import { contextArtboard } from "../artboard";

export const rippleLinesRenderer: VectorRenderer = {
  id: "ripple",
  label: "Ripple lines",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "line",
  usesTime: false,
  usesSubstrate: false,
  estimateCost: (state) => simpleCost(state, "paths"),
  generateGeometry(state, context) {
    const artboard = contextArtboard(context);
    const random = createSeededRandom(state.seed);
    const bounds = resolveVisibleGlyphSamplingBounds(state, context, resolveSimpleMarkBounds(state));
    const geometries: LineSegment[] = [];
    for (let i = 0; i < requestedMarkCount(state); i += 1) {
      const { x, y } = sampleBoundsFairly(bounds, i, random);
      const noise = (random() - 0.5) * state.turbulence * 0.035;
      const angle = Math.atan2(y - artboard.centerY, x - artboard.centerX) + Math.PI / 2 + noise;
      const edgeBand = Math.abs(y - artboard.centerY) < state.fontSize * 0.48 ? 1 : 0.28;
      const length = 5 + random() * state.amplitude * 0.7;
      geometries.push({
        type: "line",
        start: { x, y },
        end: { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length },
        opacity: Math.min(0.92, 0.18 + edgeBand * state.edgeInfluence / 110 + random() * 0.2),
      });
    }
    return {
      id: "ripple-lines",
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
