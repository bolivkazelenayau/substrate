import { describe, expect, it } from "vitest";
import {
  emitterInfluenceAtDistance,
  isEmitterInfluenceTargetEligible,
  sampleEmitterInfluence,
  type EmitterInfluenceSource,
} from "../src/engine/field/emitterInfluence";
import type { GlyphInfluenceSettings } from "../src/types";

const settings: GlyphInfluenceSettings = {
  radius: 100,
  edgeSoftness: 80,
  falloff: "smoothstep",
};

const source = (x: number, id = `source-${x}`): EmitterInfluenceSource => ({
  id,
  anchor: { x, y: -40 },
  weight: 1,
  radiusMultiplier: 1,
  phaseOffset: 0,
  scope: "all-typography",
  neighborhoodSize: 1,
  sourceGlyphId: null,
  sourceTextIndex: null,
  sourceLineIndex: null,
  sourceGlyphIndexInLine: null,
  sourceGlobalGlyphIndex: null,
});

describe("shared emitter influence envelope", () => {
  it("keeps a normalized full-strength circular core", () => {
    expect(emitterInfluenceAtDistance(0, settings)).toBe(1);
    expect(emitterInfluenceAtDistance(99.999, settings)).toBe(1);
    expect(emitterInfluenceAtDistance(100, settings)).toBe(1);
  });

  it.each(["smoothstep", "gaussian", "linear"] as const)(
    "%s decays continuously outside the core and reaches exact zero after softness",
    (falloff) => {
      const envelope = { ...settings, falloff };
      const justOutside = emitterInfluenceAtDistance(100.001, envelope);
      const middle = emitterInfluenceAtDistance(140, envelope);
      const justInsideEdge = emitterInfluenceAtDistance(179.999, envelope);
      expect(justOutside).toBeLessThanOrEqual(1);
      expect(justOutside).toBeGreaterThan(middle);
      expect(middle).toBeGreaterThan(justInsideEdge);
      expect(emitterInfluenceAtDistance(180, envelope)).toBe(0);
      expect(emitterInfluenceAtDistance(600, envelope)).toBe(0);
    },
  );

  it("radius changes coverage without changing core strength", () => {
    const small = { ...settings, radius: 40 };
    const large = { ...settings, radius: 140 };
    expect(emitterInfluenceAtDistance(0, small)).toBe(1);
    expect(emitterInfluenceAtDistance(0, large)).toBe(1);
    expect(emitterInfluenceAtDistance(120, large)).toBe(1);
    expect(emitterInfluenceAtDistance(120, small)).toBe(0);
  });

  it("edge softness changes transition width rather than core amplitude", () => {
    const hard = { ...settings, edgeSoftness: 20 };
    const soft = { ...settings, edgeSoftness: 180 };
    expect(emitterInfluenceAtDistance(40, hard)).toBe(1);
    expect(emitterInfluenceAtDistance(40, soft)).toBe(1);
    expect(emitterInfluenceAtDistance(150, hard)).toBe(0);
    expect(emitterInfluenceAtDistance(150, soft)).toBeGreaterThan(0);
  });

  it("blends multiple emitters continuously without a nearest-owner seam", () => {
    const sources = [source(0, "left"), source(120, "right")];
    const left = sampleEmitterInfluence({ x: 59.99, y: -40 }, sources, settings);
    const center = sampleEmitterInfluence({ x: 60, y: -40 }, sources, settings);
    const right = sampleEmitterInfluence({ x: 60.01, y: -40 }, sources, settings);
    expect(left.influence).toBeCloseTo(right.influence, 5);
    expect(Math.abs(center.influence - left.influence)).toBeLessThan(0.001);
    expect(center.contributions).toHaveLength(2);
    expect(center.anchor?.x).toBeCloseTo(60, 5);
  });

  it("is origin-independent in world space", () => {
    const a = sampleEmitterInfluence({ x: 35, y: -55 }, [source(10)], settings).influence;
    const shiftedSource = { ...source(1_010), anchor: { x: 1_010, y: 945 } };
    const b = sampleEmitterInfluence({ x: 1_035, y: 930 }, [shiftedSource], settings).influence;
    expect(b).toBeCloseTo(a, 10);
  });

  it("separates glyph, neighborhood, line, and global semantic eligibility", () => {
    const emitter = {
      ...source(0),
      sourceGlyphId: "glyph-o",
      sourceTextIndex: 9,
      sourceLineIndex: 1,
      sourceGlyphIndexInLine: 1,
      sourceGlobalGlyphIndex: 8,
    };
    const target = (glyphId: string, lineIndex: number, glyphIndexInLine: number) => ({
      glyphId,
      textIndex: glyphIndexInLine,
      lineIndex,
      glyphIndexInLine,
      globalGlyphIndex: glyphIndexInLine,
    });
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "source-glyph" }, target("glyph-o", 1, 1))).toBe(true);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "source-glyph" }, target("glyph-n", 1, 2))).toBe(false);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "glyph-neighborhood", neighborhoodSize: 1 }, target("glyph-n", 1, 2))).toBe(true);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "glyph-neighborhood", neighborhoodSize: 1 }, target("glyph-i", 1, 3))).toBe(false);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "glyph-neighborhood", neighborhoodSize: 8 }, target("glyph-P", 0, 0))).toBe(false);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "source-line" }, target("glyph-s", 1, 5))).toBe(true);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "source-line" }, target("glyph-P", 0, 0))).toBe(false);
    expect(isEmitterInfluenceTargetEligible({ ...emitter, scope: "all-typography" }, target("glyph-P", 0, 0))).toBe(true);
  });

  it("blends only emitters eligible for the current target", () => {
    const target = {
      glyphId: "glyph-o",
      textIndex: 9,
      lineIndex: 1,
      glyphIndexInLine: 1,
      globalGlyphIndex: 8,
    };
    const emitters: EmitterInfluenceSource[] = [
      {
        ...source(0, "sonics-o"),
        scope: "source-glyph",
        sourceGlyphId: "glyph-o",
        sourceTextIndex: 9,
        sourceLineIndex: 1,
        sourceGlyphIndexInLine: 1,
        sourceGlobalGlyphIndex: 8,
      },
      {
        ...source(0, "private-p"),
        scope: "source-glyph",
        sourceGlyphId: "glyph-P",
        sourceTextIndex: 0,
        sourceLineIndex: 0,
        sourceGlyphIndexInLine: 0,
        sourceGlobalGlyphIndex: 0,
      },
    ];
    const sample = sampleEmitterInfluence({ x: 0, y: -40 }, emitters, settings, target);
    expect(sample.influence).toBe(1);
    expect(sample.contributions.map((contribution) => contribution.source.id)).toEqual(["sonics-o"]);
  });
});
