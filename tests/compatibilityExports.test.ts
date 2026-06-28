import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { generateCompatibilityExportSet } from "../src/engine/compatibilityExports";
import { parseFontBuffer } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { getSubstratePerformanceWarnings, classifyPerformance } from "../src/engine/performance";
import { baseState } from "../src/engine/presets";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import { getExactSvgByteSize, validateSvgReload } from "../src/engine/svgValidation";
import type { RenderContext } from "../src/types";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let exportsSet: ReturnType<typeof generateCompatibilityExportSet>;
let substrateDiagnostics: RenderContext["substrateData"] extends infer _ ? ReturnType<typeof buildSubstrate>["data"]["diagnostics"] : never;

beforeAll(() => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
  const state = { ...baseState, text: "FORM", font: loaded.metadata, density: 24, maxNodes: 500 };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrate = buildSubstrate({
    sourceText: state.text,
    textGeometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 192, height: 115 },
    bounds: textGeometry.bounds,
  }, canvasFactory).data;
  substrateDiagnostics = substrate.diagnostics;
  exportsSet = generateCompatibilityExportSet({
    state,
    context: { timeMs: 0, frame: 0, textGeometry, substrateData: substrate },
    textGeometry,
  });
});

describe("compatibility export set", () => {
  it("generates every representative export with diagnostics", () => {
    expect(exportsSet.map((entry) => entry.id)).toEqual([
      "editable-text",
      "final-glyph-mask",
      "sdf-flow",
      "sdf-streamlines",
      "sdf-contours",
      "sdf-halftone",
      "wave-contours",
      "glyph-diffuser",
      "stress-high-marks",
      "special-characters",
    ]);
    exportsSet.forEach((entry) => {
      expect(entry.svg.startsWith("<svg")).toBe(true);
      expect(entry.diagnostics.byteSize).toBe(getExactSvgByteSize(entry.svg));
      expect(entry.diagnostics.serializationTimeMs).toBeGreaterThanOrEqual(0);
      expect(entry.diagnostics.generatedElementCount).toBeGreaterThanOrEqual(0);
      expect(entry.diagnostics.pointCount).toBeGreaterThanOrEqual(0);
    });
  });

  it("keeps final artwork vector-only and XML-valid", () => {
    exportsSet.forEach((entry) => {
      const isEditable = entry.id === "editable-text";
      const validation = validateSvgReload(entry.svg, !isEditable && entry.diagnostics.substrateType === "glyph-paths", !isEditable);
      expect(validation.valid, entry.id).toBe(true);
      expect(validation.document?.querySelector("image"), entry.id).toBeNull();
    });
  });

  it("escapes special-character text safely", () => {
    const special = exportsSet.find((entry) => entry.id === "special-characters")!;
    expect(special.svg).toContain("A&amp;&lt;&gt;&quot;");
    expect(validateSvgReload(special.svg, false).valid).toBe(true);
  });

  it("reports exact byte size for multibyte text", () => {
    const svg = "<svg><text>Å</text></svg>";
    expect(getExactSvgByteSize(svg)).toBeGreaterThan(svg.length);
  });
});

describe("performance diagnostics", () => {
  it("exposes finite phase timings", () => {
    expect(substrateDiagnostics).toMatchObject({
      rasterizeTimeMs: expect.any(Number),
      edgeMapTimeMs: expect.any(Number),
      distanceFieldTimeMs: expect.any(Number),
      buildTimeMs: expect.any(Number),
    });
    expect([
      substrateDiagnostics.rasterizeTimeMs,
      substrateDiagnostics.edgeMapTimeMs,
      substrateDiagnostics.distanceFieldTimeMs,
      substrateDiagnostics.buildTimeMs,
    ].every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
  });

  it("classifies warning thresholds and Ultra quality", () => {
    expect(classifyPerformance(99, "Work").severity).toBe("ok");
    expect(classifyPerformance(100, "Work").severity).toBe("noticeable");
    expect(classifyPerformance(250, "Work").severity).toBe("slow");
    expect(classifyPerformance(500, "Work").severity).toBe("severe");
    expect(getSubstratePerformanceWarnings(80, "ultra")).toEqual(["Ultra substrate quality is expensive; cpu-main fallback may block interaction."]);
    expect(getSubstratePerformanceWarnings(500, "high")[0]).toContain("severe");
  });
});
