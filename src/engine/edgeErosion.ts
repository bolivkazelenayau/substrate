import type { ProjectState, RenderContext } from "../types";
import { createSeededRandom } from "./random";
import { sampleGlyphField } from "./field/compositeWaveField";
import { sampleDistance, sampleEdge, sampleMask } from "./substrate";

export interface EdgeErosionMark {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

export const MAX_EDGE_EROSION_MARKS = 320;

export function generateEdgeErosionMarks(state: ProjectState, context: RenderContext): EdgeErosionMark[] {
  const substrate = context.substrateData;
  if (
    state.diffuserComposition !== "edge-eroded"
    || state.overlayMode === "hidden"
    || state.overlayMode === "outline"
    || state.edgeErosionAmount <= 0
    || state.edgeErosionWidth <= 0
    || !substrate
    || substrate.substrateType === "empty"
  ) return [];

  const amount = Math.max(0, Math.min(1, state.edgeErosionAmount));
  const protection = Math.max(0, Math.min(1, state.interiorProtection));
  const rasterFloor = Math.max(substrate.scaleX, substrate.scaleY) * 1.5;
  const edgeBand = Math.max(rasterFloor, state.edgeErosionWidth * (1 - protection * 0.62));
  const baseRadius = Math.max(rasterFloor * 0.7, state.edgeErosionWidth * (0.07 + amount * 0.13));
  const spacing = Math.max(3.5, state.edgeErosionWidth * (0.42 - amount * 0.16));
  const bounds = substrate.bounds ?? { x: 0, y: 0, width: substrate.viewportWidth, height: substrate.viewportHeight };
  const random = createSeededRandom(state.seed ^ 0x6e624eb7);
  const field = context.glyphField ?? null;
  const fieldPeak = field ? Math.max(0.001, Math.abs(field.min), Math.abs(field.max)) : 1;
  const marks: EdgeErosionMark[] = [];
  const maxMarks = Math.min(MAX_EDGE_EROSION_MARKS, Math.max(8, Math.round(24 + amount * 296)));

  outer:
  for (let y = bounds.y - edgeBand; y <= bounds.y + bounds.height + edgeBand; y += spacing) {
    for (let x = bounds.x - edgeBand; x <= bounds.x + bounds.width + edgeBand; x += spacing) {
      const candidateX = x + (random() * 2 - 1) * spacing * 0.46;
      const candidateY = y + (random() * 2 - 1) * spacing * 0.46;
      if (sampleMask(substrate, candidateX, candidateY) < 0.52) continue;
      const distance = sampleDistance(substrate, candidateX, candidateY);
      if (!Number.isFinite(distance) || distance <= 0 || distance > edgeBand) continue;

      const edgeSignal = Math.max(0, Math.min(1, sampleEdge(substrate, candidateX, candidateY) * 1.8));
      const fieldSignal = field
        ? Math.max(0, Math.min(1, Math.abs(context.sampleGlyphField?.(candidateX, candidateY) ?? sampleGlyphField(field, candidateX, candidateY)) / fieldPeak))
        : 0.35;
      const crestBias = 0.18 + edgeSignal * 0.34 + fieldSignal * 0.48;
      if (random() > amount * crestBias) continue;

      const radiusNoise = 0.68 + random() * 0.72;
      const radius = baseRadius * radiusNoise * (0.72 + fieldSignal * 0.5);
      // A bite must overlap the boundary. Candidates deeper than their radius cannot
      // affect the edge and are rejected, preserving the solid stroke center.
      if (distance > radius * (0.72 + amount * 0.32)) continue;

      marks.push({
        x: candidateX,
        y: candidateY,
        radius,
        opacity: Math.min(1, 0.72 + amount * 0.28),
      });
      if (marks.length >= maxMarks) break outer;
    }
  }
  return marks;
}
