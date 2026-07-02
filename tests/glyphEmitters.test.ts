import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getGlyphById, getGlyphDisplayLabel, getGlyphEmitterAnchor, getGlyphEmitterMetadata, resolveEmitterGlyph, resolveGlyphEmitterSources } from "../src/engine/field/glyphEmitters";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";
import { addEmitterRow, duplicateEmitterRow, MAX_EMITTER_ROWS, removeEmitterRow, updateEmitterRow } from "../src/engine/emitterEditor";

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = await parseFontBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "Basic-Regular.ttf");
});

describe("glyph emitter schema and metadata", () => {
  it("migrates schema v3 to v8 with safe default emitter state", () => {
    const { project, warnings } = validateProject({ version: 3, text: "OLD" });
    expect(project.version).toBe(8);
    expect(project.emitter).toEqual(baseState.emitter);
    expect(project.emitter.enabled).toBe(false);
    expect(warnings).toContain("Project was migrated to schema version 8.");
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

describe("multi-emitter resolver", () => {
  const row = (id: string, glyphId: string | null, enabled = true) => ({
    id,
    glyphId,
    enabled,
    weight: 1,
    phaseOffset: 0,
    radiusMultiplier: 1,
    label: id,
  });

  it("returns deterministic resolved source data for the same parsed text and rows", () => {
    const state = {
      ...baseState,
      text: "SONIC",
      font: loaded.metadata,
      emitterMode: "multiple" as const,
      emitters: [
        { ...row("first", "auto-first"), weight: 0.7, phaseOffset: 1.2, radiusMultiplier: 0.8 },
        row("counter", "auto-counter"),
      ],
    };
    const geometry = layoutGlyphs(state, loaded);
    expect(resolveGlyphEmitterSources(state, geometry)).toEqual(resolveGlyphEmitterSources(state, geometry));
    expect(resolveGlyphEmitterSources(state, geometry).sources[0]).toMatchObject({
      id: "first",
      glyphLabel: "1 · S",
      weight: 0.7,
      phaseOffset: 1.2,
      radiusMultiplier: 0.8,
    });
  });

  it("resolves first, last, and middle automatic selectors", () => {
    const state = {
      ...baseState,
      text: "ABCDE",
      emitterMode: "multiple" as const,
      emitters: [
        row("first", "auto-first"),
        row("last", "auto-last"),
        row("middle", "auto-middle"),
      ],
    };
    expect(resolveGlyphEmitterSources(state, null).sources.map((source) => source.glyph.character)).toEqual(["A", "E", "C"]);
  });

  it("resolves a counter glyph and degrades safely to the middle without one", () => {
    const withCounter = {
      ...baseState,
      text: "SONIC",
      emitterMode: "multiple" as const,
      emitters: [row("counter", "auto-counter")],
    };
    const withoutCounter = { ...withCounter, text: "XYZ" };
    const resolvedCounter = resolveGlyphEmitterSources(withCounter, null).sources[0];
    const fallback = resolveGlyphEmitterSources(withoutCounter, null).sources[0];
    expect(resolvedCounter.glyph.character).toBe("O");
    expect(resolvedCounter.fallbackReason).toBeUndefined();
    expect(fallback.glyph.character).toBe("Y");
    expect(fallback.fallbackReason).toBe("counter-unavailable");
  });

  it("resolves valid explicit glyphs and skips invalid explicit glyphs with diagnostics", () => {
    const state = { ...baseState, text: "TYPE", emitterMode: "multiple" as const };
    const glyphs = getGlyphEmitterMetadata(state, null);
    const result = resolveGlyphEmitterSources({
      ...state,
      emitters: [
        row("valid", glyphs[2].glyphId),
        row("invalid", "removed-glyph"),
      ],
    }, null);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ id: "valid", glyphId: glyphs[2].glyphId });
    expect(result.skipped).toContainEqual({
      id: "invalid",
      reason: "invalid-glyph",
      requestedGlyphId: "removed-glyph",
    });
  });

  it("ignores disabled rows for active sources and returns an empty zero-active fallback", () => {
    const state = {
      ...baseState,
      text: "TYPE",
      emitterMode: "multiple" as const,
      emitters: [row("disabled", "auto-first", false)],
    };
    const result = resolveGlyphEmitterSources(state, null);
    expect(result.sources).toEqual([]);
    expect(result.activeRowCount).toBe(0);
    expect(result.skipped).toEqual([{
      id: "disabled",
      reason: "disabled",
      requestedGlyphId: "auto-first",
    }]);
  });

  it("keeps Gate 1 repaired IDs stable and caps resolver rows at eight", () => {
    const rows = Array.from({ length: 10 }, (_, index) => row(index < 2 ? "duplicate" : "", "auto-first"));
    const normalized = validateProject({ ...baseState, text: "TYPE", emitterMode: "multiple", emitters: rows }).project;
    const first = resolveGlyphEmitterSources(normalized, null);
    const second = resolveGlyphEmitterSources(normalized, null);
    expect(first.rowCount).toBe(8);
    expect(first.sources).toHaveLength(8);
    expect(first.sources.map((source) => source.id)).toEqual(second.sources.map((source) => source.id));
    expect(new Set(first.sources.map((source) => source.id)).size).toBe(8);
  });
});

describe("emitter editor state operations", () => {
  const row = (id: string) => ({
    id,
    glyphId: "auto-first",
    enabled: true,
    weight: 1,
    phaseOffset: 0,
    radiusMultiplier: 1,
    label: id,
  });

  it("adds deterministic rows and respects the eight-row limit", () => {
    expect(addEmitterRow([row("emitter-1")]).map((emitter) => emitter.id)).toEqual(["emitter-1", "emitter-2"]);
    const full = Array.from({ length: MAX_EMITTER_ROWS }, (_, index) => row(`emitter-${index + 1}`));
    expect(addEmitterRow(full)).toBe(full);
  });

  it("duplicates with a stable non-conflicting id and removes only when a fallback remains", () => {
    const source = [row("emitter-1"), row("emitter-3")];
    const duplicated = duplicateEmitterRow(source, "emitter-1");
    expect(duplicated.map((emitter) => emitter.id)).toEqual(["emitter-1", "emitter-2", "emitter-3"]);
    expect(duplicateEmitterRow(source, "emitter-1")).toEqual(duplicated);
    expect(removeEmitterRow(duplicated, "emitter-2").map((emitter) => emitter.id)).toEqual(["emitter-1", "emitter-3"]);
    const single = [row("only")];
    expect(removeEmitterRow(single, "only")).toBe(single);
  });

  it("updates enable and geometry controls on only the selected row", () => {
    const rows = [row("first"), row("second")];
    const updated = updateEmitterRow(rows, "second", {
      enabled: false,
      weight: 0.4,
      phaseOffset: 1.5,
      radiusMultiplier: 0.7,
    });
    expect(updated[0]).toBe(rows[0]);
    expect(updated[1]).toMatchObject({
      id: "second",
      enabled: false,
      weight: 0.4,
      phaseOffset: 1.5,
      radiusMultiplier: 0.7,
    });
  });
});
