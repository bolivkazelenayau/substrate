export type SvgTraceMode =
  | "normal"
  | "mask-disabled"
  | "static-mask"
  | "local-clock"
  | "temporal-12"
  | "temporal-8"
  | "cadence-20"
  | "cadence-15"
  | "hybrid-spatial";

export interface SvgTraceConfig {
  mode: SvgTraceMode;
  bucketCount: 8 | 12 | 24;
}

export const DEFAULT_SVG_TRACE_CONFIG: SvgTraceConfig = {
  mode: "normal",
  bucketCount: 24,
};

export function traceConfigForPreviewQuality(quality: PreviewQuality): SvgTraceConfig {
  // Product quality modes always repaint a coherent frame. Balanced and
  // Performance reduce preview-only opacity quantization instead of leaving
  // alternating path cohorts one or two animation frames behind.
  if (quality === "balanced") return { mode: "normal", bucketCount: 12 };
  if (quality === "performance") return { mode: "normal", bucketCount: 8 };
  return DEFAULT_SVG_TRACE_CONFIG;
}
import type { PreviewQuality } from "../types";
