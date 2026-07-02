export interface NumericBoundsContext {
  artboardWidth: number;
  artboardHeight: number;
  typographySize: number;
  currentValue: number;
}

export interface NumericControlBounds {
  min: number;
  softMax: number;
  hardMax: number;
  step: number;
  warningThreshold?: number;
}

// Soft maxima shape sliders without rejecting intentional extremes. Hard
// maxima are broad, finite document/engine safety limits used during repair.
export const SIZE_HARD_LIMITS = {
  typographySize: 4096,
  outlineWidth: 512,
  dotRadius: 128,
  emitterRadius: 8192,
  displacement: 2048,
  textOffset: 2048,
} as const;

function expandableSoftMax(base: number, currentValue: number, hardMax: number, quantum: number) {
  const finiteCurrent = Number.isFinite(currentValue) ? currentValue : 0;
  const target = Math.min(hardMax, Math.max(base, finiteCurrent));
  return Math.min(hardMax, Math.ceil(target / quantum) * quantum);
}

export function resolveTypographySizeBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.typographySize;
  return {
    min: 1,
    softMax: expandableSoftMax(context.artboardHeight * 0.75, context.currentValue, hardMax, 20),
    hardMax,
    step: 1,
  };
}

export function resolveOutlineWidthBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.outlineWidth;
  return {
    min: 0.25,
    softMax: expandableSoftMax(Math.max(16, context.typographySize * 0.12), context.currentValue, hardMax, 4),
    hardMax,
    step: 0.25,
    warningThreshold: context.typographySize * 0.2,
  };
}

export function resolveDotRadiusBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.dotRadius;
  return {
    min: 0.1,
    softMax: expandableSoftMax(Math.max(8, context.typographySize * 0.06), context.currentValue, hardMax, 2),
    hardMax,
    step: 0.1,
  };
}

export function resolveEmitterRadiusBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.emitterRadius;
  return {
    min: 20,
    softMax: expandableSoftMax(Math.hypot(context.artboardWidth, context.artboardHeight) * 1.25, context.currentValue, hardMax, 100),
    hardMax,
    step: 10,
  };
}

export function resolveDisplacementBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.displacement;
  return {
    min: 0,
    softMax: expandableSoftMax(Math.max(80, context.typographySize * 0.75), context.currentValue, hardMax, 20),
    hardMax,
    step: 1,
  };
}

export function resolveTextOffsetBounds(context: NumericBoundsContext): NumericControlBounds {
  const hardMax = SIZE_HARD_LIMITS.textOffset;
  const finiteCurrent = Number.isFinite(context.currentValue) ? context.currentValue : 0;
  return {
    min: Math.max(-hardMax, Math.min(-120, Math.floor(finiteCurrent))),
    softMax: Math.min(hardMax, Math.max(120, Math.ceil(finiteCurrent))),
    hardMax,
    step: 1,
  };
}
