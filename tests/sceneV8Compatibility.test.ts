import { describe, expect, it } from "vitest";
import { validateProject } from "../src/engine/projectSchema";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { loadLargeV8Project } from "./utils/sceneLayoutHarness";

describe("existing large v8 project compatibility", () => {
  it("keeps persisted artboard dimensions as the authored baseline", () => {
    const project = loadLargeV8Project();
    expect(project.version).toBe(15);
    expect(project.artboard).toEqual({ width: 3367, height: 777 });
  });

  it("does not auto-shrink a large saved artboard below the persisted baseline", () => {
    const project = loadLargeV8Project();
    const scene = resolveSceneLayout(project, null);
    expect(scene.authoredArtboard).toEqual({ width: 3367, height: 777 });
    expect(scene.effectiveArtboard.width).toBeGreaterThanOrEqual(3367);
    expect(scene.effectiveArtboard.height).toBeGreaterThanOrEqual(777);
  });

  it("repairs invalid dimensions but preserves valid authored artboard on import", () => {
    const repaired = validateProject({
      version: 8,
      artboard: { width: 3367, height: 777 },
      text: "LEGACY",
      renderer: "flow",
    }).project;
    expect(repaired.artboard).toEqual({ width: 3367, height: 777 });
    expect(repaired.version).toBe(15);
  });
});
