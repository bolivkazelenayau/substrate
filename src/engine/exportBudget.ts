import type { GeometrySummary } from "./rendererRuntime";

export interface ExportBudgetInput extends GeometrySummary {
  substrateType: "glyph-paths" | "native-text";
  exactByteSize?: number;
}

export function getExportBudgetWarnings(input: ExportBudgetInput): string[] {
  const warnings: string[] = [];
  const measuredSize = input.exactByteSize ?? input.estimatedByteSize;
  if (measuredSize >= 500_000) warnings.push(`${input.exactByteSize === undefined ? "Estimated" : "Exact"} SVG size is high.`);
  if (input.elementCount >= 2_500) warnings.push("SVG element count is high.");
  if (input.pointCount >= 8_000) warnings.push("Vector point count is high.");
  if (input.maxNodesClipped) warnings.push("Renderer output was clipped by maxNodes.");
  if (input.substrateType === "native-text") warnings.push("Artwork uses the native-text substrate fallback.");
  return warnings;
}
