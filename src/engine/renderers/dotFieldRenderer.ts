import { VIEWPORT } from "../constants";
import { createSeededRandom } from "../random";
import type { CircleMark } from "../geometry";
import type { VectorRenderer } from "./types";
import { requestedMarkCount, simpleCost } from "./types";

export const dotFieldRenderer: VectorRenderer = {
  id: "dots",
  label: "Dot field",
  supportedControls: ["density", "edgeInfluence", "maxNodes"],
  svgElementType: "circle",
  usesTime: false,
  usesSubstrate: false,
  estimateCost: (state) => simpleCost(state, "circles"),
  generateGeometry(state) {
    const random = createSeededRandom(state.seed);
    const geometries: CircleMark[] = [];
    for (let i = 0; i < requestedMarkCount(state); i += 1) {
      const x = VIEWPORT.paddingX + random() * (VIEWPORT.width - VIEWPORT.paddingX * 2);
      const y = VIEWPORT.paddingY + random() * (VIEWPORT.height - VIEWPORT.paddingY * 2);
      const edgeBand = Math.abs(y - VIEWPORT.centerY) < state.fontSize * 0.48 ? 1 : 0.28;
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
