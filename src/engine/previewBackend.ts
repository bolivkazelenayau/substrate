import type { PresetId, PreviewBackendPreference, RendererId } from "../types";
import type { PreviewFpsCap } from "../types";

export type PreviewBackend = "svg-dom" | "canvas-2d";

export const DEFAULT_PREVIEW_FPS_CAP: PreviewFpsCap = 30;

export interface PreviewBackendDescriptor {
  id: PreviewBackend;
  label: string;
  detail: string;
  previewOnly: boolean;
}

export const previewBackends: Record<PreviewBackend, PreviewBackendDescriptor> = {
  "canvas-2d": {
    id: "canvas-2d",
    label: "Canvas Performance",
    detail: "preview only",
    previewOnly: true,
  },
  "svg-dom": {
    id: "svg-dom",
    label: "SVG Accuracy",
    detail: "vector DOM",
    previewOnly: true,
  },
};

/** Runtime recommendation metadata. This is deliberately outside ProjectState. */
export const recommendedPreviewBackends: Partial<Record<PresetId, PreviewBackend>> = {
  "Edge Current": "canvas-2d",
};

/**
 * Element count at which the SVG DOM preview becomes a paint bottleneck.
 * Above it, the canvas-2d preference also applies to static renderers: the
 * artwork is painted into a single bitmap instead of one DOM node per mark,
 * which keeps zoom/pan and slider edits off the SVG repaint path. Diagnostics
 * already flag `SVG DEBUG / SLOW` at this same threshold (Viewport).
 */
export const CANVAS_PREVIEW_ELEMENT_THRESHOLD = 500;

export function selectPreviewBackend(
  renderer: RendererId,
  elementCount: number,
  preference: PreviewBackendPreference,
  canvasAvailable = true,
): PreviewBackend {
  if (preference === "svg-dom" || !canvasAvailable) return "svg-dom";
  if (renderer === "flow") return "canvas-2d";
  return elementCount >= CANVAS_PREVIEW_ELEMENT_THRESHOLD ? "canvas-2d" : "svg-dom";
}

export function shouldRunPreviewAnimation(
  usesTime: boolean,
  playing: boolean,
  reducedMotion: boolean,
  exporting: boolean,
): boolean {
  return usesTime && playing && !reducedMotion && !exporting;
}
