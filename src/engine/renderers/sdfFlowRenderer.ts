import type { LineSegment } from "../geometry";
import { createSeededRandom } from "../random";
import { sampleDistance, sampleDistanceGradient, sampleEdge, sampleMask } from "../substrate";
import type { VectorRenderer } from "./types";
import { requestedMarkCount, simpleCost } from "./types";
import { resolveVisibleGlyphSamplingBounds, sampleBoundsFairly } from "../rendererSampling";
import { contextArtboard } from "../artboard";

export const sdfFlowRenderer: VectorRenderer = {
  id: "sdf-flow",
  label: "SDF Flow",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "line",
  usesTime: false,
  usesSubstrate: true,
  estimateCost: (state) => simpleCost(state, "paths"),
  generateGeometry(state, context) {
    const artboard = contextArtboard(context);
    const substrate = context.substrateData;
    if (!substrate || substrate.substrateType === "empty" || substrate.diagnostics.maskCoverage <= 0) {
      return {
        id: "sdf-flow-lines",
        geometries: [],
        diagnostics: {
          acceptedCandidates: 0,
          rejectedCandidates: 0,
          averageSampledDistance: 0,
          substrateAvailable: false,
          fallback: true,
          warning: "SDF Flow requires a non-empty substrate.",
        },
      };
    }

    const random = createSeededRandom(state.seed);
    const target = requestedMarkCount(state);
    const maxAttempts = Math.max(target * 14, 500);
    const geometries: LineSegment[] = [];
    const influence = state.edgeInfluence / 100;
    const edgeBand = Math.max(2, state.fontSize * (0.42 - influence * 0.34));
    const bounds = substrate.bounds;
    const minX = Math.max(0, (bounds?.x ?? 0) - 8);
    const maxX = Math.min(artboard.width, (bounds ? bounds.x + bounds.width : artboard.width) + 8);
    const minY = Math.max(0, (bounds?.y ?? 0) - 8);
    const maxY = Math.min(artboard.height, (bounds ? bounds.y + bounds.height : artboard.height) + 8);
    const samplingBounds = resolveVisibleGlyphSamplingBounds(state, context, {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY),
    });
    let attempts = 0;
    let sampledDistanceTotal = 0;

    while (geometries.length < target && attempts < maxAttempts) {
      attempts += 1;
      const { x, y } = sampleBoundsFairly(samplingBounds, attempts - 1, random);
      const mask = sampleMask(substrate, x, y);
      const distance = sampleDistance(substrate, x, y);
      const edge = sampleEdge(substrate, x, y);
      const gradient = sampleDistanceGradient(substrate, x, y);

      if (mask < 0.5 || distance < 0 || !Number.isFinite(gradient.magnitude) || gradient.magnitude < 0.01) continue;

      const edgeProximity = Math.exp(-Math.abs(distance) / edgeBand);
      const edgeStrength = Math.min(1, edgeProximity * 0.82 + edge * 0.55);
      const acceptance = (1 - influence) + influence * edgeStrength;
      if (random() > acceptance) continue;

      const normalX = gradient.x / gradient.magnitude;
      const normalY = gradient.y / gradient.magnitude;
      const tangentAngle = Math.atan2(normalX, -normalY);
      const perturbation = (random() - 0.5) * (state.turbulence / 100) * 0.9;
      const angle = tangentAngle + perturbation;
      const length = Math.max(1, state.amplitude * (0.45 + random() * 0.55) * (0.72 + edgeProximity * 0.28));
      const opacity = Math.min(0.96, 0.24 + edgeStrength * (0.35 + influence * 0.35) + random() * 0.12);

      geometries.push({
        type: "line",
        start: { x, y },
        end: { x: x + Math.cos(angle) * length, y: y + Math.sin(angle) * length },
        opacity,
      });
      sampledDistanceTotal += distance;
    }

    return {
      id: "sdf-flow-lines",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates: attempts - geometries.length,
        averageSampledDistance: geometries.length > 0 ? sampledDistanceTotal / geometries.length : 0,
        substrateAvailable: true,
        fallback: false,
        maxNodesClipped: Math.round(state.density * 34) > state.maxNodes,
        warning: geometries.length < target ? `Candidate budget reached at ${geometries.length} of ${target} marks.` : undefined,
      },
    };
  },
};
