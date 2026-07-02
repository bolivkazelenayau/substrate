import { describe, expect, it } from "vitest";
import { centerPreservingTypographySizePatch, getTextBounds } from "../src/engine/textLayout";
import { baseState } from "../src/engine/presets";
import type { TextGeometry } from "../src/engine/glyphGeometry";

function centerY(bounds: { y: number; height: number }) {
  return bounds.y + bounds.height / 2;
}

describe("center-preserving typography size changes", () => {
  it("preserves estimated fallback center when increasing and decreasing size", () => {
    for (const fontSize of [500, 72]) {
      const patch = centerPreservingTypographySizePatch(baseState, fontSize, null);
      const next = { ...baseState, ...patch };
      expect(centerY(getTextBounds(next))).toBeCloseTo(centerY(getTextBounds(baseState)), 8);
    }
  });

  it("uses parsed geometry bounds and baseline when available", () => {
    const geometry = {
      glyphs: [],
      bounds: { x: 200, y: 250, width: 600, height: 160 },
      baselineY: 410,
      originX: 200,
      advanceWidth: 600,
      sourceText: baseState.text,
      hasOutlines: true,
    } satisfies TextGeometry;
    const patch = centerPreservingTypographySizePatch(baseState, 296, geometry);
    const oldCenter = centerY(geometry.bounds);
    const projectedBeforeCompensation = geometry.baselineY + (oldCenter - geometry.baselineY) * 2;
    expect(projectedBeforeCompensation + patch.textOffsetY - baseState.textOffsetY).toBeCloseTo(oldCenter, 8);
  });

  it("safely ignores invalid or unchanged requested sizes", () => {
    expect(centerPreservingTypographySizePatch(baseState, NaN, null)).toEqual({
      fontSize: baseState.fontSize,
      textOffsetY: baseState.textOffsetY,
    });
    expect(centerPreservingTypographySizePatch(baseState, baseState.fontSize, null)).toEqual({
      fontSize: baseState.fontSize,
      textOffsetY: baseState.textOffsetY,
    });
  });
});
