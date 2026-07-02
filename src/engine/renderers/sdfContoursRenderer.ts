import type { Point, Polyline, RendererDiagnostics } from "../geometry";
import { sampleDistanceGradient, sampleMask, type SubstrateData } from "../substrate";
import type { VectorRenderer } from "./types";
import { getGlyphFieldSampler } from "../field/glyphFieldModulation";
import { budgetContourFragmentsFairly } from "../contourBudget";
import { configuredContourStrokeWidth } from "../contourStroke";

interface Segment {
  a: Point;
  b: Point;
}

// Preserve the historical budget selection for projects that were representable
// before contextual typography sizing. Fair decimation applies only to the newly
// reachable large-type range, keeping canonical exports byte-stable.
const LEGACY_CONTOUR_BUDGET_SIZE_LIMIT = 220;

// Numeric hash for a quantized point coordinate. Same quantization as the previous
// `${Math.round(point.x*100)},${Math.round(point.y*100)}` string key, packed into
// a single integer so adjacency Maps use numeric keys.
const POINT_KEY_OFFSET = 1_000_000;
const POINT_KEY_SPAN = 2_000_000;
function pointKey(point: Point): number {
  return (Math.round(point.y * 100) + POINT_KEY_OFFSET) * POINT_KEY_SPAN
    + (Math.round(point.x * 100) + POINT_KEY_OFFSET);
}

function extractSegments(substrate: SubstrateData, level: number): Segment[] {
  const segments: Segment[] = [];
  const width = substrate.width;
  const height = substrate.height;
  const values = substrate.distance.data;
  const invWidthMinusOne = 1 / Math.max(1, width - 1);
  const invHeightMinusOne = 1 / Math.max(1, height - 1);
  const domain = substrate.domainBounds ?? { x: 0, y: 0, width: substrate.viewportWidth, height: substrate.viewportHeight };
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const idx = y * width + x;
      // Read the four corner values directly. Avoids allocating a `corners` array
      // and a `{x, y, value}` object per cell across the whole raster sweep.
      const v00 = values[idx];
      const v10 = values[idx + 1];
      const v11 = values[idx + width + 1];
      const v01 = values[idx + width];
      const above00 = v00 >= level;
      const above10 = v10 >= level;
      const above11 = v11 >= level;
      const above01 = v01 >= level;
      // Walk the four edges in the same order as [[0,1],[1,2],[2,3],[3,0]] but
      // inlined so no `edgePairs` array is allocated per cell. Each crossing is
      // emitted only when the above-flag differs across the edge — the same
      // numerical behaviour as the previous `interpolatePoint` helper, just
      // inlined here so no intermediate Point array is built per cell.
      let crossingCount = 0;
      let c0x = 0, c0y = 0, c1x = 0, c1y = 0, c2x = 0, c2y = 0, c3x = 0, c3y = 0;
      if (above00 !== above10) {
        const denom = v10 - v00;
        const amount = Math.abs(denom) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v00) / denom));
        c0x = domain.x + (x + amount) * invWidthMinusOne * domain.width;
        c0y = domain.y + y * invHeightMinusOne * domain.height;
        crossingCount = 1;
      }
      if (above10 !== above11) {
        const denom = v11 - v10;
        const amount = Math.abs(denom) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v10) / denom));
        const px = domain.x + (x + 1) * invWidthMinusOne * domain.width;
        const py = domain.y + (y + amount) * invHeightMinusOne * domain.height;
        if (crossingCount === 0) { c0x = px; c0y = py; crossingCount = 1; }
        else { c1x = px; c1y = py; crossingCount = 2; }
      }
      if (above11 !== above01) {
        const denom = v01 - v11;
        const amount = Math.abs(denom) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v11) / denom));
        // Edge goes from corner2=(x+1, y+1) toward corner3=(x, y+1); the along-edge
        // position is (x+1) - amount, with y fixed at y+1.
        const px = domain.x + (x + 1 - amount) * invWidthMinusOne * domain.width;
        const py = domain.y + (y + 1) * invHeightMinusOne * domain.height;
        if (crossingCount === 0) { c0x = px; c0y = py; crossingCount = 1; }
        else if (crossingCount === 1) { c1x = px; c1y = py; crossingCount = 2; }
        else { c2x = px; c2y = py; crossingCount = 3; }
      }
      if (above01 !== above00) {
        const denom = v00 - v01;
        const amount = Math.abs(denom) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v01) / denom));
        // Edge goes from corner3=(x, y+1) toward corner0=(x, y); the along-edge
        // position is (y+1) - amount, with x fixed at x.
        const px = domain.x + x * invWidthMinusOne * domain.width;
        const py = domain.y + (y + 1 - amount) * invHeightMinusOne * domain.height;
        if (crossingCount === 0) { c0x = px; c0y = py; crossingCount = 1; }
        else if (crossingCount === 1) { c1x = px; c1y = py; crossingCount = 2; }
        else if (crossingCount === 2) { c2x = px; c2y = py; crossingCount = 3; }
        else { c3x = px; c3y = py; crossingCount = 4; }
      }
      if (crossingCount === 2) {
        segments.push({ a: { x: c0x, y: c0y }, b: { x: c1x, y: c1y } });
      } else if (crossingCount === 4) {
        const centerInside = (v00 + v10 + v11 + v01) / 4 >= level;
        const p0: Point = { x: c0x, y: c0y };
        const p1: Point = { x: c1x, y: c1y };
        const p2: Point = { x: c2x, y: c2y };
        const p3: Point = { x: c3x, y: c3y };
        if (centerInside) {
          segments.push({ a: p0, b: p1 }, { a: p2, b: p3 });
        } else {
          segments.push({ a: p0, b: p3 }, { a: p1, b: p2 });
        }
      }
    }
  }
  return segments;
}

function stitchSegments(segments: Segment[]): Point[][] {
  const adjacency = new Map<number, number[]>();
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const keyA = pointKey(segment.a);
    const keyB = pointKey(segment.b);
    const entriesA = adjacency.get(keyA);
    if (entriesA) entriesA.push(index);
    else adjacency.set(keyA, [index]);
    const entriesB = adjacency.get(keyB);
    if (entriesB) entriesB.push(index);
    else adjacency.set(keyB, [index]);
  }
  const used = new Uint8Array(segments.length);
  const fragments: Point[][] = [];

  const extend = (points: Point[], prepend: boolean) => {
    while (true) {
      const endpoint = prepend ? points[0] : points[points.length - 1];
      const key = pointKey(endpoint);
      const entries = adjacency.get(key);
      let nextIndex = -1;
      if (entries) {
        for (let k = 0; k < entries.length; k += 1) {
          if (used[entries[k]] === 0) { nextIndex = entries[k]; break; }
        }
      }
      if (nextIndex < 0) break;
      used[nextIndex] = 1;
      const segment = segments[nextIndex];
      const next = pointKey(segment.a) === key ? segment.b : segment.a;
      if (prepend) points.unshift(next);
      else points.push(next);
    }
  };

  for (let index = 0; index < segments.length; index += 1) {
    if (used[index]) continue;
    used[index] = 1;
    const segment = segments[index];
    const points: Point[] = [segment.a, segment.b];
    extend(points, false);
    extend(points, true);
    fragments.push(points);
  }
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
  strokeWidth: configuredContourStrokeWidth,
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

    const candidates: Array<{ points: Point[]; payload: { level: number; levelIndex: number } }> = [];
    let skippedFragments = 0;
    let extractedFragments = 0;
    let totalFragmentLength = 0;
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
          if (!glyph.enabled) return point;
          const value = glyph.value(point.x, point.y);
          fieldValueTotal += Math.abs(value);
          fieldSamples += 1;
          if (!glyph.displacementEnabled) return point;
          const fieldGradient = glyph.gradient(point.x, point.y);
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
        if (!displaced.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) {
          skippedFragments += 1;
          return;
        }
        candidates.push({ points: displaced, payload: { level, levelIndex } });
      });
    });
    const usesFairBudget = state.fontSize > LEGACY_CONTOUR_BUDGET_SIZE_LIMIT;
    const budgeted = usesFairBudget
      ? budgetContourFragmentsFairly(candidates, state.maxNodes)
      : (() => {
          const fragments = [];
          let retainedPointCount = 0;
          let budgetLimited = false;
          for (const candidate of candidates) {
            if (retainedPointCount + candidate.points.length > state.maxNodes) {
              budgetLimited = true;
              continue;
            }
            fragments.push(candidate);
            retainedPointCount += candidate.points.length;
          }
          return {
            fragments,
            originalFragmentCount: candidates.length,
            retainedFragmentCount: fragments.length,
            originalPointCount: candidates.reduce((sum, candidate) => sum + candidate.points.length, 0),
            retainedPointCount,
            budgetLimited,
            strategy: "none" as const,
          };
        })();
    const geometries: Polyline[] = budgeted.fragments.map(({ points, payload }) => ({
      type: "polyline",
      points,
      opacity: Math.min(0.92, 0.42 + influence * 0.28 + payload.levelIndex / Math.max(1, levels.length - 1) * 0.16),
    }));
    const totalPoints = budgeted.retainedPointCount;
    skippedFragments += budgeted.originalFragmentCount - budgeted.retainedFragmentCount;
    totalFragmentLength = budgeted.fragments.reduce((sum, fragment) => sum + fragmentLength(fragment.points), 0);
    sampledDistanceTotal = budgeted.fragments.reduce((sum, fragment) => sum + fragment.payload.level * fragment.points.length, 0);

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
        maxNodesClipped: budgeted.budgetLimited,
        glyphFieldEnabled: glyph.enabled,
        selectedGlyph: glyph.field ? `${glyph.field.sourceGlyph.textIndex + 1} · ${glyph.field.sourceGlyph.character}` : undefined,
        glyphFieldMode: state.glyphFieldMode,
        averageGlyphFieldValue: fieldSamples ? fieldValueTotal / fieldSamples : 0,
        averageGlyphFieldDisplacement: fieldSamples ? displacementTotal / fieldSamples : 0,
        rejectedDisplacedCandidates,
        fieldInfluencedAcceptanceCount: 0,
        warning: budgeted.budgetLimited
          ? usesFairBudget
            ? "Contour detail was reduced by the maxNodes point budget."
            : "Contour fragments were clipped by the maxNodes point budget."
          : undefined,
      },
    };
  },
};
