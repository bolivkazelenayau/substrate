import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getGlyphById, getGlyphDisplayLabel, getGlyphEmitterAnchor, getGlyphEmitterMetadata, resolveEmitterGlyph } from "../src/engine/field/glyphEmitters";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";

let loaded: LoadedFont;

beforeAll(() => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = parseFontBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "Basic-Regular.ttf");
});

describe("glyph emitter schema and metadata", () => {
  it("migrates schema v3 to v4 with safe default emitter state", () => {
    const { project, warnings } = validateProject({ version: 3, text: "OLD" });
    expect(project.version).toBe(4);
    expect(project.emitter).toEqual(baseState.emitter);
    expect(project.emitter.enabled).toBe(false);
    expect(warnings).toContain("Project was migrated to schema version 4.");
  });

  it("preserves emitter settings through JSON save/load validation", () => {
    const original = {
      ...baseState,
      emitter: {
        ...baseState.emitter,
        enabled: true,
        glyphId: "native-1-79",
        sourceMode: "custom" as const,
        amplitude: 2.4,
        customX: 420,
        customY: 300,
      },
      waveContourMode: "dotted" as const,
    };
    const restored = validateProject(JSON.parse(JSON.stringify(original))).project;
    expect(restored.emitter).toEqual(original.emitter);
    expect(restored.waveContourMode).toBe("dotted");
  });

  it("uses stable parsed glyph IDs, labels, and anchor approximations", () => {
    const state = { ...baseState, text: "OX", font: loaded.metadata };
    const first = getGlyphEmitterMetadata(state, layoutGlyphs(state, loaded));
    const second = getGlyphEmitterMetadata(state, layoutGlyphs(state, loaded));
    expect(first.map((glyph) => glyph.glyphId)).toEqual(second.map((glyph) => glyph.glyphId));
    expect(first[0].character).toBe("O");
    expect(first[0].glyphIndex).toBeGreaterThanOrEqual(0);
    expect(getGlyphDisplayLabel(first[0])).toBe("1 · O");
    expect(getGlyphEmitterAnchor(first[0], "center")).toEqual(first[0].center);
    expect(getGlyphEmitterAnchor(first[0], "centroid")).toEqual(first[0].centroid);
    expect(first[0].counterCenter).not.toBeNull();
    expect(getGlyphEmitterAnchor(first[0], "counter-center")).toEqual(first[0].counterCenter);
    expect(first[1].counterCenter).toBeNull();
    expect(getGlyphEmitterAnchor(first[1], "counter-center")).toEqual(first[1].center);
  });

  it("builds approximate native-text cells with finite centers", () => {
    const glyphs = getGlyphEmitterMetadata({ ...baseState, text: "ABC" }, null);
    expect(glyphs).toHaveLength(3);
    glyphs.forEach((glyph, index) => {
      expect(glyph.glyphId).toContain(`native-${index}-`);
      expect(Object.values(glyph.center).every(Number.isFinite)).toBe(true);
      expect(glyph.center.x).toBeCloseTo(glyph.bounds.x + glyph.bounds.width / 2);
    });
  });

  it("falls back safely when a previous glyphId no longer exists", () => {
    const glyphs = getGlyphEmitterMetadata({ ...baseState, text: "NEW" }, null);
    expect(getGlyphById(glyphs, "native-8-90")).toBeNull();
    expect(getGlyphById(glyphs, null)).toBeNull();
    expect(glyphs[0].emitterEligible).toBe(true);
  });

  it("selects O/o/0 or a middle glyph for the diffuser auto source", () => {
    const withO = getGlyphEmitterMetadata({ ...baseState, text: "SONIC" }, null);
    expect(resolveEmitterGlyph(withO, "auto-o-middle")?.character).toBe("O");
    const withoutO = getGlyphEmitterMetadata({ ...baseState, text: "ABCDE" }, null);
    expect(resolveEmitterGlyph(withoutO, "auto-o-middle")?.character).toBe("C");
  });
});
