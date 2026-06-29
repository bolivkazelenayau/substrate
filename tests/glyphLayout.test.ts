import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { parseFontBuffer, validateLoadedFont, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { unionBounds, validateTextGeometry } from "../src/engine/glyphGeometry";
import { baseState } from "../src/engine/presets";
import { TEXT_LAYOUT, VIEWPORT } from "../src/engine/constants";
import { getTextBounds, getTextLayout, getTypographyLimitations } from "../src/engine/textLayout";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
let loaded: LoadedFont;

beforeAll(() => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = parseFontBuffer(buffer, "Basic-Regular.ttf");
});

describe("font and glyph layout", () => {
  it("preserves the legacy default paths, origins, advances, and bounds", () => {
    const state = { ...baseState, text: "TYPE", font: loaded.metadata };
    const characters = Array.from(state.text);
    const sourceGlyphs = characters.map((character) => loaded.font.charToGlyph(character));
    const scale = state.fontSize / loaded.font.unitsPerEm;
    const advances = sourceGlyphs.map((glyph) => (glyph.advanceWidth ?? loaded.font.unitsPerEm) * scale);
    const kernings = sourceGlyphs.map((glyph, index) => index < sourceGlyphs.length - 1
      ? loaded.font.getKerningValue(glyph, sourceGlyphs[index + 1]) * scale
      : 0);
    const totalAdvance = advances.reduce((sum, advance) => sum + advance, 0)
      + kernings.reduce((sum, kerning) => sum + kerning, 0)
      + Math.max(0, sourceGlyphs.length - 1) * state.tracking;
    let cursorX = VIEWPORT.centerX - totalAdvance / 2;
    const legacy = sourceGlyphs.map((glyph, index) => {
      const path = glyph.getPath(cursorX, TEXT_LAYOUT.baselineY, state.fontSize, { kerning: false }, loaded.font);
      const result = {
        d: path.toPathData(state.precision),
        x: cursorX,
        y: TEXT_LAYOUT.baselineY,
        advanceWidth: advances[index],
        box: path.getBoundingBox(),
      };
      cursorX += advances[index] + kernings[index] + (index < sourceGlyphs.length - 1 ? state.tracking : 0);
      return result;
    });
    const geometry = layoutGlyphs(state, loaded);
    const legacyBounds = unionBounds(legacy.map(({ box, d }) => d.length > 0
      ? { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 }
      : null));

    expect(geometry.glyphs.map((glyph) => glyph.path.d)).toEqual(legacy.map((glyph) => glyph.d));
    expect(geometry.glyphs.map((glyph) => ({ x: glyph.x, y: glyph.y }))).toEqual(
      legacy.map((glyph) => ({ x: glyph.x, y: glyph.y })),
    );
    expect(geometry.glyphs.map((glyph) => glyph.advanceWidth)).toEqual(legacy.map((glyph) => glyph.advanceWidth));
    expect(geometry.advanceWidth).toBe(totalAdvance);
    expect(geometry.originX).toBe(VIEWPORT.centerX - totalAdvance / 2);
    expect(geometry.bounds).toEqual(legacyBounds);
  });

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

  it("applies parsed-font kerning mode and strength predictably", () => {
    const text = "AV";
    const glyphs = Array.from(text).map((character) => loaded.font.charToGlyph(character));
    const expectedKerning = loaded.font.getKerningValue(glyphs[0], glyphs[1])
      * baseState.fontSize / loaded.font.unitsPerEm;
    const fontKerning = layoutGlyphs({ ...baseState, text, font: loaded.metadata }, loaded);
    const noKerning = layoutGlyphs({ ...baseState, text, font: loaded.metadata, kerningMode: "none" }, loaded);
    const halfKerning = layoutGlyphs({ ...baseState, text, font: loaded.metadata, kerningStrength: 0.5 }, loaded);
    expect(fontKerning.advanceWidth - noKerning.advanceWidth).toBeCloseTo(expectedKerning, 8);
    expect(halfKerning.advanceWidth - noKerning.advanceWidth).toBeCloseTo(expectedKerning * 0.5, 8);
  });

  it("keeps optical spacing deterministic, opt-in, and bounded per pair", () => {
    const state = { ...baseState, text: "AVATAR", tracking: 0, font: loaded.metadata };
    const disabled = layoutGlyphs(state, loaded);
    const first = layoutGlyphs({ ...state, opticalSpacing: true, opticalSpacingStrength: 1 }, loaded);
    const second = layoutGlyphs({ ...state, opticalSpacing: true, opticalSpacingStrength: 1 }, loaded);
    const limit = state.fontSize * 0.08;
    const pairAdjustments = first.glyphs.slice(0, -1).map((glyph, index) => {
      const next = first.glyphs[index + 1];
      const sourceGlyph = loaded.font.charToGlyph(glyph.character);
      const nextSourceGlyph = loaded.font.charToGlyph(next.character);
      const kerning = loaded.font.getKerningValue(sourceGlyph, nextSourceGlyph)
        * state.fontSize / loaded.font.unitsPerEm;
      return next.x - glyph.x - glyph.advanceWidth - kerning - state.tracking;
    });
    expect(layoutGlyphs(state, loaded)).toEqual(disabled);
    expect(first).toEqual(second);
    expect(pairAdjustments.every((adjustment) => Math.abs(adjustment) <= limit + 1e-8)).toBe(true);
    expect(pairAdjustments.some((adjustment) => Math.abs(adjustment) > 1e-8)).toBe(true);
  });

  it("aligns parsed runs to the artboard and offsets the shared baseline once", () => {
    const state = { ...baseState, text: "TYPE", font: loaded.metadata };
    const centered = layoutGlyphs(state, loaded);
    const left = layoutGlyphs({ ...state, textAlign: "left" }, loaded);
    const right = layoutGlyphs({ ...state, textAlign: "right" }, loaded);
    const shifted = layoutGlyphs({ ...state, textOffsetY: 36 }, loaded);
    expect(left.originX).toBe(VIEWPORT.paddingX);
    expect(right.originX + right.advanceWidth).toBeCloseTo(VIEWPORT.width - VIEWPORT.paddingX, 8);
    expect(centered.originX + centered.advanceWidth / 2).toBeCloseTo(VIEWPORT.centerX, 8);
    expect(shifted.glyphs.map((glyph) => glyph.x)).toEqual(centered.glyphs.map((glyph) => glyph.x));
    expect(shifted.glyphs.map((glyph) => glyph.y - 36)).toEqual(centered.glyphs.map((glyph) => glyph.y));
    expect(shifted.bounds!.y - 36).toBeCloseTo(centered.bounds!.y, 8);
    expect(shifted.baselineY).toBe(centered.baselineY + 36);
  });

  it("aligns native fallback bounds and reports parsed-font-only limitations", () => {
    const left = { ...baseState, text: "TYPE", textAlign: "left" as const };
    const right = { ...baseState, text: "TYPE", textAlign: "right" as const, textOffsetY: -24 };
    expect(getTextBounds(left).x).toBe(VIEWPORT.paddingX);
    expect(getTextBounds(right).x + getTextBounds(right).width).toBe(VIEWPORT.width - VIEWPORT.paddingX);
    expect(getTextLayout(right, false).baselineY).toBe(TEXT_LAYOUT.baselineY - 24);
    expect(getTypographyLimitations({
      ...baseState,
      kerningStrength: 0.5,
      opticalSpacing: true,
      opticalSpacingStrength: 0.4,
    }, false)).toEqual([
      "Kerning strength requires parsed font outlines.",
      "Optical spacing requires parsed font outlines.",
    ]);
    expect(getTypographyLimitations(baseState, false)).toEqual([]);
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
