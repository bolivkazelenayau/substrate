import type { Point, Polyline, RendererDiagnostics } from "../geometry";
import { sampleDistanceGradient, sampleMask, type SubstrateData } from "../substrate";
import type { VectorRenderer } from "./types";
import { getGlyphFieldSampler } from "../field/glyphFieldModulation";

interface Segment {
  a: Point;
  b: Point;
}

function interpolatePoint(
  x1: number,
  y1: number,
  value1: number,
  x2: number,
  y2: number,
  value2: number,
  level: number,
  substrate: SubstrateData,
): Point {
  const denominator = value2 - value1;
  const amount = Math.abs(denominator) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - value1) / denominator));
  const rasterX = x1 + (x2 - x1) * amount;
  const rasterY = y1 + (y2 - y1) * amount;
  return {
    x: rasterX / (substrate.width - 1) * substrate.viewportWidth,
    y: rasterY / (substrate.height - 1) * substrate.viewportHeight,
  };
}

function extractSegments(substrate: SubstrateData, level: number): Segment[] {
  const segments: Segment[] = [];
  const { width, height } = substrate;
  const values = substrate.distance.data;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const corners = [
        { x, y, value: values[y * width + x] },
        { x: x + 1, y, value: values[y * width + x + 1] },
        { x: x + 1, y: y + 1, value: values[(y + 1) * width + x + 1] },
        { x, y: y + 1, value: values[(y + 1) * width + x] },
      ];
      const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 0]] as const;
      const crossings: Point[] = [];
      edgePairs.forEach(([start, end]) => {
        const a = corners[start];
        const b = corners[end];
        if ((a.value >= level) !== (b.value >= level)) {
          crossings.push(interpolatePoint(a.x, a.y, a.value, b.x, b.y, b.value, level, substrate));
        }
      });
      if (crossings.length === 2) {
        segments.push({ a: crossings[0], b: crossings[1] });
      } else if (crossings.length === 4) {
        const centerInside = corners.reduce((sum, corner) => sum + corner.value, 0) / 4 >= level;
        if (centerInside) {
          segments.push({ a: crossings[0], b: crossings[1] }, { a: crossings[2], b: crossings[3] });
        } else {
          segments.push({ a: crossings[0], b: crossings[3] }, { a: crossings[1], b: crossings[2] });
        }
      }
    }
  }
  return segments;
}

const pointKey = (point: Point) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;

function stitchSegments(segments: Segment[]): Point[][] {
  const adjacency = new Map<string, number[]>();
  segments.forEach((segment, index) => {
    [segment.a, segment.b].forEach((point) => {
      const key = pointKey(point);
      const entries = adjacency.get(key) ?? [];
      entries.push(index);
      adjacency.set(key, entries);
    });
  });
  const used = new Uint8Array(segments.length);
  const fragments: Point[][] = [];

  const extend = (points: Point[], prepend: boolean) => {
    while (true) {
      const endpoint = prepend ? points[0] : points[points.length - 1];
      const nextIndex = (adjacency.get(pointKey(endpoint)) ?? []).find((index) => used[index] === 0);
      if (nextIndex === undefined) break;
      used[nextIndex] = 1;
      const segment = segments[nextIndex];
      const next = pointKey(segment.a) === pointKey(endpoint) ? segment.b : segment.a;
      if (prepend) points.unshift(next);
      else points.push(next);
    }
  };

  segments.forEach((segment, index) => {
    if (used[index]) return;
    used[index] = 1;
    const points = [segment.a, segment.b];
    extend(points, false);
    extend(points, true);
    fragments.push(points);
  });
  return fragments;
}

function pointDistance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function fragmentLength(points: Point[]) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) length += pointDistance(points[index - 1], points[index]);
  return length;
}

function cleanFragment(points: Point[]) {
  const deduplicated = points.filter((point, index) => index === 0 || pointDistance(points[index - 1], point) > 0.12);
  if (deduplicated.length < 3) return deduplicated;
  const simplified = [deduplicated[0]];
  for (let index = 1; index < deduplicated.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1];
    const current = deduplicated[index];
    const next = deduplicated[index + 1];
    const span = pointDistance(previous, next);
    const areaTwice = Math.abs((current.x - previous.x) * (next.y - previous.y) - (current.y - previous.y) * (next.x - previous.x));
    const perpendicularDistance = span > 0 ? areaTwice / span : 0;
    if (perpendicularDistance >= 0.22) simplified.push(current);
  }
  simplified.push(deduplicated[deduplicated.length - 1]);
  return simplified;
}

function deterministicNoise(seed: number, x: number, y: number) {
  const value = Math.sin(x * 17.123 + y * 41.773 + seed * 0.019) * 43758.5453;
  return value - Math.floor(value);
}

function displaceFragment(points: Point[], substrate: SubstrateData, turbulence: number, seed: number) {
  if (turbulence <= 0) return points;
  const maximum = Math.min(substrate.scaleX, substrate.scaleY) * 0.38 * turbulence;
  return points.map((point, index) => {
    const gradient = sampleDistanceGradient(substrate, point.x, point.y);
    if (!Number.isFinite(gradient.magnitude) || gradient.magnitude < 0.01) return point;
    const amount = (deterministicNoise(seed + index * 97, point.x, point.y) - 0.5) * 2 * maximum;
    const candidate = {
      x: point.x + gradient.x / gradient.magnitude * amount,
      y: point.y + gradient.y / gradient.magnitude * amount,
    };
    return sampleMask(substrate, candidate.x, candidate.y) >= 0.48 ? candidate : point;
  });
}

function fallbackDiagnostics(warning: string): RendererDiagnostics {
  return {
    acceptedCandidates: 0,
    rejectedCandidates: 0,
    averageSampledDistance: 0,
    substrateAvailable: false,
    fallback: true,
    contourLevelCount: 0,
    extractedFragments: 0,
    totalContourPoints: 0,
    skippedFragments: 0,
    maxPositiveDistance: 0,
    averageFragmentLength: 0,
    maxNodesClipped: false,
    warning,
  };
}

export const sdfContoursRenderer: VectorRenderer = {
  id: "sdf-contours",
  label: "SDF Contours",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "polyline",
  usesTime: false,
  usesSubstrate: true,
  estimateCost: (state) => ({ marks: Math.max(2, Math.round(1 + state.density / 7)), nodes: state.maxNodes, label: `≤ ${state.maxNodes.toLocaleString()} points` }),
  generateGeometry(state, context) {
    const substrate = context.substrateData;
    if (!substrate || substrate.substrateType === "empty" || substrate.diagnostics.maskCoverage <= 0 || substrate.diagnostics.maxDistance <= 0) {
      return { id: "sdf-contours", geometries: [], diagnostics: fallbackDiagnostics("SDF Contours requires a non-empty signed distance substrate.") };
    }

    const maxPositiveDistance = substrate.diagnostics.maxDistance;
    const glyph = getGlyphFieldSampler(state, context);
    const requestedLevels = Math.max(2, Math.min(14, Math.round(1 + state.density / 7)));
    const influence = state.edgeInfluence / 100;
    const amplitudeFactor = 0.35 + ((state.amplitude - 2) / 42) * 0.65;
    const minimumLevel = Math.min(maxPositiveDistance * 0.65, Math.max(0.75, (substrate.scaleX + substrate.scaleY) * 0.38));
    const maximumLevel = Math.max(minimumLevel, maxPositiveDistance * amplitudeFactor * (1 - influence * 0.74));
    const levels = Array.from({ length: requestedLevels }, (_, index) => {
      const amount = requestedLevels === 1 ? 0 : index / (requestedLevels - 1);
      return minimumLevel + (maximumLevel - minimumLevel) * Math.pow(amount, 1 + influence * 1.8);
    });

    const geometries: Polyline[] = [];
    let totalPoints = 0;
    let skippedFragments = 0;
    let extractedFragments = 0;
    let totalFragmentLength = 0;
    let maxNodesClipped = false;
    let sampledDistanceTotal = 0;
    let fieldValueTotal = 0;
    let displacementTotal = 0;
    let rejectedDisplacedCandidates = 0;
    let fieldSamples = 0;

    levels.forEach((level, levelIndex) => {
      const fragments = stitchSegments(extractSegments(substrate, level));
      fragments.forEach((rawFragment) => {
        extractedFragments += 1;
        const cleaned = cleanFragment(rawFragment);
        const displaced = displaceFragment(cleaned, substrate, state.turbulence / 100, state.seed + levelIndex * 1009).map((point) => {
          const value = glyph.value(point.x, point.y);
          const fieldGradient = glyph.gradient(point.x, point.y);
          fieldValueTotal += Math.abs(value);
          fieldSamples += 1;
          if (!glyph.enabled) return point;
          const sdfNormal = sampleDistanceGradient(substrate, point.x, point.y);
          const normalMagnitude = sdfNormal.magnitude;
          if (!Number.isFinite(normalMagnitude) || normalMagnitude < 0.01) return point;
          const amount = value * state.glyphFieldDisplacement * glyph.strength;
          const candidate = { x: point.x + sdfNormal.x / normalMagnitude * amount, y: point.y + sdfNormal.y / normalMagnitude * amount };
          if (!fieldGradient.finite || sampleMask(substrate, candidate.x, candidate.y) < 0.48) {
            rejectedDisplacedCandidates += 1;
            return point;
          }
          displacementTotal += Math.abs(amount);
          return candidate;
        });
        const length = fragmentLength(displaced);
        if (displaced.length < 3 || length < Math.min(substrate.scaleX, substrate.scaleY) * 1.5) {
          skippedFragments += 1;
          return;
        }
        if (totalPoints + displaced.length > state.maxNodes) {
          skippedFragments += 1;
          maxNodesClipped = true;
          return;
        }
        if (!displaced.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
          skippedFragments += 1;
          return;
        }
        geometries.push({
          type: "polyline",
          points: displaced,
          opacity: Math.min(0.92, 0.42 + influence * 0.28 + levelIndex / Math.max(1, levels.length - 1) * 0.16),
        });
        totalPoints += displaced.length;
        totalFragmentLength += length;
        sampledDistanceTotal += level * displaced.length;
      });
    });

    return {
      id: "sdf-contours",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates: skippedFragments,
        averageSampledDistance: totalPoints > 0 ? sampledDistanceTotal / totalPoints : 0,
        substrateAvailable: true,
        fallback: false,
        contourLevelCount: levels.length,
        extractedFragments,
        totalContourPoints: totalPoints,
        skippedFragments,
        maxPositiveDistance,
        averageFragmentLength: geometries.length > 0 ? totalFragmentLength / geometries.length : 0,
        maxNodesClipped,
        glyphFieldEnabled: glyph.enabled,
        selectedGlyph: glyph.field ? `${glyph.field.sourceGlyph.textIndex + 1} · ${glyph.field.sourceGlyph.character}` : undefined,
        glyphFieldMode: state.glyphFieldMode,
        averageGlyphFieldValue: fieldSamples ? fieldValueTotal / fieldSamples : 0,
        averageGlyphFieldDisplacement: fieldSamples ? displacementTotal / fieldSamples : 0,
        rejectedDisplacedCandidates,
        fieldInfluencedAcceptanceCount: 0,
        warning: maxNodesClipped ? "Contour fragments were clipped by the maxNodes point budget." : undefined,
      },
    };
  },
};
