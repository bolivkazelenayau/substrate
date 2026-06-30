import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCanvas, Path2D } from "@napi-rs/canvas";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { getTextLayout } from "../src/engine/textLayout";
import { validateSvgReload } from "../src/engine/svgValidation";
import { COLORS } from "../src/engine/constants";
import { buildCompositeWaveField, createGlyphFieldContext } from "../src/engine/field/compositeWaveField";
import type { ProjectState, RenderContext } from "../src/types";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;
let baseDiffuserState: ProjectState;
let context: RenderContext;

beforeAll(async () => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
  baseDiffuserState = {
    ...baseState,
    text: "WAVE",
    font: loaded.metadata,
    renderer: "glyph-diffuser",
    density: 42,
    maxNodes: 800,
    diffuserDomain: "text-halo",
    diffuserComposition: "behind-text",
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 320, neighborInfluence: 1, falloff: "gaussian" },
  };
  const textGeometry = layoutGlyphs(baseDiffuserState, loaded);
  const layout = getTextLayout(baseDiffuserState, true);
  const substrateData = buildSubstrate({
    sourceText: baseDiffuserState.text,
    textGeometry,
    fontSize: baseDiffuserState.fontSize,
    tracking: baseDiffuserState.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 192, height: 115 },
    bounds: textGeometry.bounds,
  }, canvasFactory).data;
  context = { timeMs: 0, frame: 0, textGeometry, substrateData };
});

function parse(svg: string) {
  return new DOMParser().parseFromString(svg, "image/svg+xml");
}

function warpedContext(warpState: ProjectState): RenderContext {
  const baseContext: RenderContext = { ...context, textGeometry: context.textGeometry };
  const field = buildCompositeWaveField(warpState, baseContext);
  return { ...baseContext, ...createGlyphFieldContext(field) };
}

describe("Text overlay modes", () => {
  it("regular outline with parsed font emits stroke-only vector glyph paths with fill='none'", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline", outlineStrokeWidth: 1.5 };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlay = document.querySelector("#diffuser-text-overlay");
    expect(overlay).not.toBeNull();
    const innerGroup = overlay!.querySelector("g");
    expect(innerGroup).not.toBeNull();
    expect(innerGroup!.getAttribute("fill")).toBe("none");
    expect(innerGroup!.getAttribute("stroke")).toBe(COLORS.artwork);
    expect(innerGroup!.getAttribute("stroke-width")).toBe("1.5");
    expect(innerGroup!.getAttribute("fill-rule")).toBe("evenodd");
    expect(innerGroup!.getAttribute("stroke-linejoin")).toBe("round");
    expect(innerGroup!.getAttribute("stroke-linecap")).toBe("round");
    // No edge-erosion mask should be applied to the outline overlay.
    expect(innerGroup!.getAttribute("mask")).toBeNull();
  });

  it("regular outline emits a visible stroke and does not collapse glyph fills", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline", outlineStrokeWidth: 1.5 };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlayPaths = document.querySelectorAll("#diffuser-text-overlay path");
    expect(overlayPaths.length).toBeGreaterThan(0);
    overlayPaths.forEach((path) => {
      expect(path.getAttribute("d")?.length).toBeGreaterThan(0);
      // Each glyph path is independent; no data-warped-glyph attribute.
      expect(path.hasAttribute("data-warped-glyph")).toBe(false);
      expect(path.hasAttribute("data-character-index")).toBe(true);
      expect(path.hasAttribute("data-glyph-index")).toBe(true);
    });
  });

  it("regular outline does not emit warped-outline geometry", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline" };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    expect(document.querySelector("#diffuser-text-overlay path[data-warped-glyph]")).toBeNull();
  });

  it("regular outline does not use the edge-erosion mask even when erosion composition is active", () => {
    const state: ProjectState = {
      ...baseDiffuserState,
      overlayMode: "outline",
      diffuserComposition: "edge-eroded",
      edgeErosionAmount: 1,
      edgeErosionWidth: 32,
    };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner).not.toBeNull();
    // The overlay group must NOT carry the erosion mask reference even when
    // composition = edge-eroded; outline stays clean.
    expect(overlayInner!.getAttribute("mask")).toBeNull();
    expect(overlayInner!.getAttribute("fill")).toBe("none");
    expect(overlayInner!.getAttribute("stroke")).toBe(COLORS.artwork);
  });

  it("does not merge glyph contours across glyphs into a single path", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline" };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const paths = document.querySelectorAll("#diffuser-text-overlay path");
    expect(paths.length).toBe(context.textGeometry!.glyphs.filter((glyph) => glyph.path.d.length > 0).length);
  });

  it("uses the dedicated outlineStrokeWidth, not the erosion width, as the stroke width", () => {
    const state: ProjectState = {
      ...baseDiffuserState,
      overlayMode: "outline",
      outlineStrokeWidth: 3.5,
      edgeErosionWidth: 32,
    };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner!.getAttribute("stroke-width")).toBe("3.5");
  });

  it("native SVG fallback outline emits stroke-only text", () => {
    const nativeState: ProjectState = {
      ...baseDiffuserState,
      font: null,
      overlayMode: "outline",
      outlineStrokeWidth: 2,
    };
    const svg = createSvg(nativeState, { ...context, textGeometry: null }, null);
    const document = parse(svg);
    expect(validateSvgReload(svg, false).valid).toBe(true);
    const overlayText = document.querySelector("#diffuser-text-overlay text");
    expect(overlayText).not.toBeNull();
    // The text element itself is filled "none"; stroke is set on the wrapping group
    // and inherited by the text, so the outline is stroke-only.
    expect(overlayText!.getAttribute("fill")).toBe("none");
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner).not.toBeNull();
    expect(overlayInner!.getAttribute("fill")).toBe("none");
    expect(overlayInner!.getAttribute("stroke")).toBe(COLORS.artwork);
    expect(overlayInner!.getAttribute("stroke-width")).toBe("2");
    // No warped-outline geometry in native fallback outline mode.
    expect(document.querySelector("#diffuser-text-overlay [data-warped-glyph]")).toBeNull();
  });

  it("solid overlay remains filled and unstroked", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "solid" };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner!.getAttribute("fill")).toBe(COLORS.artwork);
    expect(overlayInner!.getAttribute("stroke")).toBe("none");
  });

  it("hidden overlay emits no text overlay group", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "hidden" };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    expect(document.querySelector("#diffuser-text-overlay")).toBeNull();
  });

  it("warped-outline still works separately and emits data-warped-glyph attributes", () => {
    const warpState: ProjectState = {
      ...baseDiffuserState,
      overlayMode: "warped-outline",
      outlineWarpAmount: 20,
      outlineWarpMaxDisplacement: 12,
    };
    const wctx = warpedContext(warpState);
    const svg = createSvg(warpState, wctx, context.textGeometry);
    const document = parse(svg);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    const warped = document.querySelectorAll("#diffuser-text-overlay path[data-warped-glyph]");
    expect(warped.length).toBeGreaterThan(0);
    // Warped outline is a fill-based overlay (not stroke-only).
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner!.getAttribute("fill")).toBe(COLORS.artwork);
    expect(overlayInner!.getAttribute("stroke")).toBe("none");
    expect(overlayInner!.getAttribute("fill-rule")).toBe("evenodd");
  });

  it("final artwork export remains vector-only and DOMParser-validation passes", () => {
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline" };
    const svg = createSvg(state, context, context.textGeometry);
    expect(validateSvgReload(svg, true).valid).toBe(true);
    expect(svg).not.toMatch(/<image|<canvas|data:image|png|jpe?g/i);
    expect(svg).toMatch(/<path\b/);
  });

  it("editable text export remains native SVG text without warped or outline geometry", () => {
    const state: ProjectState = {
      ...baseDiffuserState,
      overlayMode: "outline",
      exportMode: "editable",
    };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    expect(validateSvgReload(svg, false, false).valid).toBe(true);
    expect(document.querySelector("#generated-artwork text")?.textContent).toBe(state.text);
    expect(document.querySelector("#diffuser-text-overlay")).toBeNull();
    expect(document.querySelector("[data-warped-glyph]")).toBeNull();
  });

  it("outline stroke-width uses the project schema default when not set", () => {
    expect(baseState.outlineStrokeWidth).toBe(1.5);
    const state: ProjectState = { ...baseDiffuserState, overlayMode: "outline" };
    const svg = createSvg(state, context, context.textGeometry);
    const document = parse(svg);
    const overlayInner = document.querySelector("#diffuser-text-overlay > g");
    expect(overlayInner!.getAttribute("stroke-width")).toBe("1.5");
  });
});
