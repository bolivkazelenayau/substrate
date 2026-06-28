import type { CircleMark, Point, Polyline, RendererDiagnostics } from "../geometry";
import { buildCompositeWaveField, type CompositeWaveField } from "../field/compositeWaveField";
import type { VectorRenderer } from "./types";

interface Segment { a: Point; b: Point }
const key = (point: Point) => `${Math.round(point.x * 10)},${Math.round(point.y * 10)}`;

function interpolate(field: CompositeWaveField, x1: number, y1: number, v1: number, x2: number, y2: number, v2: number, level: number): Point {
  const amount = Math.abs(v2 - v1) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v1) / (v2 - v1)));
  return {
    x: (x1 + (x2 - x1) * amount) / (field.width - 1) * field.viewportWidth,
    y: (y1 + (y2 - y1) * amount) / (field.height - 1) * field.viewportHeight,
  };
}

function segments(field: CompositeWaveField, level: number) {
  const result: Segment[] = [];
  for (let y = 0; y < field.height - 1; y += 1) for (let x = 0; x < field.width - 1; x += 1) {
    const corners = [
      [x, y, field.data[y * field.width + x]],
      [x + 1, y, field.data[y * field.width + x + 1]],
      [x + 1, y + 1, field.data[(y + 1) * field.width + x + 1]],
      [x, y + 1, field.data[(y + 1) * field.width + x]],
    ] as const;
    const crossings: Point[] = [];
    for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0]] as const) {
      if ((corners[a][2] >= level) !== (corners[b][2] >= level)) {
        crossings.push(interpolate(field, corners[a][0], corners[a][1], corners[a][2], corners[b][0], corners[b][1], corners[b][2], level));
      }
    }
    if (crossings.length === 2) result.push({ a: crossings[0], b: crossings[1] });
    if (crossings.length === 4) result.push({ a: crossings[0], b: crossings[1] }, { a: crossings[2], b: crossings[3] });
  }
  return result;
}

function stitch(input: Segment[]) {
  const adjacency = new Map<string, number[]>();
  input.forEach((segment, index) => [segment.a, segment.b].forEach((point) => adjacency.set(key(point), [...(adjacency.get(key(point)) ?? []), index])));
  const used = new Uint8Array(input.length);
  const fragments: Point[][] = [];
  input.forEach((segment, index) => {
    if (used[index]) return;
    used[index] = 1;
    const points = [segment.a, segment.b];
    while (true) {
      const endpoint = points[points.length - 1];
      const nextIndex = (adjacency.get(key(endpoint)) ?? []).find((candidate) => !used[candidate]);
      if (nextIndex === undefined) break;
      used[nextIndex] = 1;
      const next = input[nextIndex];
      points.push(key(next.a) === key(endpoint) ? next.b : next.a);
    }
    fragments.push(points);
  });
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
