import type { ProjectState } from "../types";

export const SDF_REFERENCE_TYPOGRAPHY_SIZE = 540;
export const SDF_SCALE_LIMITS = { min: 0.18, max: 4 } as const;

const rounded = (value: number) => Number(value.toFixed(4));

export interface SdfScaleContext {
  scale: number;
  world: (referenceValue: number, minimum?: number, maximum?: number) => number;
}

export function resolveSdfScaleContext(
  state: Pick<ProjectState, "fontSize">,
): SdfScaleContext {
  const scale = Math.min(
    SDF_SCALE_LIMITS.max,
    Math.max(SDF_SCALE_LIMITS.min, state.fontSize / SDF_REFERENCE_TYPOGRAPHY_SIZE),
  );
  return {
    scale: rounded(scale),
    world(referenceValue, minimum = 0, maximum = Number.POSITIVE_INFINITY) {
      return rounded(Math.min(maximum, Math.max(minimum, referenceValue * scale)));
    },
  };
}
