import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { getTextLayout, getTextLayoutBounds } from "../src/engine/textLayout";
import { canonicalFirstBaseline, resolveTypographyPlacement } from "../src/engine/typographyPlacement";
import { applyTypographySizePlacement, resolveArtboardCenteredTypographySize } from "../src/engine/typographySizePlacement";

const centerY = (bounds: { y: number; height: number }) => bounds.y + bounds.height / 2;

describe("canonical typography placement", () => {
  it.each([100, 148, 189, 235, 540, 700])("centers native layout bounds at Size %i", (fontSize) => {
    const state = { ...baseState, fontSize, textOffsetY: 0 };
    expect(centerY(getTextLayoutBounds(state))).toBeCloseTo(state.artboard.height / 2, 9);
  });

  it("treats textOffsetY as a delta from the canonical center", () => {
    for (const fontSize of [148, 540, 148]) {
      const state = { ...baseState, fontSize, textOffsetY: -30 };
      const bounds = getTextLayoutBounds(state);
      const placement = resolveTypographyPlacement(state, bounds, bounds, getTextLayout(state).lines[0].originX);
      expect(centerY(bounds)).toBeCloseTo(state.artboard.height / 2 - 30, 9);
      expect(placement.authoredOffset.y).toBe(-30);
    }
  });

  it("commits only fontSize during authoritative Size settlement", () => {
    const initial = { ...baseState, artboard: { width: 1200, height: 720 }, textOffsetY: 80, fontSize: 148 };
    const large = applyTypographySizePlacement(initial, resolveArtboardCenteredTypographySize(initial, null, 540));
    const returned = applyTypographySizePlacement(large, resolveArtboardCenteredTypographySize(large, null, 148));
    expect(large.artboard).toEqual(initial.artboard);
    expect(large.textOffsetY).toBe(80);
    expect(returned).toEqual(initial);
    expect(canonicalFirstBaseline(returned)).toBe(canonicalFirstBaseline(initial));
  });
});
