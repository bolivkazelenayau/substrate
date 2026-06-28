import { VIEWPORT } from "../constants";
import type { CircleMark, RendererDiagnostics } from "../geometry";
import { createSeededRandom } from "../random";
import { sampleDistance, sampleDistanceGradient, sampleEdge, sampleMask } from "../substrate";
import type { VectorRenderer } from "./types";
import { getGlyphFieldSampler } from "../field/glyphFieldModulation";

interface OccupiedDot {
  x: number;
  y: number;
  radius: number;
}

function fallbackDiagnostics(warning: string): RendererDiagnostics {
  return {
    acceptedCandidates: 0,
    rejectedCandidates: 0,
    averageSampledDistance: 0,
    substrateAvailable: false,
    fallback: true,
    requestedDots: 0,
    acceptedDots: 0,
    rejectedOutsideMask: 0,
    rejectedBySpacing: 0,
    averageRadius: 0,
    minRadius: 0,
    maxRadius: 0,
    maxNodesClipped: false,
    warning,
  };
}

function cellKey(x: number, y: number, cellSize: number) {
  return `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
}

export const sdfHalftoneRenderer: VectorRenderer = {
  id: "sdf-halftone",
  label: "SDF Halftone",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "circle",
  usesTime: false,
  usesSubstrate: true,
  estimateCost(state) {
    const density = Math.max(10, Math.min(80, state.density));
    const spacing = 26 - (density - 10) / 70 * 18;
    const boundsArea = VIEWPORT.width * VIEWPORT.height * 0.38;
    const marks = Math.min(state.maxNodes, Math.ceil(boundsArea / (spacing * spacing)));
    return { marks, nodes: marks, label: `${marks.toLocaleString()} circles` };
  },
  generateGeometry(state, context) {
    const substrate = context.substrateData;
    if (!substrate || substrate.substrateType === "empty" || substrate.diagnostics.maskCoverage <= 0 || substrate.diagnostics.maxDistance <= 0) {
      return {
        id: "sdf-halftone",
        geometries: [],
        diagnostics: fallbackDiagnostics("SDF Halftone requires a non-empty signed distance substrate."),
      };
    }
    const glyph = getGlyphFieldSampler(state, context);

    const random = createSeededRandom(state.seed);
    const density = Math.max(10, Math.min(80, state.density));
    const densityRatio = (density - 10) / 70;
    const spacing = 26 - densityRatio * 18;
    const maxRadius = Math.max(1.2, Math.min(spacing * 0.46, 1.2 + state.amplitude * 0.2));
    const minRadius = Math.max(0.55, Math.min(1.5, maxRadius * 0.24));
    const influence = Math.max(0, Math.min(1, state.edgeInfluence / 100));
    const jitter = spacing * 0.42 * Math.max(0, Math.min(1, state.turbulence / 100));
    const edgeBand = Math.max(spacing, substrate.diagnostics.maxDistance * (0.72 - influence * 0.52));
    const bounds = substrate.bounds;
    const minX = Math.max(0, (bounds?.x ?? 0) - spacing);
    const maxX = Math.min(VIEWPORT.width, (bounds ? bounds.x + bounds.width : VIEWPORT.width) + spacing);
    const minY = Math.max(0, (bounds?.y ?? 0) - spacing);
    const maxY = Math.min(VIEWPORT.height, (bounds ? bounds.y + bounds.height : VIEWPORT.height) + spacing);
    const columns = Math.max(1, Math.ceil((maxX - minX) / spacing));
    const rows = Math.max(1, Math.ceil((maxY - minY) / spacing));
    const requestedDots = columns * rows;
    const geometries: CircleMark[] = [];
    const occupancy = new Map<string, OccupiedDot[]>();
    const occupancyCellSize = Math.max(2, maxRadius * 2);
    let rejectedOutsideMask = 0;
    let rejectedBySpacing = 0;
    let rejectedByInfluence = 0;
    let sampledDistanceTotal = 0;
    let radiusTotal = 0;
    let actualMinRadius = Number.POSITIVE_INFINITY;
    let actualMaxRadius = 0;
    let clipped = false;
    let fieldValueTotal = 0;
    let displacementTotal = 0;
    let rejectedDisplacedCandidates = 0;
    let fieldInfluencedAcceptanceCount = 0;

    outer:
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (geometries.length >= state.maxNodes) {
          clipped = true;
          break outer;
        }

        const centerX = minX + (column + 0.5) * spacing;
        const centerY = minY + (row + 0.5) * spacing;
        let x = centerX + (random() * 2 - 1) * jitter;
        let y = centerY + (random() * 2 - 1) * jitter;
        let mask = sampleMask(substrate, x, y);
        let distance = sampleDistance(substrate, x, y);

        if (mask < 0.55 || distance <= 0) {
          x = centerX;
          y = centerY;
          mask = sampleMask(substrate, x, y);
          distance = sampleDistance(substrate, x, y);
        }
        if (mask < 0.55 || distance <= 0) {
          rejectedOutsideMask += 1;
          continue;
        }

        const fieldValue = glyph.value(x, y);
        const fieldGradient = glyph.gradient(x, y);
        if (glyph.enabled && fieldGradient.finite && fieldGradient.magnitude > 1e-6) {
          const displacement = state.glyphFieldDisplacement * glyph.strength * (0.3 + Math.abs(fieldValue) * 0.7);
          const direction = fieldValue >= 0 ? 1 : -1;
          const candidateX = x + fieldGradient.x / fieldGradient.magnitude * displacement * direction;
          const candidateY = y + fieldGradient.y / fieldGradient.magnitude * displacement * direction;
          if (sampleMask(substrate, candidateX, candidateY) >= 0.55 && sampleDistance(substrate, candidateX, candidateY) > 0) {
            x = candidateX;
            y = candidateY;
            mask = sampleMask(substrate, x, y);
            distance = sampleDistance(substrate, x, y);
            displacementTotal += displacement;
          } else rejectedDisplacedCandidates += 1;
        }

        const edge = sampleEdge(substrate, x, y);
        const gradient = sampleDistanceGradient(substrate, x, y);
        const edgeProximity = Math.exp(-distance / edgeBand);
        const edgeSignal = Math.min(1, edgeProximity * 0.82 + edge * 0.38);
        const fieldDensity = Math.abs(fieldValue) * state.glyphFieldDensity / 100 * glyph.strength;
        const acceptance = Math.min(1, (1 - influence * 0.78 + influence * 0.78 * edgeSignal) * (1 + fieldDensity * 0.72));
        if (random() > acceptance) {
          rejectedByInfluence += 1;
          continue;
        }
        if (glyph.enabled && fieldDensity > 0.01) fieldInfluencedAcceptanceCount += 1;

        const interiorRatio = Math.max(0, Math.min(1, distance / Math.max(maxRadius * 2.4, spacing * 0.7)));
        const edgeWeightedRatio = (1 - influence * 0.42) * interiorRatio + influence * 0.42 * edgeSignal;
        const radiusNoise = 1 + (random() * 2 - 1) * Math.min(0.18, state.turbulence / 700);
        const gradientSafety = Number.isFinite(gradient.magnitude) ? 1 : 0.85;
        const radiusModulation = 1 + fieldValue * state.glyphFieldRadius / 100 * glyph.strength * 0.75;
        const radius = Math.max(minRadius, Math.min(maxRadius * 1.35, (minRadius + (maxRadius - minRadius) * edgeWeightedRatio) * radiusNoise * gradientSafety * radiusModulation));

        const cellX = Math.floor(x / occupancyCellSize);
        const cellY = Math.floor(y / occupancyCellSize);
        let overlaps = false;
        for (let oy = -1; oy <= 1 && !overlaps; oy += 1) {
          for (let ox = -1; ox <= 1 && !overlaps; ox += 1) {
            const nearby = occupancy.get(`${cellX + ox},${cellY + oy}`) ?? [];
            overlaps = nearby.some((dot) => Math.hypot(x - dot.x, y - dot.y) < (radius + dot.radius) * 0.86);
          }
        }
        if (overlaps) {
          rejectedBySpacing += 1;
          continue;
        }

        const opacity = Math.max(0.18, Math.min(0.98, (0.48 + interiorRatio * 0.34 + edgeSignal * influence * 0.14) * (1 + fieldValue * state.glyphFieldOpacity / 100 * glyph.strength)));
        geometries.push({ type: "circle", center: { x, y }, radius, opacity });
        const key = cellKey(x, y, occupancyCellSize);
        const occupied = occupancy.get(key) ?? [];
        occupied.push({ x, y, radius });
        occupancy.set(key, occupied);
        sampledDistanceTotal += distance;
        radiusTotal += radius;
        actualMinRadius = Math.min(actualMinRadius, radius);
        actualMaxRadius = Math.max(actualMaxRadius, radius);
        fieldValueTotal += Math.abs(fieldValue);
      }
    }

    const rejectedCandidates = rejectedOutsideMask + rejectedBySpacing + rejectedByInfluence;
    return {
      id: "sdf-halftone",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates,
        averageSampledDistance: geometries.length > 0 ? sampledDistanceTotal / geometries.length : 0,
        substrateAvailable: true,
        fallback: false,
        requestedDots,
        acceptedDots: geometries.length,
        rejectedOutsideMask,
        rejectedBySpacing,
        averageRadius: geometries.length > 0 ? radiusTotal / geometries.length : 0,
        minRadius: geometries.length > 0 ? actualMinRadius : 0,
        maxRadius: actualMaxRadius,
        maxNodesClipped: clipped,
        glyphFieldEnabled: glyph.enabled,
        selectedGlyph: glyph.field ? `${glyph.field.sourceGlyph.textIndex + 1} · ${glyph.field.sourceGlyph.character}` : undefined,
        glyphFieldMode: state.glyphFieldMode,
        averageGlyphFieldValue: geometries.length ? fieldValueTotal / geometries.length : 0,
        averageGlyphFieldDisplacement: geometries.length ? displacementTotal / geometries.length : 0,
        rejectedDisplacedCandidates,
        fieldInfluencedAcceptanceCount,
        warning: clipped ? `Dot output clipped at the ${state.maxNodes} node budget.` : undefined,
      },
    };
  },
};
