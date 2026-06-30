import { useState } from "react";
import { DEFAULT_PREVIEW_FPS_CAP } from "../engine/previewBackend";
import type { PreviewSettings } from "../types";

export function createDefaultPreviewSettings(): PreviewSettings {
  return {
    fpsCap: DEFAULT_PREVIEW_FPS_CAP,
    pauseWhenHidden: true,
    reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    backend: "canvas-2d",
    quality: "full",
  };
}

export function usePreviewSettings() {
  return useState<PreviewSettings>(createDefaultPreviewSettings);
}
