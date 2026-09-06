import { baseState } from "../../src/engine/presets";
import type { GlyphDisplacementMode, ProjectState } from "../../src/types";

export const protectedFragmentationModes = [
  "warp",
  "horizontal-slices",
  "vertical-slices",
  "grid",
  "radial-sectors",
] as const satisfies readonly GlyphDisplacementMode[];

function fragmentationFixture(mode: GlyphDisplacementMode): ProjectState {
  return {
    ...baseState,
    text: "FRAGMENT",
    fontSize: 148,
    lineHeight: 1,
    tracking: -3,
    renderer: "sdf-halftone",
    seed: 91234,
    preset: "Custom",
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 600,
      customY: 360,
      radius: 360,
    },
    emitters: baseState.emitters.map((emitter) => ({ ...emitter })),
    emitterDisplay: { ...baseState.emitterDisplay, mode: "field" },
    glyphDisplacement: {
      ...baseState.glyphDisplacement,
      enabled: true,
      mode,
      sliceInfluence: "legacy",
      strength: 68,
      responseRadius: 420,
      falloff: "smoothstep",
      fragmentSize: 48,
      gap: 9,
      quantizationSteps: 7,
      direction: 18,
      radialTangential: 22,
      jitter: 28,
      fragmentRotation: 1.75,
      seedInfluence: 100,
    },
    dotGrid: {
      ...baseState.dotGrid,
      enabled: true,
      spacing: 12,
      radius: 2.2,
      threshold: 0.55,
      edgeSoftness: 0.18,
    },
    debug: { ...baseState.debug },
    font: null,
  };
}

export const currentFragmentationFixtures = Object.fromEntries(
  protectedFragmentationModes.map((mode) => [mode, fragmentationFixture(mode)]),
) as Record<GlyphDisplacementMode, ProjectState>;
