import { VIEWPORT } from "../constants";
import type { Point, Polyline, RendererDiagnostics } from "../geometry";
import { createSeededRandom } from "../random";
import { sampleDistance, sampleDistanceGradient, sampleEdge, sampleMask, type SubstrateData } from "../substrate";
import type { VectorRenderer } from "./types";
import { getGlyphFieldSampler } from "../field/glyphFieldModulation";

const OCCUPANCY_CELL_SIZE = 11;
const MIN_POLYLINE_POINTS = 4;

function deterministicNoise(seed: number, x: number, y: number) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + seed * 0.017) * 43758.5453123;
  return value - Math.floor(value);
}

function occupancyIndex(x: number, y: number, width: number, height: number) {
  const cellX = Math.max(0, Math.min(width - 1, Math.floor(x / OCCUPANCY_CELL_SIZE)));
  const cellY = Math.max(0, Math.min(height - 1, Math.floor(y / OCCUPANCY_CELL_SIZE)));
  return { cellX, cellY, index: cellY * width + cellX };
}

function isOccupiedNearby(occupancy: Uint8Array, x: number, y: number, width: number, height: number) {
  const cell = occupancyIndex(x, y, width, height);
  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const nx = cell.cellX + offsetX;
      const ny = cell.cellY + offsetY;
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && occupancy[ny * width + nx] > 0) return true;
    }
  }
  return false;
}

function markOccupied(occupancy: Uint8Array, points: Point[], width: number, height: number) {
  points.forEach((point) => {
    occupancy[occupancyIndex(point.x, point.y, width, height).index] = 1;
  });
}

interface TraceCounters {
  stoppedOutsideMask: number;
  stoppedInvalidGradient: number;
  occupancyRejections: number;
}

function traceHalf(
  substrate: SubstrateData,
  seedPoint: Point,
  directionSign: number,
  stepSize: number,
  maxSteps: number,
  turbulence: number,
  seed: number,
  occupancy: Uint8Array,
  occupancyWidth: number,
  occupancyHeight: number,
  counters: TraceCounters,
  pointBudget: number,
  glyph: ReturnType<typeof getGlyphFieldSampler>,
  glyphDisplacement: number,
  glyphStats: { valueTotal: number; displacementTotal: number; samples: number },
) {
  const points: Point[] = [];
  let current = seedPoint;
  for (let step = 0; step < maxSteps && points.length < pointBudget; step += 1) {
    const gradient = sampleDistanceGradient(substrate, current.x, current.y);
    if (!Number.isFinite(gradient.magnitude) || gradient.magnitude < 0.01) {
      counters.stoppedInvalidGradient += 1;
      break;
    }
    const tangentX = -gradient.y / gradient.magnitude * directionSign;
    const tangentY = gradient.x / gradient.magnitude * directionSign;
    const perturbation = (deterministicNoise(seed + step * 131, current.x, current.y) - 0.5) * turbulence * 0.72;
    const baseAngle = Math.atan2(tangentY, tangentX);
    const glyphValue = glyph.value(current.x, current.y);
    const glyphGradient = glyph.gradient(current.x, current.y);
    const glyphTurn = glyph.enabled ? glyphValue * glyphDisplacement * glyph.strength * 0.045
      + (glyphGradient.finite ? Math.min(0.32, glyphGradient.magnitude * glyphDisplacement) : 0) : 0;
    glyphStats.valueTotal += Math.abs(glyphValue);
    glyphStats.displacementTotal += Math.abs(glyphTurn);
    glyphStats.samples += 1;
    const angle = baseAngle + perturbation + glyphTurn;
    const next = {
      x: current.x + Math.cos(angle) * stepSize,
      y: current.y + Math.sin(angle) * stepSize,
    };
    if (next.x < 0 || next.x > VIEWPORT.width || next.y < 0 || next.y > VIEWPORT.height || sampleMask(substrate, next.x, next.y) < 0.5) {
      counters.stoppedOutsideMask += 1;
      break;
    }
    const nextDistance = sampleDistance(substrate, next.x, next.y);
    if (!Number.isFinite(nextDistance)) {
      counters.stoppedInvalidGradient += 1;
      break;
    }
    if (isOccupiedNearby(occupancy, next.x, next.y, occupancyWidth, occupancyHeight)) {
      counters.occupancyRejections += 1;
      break;
    }
    points.push(next);
    current = next;
  }
  return points;
}

function fallbackDiagnostics(warning: string): RendererDiagnostics {
  return {
    acceptedCandidates: 0,
    rejectedCandidates: 0,
    averageSampledDistance: 0,
    substrateAvailable: false,
    fallback: true,
    requestedStreamlines: 0,
    acceptedStreamlines: 0,
    rejectedSeeds: 0,
    totalPolylinePoints: 0,
    averagePointsPerStreamline: 0,
    stoppedOutsideMask: 0,
    stoppedInvalidGradient: 0,
    occupancyRejections: 0,
    warning,
  };
}

export const sdfStreamlinesRenderer: VectorRenderer = {
  id: "sdf-streamlines",
  label: "SDF Streamlines",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "polyline",
  usesTime: false,
  usesSubstrate: true,
  estimateCost(state) {
    const requested = Math.max(1, Math.round(state.density * 0.75));
    return { marks: requested, nodes: state.maxNodes, label: `≤ ${state.maxNodes.toLocaleString()} points` };
  },
  generateGeometry(state, context) {
    const substrate = context.substrateData;
    if (!substrate || substrate.substrateType === "empty" || substrate.diagnostics.maskCoverage <= 0) {
      return { id: "sdf-streamlines", geometries: [], diagnostics: fallbackDiagnostics("SDF Streamlines requires a non-empty substrate.") };
    }

    const random = createSeededRandom(state.seed);
    const glyph = getGlyphFieldSampler(state, context);
    const requestedStreamlines = Math.max(1, Math.round(state.density * 0.75));
    const maxSteps = Math.max(6, Math.min(48, Math.round(5 + state.amplitude * 0.95)));
    const stepSize = Math.max(1.5, 2.2 + state.amplitude * 0.09);
    const maxSeedAttempts = requestedStreamlines * 35;
    const occupancyWidth = Math.ceil(VIEWPORT.width / OCCUPANCY_CELL_SIZE);
    const occupancyHeight = Math.ceil(VIEWPORT.height / OCCUPANCY_CELL_SIZE);
    const occupancy = new Uint8Array(occupancyWidth * occupancyHeight);
    const influence = state.edgeInfluence / 100;
    const edgeBand = Math.max(2, state.fontSize * (0.46 - influence * 0.37));
    const bounds = substrate.bounds;
    const minX = Math.max(0, (bounds?.x ?? 0) - 5);
    const maxX = Math.min(VIEWPORT.width, (bounds ? bounds.x + bounds.width : VIEWPORT.width) + 5);
    const minY = Math.max(0, (bounds?.y ?? 0) - 5);
    const maxY = Math.min(VIEWPORT.height, (bounds ? bounds.y + bounds.height : VIEWPORT.height) + 5);
    const polylines: Polyline[] = [];
    const counters: TraceCounters = { stoppedOutsideMask: 0, stoppedInvalidGradient: 0, occupancyRejections: 0 };
    let rejectedSeeds = 0;
    let attempts = 0;
    let totalPoints = 0;
    let sampledDistanceTotal = 0;
    const glyphStats = { valueTotal: 0, displacementTotal: 0, samples: 0 };
    let fieldInfluencedAcceptanceCount = 0;

    while (polylines.length < requestedStreamlines && attempts < maxSeedAttempts && state.maxNodes - totalPoints >= MIN_POLYLINE_POINTS) {
      attempts += 1;
      const seedPoint = {
        x: minX + random() * Math.max(1, maxX - minX),
        y: minY + random() * Math.max(1, maxY - minY),
      };
      const mask = sampleMask(substrate, seedPoint.x, seedPoint.y);
      const distance = sampleDistance(substrate, seedPoint.x, seedPoint.y);
      const edge = sampleEdge(substrate, seedPoint.x, seedPoint.y);
      const gradient = sampleDistanceGradient(substrate, seedPoint.x, seedPoint.y);
      if (mask < 0.5 || !Number.isFinite(distance) || distance < 0 || !Number.isFinite(gradient.magnitude) || gradient.magnitude < 0.01) {
        rejectedSeeds += 1;
        continue;
      }
      if (isOccupiedNearby(occupancy, seedPoint.x, seedPoint.y, occupancyWidth, occupancyHeight)) {
        rejectedSeeds += 1;
        counters.occupancyRejections += 1;
        continue;
      }
      const edgeProximity = Math.exp(-distance / edgeBand);
      const edgeStrength = Math.min(1, edgeProximity * 0.82 + edge * 0.55);
      const seedField = Math.abs(glyph.value(seedPoint.x, seedPoint.y));
      const fieldAcceptance = seedField * state.glyphFieldDensity / 100 * glyph.strength;
      if (random() > Math.min(1, (1 - influence) + influence * edgeStrength + fieldAcceptance * 0.35)) {
        rejectedSeeds += 1;
        continue;
      }
      if (glyph.enabled && fieldAcceptance > 0.01) fieldInfluencedAcceptanceCount += 1;

      const remaining = state.maxNodes - totalPoints;
      const halfBudget = Math.max(1, Math.floor((remaining - 1) / 2));
      const directionSign = polylines.length % 2 === 0 ? 1 : -1;
      const forward = traceHalf(substrate, seedPoint, directionSign, stepSize, maxSteps, state.turbulence / 100, state.seed, occupancy, occupancyWidth, occupancyHeight, counters, halfBudget, glyph, state.glyphFieldDisplacement, glyphStats);
      const backwardBudget = Math.max(0, remaining - 1 - forward.length);
      const backward = traceHalf(substrate, seedPoint, -directionSign, stepSize, maxSteps, state.turbulence / 100, state.seed + 7919, occupancy, occupancyWidth, occupancyHeight, counters, backwardBudget, glyph, state.glyphFieldDisplacement, glyphStats);
      const points = [...backward.reverse(), seedPoint, ...forward];
      if (points.length < MIN_POLYLINE_POINTS) {
        rejectedSeeds += 1;
        continue;
      }

      markOccupied(occupancy, points, occupancyWidth, occupancyHeight);
      const lineDistance = points.reduce((sum, point) => sum + sampleDistance(substrate, point.x, point.y), 0);
      sampledDistanceTotal += lineDistance;
      totalPoints += points.length;
      polylines.push({
        type: "polyline",
        points,
        opacity: Math.min(0.94, 0.32 + edgeStrength * 0.5 + random() * 0.1),
      });
    }

    return {
      id: "sdf-streamlines",
      geometries: polylines,
      diagnostics: {
        acceptedCandidates: polylines.length,
        rejectedCandidates: rejectedSeeds,
        averageSampledDistance: totalPoints > 0 ? sampledDistanceTotal / totalPoints : 0,
        substrateAvailable: true,
        fallback: false,
        requestedStreamlines,
        acceptedStreamlines: polylines.length,
        rejectedSeeds,
        totalPolylinePoints: totalPoints,
        averagePointsPerStreamline: polylines.length > 0 ? totalPoints / polylines.length : 0,
        stoppedOutsideMask: counters.stoppedOutsideMask,
        stoppedInvalidGradient: counters.stoppedInvalidGradient,
        occupancyRejections: counters.occupancyRejections,
        maxNodesClipped: state.maxNodes - totalPoints < MIN_POLYLINE_POINTS && polylines.length < requestedStreamlines,
        glyphFieldEnabled: glyph.enabled,
        selectedGlyph: glyph.field ? `${glyph.field.sourceGlyph.textIndex + 1} · ${glyph.field.sourceGlyph.character}` : undefined,
        glyphFieldMode: state.glyphFieldMode,
        averageGlyphFieldValue: glyphStats.samples ? glyphStats.valueTotal / glyphStats.samples : 0,
        averageGlyphFieldDisplacement: glyphStats.samples ? glyphStats.displacementTotal / glyphStats.samples : 0,
        rejectedDisplacedCandidates: counters.stoppedOutsideMask,
        fieldInfluencedAcceptanceCount,
        warning: polylines.length < requestedStreamlines ? `Generated ${polylines.length} of ${requestedStreamlines} requested streamlines.` : undefined,
      },
    };
  },
};
