import { describe, expect, it } from "vitest";
import { resolveContourDomain, textBoundsExceedArtboard } from "../src/engine/contourDomain";
import type { TextGeometry } from "../src/engine/glyphGeometry";
import { baseState } from "../src/engine/presets";
import { NATIVE_TEXT_BOUNDS_WARNING, resolveTextBoundsModel } from "../src/engine/textBounds";
import { DEFAULT_ARTBOARD } from "../src/engine/artboard";

function parsedGeometry(): TextGeometry {
  const glyph = (textIndex: number, character: string, x: number, width: number) => ({
    glyphId: `g-${textIndex}`,
    character,
    sourceCharacter: character,
    textIndex,
    glyphIndex: textIndex,
    glyphName: character,
    advanceWidth: 100,
    x: textIndex * 100,
    y: 400,
    path: { d: "M0 0L1 1", bounds: { x, y: 100, width, height: 300 }, commands: [] },
    center: { x: x + width / 2, y: 250 },
    centroid: { x: x + width / 2, y: 250 },
    counterCenter: null,
    sourceAnchor: { x: x + width / 2, y: 250 },
    emitterEligible: true,
  });
  const glyphs = [glyph(0, "A", -25, 125), glyph(1, "V", 100, 135)];
  return {
    glyphs,
    bounds: { x: -25, y: 100, width: 260, height: 300 },
    baselineY: 400,
    originX: 0,
    advanceWidth: 200,
    sourceText: "AV",
    hasOutlines: true,
  };
}

describe("text bounds authority", () => {
  it("keeps parsed left and right overhangs in the exact glyph union", () => {
    const model = resolveTextBoundsModel({ ...baseState, text: "AV" }, parsedGeometry());
    expect(model.glyphUnionBounds).toEqual({ x: -25, y: 100, width: 260, height: 300 });
    expect(model.inkBounds.x).toBeLessThan(model.layoutBounds.x);
    expect(model.inkBounds.x + model.inkBounds.width).toBeGreaterThan(model.layoutBounds.x + model.layoutBounds.width);
    for (const glyph of parsedGeometry().glyphs) {
      expect(glyph.path.bounds!.x).toBeGreaterThanOrEqual(model.inkBounds.x);
      expect(glyph.path.bounds!.x + glyph.path.bounds!.width).toBeLessThanOrEqual(model.inkBounds.x + model.inkBounds.width);
    }
  });

  it("marks native ink bounds approximate and does not clamp their layout width to the artboard", () => {
    const model = resolveTextBoundsModel({ ...baseState, text: "SUBSTRATE", fontSize: 560 }, null);
    expect(model.inkBoundsSource).toBe("native-approximate");
    expect(model.glyphUnionBounds).toBeNull();
    expect(model.layoutBounds.width).toBeGreaterThan(DEFAULT_ARTBOARD.width);
    expect(model.inkBounds.width).toBeGreaterThan(model.layoutBounds.width);
    expect(NATIVE_TEXT_BOUNDS_WARNING).toBe("Native text fallback uses approximate text bounds.");
  });

  it("uses ink bounds for overflow and contains them in the expanded renderer domain", () => {
    const state = { ...baseState, text: "SUBSTRATE", fontSize: 560, renderer: "sdf-contours" as const };
    const model = resolveTextBoundsModel(state, null);
    const domain = resolveContourDomain(state, null, model.inkBounds);
    expect(textBoundsExceedArtboard(model.inkBounds)).toBe(true);
    expect(domain.bounds.x).toBeLessThanOrEqual(model.inkBounds.x);
    expect(domain.bounds.x + domain.bounds.width).toBeGreaterThanOrEqual(model.inkBounds.x + model.inkBounds.width);
  });
});
