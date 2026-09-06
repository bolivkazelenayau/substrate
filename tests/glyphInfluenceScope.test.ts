import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  deriveGlyphCalmWaterGeometry,
  glyphCalmWaterIdentity,
  type GlyphCalmWaterGeometry,
} from "../src/engine/glyphCalmWater";
import {
  deriveDisplacedTypographyGeometry,
  glyphDisplacementIdentity,
} from "../src/engine/glyphDisplacement";
import { deriveGlyphMicroWarpGeometry } from "../src/engine/glyphMicroWarp";
import { resolveEmitterInfluenceSources } from "../src/engine/field/emitterInfluence";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import type { PositionedGlyph, TextGeometry } from "../src/engine/glyphGeometry";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";
import type { EmitterInfluenceScope, ProjectState } from "../src/types";

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

interface ScopedFixture {
  state: ProjectState;
  source: TextGeometry;
  sourceGlyph: PositionedGlyph;
}

function scopedFixture(
  scope: EmitterInfluenceScope,
  neighborhoodSize = 1,
): ScopedFixture {
  let state: ProjectState = {
    ...baseState,
    text: "Private\nSonics",
    fontSize: 360,
    lineHeight: 0.78,
    textOffsetY: 36,
    font: loaded.metadata,
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "counter-center",
      influenceScope: scope,
      neighborhoodSize,
      glyphId: "auto-o-middle",
      frequency: 0.055,
    },
    glyphInfluence: {
      ...baseState.glyphInfluence,
      radius: 1_200,
      edgeSoftness: 0,
    },
    glyphCalmWater: {
      ...baseState.glyphCalmWater,
      enabled: true,
      strength: 12,
      surfaceVariation: 34,
      drift: 8,
      detail: 12,
    },
  };
  let source = layoutGlyphs(state, loaded);
  const selected = source.glyphs.find((glyph) => glyph.lineIndex === 1 && glyph.character === "o");
  if (!selected) throw new Error("Private / Sonics fixture did not produce the lowercase o.");
  state = { ...state, emitter: { ...state.emitter, glyphId: selected.glyphId } };
  source = layoutGlyphs(state, loaded);
  const sourceGlyph = source.glyphs.find((glyph) => glyph.glyphId === selected.glyphId);
  if (!sourceGlyph) throw new Error("Emitter glyph identity was not stable across layout.");
  return { state, source, sourceGlyph };
}

function calmWater(fixture: ScopedFixture): GlyphCalmWaterGeometry {
  return deriveGlyphCalmWaterGeometry(fixture.state, fixture.source, "typography:private-sonics");
}

function changedPointCounts(source: TextGeometry, result: GlyphCalmWaterGeometry) {
  const counts = new Map(source.glyphs.map((glyph) => [glyph.glyphId, 0]));
  for (const changed of result.diagnostics.changedGlyphs) counts.set(changed.glyphId, changed.changedPointCount);
  return counts;
}

function expectUnchangedGlyphsAreByteExact(
  source: TextGeometry,
  output: TextGeometry,
  counts: Map<string, number>,
) {
  for (const sourceGlyph of source.glyphs) {
    if ((counts.get(sourceGlyph.glyphId) ?? 0) !== 0) continue;
    const outputGlyph = output.glyphs.find((glyph) => glyph.glyphId === sourceGlyph.glyphId);
    expect(outputGlyph?.path.d, sourceGlyph.glyphId).toBe(sourceGlyph.path.d);
  }
}

describe("glyph-bound emitter influence scope", () => {
  it("resolves authoritative source identity and keys scope plus neighborhood", () => {
    const fixture = scopedFixture("source-glyph");
    const [source] = resolveEmitterInfluenceSources(fixture.state, fixture.source);
    expect(source).toMatchObject({
      sourceGlyphId: fixture.sourceGlyph.glyphId,
      sourceTextIndex: 9,
      sourceLineIndex: 1,
      sourceGlyphIndexInLine: 1,
      scope: "source-glyph",
    });
    const sourceGlyphKey = glyphCalmWaterIdentity(fixture.state, "source", fixture.source).geometryKey;
    const sourceLineKey = glyphCalmWaterIdentity({
      ...fixture.state,
      emitter: { ...fixture.state.emitter, influenceScope: "source-line" },
    }, "source", fixture.source).geometryKey;
    const neighborOneKey = glyphCalmWaterIdentity({
      ...fixture.state,
      emitter: { ...fixture.state.emitter, influenceScope: "glyph-neighborhood", neighborhoodSize: 1 },
    }, "source", fixture.source).geometryKey;
    const neighborTwoKey = glyphCalmWaterIdentity({
      ...fixture.state,
      emitter: { ...fixture.state.emitter, influenceScope: "glyph-neighborhood", neighborhoodSize: 2 },
    }, "source", fixture.source).geometryKey;
    expect(sourceLineKey).not.toBe(sourceGlyphKey);
    expect(neighborTwoKey).not.toBe(neighborOneKey);
    expect(glyphCalmWaterIdentity({
      ...fixture.state,
      debug: { ...fixture.state.debug, glyphBounds: true },
    }, "source", fixture.source).geometryKey).toBe(sourceGlyphKey);
  });

  it("keeps every non-source glyph at zero changed points under a very large radius", () => {
    const fixture = scopedFixture("source-glyph");
    const result = calmWater(fixture);
    const counts = changedPointCounts(fixture.source, result);
    expect(counts.get(fixture.sourceGlyph.glyphId)).toBeGreaterThan(0);
    for (const glyph of fixture.source.glyphs) {
      if (glyph.glyphId === fixture.sourceGlyph.glyphId) continue;
      expect(counts.get(glyph.glyphId), glyph.glyphId).toBe(0);
    }
    expect(result.diagnostics.changedGlyphs).toEqual([
      expect.objectContaining({
        glyphId: fixture.sourceGlyph.glyphId,
        textIndex: 9,
        lineIndex: 1,
        changedPointCount: expect.any(Number),
      }),
    ]);
    expectUnchangedGlyphsAreByteExact(fixture.source, result.geometry!, counts);
  });

  it("limits a one-neighbor scope to adjacent glyphs on the same line", () => {
    const fixture = scopedFixture("glyph-neighborhood", 1);
    const result = calmWater(fixture);
    const counts = changedPointCounts(fixture.source, result);
    const eligible = fixture.source.glyphs.filter((glyph) => glyph.lineIndex === 1
      && Math.abs((glyph.glyphIndexInLine ?? -99) - (fixture.sourceGlyph.glyphIndexInLine ?? 0)) <= 1);
    const eligibleIds = new Set(eligible.map((glyph) => glyph.glyphId));
    expect(eligible.map((glyph) => glyph.character)).toEqual(["S", "o", "n"]);
    expect(counts.get(fixture.sourceGlyph.glyphId)).toBeGreaterThan(0);
    for (const glyph of fixture.source.glyphs) {
      if (eligibleIds.has(glyph.glyphId)) continue;
      expect(counts.get(glyph.glyphId), glyph.glyphId).toBe(0);
    }
    expect(result.diagnostics.changedGlyphs.every((glyph) => eligibleIds.has(glyph.glyphId))).toBe(true);
    expectUnchangedGlyphsAreByteExact(fixture.source, result.geometry!, counts);
  });

  it("isolates Source line while All typography intentionally restores global spatial behavior", () => {
    const lineFixture = scopedFixture("source-line");
    const lineResult = calmWater(lineFixture);
    const lineCounts = changedPointCounts(lineFixture.source, lineResult);
    expect(lineResult.diagnostics.changedGlyphs.length).toBeGreaterThan(0);
    expect(lineResult.diagnostics.changedGlyphs.every((glyph) => glyph.lineIndex === 1)).toBe(true);
    for (const glyph of lineFixture.source.glyphs.filter((candidate) => candidate.lineIndex === 0)) {
      expect(lineCounts.get(glyph.glyphId), glyph.glyphId).toBe(0);
      expect(lineResult.geometry!.glyphs.find((output) => output.glyphId === glyph.glyphId)?.path.d)
        .toBe(glyph.path.d);
    }

    const globalFixture = scopedFixture("all-typography");
    const globalResult = calmWater(globalFixture);
    expect(globalResult.diagnostics.changedGlyphs.some((glyph) => glyph.lineIndex === 0)).toBe(true);
  });

  it("keeps mixed multi-emitter scopes independent and treats custom positions as global", () => {
    const fixture = scopedFixture("source-glyph");
    const privateP = fixture.source.glyphs.find((glyph) => glyph.textIndex === 0)!;
    const state: ProjectState = {
      ...fixture.state,
      emitterMode: "multiple",
      emitters: [
        {
          ...baseState.emitters[0],
          id: "sonics-o",
          glyphId: fixture.sourceGlyph.glyphId,
          influenceScope: "source-glyph",
          label: "Sonics o",
        },
        {
          ...baseState.emitters[0],
          id: "private-p",
          glyphId: privateP.glyphId,
          influenceScope: "source-glyph",
          label: "Private P",
        },
      ],
    };
    const result = deriveGlyphCalmWaterGeometry(state, fixture.source, "source");
    expect(new Set(result.diagnostics.changedGlyphs.map((glyph) => glyph.glyphId)))
      .toEqual(new Set([fixture.sourceGlyph.glyphId, privateP.glyphId]));

    const customState = {
      ...fixture.state,
      emitter: {
        ...fixture.state.emitter,
        sourceMode: "custom" as const,
        influenceScope: "source-glyph" as const,
      },
    };
    expect(resolveEmitterInfluenceSources(customState, fixture.source)[0].scope).toBe("all-typography");
  });

  it("preserves glyph and line provenance through Micro Warp then Calm Water", () => {
    const fixture = scopedFixture("source-glyph");
    const warpState: ProjectState = {
      ...fixture.state,
      glyphCalmWater: { ...fixture.state.glyphCalmWater, enabled: false },
      glyphMicroWarp: {
        ...fixture.state.glyphMicroWarp,
        enabled: true,
        strength: 18,
        responseRadius: 1_200,
        normalDisplacement: 70,
        tangentialDisplacement: 20,
        maxDisplacement: 18,
      },
    };
    const warped = deriveGlyphMicroWarpGeometry(warpState, fixture.source, "source");
    const waterState = { ...fixture.state, glyphMicroWarp: warpState.glyphMicroWarp };
    const water = deriveGlyphCalmWaterGeometry(waterState, warped.geometry, warped.geometryKey);
    expect(warped.geometry!.glyphs.map(({ glyphId, textIndex, lineIndex, glyphIndexInLine }) => ({ glyphId, textIndex, lineIndex, glyphIndexInLine })))
      .toEqual(fixture.source.glyphs.map(({ glyphId, textIndex, lineIndex, glyphIndexInLine }) => ({ glyphId, textIndex, lineIndex, glyphIndexInLine })));
    expect(water.geometry!.glyphs.map(({ glyphId, textIndex, lineIndex, glyphIndexInLine }) => ({ glyphId, textIndex, lineIndex, glyphIndexInLine })))
      .toEqual(fixture.source.glyphs.map(({ glyphId, textIndex, lineIndex, glyphIndexInLine }) => ({ glyphId, textIndex, lineIndex, glyphIndexInLine })));
    expect(water.diagnostics.changedGlyphs.map((glyph) => glyph.glyphId)).toEqual([fixture.sourceGlyph.glyphId]);
  });

  it("keeps localized Slice fragments per glyph and prevents cross-line leakage", () => {
    const fixture = scopedFixture("source-glyph");
    const sliceState = (scope: EmitterInfluenceScope): ProjectState => ({
      ...fixture.state,
      emitter: { ...fixture.state.emitter, influenceScope: scope },
      glyphCalmWater: { ...fixture.state.glyphCalmWater, enabled: false },
      glyphDisplacement: {
        ...fixture.state.glyphDisplacement,
        enabled: true,
        mode: "horizontal-slices",
        sliceInfluence: "emitter-falloff",
        strength: 42,
        fragmentSize: 54,
        gap: 3,
        quantizationSteps: 0,
        jitter: 0,
        fragmentRotation: 0,
      },
    });

    const sourceGlyphState = sliceState("source-glyph");
    const sourceGlyphResult = deriveDisplacedTypographyGeometry(sourceGlyphState, fixture.source, "source");
    expect(sourceGlyphResult.fragments.length).toBeGreaterThan(0);
    expect(sourceGlyphResult.fragments.every((fragment) => (
      fragment.glyphIds.length === 1 && fragment.glyphIds[0] === fixture.sourceGlyph.glyphId
    ))).toBe(true);
    for (const glyph of fixture.source.glyphs.filter((candidate) => candidate.glyphId !== fixture.sourceGlyph.glyphId)) {
      expect(sourceGlyphResult.geometry!.glyphs.find((output) => output.glyphId === glyph.glyphId)?.path.d)
        .toBe(glyph.path.d);
    }

    const lineState = sliceState("source-line");
    const lineResult = deriveDisplacedTypographyGeometry(lineState, fixture.source, "source");
    const lineOneIds = new Set(fixture.source.glyphs.filter((glyph) => glyph.lineIndex === 1).map((glyph) => glyph.glyphId));
    expect(lineResult.fragments.every((fragment) => fragment.glyphIds.every((glyphId) => lineOneIds.has(glyphId)))).toBe(true);
    for (const glyph of fixture.source.glyphs.filter((candidate) => candidate.lineIndex === 0)) {
      expect(lineResult.geometry!.glyphs.find((output) => output.glyphId === glyph.glyphId)?.path.d)
        .toBe(glyph.path.d);
    }

    const sourceKey = glyphDisplacementIdentity(sourceGlyphState, "source", fixture.source).geometryKey;
    const lineKey = glyphDisplacementIdentity(lineState, "source", fixture.source).geometryKey;
    expect(lineKey).not.toBe(sourceKey);
  });

  it("round-trips scope state without changing the new-project default", () => {
    const fixture = scopedFixture("glyph-neighborhood", 2);
    const reloaded = validateProject(JSON.parse(JSON.stringify(fixture.state))).project;
    expect(reloaded.emitter.influenceScope).toBe("glyph-neighborhood");
    expect(reloaded.emitter.neighborhoodSize).toBe(2);
    expect(baseState.emitter.influenceScope).toBe("source-glyph");
  });
});
