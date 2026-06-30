import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getSvgDiagnostics, validateSvgReload } from "../src/engine/svgValidation";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const context = { timeMs: 0, frame: 0 };
let loaded: LoadedFont;

beforeAll(() => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
});

const lightState = { ...baseState, text: "TYPE", density: 1, maxNodes: 20 };

describe("SVG export", () => {
  it("uses a path-based mask when glyph geometry is available", () => {
    const state = { ...lightState, font: loaded.metadata };
    const geometry = layoutGlyphs(state, loaded);
    const svg = createSvg(state, context, geometry);
    const validation = validateSvgReload(svg, true);
    expect(validation.errors).toEqual([]);
    expect(validation.document?.querySelectorAll("#substrate-mask path[data-glyph-index]")).toHaveLength(4);
    expect(validation.document?.querySelector("#substrate-mask text")).toBeNull();
  });

  it("uses native text fallback without loaded glyph geometry", () => {
    const svg = createSvg(lightState, context, null);
    const validation = validateSvgReload(svg, false);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelector("#substrate-mask text")?.textContent).toBe("TYPE");
    expect(validation.document?.querySelector("#substrate-mask path")).toBeNull();
  });

  it("keeps Editable Text export as native SVG text", () => {
    const state = { ...lightState, exportMode: "editable" as const, font: loaded.metadata };
    const geometry = layoutGlyphs(state, loaded);
    const svg = createSvg(state, context, geometry);
    const validation = validateSvgReload(svg, false, false);
    expect(validation.valid).toBe(true);
    const editableText = validation.document?.querySelector("#generated-artwork text");
    expect(editableText?.textContent).toBe("TYPE");
    expect(validation.document?.querySelectorAll("#generated-artwork text")).toHaveLength(1);
    expect(editableText?.querySelector("tspan")).toBeNull();
    expect(editableText?.getAttribute("x")).toBe("600");
    expect(editableText?.getAttribute("y")).toBe("405");
    expect(editableText?.getAttribute("text-anchor")).toBe("middle");
    expect(editableText?.getAttribute("letter-spacing")).toBe("-3");
    expect(validation.document?.querySelector("mask")).toBeNull();
  });

  it("applies appearance colors and omits only a transparent background", () => {
    const opaque = new DOMParser().parseFromString(createSvg({
      ...lightState,
      primaryColor: "#123456",
      outlineColor: "#abcdef",
      backgroundColor: "#654321",
      overlayMode: "outline",
    }, context, null), "image/svg+xml");
    expect(opaque.querySelector("#background rect")?.getAttribute("fill")).toBe("#654321");
    expect(opaque.querySelector("#generated-artwork")?.getAttribute("fill")).toBe("#123456");

    const transparent = new DOMParser().parseFromString(createSvg({
      ...lightState,
      transparentBackground: true,
    }, context, null), "image/svg+xml");
    expect(transparent.querySelector("#background")).toBeNull();
    expect(transparent.documentElement.getAttribute("viewBox")).toBe("0 0 1200 720");
  });

  it("keeps Editable Text native and applies its configured primary color", () => {
    const document = new DOMParser().parseFromString(createSvg({
      ...lightState,
      exportMode: "editable",
      primaryColor: "#22aa66",
      transparentBackground: true,
    }, context, null), "image/svg+xml");
    expect(document.querySelectorAll("#generated-artwork text")).toHaveLength(1);
    expect(document.querySelector("#generated-artwork text")?.getAttribute("fill")).toBe("#22aa66");
    expect(document.querySelector("#background")).toBeNull();
  });

  it("does not change generated geometry when only appearance changes", () => {
    const first = new DOMParser().parseFromString(createSvg(lightState, context, null), "image/svg+xml");
    const second = new DOMParser().parseFromString(createSvg({
      ...lightState,
      primaryColor: "#ff0000",
      outlineColor: "#00ff00",
      backgroundColor: "#0000ff",
      transparentBackground: true,
    }, context, null), "image/svg+xml");
    const geometry = (document: Document) => [...document.querySelectorAll("#generated-artwork circle, #generated-artwork path, #generated-artwork polyline")]
      .map((node) => ["d", "cx", "cy", "r", "points"].map((name) => node.getAttribute(name)).join("|"));
    expect(geometry(second)).toEqual(geometry(first));
  });

  it("keeps typography-enhanced Editable Text as one honest native text element", () => {
    const state = {
      ...lightState,
      exportMode: "editable" as const,
      font: loaded.metadata,
      textAlign: "left" as const,
      textOffsetY: 25,
      kerningMode: "none" as const,
      kerningStrength: 0.5,
      opticalSpacing: true,
      opticalSpacingStrength: 0.5,
    };
    const geometry = layoutGlyphs(state, loaded);
    const document = new DOMParser().parseFromString(createSvg(state, context, geometry), "image/svg+xml");
    const text = document.querySelector("#generated-artwork text");
    expect(document.querySelectorAll("#generated-artwork text")).toHaveLength(1);
    expect(text?.querySelector("tspan")).toBeNull();
    expect(text?.getAttribute("y")).toBe("430");
    expect(text?.getAttribute("font-kerning")).toBe("none");
    expect(text?.hasAttribute("data-kerning-strength")).toBe(false);
    expect(text?.hasAttribute("data-optical-spacing")).toBe(false);
  });

  it("includes required metadata and diagnostics", () => {
    const state = { ...lightState, font: loaded.metadata };
    const geometry = layoutGlyphs(state, loaded);
    const svg = createSvg(state, context, geometry);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const metadata = JSON.parse(document.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({
      appName: "SUBSTRATE",
      appVersion: "0.17.0",
      renderer: "Flow lines",
      exportMode: "artwork",
      seed: state.seed,
      sourceText: "TYPE",
      substrateType: "glyph-paths",
      font: { family: "Basic-Regular", fileName: "Basic-Regular.ttf" },
      project: { version: 7, text: "TYPE" },
    });
    expect(metadata.exportTimestamp).toBeTypeOf("string");
    expect(getSvgDiagnostics(svg)).toMatchObject({
      glyphPaths: 4,
      generatedMarks: 20,
      substrateType: "glyph-paths",
    });
  });

  it("escapes XML-sensitive text and parses without errors", () => {
    const text = 'A&<>"';
    const svg = createSvg({ ...lightState, text }, context, null);
    expect(svg).toContain("A&amp;&lt;&gt;&quot;");
    const validation = validateSvgReload(svg, false);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelector("parsererror")).toBeNull();
    expect(validation.document?.querySelector("#substrate-mask text")?.textContent).toBe(text);
  });
});
