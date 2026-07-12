import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { resolveSceneLayout } from "../src/engine/sceneLayout";

describe("authored larger baseline", () => {
  const authored = { width: 1600, height: 900 };

  it("never shrinks the effective artboard below the authored minimum", () => {
    for (const fontSize of [96, 148, 300, 540, 700]) {
      const scene = resolveSceneLayout({ ...baseState, artboard: authored, fontSize }, null);
      expect(scene.effectiveArtboard.width).toBeGreaterThanOrEqual(authored.width);
      expect(scene.effectiveArtboard.height).toBeGreaterThanOrEqual(authored.height);
    }
  });

  it("treats the saved authored dimensions as the floor after transient size changes", () => {
    const initial = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 148 }, null);
    resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 540 }, null);
    const final = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 148 }, null);
    expect(final.effectiveArtboard.width).toBeGreaterThanOrEqual(authored.width);
    expect(final.effectiveArtboard.height).toBeGreaterThanOrEqual(authored.height);
    expect(final.effectiveArtboard).toEqual(initial.effectiveArtboard);
  });
});