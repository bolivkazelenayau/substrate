import { describe, expect, it } from "vitest";
import { artboardCenter, resolveEffectiveArtboard } from "../src/engine/artboard";
import { resolveSceneLayout } from "../src/engine/artboardExpansion";
import { baseState } from "../src/engine/presets";

describe("authored/effective artboard", () => {
  it("grows symmetrically and shrinks back without mutating authored state", () => {
    const authored = { width: 1200, height: 720 };
    const initial = resolveEffectiveArtboard(authored, { x: 200, y: 200, width: 800, height: 250 }, 48);
    const expanded = resolveEffectiveArtboard(authored, { x: -149, y: 100, width: 1498, height: 500 }, 0);
    const returned = resolveEffectiveArtboard(authored, { x: 200, y: 200, width: 800, height: 250 }, 48);
    expect(initial).toEqual({ x: 0, y: 0, width: 1200, height: 720 });
    expect(returned).toEqual(initial);
    expect(artboardCenter(expanded)).toEqual({ x: 600, y: 360 });
    expect(authored).toEqual({ width: 1200, height: 720 });
  });

  it("uses all four rect values in deterministic scene identity", () => {
    const project = { ...baseState, artboard: { width: 1200, height: 720 }, fontSize: 148 };
    const first = resolveSceneLayout(project, null);
    const large = resolveSceneLayout({ ...project, fontSize: 540 }, null);
    const returned = resolveSceneLayout(project, null);
    expect(returned.key).toBe(first.key);
    expect(returned.effectiveArtboard).toEqual(first.effectiveArtboard);
    expect(large.authoredArtboard).toEqual(project.artboard);
  });

  it("preserves a larger authored minimum", () => {
    const rect = resolveEffectiveArtboard({ width: 1600, height: 900 }, { x: 550, y: 300, width: 500, height: 200 }, 48);
    expect(rect).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
  });
});
