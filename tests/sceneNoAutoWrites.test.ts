import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import type { ProjectState } from "../src/types";

function cloneState(state: ProjectState): ProjectState {
  return structuredClone(state);
}

function sizePatchFields(source: string): string[] {
  const match = source.match(/label="Size"[\s\S]*?onChange=\{\(fontSize\) => patch\(\{([^}]+)\}\)\}/);
  if (!match) return [];
  const patchBody = match[1];
  const explicit = [...patchBody.matchAll(/(\w+)\s*:/g)].map((field) => field[1]);
  if (explicit.length > 0) return explicit;
  return [...new Set(patchBody.split(/[\s,]+/).filter(Boolean))];
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

  it("commits only the Size-owned field from the typography Size control", () => {
    const source = readFileSync(resolve("src/components/panels/ArtworkTypographyPanels.tsx"), "utf8");
    expect(sizePatchFields(source)).toEqual(["fontSize"]);
    expect(source).not.toContain("useAutoGrowArtboard");
  });

  it("does not emit automatic artboard or textOffsetY patches from production hooks", () => {
    const app = readFileSync(resolve("src/App.tsx"), "utf8");
    const hooks = readFileSync(resolve("src/hooks/useSceneLayout.ts"), "utf8");
    expect(app).not.toContain("useAutoGrowArtboard");
    expect(hooks).not.toContain("patch(");
    expect(hooks).toContain("never writes to `ProjectState`");
  });
});