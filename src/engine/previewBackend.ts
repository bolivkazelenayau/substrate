import type { PreviewBackendPreference, RendererId } from "../types";
import type { PreviewFpsCap } from "../types";

export type PreviewBackend = "svg-dom" | "canvas-2d";

export const FLOW_CANVAS_THRESHOLD = 500;
export const DEFAULT_PREVIEW_FPS_CAP: PreviewFpsCap = 30;

export function selectPreviewBackend(
  renderer: RendererId,
  elementCount: number,
  preference: PreviewBackendPreference,
  canvasAvailable = true,
): PreviewBackend {
  if (renderer !== "flow" || preference === "svg-dom" || !canvasAvailable) return "svg-dom";
  if (preference === "canvas-2d") return "canvas-2d";
  return elementCount >= FLOW_CANVAS_THRESHOLD ? "canvas-2d" : "svg-dom";
}

export function shouldRunPreviewAnimation(
  usesTime: boolean,
  playing: boolean,
  reducedMotion: boolean,
  exporting: boolean,
): boolean {
  return usesTime && playing && !reducedMotion && !exporting;
}
