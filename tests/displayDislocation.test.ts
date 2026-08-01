import { describe, expect, it } from "vitest";
import {
  DISPLAY_DISLOCATION_MAX_DISPLACEMENT,
  createDisplayDislocationSampler,
  isDisplayDislocationActive,
} from "../src/engine/displayDislocation";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";
import type { ProjectState, RenderContext } from "../src/types";

const context: RenderContext = {
  timeMs: 0,
  frame: 0,
  viewport: { x: -240, y: -160, width: 680, height: 520, centerX: 100, centerY: 100 },
};

function displayState(overrides: Partial<ProjectState["displayDislocation"]> = {}): ProjectState {
  return {
    ...baseState,
    renderer: "sdf-halftone",
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 100,
      customY: 100,
    },
    dotGrid: { ...baseState.dotGrid, enabled: true, spacing: 10 },
    displayDislocation: {
      ...baseState.displayDislocation,
      enabled: true,
      mode: "horizontal-bands",
      responseRadius: 90,
      displacementAmount: 48,
      regionSize: 20,
      gap: 0,
      quantizationSteps: 8,
      direction: 0,
      alternatingOffset: 100,
      radialBias: 0,
      seed: 7117,
      ...overrides,
    },
  };
}

describe("Display Dislocation inverse-domain sampler", () => {
  it("is renderer-local and requires the regular dot grid plus an emitter", () => {
    const state = displayState();
    expect(isDisplayDislocationActive(state)).toBe(true);
    expect(isDisplayDislocationActive({ ...state, renderer: "sdf-contours" })).toBe(false);
    expect(isDisplayDislocationActive({ ...state, dotGrid: { ...state.dotGrid, enabled: false } })).toBe(false);
    expect(isDisplayDislocationActive({ ...state, emitter: { ...state.emitter, enabled: false } })).toBe(false);
  });

  it("returns exact identity outside the response radius", () => {
    const sample = createDisplayDislocationSampler(displayState(), context).sample(210, 100);
    expect(sample).toMatchObject({
      target: { x: 210, y: 100 },
      source: { x: 210, y: 100 },
      translation: { x: 0, y: 0 },
      displacement: 0,
      influence: 0,
      affected: false,
      gapRejected: false,
    });
  });

  it("assigns one coherent deterministic translation to every point in a region", () => {
    const sampler = createDisplayDislocationSampler(displayState(), context);
    const first = sampler.sample(82, 105);
    const neighbor = sampler.sample(118, 115);
    const repeat = createDisplayDislocationSampler(displayState(), context).sample(82, 105);

    expect(first.affected).toBe(true);
    expect(neighbor.regionId).toBe(first.regionId);
    expect(neighbor.translation).toEqual(first.translation);
    expect(repeat).toEqual(first);
    expect(first.source).toEqual({
      x: first.target.x - first.translation.x,
      y: first.target.y - first.translation.y,
    });
  });

  it("uses the local seed without independently jittering dots", () => {
    const points = [[70, 65], [90, 85], [110, 105], [130, 125]] as const;
    const first = createDisplayDislocationSampler(
      displayState({ alternatingOffset: 0, seed: 11 }),
      context,
    );
    const second = createDisplayDislocationSampler(
      displayState({ alternatingOffset: 0, seed: 29 }),
      context,
    );
    expect(points.map(([x, y]) => first.sample(x, y).translation))
      .not.toEqual(points.map(([x, y]) => second.sample(x, y).translation));
  });

  it("forms hard structured gaps at affected region boundaries", () => {
    const sampler = createDisplayDislocationSampler(displayState({ gap: 8 }), context);
    expect(sampler.sample(100, 100)).toMatchObject({ affected: true, gapRejected: true });
    expect(sampler.sample(100, 110)).toMatchObject({ affected: true, gapRejected: false });
    // Gap removal is local; the same world-space boundary outside the response
    // circle remains an untouched candidate.
    expect(sampler.sample(220, 100)).toMatchObject({ affected: false, gapRejected: false });
  });

  it.each(["horizontal-bands", "vertical-bands", "blocks"] as const)(
    "handles %s deterministically with a non-zero viewport origin",
    (mode) => {
      const state = displayState({ mode, gap: 4, radialBias: 20 });
      const first = createDisplayDislocationSampler(state, context).sample(40, 60);
      const second = createDisplayDislocationSampler(state, context).sample(40, 60);
      expect(second).toEqual(first);
      expect(first.regionId).toContain(mode === "horizontal-bands" ? ":h:" : mode === "vertical-bands" ? ":v:" : ":b:");
      expect(first.displacement).toBeLessThanOrEqual(DISPLAY_DISLOCATION_MAX_DISPLACEMENT);
      expect(Object.values(first.source).every(Number.isFinite)).toBe(true);
    },
  );

  it("round-trips every separate setting and disables the feature for v9 migration", () => {
    const state = displayState({
      mode: "blocks",
      responseRadius: 333,
      displacementAmount: 77,
      regionSize: 51,
      gap: 11,
      quantizationSteps: 9,
      direction: -35,
      alternatingOffset: 65,
      radialBias: 27,
      seed: 4444,
    });
    expect(validateProject(JSON.parse(JSON.stringify(state))).project.displayDislocation)
      .toEqual(state.displayDislocation);

    const { displayDislocation: _displayDislocation, ...v10Fields } = state;
    const migrated = validateProject({ ...v10Fields, version: 9 }).project;
    expect(migrated.displayDislocation).toEqual(baseState.displayDislocation);
    expect(migrated.displayDislocation.enabled).toBe(false);
  });
});
