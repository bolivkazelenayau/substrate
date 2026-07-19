import { describe, expect, it } from "vitest";
import { resolvePreviewStageScale } from "../src/engine/previewStageScale";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { baseState } from "../src/engine/presets";

describe("preview stage scale", () => {
  it("is 1:1 when effective equals authored", () => {
    const scale = resolvePreviewStageScale(
      { width: 1200, height: 720 },
      { width: 1200, height: 720 },
    );
    expect(scale.widthRatio).toBe(1);
    expect(scale.heightRatio).toBe(1);
  });

  it("keeps width/height ratios proportional so world units share one scale", () => {
    const scale = resolvePreviewStageScale(
      { width: 1200, height: 720 },
      { width: 1500, height: 2160 },
    );
    // Same world→css scale on both axes: widthRatio / (Ew/Aw) == heightRatio / (Eh/Ah)
    expect(scale.widthRatio / (1500 / 1200)).toBeCloseTo(1, 8);
    expect(scale.heightRatio / (2160 / 720)).toBeCloseTo(1, 8);
  });

  it("does not change width ratio when only multi-line lineHeight expands height", () => {
    const text = "SUBSTRATE\nSUBSTRATE";
    const compact = resolveSceneLayout({ ...baseState, text, fontSize: 540, lineHeight: 0.8 }, null);
    const loose = resolveSceneLayout({ ...baseState, text, fontSize: 540, lineHeight: 2.5 }, null);

    const compactScale = resolvePreviewStageScale(compact.authoredArtboard, compact.effectiveArtboard);
    const looseScale = resolvePreviewStageScale(loose.authoredArtboard, loose.effectiveArtboard);

    // Vertical growth from line height must not change the horizontal scale
    // factor that maps glyph width to screen pixels.
    expect(loose.effectiveArtboard.height).toBeGreaterThan(compact.effectiveArtboard.height);
    expect(looseScale.widthRatio).toBeCloseTo(compactScale.widthRatio, 5);
    expect(looseScale.heightRatio).toBeGreaterThan(compactScale.heightRatio);
  });
});
