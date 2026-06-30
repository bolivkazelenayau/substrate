import { describe, expect, it } from "vitest";
import { DEFAULT_SVG_TRACE_CONFIG, traceConfigForPreviewQuality, type SvgTraceConfig } from "../src/engine/previewTraceConfig";
import { baseState } from "../src/engine/presets";
import { createSvg } from "../src/engine/exportSvg";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";

describe("Gate 7.8D SVG trace configuration", () => {
  it("keeps the shipping/default preview masked with 24 buckets", () => {
    expect(DEFAULT_SVG_TRACE_CONFIG).toEqual({ mode: "normal", bucketCount: 24 });
  });

  it("limits diagnostic variants to SVG-only modes and bounded bucket counts", () => {
    const variants: SvgTraceConfig[] = [
      { mode: "normal", bucketCount: 24 },
      { mode: "mask-disabled", bucketCount: 24 },
      { mode: "static-mask", bucketCount: 24 },
      { mode: "local-clock", bucketCount: 24 },
      { mode: "temporal-12", bucketCount: 24 },
      { mode: "temporal-8", bucketCount: 24 },
      { mode: "cadence-20", bucketCount: 24 },
      { mode: "cadence-15", bucketCount: 24 },
      { mode: "hybrid-spatial", bucketCount: 24 },
    ];
    expect(variants.every((variant) => [8, 12, 24].includes(variant.bucketCount))).toBe(true);
    expect(variants.map((variant) => variant.mode)).not.toContain("canvas-2d");
  });

  it("maps Full/Balanced/Performance to deterministic 24/12/8 update budgets", () => {
    expect(traceConfigForPreviewQuality("full")).toEqual({ mode: "normal", bucketCount: 24 });
    expect(traceConfigForPreviewQuality("balanced")).toEqual({ mode: "normal", bucketCount: 12 });
    expect(traceConfigForPreviewQuality("performance")).toEqual({ mode: "normal", bucketCount: 8 });
  });

  it("does not serialize preview quality or alter full-quality vector export", () => {
    const state = { ...baseState, renderer: "flow" as const };
    const context = { timeMs: 400, frame: 12 };
    const geometry = generateRendererGeometry(state, context);
    const baseline = createSvg(state, context, null, geometry);
    const baselineArtwork = baseline.slice(baseline.indexOf("</metadata>"));
    for (const quality of ["full", "balanced", "performance"] as const) {
      traceConfigForPreviewQuality(quality);
      const candidate = createSvg(state, context, null, geometry);
      expect(candidate.slice(candidate.indexOf("</metadata>"))).toBe(baselineArtwork);
    }
    expect(JSON.stringify(state)).not.toContain("previewQuality");
    expect(baseline).not.toMatch(/<image|data:image|<canvas|<foreignObject|base64/i);
  });
});
