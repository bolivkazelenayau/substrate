import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import {
  artboardCenter,
  artboardLeft,
  artboardRight,
  artboardTop,
  artboardBottom,
  roundSceneNumber,
  resolveSceneLayout,
} from "../src/engine/sceneLayout";
import { assertCenterPreserved } from "./utils/sceneLayoutHarness";

describe("symmetric effective artboard resolver", () => {
  const authored = { width: 1200, height: 720 };

  it("does not expand when native artwork fits the authored minimum", () => {
    const scene = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 148 }, null);
    expect(scene.expandedX).toBe(false);
    expect(scene.expandedY).toBe(false);
    expect(scene.effectiveArtboard).toEqual({ x: 0, y: 0, width: 1200, height: 720 });
  });

  it("grows symmetrically on the horizontal axis", () => {
    const tallAuthored = { width: 1200, height: 1500 };
    const scene = resolveSceneLayout({ ...baseState, artboard: tallAuthored, fontSize: 560, density: 58 }, null);
    expect(scene.expandedX).toBe(true);
    assertCenterPreserved(scene);
    expect(scene.effectiveArtboard.width).toBeGreaterThan(tallAuthored.width);
    expect(scene.effectiveArtboard.height).toBe(tallAuthored.height);
    expect(scene.effectiveArtboard.x).toBeLessThan(0);
    expect(scene.effectiveArtboard.y).toBe(0);
    expect(artboardLeft(scene.effectiveArtboard)).toBeLessThan(0);
    expect(artboardRight(scene.effectiveArtboard)).toBeGreaterThan(tallAuthored.width);
  });

  it("grows symmetrically on the vertical axis when ink exceeds authored height", () => {
    const scene = resolveSceneLayout({
      ...baseState,
      artboard: { width: 1200, height: 120 },
      fontSize: 148,
      textOffsetY: 0,
    }, null);
    expect(scene.expandedY).toBe(true);
    assertCenterPreserved(scene);
    expect(scene.effectiveArtboard.height).toBeGreaterThan(120);
    expect(scene.effectiveArtboard.y).toBeLessThan(0);
    expect(artboardTop(scene.effectiveArtboard)).toBeLessThan(0);
    expect(artboardBottom(scene.effectiveArtboard)).toBeGreaterThan(120);
  });

  it("can grow on both axes while preserving the authored center", () => {
    const scene = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 700 }, null);
    expect(scene.expandedX).toBe(true);
    expect(scene.expandedY).toBe(true);
    assertCenterPreserved(scene);
    expect(scene.effectiveArtboard.width).toBeGreaterThan(authored.width);
    expect(scene.effectiveArtboard.height).toBeGreaterThan(authored.height);
  });

  it("never shrinks below the authored minimum floor", () => {
    const scene = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 96 }, null);
    expect(scene.effectiveArtboard.width).toBeGreaterThanOrEqual(authored.width);
    expect(scene.effectiveArtboard.height).toBeGreaterThanOrEqual(authored.height);
  });

  it("applies deterministic rounding and non-zero origins when expanded", () => {
    const scene = resolveSceneLayout({ ...baseState, artboard: authored, fontSize: 540 }, null);
    for (const value of [
      scene.effectiveArtboard.x,
      scene.effectiveArtboard.y,
      scene.effectiveArtboard.width,
      scene.effectiveArtboard.height,
    ]) {
      expect(value).toBe(roundSceneNumber(value));
    }
    const center = artboardCenter(scene.effectiveArtboard);
    expect(center.x).toBeCloseTo(authored.width / 2, 3);
    expect(center.y).toBeCloseTo(authored.height / 2, 3);
  });

  it("returns the same key for identical authored inputs", () => {
    const state = { ...baseState, artboard: authored, fontSize: 148 };
    const first = resolveSceneLayout(state, null);
    const second = resolveSceneLayout(state, null);
    expect(second.key).toBe(first.key);
  });
});