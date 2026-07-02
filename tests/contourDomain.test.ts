import { describe, expect, it } from "vitest";
import {
  TEXT_ARTBOARD_OVERFLOW_WARNING,
  getTextArtboardOverflowWarning,
  resolveContourDomain,
} from "../src/engine/contourDomain";
import { baseState } from "../src/engine/presets";
import type { TextGeometry } from "../src/engine/glyphGeometry";

describe("large-type contour domain", () => {
  it("preserves the canonical artboard domain for historical sizes", () => {
    expect(resolveContourDomain({ ...baseState, renderer: "sdf-contours" }, null, null)).toEqual({
      bounds: { x: 0, y: 0, width: 1200, height: 720 },
      padding: 0,
      resolutionScaleX: 1,
      resolutionScaleY: 1,
      expanded: false,
    });
  });

  it("expands deterministically beyond raw parsed glyph bounds", () => {
    const state = { ...baseState, renderer: "sdf-contours" as const, fontSize: 560, amplitude: 34 };
    const geometry = {
      glyphs: [],
      bounds: { x: -620, y: 80, width: 2440, height: 580 },
      baselineY: 600,
      originX: -620,
      advanceWidth: 2440,
      sourceText: "SUBSTRATE",
      hasOutlines: true,
    } satisfies TextGeometry;
    const first = resolveContourDomain(state, geometry, geometry.bounds);
    expect(first).toEqual(resolveContourDomain(state, geometry, geometry.bounds));
    expect(first.expanded).toBe(true);
    expect(first.bounds.x).toBeLessThan(geometry.bounds.x);
    expect(first.bounds.x + first.bounds.width).toBeGreaterThan(geometry.bounds.x + geometry.bounds.width);
    expect(first.padding).toBeGreaterThan(24);
    expect(first.resolutionScaleX).toBeLessThanOrEqual(2);
    expect(first.resolutionScaleY).toBeLessThanOrEqual(2);
  });

  it("uses uncapped fallback text width and finite performance limits", () => {
    const domain = resolveContourDomain({
      ...baseState,
      renderer: "sdf-contours",
      text: "SUBSTRATE",
      fontSize: 600,
    }, null, { x: 0, y: 0, width: 1200, height: 708 });
    expect(domain.bounds.x).toBeLessThan(0);
    expect(domain.bounds.x + domain.bounds.width).toBeGreaterThan(1200);
    expect(domain.bounds.width).toBeLessThanOrEqual(3600);
    expect(domain.bounds.height).toBeLessThanOrEqual(2160);
  });

  it("does not expand unrelated renderers", () => {
    const domain = resolveContourDomain({ ...baseState, renderer: "dots", fontSize: 600 }, null, null);
    expect(domain.expanded).toBe(false);
    expect(domain.bounds).toEqual({ x: 0, y: 0, width: 1200, height: 720 });
  });

  it("reports artboard overflow independently from renderer budgets", () => {
    expect(getTextArtboardOverflowWarning(baseState, null)).toBeNull();
    expect(getTextArtboardOverflowWarning({ ...baseState, fontSize: 560 }, null)).toBe(TEXT_ARTBOARD_OVERFLOW_WARNING);
  });
});
