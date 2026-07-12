import { beforeAll, describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { getTextLayout } from "../src/engine/textLayout";
import { loadReferenceFont } from "./utils/sceneLayoutHarness";
import type { LoadedFont } from "../src/engine/fontLoader";

let loadedFont: LoadedFont;

beforeAll(async () => {
  loadedFont = await loadReferenceFont();
});

describe("parsed font and native fallback placement contract", () => {
  const state = { ...baseState, text: "SUBSTRATE", fontSize: 148, textOffsetY: 12 };

  it("uses the same canonical baseline and offset semantics for native fallback", () => {
    const scene = resolveSceneLayout(state, null);
    const layout = getTextLayout(state, false);
    expect(layout.baselineY).toBeCloseTo(scene.typography.resolvedBaseline, 3);
    expect(scene.typography.authoredOffset).toEqual({ x: 0, y: state.textOffsetY });
  });

  it("uses the same canonical baseline and offset semantics for parsed font geometry", () => {
    const geometry = layoutGlyphs({ ...state, font: loadedFont.metadata }, loadedFont);
    const scene = resolveSceneLayout({ ...state, font: loadedFont.metadata }, geometry);
    const layout = getTextLayout({ ...state, font: loadedFont.metadata }, true);
    expect(layout.baselineY).toBeCloseTo(scene.typography.resolvedBaseline, 3);
    expect(scene.typography.authoredOffset).toEqual({ x: 0, y: state.textOffsetY });
    expect(scene.typography.canonicalBaseline).toBeCloseTo(
      resolveSceneLayout(state, null).typography.canonicalBaseline,
      3,
    );
  });

  it("may differ in ink bounds accuracy but not in coordinate contract", () => {
    const nativeScene = resolveSceneLayout(state, null);
    const parsedGeometry = layoutGlyphs({ ...state, font: loadedFont.metadata }, loadedFont);
    const parsedScene = resolveSceneLayout({ ...state, font: loadedFont.metadata }, parsedGeometry);
    expect(parsedScene.typography.resolvedBaseline).toBeCloseTo(nativeScene.typography.resolvedBaseline, 3);
    expect(parsedScene.typography.authoredOffset).toEqual(nativeScene.typography.authoredOffset);
    expect(parsedScene.typography.inkBounds).not.toEqual(nativeScene.typography.inkBounds);
  });
});