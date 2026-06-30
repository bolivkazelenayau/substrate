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

export function selectPreviewBackend(
  renderer: RendererId,
  _elementCount: number,
  preference: PreviewBackendPreference,
  canvasAvailable = true,
): PreviewBackend {
  if (renderer !== "flow" || preference === "svg-dom" || !canvasAvailable) return "svg-dom";
  return "canvas-2d";
}

export function shouldRunPreviewAnimation(
  usesTime: boolean,
  playing: boolean,
  reducedMotion: boolean,
  exporting: boolean,
): boolean {
  return usesTime && playing && !reducedMotion && !exporting;
}
