import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import type { ProjectState } from "../src/types";

function cloneState(state: ProjectState): ProjectState {
  return structuredClone(state);
}

function sizeControlUsesInteractionBoundary(source: string): boolean {
  return source.includes("SizeRange")
    && source.includes("handlers={sizeHandlers}")
    && source.includes("handlers.onInput")
    && !source.includes('onChange={(fontSize) => patch({ fontSize })}');
}

describe("no automatic ProjectState writes", () => {
  it("does not mutate ProjectState while resolving scene layout", () => {
    const state = cloneState({ ...baseState, fontSize: 148, textOffsetY: 0 });
    const before = JSON.stringify(state);
    resolveSceneLayout(state, null);
    resolveSceneLayout({ ...state, fontSize: 540 }, null);
    resolveSceneLayout({ ...state, fontSize: 148 }, null);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("keeps artboard and textOffsetY unchanged when only fontSize changes in the resolver inputs", () => {
    const initial = { ...baseState, fontSize: 148, textOffsetY: 0, artboard: { width: 1200, height: 720 } };
    const restored = { ...initial, fontSize: 148 };
    const transient = { ...initial, fontSize: 540 };
    resolveSceneLayout(transient, null);
    const scene = resolveSceneLayout(restored, null);
    expect(scene.authoredArtboard).toEqual(initial.artboard);
    expect(scene.typography.authoredOffset.y).toBe(initial.textOffsetY);
  });

  it("routes the typography Size control through the interaction boundary instead of per-input patch commits", () => {
    const panels = readFileSync(resolve("src/components/panels/ArtworkTypographyPanels.tsx"), "utf8");
    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    expect(sizeControlUsesInteractionBoundary(panels)).toBe(true);
    expect(app).toContain("useSizeInteraction");
    expect(app).toContain("commitFontSize");
    expect(panels).not.toContain("useAutoGrowArtboard");
  });

  it("does not emit automatic artboard or textOffsetY patches from production hooks", () => {
    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    const hooks = readFileSync(resolve("src/hooks/useSceneLayout.ts"), "utf8");
    expect(app).not.toContain("useAutoGrowArtboard");
    expect(hooks).not.toContain("patch(");
    expect(hooks).toContain("never writes to `ProjectState`");
  });
});