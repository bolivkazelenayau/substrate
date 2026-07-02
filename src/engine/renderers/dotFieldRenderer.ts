import { createSeededRandom } from "../random";
import type { CircleMark } from "../geometry";
import type { VectorRenderer } from "./types";
import { requestedMarkCount, simpleCost } from "./types";
import { resolveSimpleMarkBounds, resolveVisibleGlyphSamplingBounds, sampleBoundsFairly } from "../rendererSampling";
import { contextArtboard } from "../artboard";

export const dotFieldRenderer: VectorRenderer = {
  id: "dots",
  label: "Dot field",
  supportedControls: ["density", "edgeInfluence", "maxNodes"],
  svgElementType: "circle",
  usesTime: false,
  usesSubstrate: false,
  estimateCost: (state) => simpleCost(state, "circles"),
  generateGeometry(state, context) {
    const artboard = contextArtboard(context);
    const random = createSeededRandom(state.seed);
    const bounds = resolveVisibleGlyphSamplingBounds(state, context, resolveSimpleMarkBounds(state));
    const geometries: CircleMark[] = [];
    for (let i = 0; i < requestedMarkCount(state); i += 1) {
      const { x, y } = sampleBoundsFairly(bounds, i, random);
      const edgeBand = Math.abs(y - artboard.centerY) < state.fontSize * 0.48 ? 1 : 0.28;
      geometries.push({
        type: "circle",
        center: { x, y },
        radius: 0.7 + random() * 2.2 * edgeBand,
        opacity: Math.min(0.92, 0.18 + edgeBand * state.edgeInfluence / 110 + random() * 0.2),
      });
    }
    return {
      id: "dot-field",
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
