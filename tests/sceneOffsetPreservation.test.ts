import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { artboardBottom, artboardTop, resolveSceneLayout } from "../src/engine/sceneLayout";

describe("authored offset preservation", () => {
  const offset = 36;

  it("keeps persisted textOffsetY and resolved displacement stable across 148 → 540 → 148", () => {
    const initial = resolveSceneLayout({ ...baseState, fontSize: 148, textOffsetY: offset }, null);
    resolveSceneLayout({ ...baseState, fontSize: 540, textOffsetY: offset }, null);
    const final = resolveSceneLayout({ ...baseState, fontSize: 148, textOffsetY: offset }, null);

    expect(final.typography.authoredOffset.y).toBe(offset);
    expect(final.typography.resolvedBaseline - final.typography.canonicalBaseline).toBe(offset);
    expect(final.typography.key).toBe(initial.typography.key);
    expect(final.typography.resolvedOrigin.y - initial.typography.resolvedOrigin.y).toBe(0);
  });

  it("contains displaced artwork inside the effective rect", () => {
    const scene = resolveSceneLayout({ ...baseState, fontSize: 148, textOffsetY: offset }, null);
    const bounds = scene.typography.placementBounds;
    expect(bounds.y).toBeGreaterThanOrEqual(artboardTop(scene.effectiveArtboard) - scene.containmentPadding);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(artboardBottom(scene.effectiveArtboard) + scene.containmentPadding);
  });
});