import type { CircleMark, Point, Polyline, RendererDiagnostics } from "../geometry";
import { buildCompositeWaveField, type CompositeWaveField } from "../field/compositeWaveField";
import type { VectorRenderer } from "./types";
import { configuredContourStrokeWidth } from "../contourStroke";

interface Segment { a: Point; b: Point }

// Numeric hash for a quantized point coordinate. Same quantization as the previous
// `${Math.round(point.x*10)},${Math.round(point.y*10)}` string key, packed into a
// single integer so adjacency Maps use numeric keys.
const POINT_KEY_OFFSET = 1_000_000;
const POINT_KEY_SPAN = 2_000_000;
function key(point: Point): number {
  return (Math.round(point.y * 10) + POINT_KEY_OFFSET) * POINT_KEY_SPAN
    + (Math.round(point.x * 10) + POINT_KEY_OFFSET);
}

function segments(field: CompositeWaveField, level: number): Segment[] {
  const result: Segment[] = [];
  const width = field.width;
  const height = field.height;
  if (width <= 1 || height <= 1) return result;
  const data = field.data;
  const invWidthMinusOne = 1 / (width - 1);
  const invHeightMinusOne = 1 / (height - 1);
  const domain = field.worldBounds;
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const idx = y * width + x;
      // Read the four corner field values directly. Avoids allocating a `corners`
      // array of [x, y, value] tuples per cell across the whole field sweep.
      const v00 = data[idx];
      const v10 = data[idx + 1];
      const v11 = data[idx + width + 1];
      const v01 = data[idx + width];
      const above00 = v00 >= level;
      const above10 = v10 >= level;
      const above11 = v11 >= level;
      const above01 = v01 >= level;
      // Same four edges as [[0,1],[1,2],[2,3],[3,0]], walked inline so the
      // `edgePairs` array and intermediate crossings array are not allocated per
      // cell. Wave Contours does not use the center-value disambiguation used by
      // SDF Contours, so the 4-crossing case mirrors the original pairing.
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
        result.push({ a: { x: c0x, y: c0y }, b: { x: c1x, y: c1y } });
      } else if (crossingCount === 4) {
        result.push(
          { a: { x: c0x, y: c0y }, b: { x: c1x, y: c1y } },
          { a: { x: c2x, y: c2y }, b: { x: c3x, y: c3y } },
        );
      }
    }
  }
  return result;
}

function stitch(input: Segment[]): Point[][] {
  const adjacency = new Map<number, number[]>();
  for (let index = 0; index < input.length; index += 1) {
    const segment = input[index];
    const keyA = key(segment.a);
    const keyB = key(segment.b);
    const entriesA = adjacency.get(keyA);
    if (entriesA) entriesA.push(index);
    else adjacency.set(keyA, [index]);
    const entriesB = adjacency.get(keyB);
    if (entriesB) entriesB.push(index);
    else adjacency.set(keyB, [index]);
  }
  const used = new Uint8Array(input.length);
  const fragments: Point[][] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (used[index]) continue;
    used[index] = 1;
    const segment = input[index];
    const points: Point[] = [segment.a, segment.b];
    while (true) {
      const endpoint = points[points.length - 1];
      const entries = adjacency.get(key(endpoint));
      let nextIndex = -1;
      if (entries) {
        for (let k = 0; k < entries.length; k += 1) {
          if (!used[entries[k]]) { nextIndex = entries[k]; break; }
        }
      }
      if (nextIndex < 0) break;
      used[nextIndex] = 1;
      const next = input[nextIndex];
      const keyEndpoint = key(endpoint);
      points.push(key(next.a) === keyEndpoint ? next.b : next.a);
    }
    fragments.push(points);
  }
  return fragments;
}

function resample(points: Point[], spacing: number, radius: number, remaining: number): CircleMark[] {
  const dots: CircleMark[] = [];
  let carry = 0;
  for (let index = 1; index < points.length && dots.length < remaining; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    for (let distance = carry; distance <= length && dots.length < remaining; distance += spacing) {
      const t = length > 0 ? distance / length : 0;
      dots.push({ type: "circle", center: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, radius, opacity: 0.78 });
    }
    carry = Math.max(0, spacing - ((length - carry) % spacing));
  }
  return dots;
}

function fallback(warning: string): RendererDiagnostics {
  return { acceptedCandidates: 0, rejectedCandidates: 0, averageSampledDistance: 0, substrateAvailable: false, fallback: true, contourLevelCount: 0, totalContourPoints: 0, maxNodesClipped: false, warning };
}

export const waveContoursRenderer: VectorRenderer = {
  id: "wave-contours",
  label: "Wave Contours",
  supportedControls: ["density", "amplitude", "frequency", "edgeInfluence", "maxNodes"],
  svgElementType: "mixed",
  usesTime: false,
  usesSubstrate: true,
  strokeWidth: (state) => state.waveContourMode === "continuous"
    ? configuredContourStrokeWidth(state)
    : undefined,
  estimateCost: (state) => ({ marks: Math.round(state.density / 5), nodes: state.maxNodes, label: `≤ ${state.maxNodes.toLocaleString()} nodes` }),
  generateGeometry(state, context) {
    const field = context.glyphField ?? buildCompositeWaveField(state, context);
    if (!field) return { id: "wave-contours", geometries: [], diagnostics: fallback("Wave Contours requires an enabled glyph emitter and non-empty substrate.") };
    const extractionStarted = performance.now();
    const levelCount = Math.max(3, Math.min(18, Math.round(state.density / 5)));
    const magnitude = Math.max(Math.abs(field.min), Math.abs(field.max));
    const levels = Array.from({ length: levelCount }, (_, index) => -magnitude * 0.88 + index / Math.max(1, levelCount - 1) * magnitude * 1.76);
    const geometries: Array<Polyline | CircleMark> = [];
    let pointCount = 0;
    let fragments = 0;
    let clipped = false;
    for (const level of levels) {
      for (const points of stitch(segments(field, level))) {
        if (points.length < 3) continue;
        fragments += 1;
        if (state.waveContourMode === "dotted") {
          const dots = resample(points, state.waveDotSpacing, state.waveDotRadius, state.maxNodes - geometries.length);
          geometries.push(...dots);
          if (geometries.length >= state.maxNodes) clipped = true;
        } else if (pointCount + points.length <= state.maxNodes) {
          geometries.push({ type: "polyline", points, opacity: 0.72 });
          pointCount += points.length;
        } else clipped = true;
        if (clipped) break;
      }
      if (clipped) break;
    }
    return {
      id: "wave-contours",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates: 0,
        averageSampledDistance: 0,
        substrateAvailable: true,
        fallback: false,
        contourLevelCount: levels.length,
        extractedFragments: fragments,
        skippedFragments: 0,
        totalContourPoints: state.waveContourMode === "dotted" ? geometries.length : pointCount,
        maxPositiveDistance: magnitude,
        averageFragmentLength: 0,
        maxNodesClipped: clipped,
        selectedGlyph: `${field.sourceGlyph.textIndex + 1} · ${field.sourceGlyph.character}`,
        emitterAnchorX: field.anchor.x,
        emitterAnchorY: field.anchor.y,
        fieldWidth: field.width,
        fieldHeight: field.height,
        fieldMin: field.min,
        fieldMax: field.max,
        fieldBuildTimeMs: field.buildTimeMs,
        contourExtractionTimeMs: Math.max(0, performance.now() - extractionStarted),
        fieldMembership: "glyph-bounds-approximate",
        waveContourMode: state.waveContourMode,
        emitterSourceMode: state.emitter.sourceMode,
        waveOutputCount: geometries.length,
        warning: clipped ? "Wave contour output was clipped by maxNodes." : undefined,
      },
    };
  },
};
