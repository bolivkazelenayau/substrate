import { describe, expect, it } from "vitest";
import {
  CONTOUR_STROKE_REFERENCE_TYPOGRAPHY_SIZE,
  DEFAULT_CONTOUR_STROKE_WIDTH,
  resolveContourStrokeWidth,
} from "../src/engine/contourStroke";

describe("scale-aware contour stroke width", () => {
  it("calibrates the normalized default at the legacy large-type reference size", () => {
    expect(CONTOUR_STROKE_REFERENCE_TYPOGRAPHY_SIZE).toBe(540);
    expect(resolveContourStrokeWidth({
      contourStrokeWidth: DEFAULT_CONTOUR_STROKE_WIDTH,
      fontSize: 540,
    })).toBe(1.4);
  });

  it("makes default contours proportionally thinner at the default typography size", () => {
    expect(resolveContourStrokeWidth({
      contourStrokeWidth: DEFAULT_CONTOUR_STROKE_WIDTH,
      fontSize: 148,
    })).toBe(0.3837);
  });

  it("is deterministic and conservatively clamps extreme effective widths", () => {
    const input = { contourStrokeWidth: 3.25, fontSize: 320 };
    expect(resolveContourStrokeWidth(input)).toBe(resolveContourStrokeWidth(input));
    expect(resolveContourStrokeWidth({ contourStrokeWidth: 0.25, fontSize: 1 })).toBe(0.1);
    expect(resolveContourStrokeWidth({ contourStrokeWidth: 16, fontSize: 4096 })).toBe(16);
  });
});
