import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import {
  canonicalBaselineAtAuthoredCenter,
  resolveSceneLayout,
  TYPOGRAPHY_PLACEMENT_BOX_HEIGHT_FACTOR,
} from "../src/engine/sceneLayout";
import { getTextLayout } from "../src/engine/textLayout";

const sizes = [100, 148, 300, 540, 700] as const;

describe("canonical typography placement", () => {
  for (const fontSize of sizes) {
    it(`centers the layout box at the authored artboard center for size ${fontSize}`, () => {
      const state = { ...baseState, fontSize, textOffsetY: 0 };
      const scene = resolveSceneLayout(state, null);
      const layout = getTextLayout(state);
      const authoredCenterY = state.artboard.height / 2;
      const layoutCenterY = layout.baselineY - state.fontSize + (state.fontSize * TYPOGRAPHY_PLACEMENT_BOX_HEIGHT_FACTOR) / 2;
      expect(layout.baselineY).toBeCloseTo(scene.typography.resolvedBaseline, 3);
      expect(layout.baselineY).toBeCloseTo(canonicalBaselineAtAuthoredCenter(authoredCenterY, fontSize), 3);
      expect(layoutCenterY).toBeCloseTo(authoredCenterY, 1);
      expect(scene.typography.authoredOffset).toEqual({ x: 0, y: 0 });
      expect(scene.typography.canonicalBaseline).toBeCloseTo(canonicalBaselineAtAuthoredCenter(authoredCenterY, fontSize), 3);
    });
  }

  it("applies textOffsetY as a user-authored delta without rewriting it across size changes", () => {
    const offset = 24;
    const initial = resolveSceneLayout({ ...baseState, fontSize: 148, textOffsetY: offset }, null);
    const transient = resolveSceneLayout({ ...baseState, fontSize: 540, textOffsetY: offset }, null);
    const restored = resolveSceneLayout({ ...baseState, fontSize: 148, textOffsetY: offset }, null);

    expect(initial.typography.authoredOffset.y).toBe(offset);
    expect(transient.typography.authoredOffset.y).toBe(offset);
    expect(restored.typography.authoredOffset.y).toBe(offset);
    expect(restored.typography.resolvedBaseline - restored.typography.canonicalBaseline).toBe(offset);
    expect(restored.typography.key).toBe(initial.typography.key);
  });
});