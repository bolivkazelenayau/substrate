import { describe, expect, it } from "vitest";
import {
  SIZE_HARD_LIMITS,
  resolveDisplacementBounds,
  resolveDotRadiusBounds,
  resolveEmitterRadiusBounds,
  resolveOutlineWidthBounds,
  resolveTextOffsetBounds,
  resolveTypographySizeBounds,
} from "../src/engine/numericBounds";

const context = {
  artboardWidth: 1200,
  artboardHeight: 720,
  typographySize: 148,
  currentValue: 148,
};

describe("contextual numeric bounds", () => {
  it("uses an artboard-relative typography range beyond the former UI cap", () => {
    const bounds = resolveTypographySizeBounds(context);
    expect(bounds.softMax).toBeGreaterThan(220);
    expect(bounds.softMax).toBeLessThanOrEqual(bounds.hardMax);
    expect(bounds.hardMax).toBe(SIZE_HARD_LIMITS.typographySize);
  });

  it("expands the typography range to preserve a large current value", () => {
    const bounds = resolveTypographySizeBounds({ ...context, typographySize: 777, currentValue: 777 });
    expect(bounds.softMax).toBeGreaterThanOrEqual(777);
    expect(bounds.softMax).toBeLessThanOrEqual(bounds.hardMax);
  });

  it("scales outline and displacement ranges with typography size", () => {
    const smallOutline = resolveOutlineWidthBounds({ ...context, typographySize: 100, currentValue: 1 });
    const largeOutline = resolveOutlineWidthBounds({ ...context, typographySize: 1000, currentValue: 1 });
    const smallDisplacement = resolveDisplacementBounds({ ...context, typographySize: 100, currentValue: 1 });
    const largeDisplacement = resolveDisplacementBounds({ ...context, typographySize: 1000, currentValue: 1 });
    expect(largeOutline.softMax).toBeGreaterThan(smallOutline.softMax);
    expect(largeDisplacement.softMax).toBeGreaterThan(smallDisplacement.softMax);
  });

  it("keeps current dot and emitter sizes representable within finite hard limits", () => {
    const dot = resolveDotRadiusBounds({ ...context, currentValue: 42 });
    const emitter = resolveEmitterRadiusBounds({ ...context, currentValue: 3000 });
    expect(dot.softMax).toBeGreaterThanOrEqual(42);
    expect(dot.hardMax).toBe(SIZE_HARD_LIMITS.dotRadius);
    expect(emitter.softMax).toBeGreaterThanOrEqual(3000);
    expect(emitter.hardMax).toBe(SIZE_HARD_LIMITS.emitterRadius);
  });

  it("never expands soft ranges beyond hard safety limits", () => {
    const typography = resolveTypographySizeBounds({ ...context, currentValue: Number.MAX_VALUE });
    const outline = resolveOutlineWidthBounds({ ...context, currentValue: Number.POSITIVE_INFINITY });
    expect(typography.softMax).toBe(typography.hardMax);
    expect(Number.isFinite(typography.softMax)).toBe(true);
    expect(Number.isFinite(outline.softMax)).toBe(true);
    expect(outline.softMax).toBeLessThanOrEqual(outline.hardMax);
  });

  it("keeps center-compensation offsets representable within finite limits", () => {
    const positive = resolveTextOffsetBounds({ ...context, currentValue: 640 });
    const negative = resolveTextOffsetBounds({ ...context, currentValue: -640 });
    expect(positive.softMax).toBeGreaterThanOrEqual(640);
    expect(negative.min).toBeLessThanOrEqual(-640);
    expect(positive.hardMax).toBe(SIZE_HARD_LIMITS.textOffset);
  });
});
