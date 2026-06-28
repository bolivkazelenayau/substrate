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
    expect(validation.document?.querySelector("#generated-artwork text")?.textContent).toBe("TYPE");
    expect(validation.document?.querySelector("mask")).toBeNull();
  });

  it("includes required metadata and diagnostics", () => {
    const state = { ...lightState, font: loaded.metadata };
    const geometry = layoutGlyphs(state, loaded);
    const svg = createSvg(state, context, geometry);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const metadata = JSON.parse(document.querySelector("metadata")!.textContent!);
    expect(metadata).toMatchObject({
      appName: "SUBSTRATE",
      appVersion: "0.13.0",
      renderer: "Flow lines",
      exportMode: "artwork",
      seed: state.seed,
      sourceText: "TYPE",
      substrateType: "glyph-paths",
      font: { family: "Basic-Regular", fileName: "Basic-Regular.ttf" },
      project: { version: 4, text: "TYPE" },
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
