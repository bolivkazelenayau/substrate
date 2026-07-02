import type { ProjectState } from "../types";

export const DEFAULT_CONTOUR_STROKE_WIDTH = 1.15;
export const LEGACY_EXPORT_STROKE_WIDTH = 1.15;
export const CONTOUR_STROKE_WIDTH_LIMITS = {
  min: 0.25,
  softMax: 12,
  max: 16,
} as const;

export function configuredContourStrokeWidth(state: ProjectState): number | undefined {
  return state.contourStrokeWidth === DEFAULT_CONTOUR_STROKE_WIDTH
    ? undefined
    : state.contourStrokeWidth;
}

export function supportsContourStrokeWidth(state: ProjectState): boolean {
  return state.renderer === "sdf-contours"
    || (state.renderer === "wave-contours" && state.waveContourMode === "continuous");
}
