import { describe, expect, it } from "vitest";
import {
  intersectArtboard,
  resolveSimpleMarkBounds,
  resolveVisibleGlyphSamplingBounds,
  sampleBoundsFairly,
} from "../src/engine/rendererSampling";
import { baseState } from "../src/engine/presets";
import type { RenderContext } from "../src/types";

describe("large typography renderer sampling", () => {
  it("keeps default mark bounds byte-compatible and opens edge coverage only for large type", () => {
    expect(resolveSimpleMarkBounds(baseState)).toEqual({ x: 55, y: 70, width: 1090, height: 580 });
    expect(resolveSimpleMarkBounds({ ...baseState, fontSize: 560 })).toEqual({ x: 0, y: 0, width: 1200, height: 720 });
  });

  it("includes partial glyph intersections and excludes fully outside glyphs", () => {
    const geometry = {
      glyphs: [
        { path: { bounds: { x: -80, y: 100, width: 140, height: 300 } } },
        { path: { bounds: { x: -300, y: 100, width: 100, height: 300 } } },
        { path: { bounds: { x: 1140, y: 100, width: 140, height: 300 } } },
      ],
    } as RenderContext["textGeometry"];
    const bounds = resolveVisibleGlyphSamplingBounds(
      { ...baseState, fontSize: 560 },
      { timeMs: 0, frame: 0, textGeometry: geometry },
      { x: 0, y: 0, width: 1200, height: 720 },
    );
    expect(bounds).toEqual([
      { x: 0, y: 100, width: 60, height: 300 },
      { x: 1140, y: 100, width: 60, height: 300 },
    ]);
  });

  it("samples visible glyph bounds round-robin deterministically", () => {
    const bounds = [
      { x: 0, y: 0, width: 50, height: 100 },
      { x: 1150, y: 0, width: 50, height: 100 },
    ];
    const values = [0.5, 0.25, 0.5, 0.25];
    let index = 0;
    const random = () => values[index++ % values.length];
    expect(sampleBoundsFairly(bounds, 0, random)).toEqual({ x: 25, y: 25 });
    expect(sampleBoundsFairly(bounds, 1, random)).toEqual({ x: 1175, y: 25 });
  });

  it("returns null only for fully outside bounds", () => {
    expect(intersectArtboard({ x: -100, y: 20, width: 150, height: 80 })).toEqual({ x: 0, y: 20, width: 50, height: 80 });
    expect(intersectArtboard({ x: -200, y: 20, width: 50, height: 80 })).toBeNull();
  });
});
