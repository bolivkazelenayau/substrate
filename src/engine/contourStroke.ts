import type { ProjectState } from "../types";
import { SDF_REFERENCE_TYPOGRAPHY_SIZE, resolveSdfScaleContext } from "./sdfScale";

export const DEFAULT_CONTOUR_STROKE_WIDTH = 1.4;
export const LEGACY_EXPORT_STROKE_WIDTH = 1.15;
export const LEGACY_PREVIEW_STROKE_WIDTH = 1.4;
export const CONTOUR_STROKE_REFERENCE_TYPOGRAPHY_SIZE = SDF_REFERENCE_TYPOGRAPHY_SIZE;
export const EFFECTIVE_CONTOUR_STROKE_WIDTH_LIMITS = {
  min: 0.1,
  max: 16,
} as const;
export const CONTOUR_STROKE_WIDTH_LIMITS = {
  min: 0.25,
  softMax: 12,
  max: 16,
} as const;

export function resolveContourStrokeWidth(state: Pick<ProjectState, "contourStrokeWidth" | "fontSize">): number {
  const scaled = resolveSdfScaleContext(state).world(state.contourStrokeWidth);
  const clamped = Math.min(
    EFFECTIVE_CONTOUR_STROKE_WIDTH_LIMITS.max,
    Math.max(EFFECTIVE_CONTOUR_STROKE_WIDTH_LIMITS.min, scaled),
  );
  return Number(clamped.toFixed(4));
}

export function supportsContourStrokeWidth(state: ProjectState): boolean {
  return state.renderer === "sdf-contours"
    || (state.renderer === "wave-contours" && state.waveContourMode === "continuous");
}
