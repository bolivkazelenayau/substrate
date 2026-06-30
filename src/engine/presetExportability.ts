import type { ExportMode, PresetId } from "../types";

export type PresetExportKind = "vector" | "preview-only";

export const PREVIEW_ONLY_EXPORT_WARNING =
  "This preset is preview-only and cannot be exported as Final Artwork SVG.";

export const presetExportKinds: Record<PresetId, PresetExportKind> = {
  "Edge Current": "vector",
  "Sonic Ripple": "vector",
  "Signal Dust": "vector",
  "SDF Current": "vector",
  "Contour Thread": "vector",
  "Topographic Type": "vector",
  "Halftone Press": "vector",
  "Glyph Ripple": "vector",
  "Dotted Diffuser": "vector",
  "Sonic Halftone": "vector",
  "Sonic Contours": "vector",
  "Sonic Stream": "vector",
  "Sonic Diffuser": "vector",
  "Sonic Warp": "vector",
  "Sonic Interference": "vector",
  "Counter Resonance": "vector",
  "Split Field": "vector",
  Custom: "vector",
};

export function assertFinalArtworkExportable(exportKind: PresetExportKind, exportMode: ExportMode) {
  if (exportMode === "artwork" && exportKind === "preview-only") {
    throw new Error(PREVIEW_ONLY_EXPORT_WARNING);
  }
}

export function assertPresetExportable(preset: PresetId, exportMode: ExportMode) {
  assertFinalArtworkExportable(presetExportKinds[preset], exportMode);
}
