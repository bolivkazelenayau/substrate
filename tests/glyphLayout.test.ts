import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFontBuffer, validateLoadedFont, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { validateTextGeometry } from "../src/engine/glyphGeometry";
import { baseState } from "../src/engine/presets";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
let loaded: LoadedFont;

beforeAll(() => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
});

describe("font and glyph layout", () => {
  it("loads the licensed font fixture and extracts metadata", () => {
    expect(validateLoadedFont(loaded)).toBe(true);
    expect(loaded.metadata.family).toBe("Basic-Regular");
    expect(loaded.metadata.fileName).toBe("Basic-Regular.ttf");
    expect(loaded.metadata.unitsPerEm).toBeGreaterThan(0);
    expect(Number.isFinite(loaded.metadata.ascender)).toBe(true);
  });

  it("generates non-empty paths and finite bounds for basic Latin", () => {
    const geometry = layoutGlyphs({ ...baseState, text: "TYPE", font: loaded.metadata }, loaded);
    expect(geometry.glyphs).toHaveLength(4);
    expect(geometry.glyphs.every((glyph) => glyph.path.d.length > 0)).toBe(true);
    expect(validateTextGeometry(geometry)).toMatchObject({ valid: true, boundsFinite: true });
    expect(geometry.bounds).not.toBeNull();
    expect(Object.values(geometry.bounds!).every(Number.isFinite)).toBe(true);
  });

  it("tracking changes total advance width", () => {
    const compact = layoutGlyphs({ ...baseState, text: "TYPE", tracking: 0, font: loaded.metadata }, loaded);
    const tracked = layoutGlyphs({ ...baseState, text: "TYPE", tracking: 10, font: loaded.metadata }, loaded);
    expect(tracked.advanceWidth - compact.advanceWidth).toBeCloseTo(30, 5);
  });

  it("font size changes path bounds", () => {
    const small = layoutGlyphs({ ...baseState, text: "TYPE", fontSize: 80, font: loaded.metadata }, loaded);
    const large = layoutGlyphs({ ...baseState, text: "TYPE", fontSize: 160, font: loaded.metadata }, loaded);
    expect(large.bounds!.height).toBeGreaterThan(small.bounds!.height * 1.9);
    expect(large.bounds!.width).toBeGreaterThan(small.bounds!.width * 1.8);
  });

  it("handles empty and whitespace text without crashing", () => {
    const empty = layoutGlyphs({ ...baseState, text: "", font: loaded.metadata }, loaded);
    const spaces = layoutGlyphs({ ...baseState, text: "   ", font: loaded.metadata }, loaded);
    expect(empty.glyphs).toHaveLength(0);
    expect(empty.bounds).toBeNull();
    expect(spaces.glyphs).toHaveLength(3);
    expect(spaces.bounds).toBeNull();
  });

  it("handles missing glyphs safely through the font fallback glyph", () => {
    const geometry = layoutGlyphs({ ...baseState, text: "\u{10FFFF}", font: loaded.metadata }, loaded);
    expect(geometry.glyphs).toHaveLength(1);
    expect(Number.isFinite(geometry.glyphs[0].advanceWidth)).toBe(true);
    expect(() => validateTextGeometry(geometry)).not.toThrow();
  });
});
