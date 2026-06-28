import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { getExportBudgetWarnings } from "../src/engine/exportBudget";
import { parseFontBuffer } from "../src/engine/fontLoader";
import { geometryNodeCost } from "../src/engine/geometry";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry, clearRendererGeometryCache } from "../src/engine/rendererRuntime";
import { rendererList } from "../src/engine/renderers";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import type { ProjectState, RenderContext } from "../src/types";
import { getControlActivity } from "../src/engine/controlOwnership";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let context: RenderContext;

beforeAll(() => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
  const state = { ...baseState, text: "TYPE", font: loaded.metadata };
  const textGeometry = layoutGlyphs(state, loaded);
  const layout = getTextLayout(state, true);
  const substrateData = buildSubstrate({
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
  context = { timeMs: 120, frame: 7, textGeometry, substrateData };
});

describe("renderer quality contracts", () => {
  it("declares complete capability metadata and supported controls", () => {
    expect(rendererList).toHaveLength(9);
    rendererList.forEach((renderer) => {
      expect(renderer.id).toBeTruthy();
      expect(renderer.label).toBeTruthy();
      expect(renderer.supportedControls.length).toBeGreaterThan(0);
      expect(typeof renderer.usesTime).toBe("boolean");
      expect(typeof renderer.usesSubstrate).toBe("boolean");
      expect(renderer.svgElementType).toBeTruthy();
    });
  });

  it("keeps Flow Lines as the only time-consuming renderer", () => {
    expect(rendererList.filter((renderer) => renderer.usesTime).map((renderer) => renderer.id)).toEqual(["flow"]);
  });

  it("respects maxNodes according to each geometry type", () => {
    rendererList.forEach((renderer) => {
      const state: ProjectState = {
        ...baseState,
        renderer: renderer.id,
        density: 80,
        maxNodes: 60,
      };
      const group = renderer.generateGeometry(state, context);
      expect(geometryNodeCost(group), renderer.id).toBeLessThanOrEqual(state.maxNodes);
    });
  });

  it("memoizes static output without changing geometry", () => {
    clearRendererGeometryCache();
    const staticState = { ...baseState, renderer: "sdf-halftone" as const, maxNodes: 120 };
    const first = generateRendererGeometry(staticState, context);
    const laterContext = { ...context, timeMs: 9999, frame: 600 };
    const second = generateRendererGeometry(staticState, laterContext);
    expect(second).toBe(first);
    expect(second).toEqual(first);
  });

  it("regenerates animated Flow Lines while preserving deterministic frame output", () => {
    const animatedState = { ...baseState, renderer: "flow" as const, maxNodes: 120 };
    const first = generateRendererGeometry(animatedState, { ...context, timeMs: 500, frame: 15 });
    const sameFrame = generateRendererGeometry(animatedState, { ...context, timeMs: 500, frame: 15 });
    const later = generateRendererGeometry(animatedState, { ...context, timeMs: 900, frame: 27 });
    expect(sameFrame).not.toBe(first);
    expect(sameFrame).toEqual(first);
    expect(later).not.toEqual(first);
  });

  it("debug overlay changes do not alter or regenerate static geometry", () => {
    clearRendererGeometryCache();
    const state = { ...baseState, renderer: "sdf-contours" as const, maxNodes: 180 };
    const first = generateRendererGeometry(state, context);
    const debugChanged = generateRendererGeometry({
      ...state,
      debug: { ...state.debug, maskBounds: true, glyphOrigins: true, substrateMode: "distance" },
    }, context);
    expect(debugChanged).toBe(first);
    expect(debugChanged).toEqual(first);
  });

  it("marks Glyph Modulation inactive for Glyph Diffuser and active for SDF consumers", () => {
    const diffuser = getControlActivity({ ...baseState, renderer: "glyph-diffuser", overlayMode: "warped-outline" }, true);
    expect(diffuser).toMatchObject({
      glyphModulation: false,
      diffuser: true,
      warp: true,
    });
    const contours = getControlActivity({ ...baseState, renderer: "sdf-contours" }, true);
    expect(contours).toMatchObject({
      glyphModulation: true,
      glyphDensityModulation: false,
      glyphRadiusModulation: false,
      glyphOpacityModulation: false,
    });
    const streamlines = getControlActivity({ ...baseState, renderer: "sdf-streamlines" }, true);
    expect(streamlines).toMatchObject({ glyphModulation: true, glyphDensityModulation: true, glyphRadiusModulation: false });
    const halftone = getControlActivity({ ...baseState, renderer: "sdf-halftone" }, true);
    expect(halftone).toMatchObject({
      glyphModulation: true,
      glyphDensityModulation: true,
      glyphRadiusModulation: true,
      glyphOpacityModulation: true,
    });
  });

  it("reports native warped-outline fallback as inactive and explicit", () => {
    expect(getControlActivity({ ...baseState, renderer: "glyph-diffuser", overlayMode: "warped-outline" }, false)).toMatchObject({
      parsedFontPaths: false,
      warp: false,
      effectiveOverlay: "solid fallback",
      disabledReason: "warped outline requires parsed font paths",
    });
  });

  it("does not regenerate Glyph Diffuser geometry for inactive modulation controls", () => {
    clearRendererGeometryCache();
    const state = {
      ...baseState,
      renderer: "glyph-diffuser" as const,
      emitter: { ...baseState.emitter, enabled: true },
      maxNodes: 120,
    };
    const first = generateRendererGeometry(state, context);
    const inactiveChanged = generateRendererGeometry({
      ...state,
      glyphFieldMode: "strong",
      glyphFieldInfluence: 100,
      glyphFieldDisplacement: 40,
      glyphFieldDensity: 100,
      glyphFieldRadius: 100,
      glyphFieldOpacity: 100,
    }, context);
    expect(inactiveChanged).toBe(first);
  });

  it("reports export budget risks without blocking export", () => {
    const warnings = getExportBudgetWarnings({
      geometryType: "polyline",
      elementCount: 3000,
      pointCount: 9000,
      estimatedSvgNodes: 9000,
      estimatedByteSize: 600_000,
      maxNodesClipped: true,
      substrateType: "native-text",
    });
    expect(warnings).toHaveLength(5);
    expect(warnings.join(" ")).toContain("native-text");
    expect(getExportBudgetWarnings({
      geometryType: "circle",
      elementCount: 10,
      pointCount: 10,
      estimatedSvgNodes: 10,
      estimatedByteSize: 2000,
      maxNodesClipped: false,
      substrateType: "glyph-paths",
    })).toEqual([]);
    expect(getExportBudgetWarnings({
      geometryType: "circle",
      elementCount: 10,
      pointCount: 10,
      estimatedSvgNodes: 10,
      estimatedByteSize: 2000,
      exactByteSize: 600_000,
      maxNodesClipped: false,
      substrateType: "glyph-paths",
    })).toContain("Exact SVG size is high.");
  });
});
