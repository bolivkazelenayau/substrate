import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateAndRepairProject,
  parseProjectDocumentText,
  ProjectImportError,
  validateProjectV8Shape,
  validateProjectV9Shape,
  validateProjectV10Shape,
  validateProjectV11Shape,
  validateProjectV12Shape,
  validateProjectV13Shape,
  validateProjectV14Shape,
  validateProjectV15Shape,
} from "../src/engine/projectImport";
import { applyPreset, baseState } from "../src/engine/presets";
import { serializeProjectDocument } from "../src/hooks/useProjectDocument";
import { currentFragmentationFixtures, protectedFragmentationModes } from "./fixtures/currentFragmentationProjects";

type UnknownRecord = Record<string, unknown>;

const legacyVersions = [1, 2, 3, 4, 5, 6, 7, 8] as const;
const legacyGlyphDisplacement = { ...baseState.glyphDisplacement, sliceInfluence: "legacy" as const };

const expectedCore = {
  1: { text: "LEGACY ONE", renderer: "dots", preset: "Signal Dust", seed: 10101 },
  2: { text: "LEGACY TWO", renderer: "ripple", preset: "Sonic Ripple", seed: 20202 },
  3: { text: "LEGACY THREE", renderer: "flow", preset: "Edge Current", seed: 30303 },
  4: { text: "LEGACY FOUR", renderer: "wave-contours", preset: "Sonic Contours", seed: 40404 },
  5: { text: "LEGACY FIVE", renderer: "glyph-diffuser", preset: "Dotted Diffuser", seed: 50505 },
  6: { text: "LEGACY SIX", renderer: "sdf-contours", preset: "Topographic Type", seed: 60606 },
  7: { text: "DENSE LEGACY SDF", renderer: "sdf-halftone", preset: "Halftone Press", seed: 70707 },
  8: { text: "LEGACY EIGHT", renderer: "glyph-diffuser", preset: "Sonic Diffuser", seed: 80808 },
} as const;

function readLegacy(version: typeof legacyVersions[number]): UnknownRecord {
  return JSON.parse(readFileSync(
    resolve(`tests/fixtures/projects/legacy/v${version}.substrate.json`),
    "utf8",
  )) as UnknownRecord;
}

function readPrivateSonicsV8(): UnknownRecord {
  return JSON.parse(readFileSync(
    resolve("tests/fixtures/projects/legacy/private-sonics-v8.substrate.json"),
    "utf8",
  )) as UnknownRecord;
}

function capturedImportError(action: () => unknown): ProjectImportError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectImportError);
    return error as ProjectImportError;
  }
  throw new Error("Expected project import to fail.");
}

describe("historical project compatibility matrix", () => {
  for (const version of legacyVersions) {
    it(`loads, migrates, validates, saves, and reloads schema v${version}`, () => {
      const raw = readLegacy(version);
      const first = migrateAndRepairProject(raw);

      expect(first.project).toMatchObject({ version: 15, ...expectedCore[version] });
      expect(first.project.emitterDisplay.mode).toBe("field");
      expect(first.project.glyphDisplacement).toEqual(legacyGlyphDisplacement);
      expect(first.project.glyphDisplacement.enabled).toBe(false);
      expect(first.project.dotGrid).toEqual(baseState.dotGrid);
      expect(first.project.dotGrid.enabled).toBe(false);
      expect(first.project.displayDislocation).toEqual(baseState.displayDislocation);
      expect(first.project.displayDislocation.enabled).toBe(false);
      expect(first.project.emitterMicroResponse).toEqual(baseState.emitterMicroResponse);
      expect(first.project.emitterMicroResponse.enabled).toBe(false);
      expect(first.project.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
      expect(first.project.glyphMicroWarp.enabled).toBe(false);
      expect(first.project.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);
      expect(first.project.glyphFalloffDisplacement.mode).toBe("off");
      expect(first.project.glyphInfluence).toEqual(baseState.glyphInfluence);
      expect(first.project.glyphCalmWater).toEqual(baseState.glyphCalmWater);
      expect(first.project.glyphCalmWater.enabled).toBe(false);
      expect(first.project.emitter.influenceScope).toBe("all-typography");
      expect(first.project.emitters.every((emitter) => emitter.influenceScope === "all-typography")).toBe(true);
      expect(first.warnings).toContain("Project was migrated to schema version 15.");

      const saved = serializeProjectDocument(first.project);
      const savedObject = parseProjectDocumentText(saved);
      expect(validateProjectV15Shape(savedObject).version).toBe(15);
      const reloaded = migrateAndRepairProject(savedObject);
      expect(reloaded.project).toEqual(first.project);
    });
  }

  it("preserves historical font metadata without treating runtime font bytes as persisted state", () => {
    const project = migrateAndRepairProject(readLegacy(3)).project;
    expect(project.font).toEqual({
      family: "Archive Sans",
      fullName: "Archive Sans Regular",
      fileName: "ArchiveSans-Regular.ttf",
      unitsPerEm: 1000,
      ascender: 780,
      descender: -220,
    });
    expect(serializeProjectDocument(project)).not.toMatch(/arrayBuffer|fontResource|glyphs/);
  });

  it("preserves the old single-emitter structure and derives its v5 row", () => {
    const project = migrateAndRepairProject(readLegacy(4)).project;
    expect(project.emitter).toMatchObject({
      id: "legacy-single",
      glyphId: "auto-o",
      enabled: true,
      sourceMode: "counter-center",
      blendMode: "max",
    });
    expect(project.emitterMode).toBe("single");
    expect(project.fieldBlendMode).toBe("max");
    expect(project.emitters[0]).toMatchObject({ glyphId: "auto-o", enabled: true });
  });

  it("preserves multiple emitters, non-zero text offset, dense SDF settings, and authored v8 artboard", () => {
    expect(migrateAndRepairProject(readLegacy(5)).project).toMatchObject({
      emitterMode: "multiple",
      fieldBlendMode: "max",
      emitters: [{ id: "left-counter" }, { id: "right-counter" }],
    });
    expect(migrateAndRepairProject(readLegacy(6)).project).toMatchObject({
      textOffsetY: 137,
      kerningMode: "none",
      textAlign: "right",
    });
    expect(migrateAndRepairProject(readLegacy(7)).project).toMatchObject({
      renderer: "sdf-halftone",
      density: 80,
      maxNodes: 5000,
      substrateQuality: "high",
    });
    expect(migrateAndRepairProject(readLegacy(8)).project).toMatchObject({
      artboard: { width: 1480, height: 820 },
      textOffsetY: -96,
      emitterMode: "multiple",
      emitters: [{ id: "legacy-a" }, { id: "legacy-b" }],
    });
  });

  it("migrates exact v13 projects without reinterpreting global Slice", () => {
    const {
      glyphInfluence: _glyphInfluence,
      glyphCalmWater: _glyphCalmWater,
      glyphDisplacement,
      ...v14WithoutNewGlyphStages
    } = baseState;
    const { sliceInfluence: _sliceInfluence, ...v13GlyphDisplacement } = glyphDisplacement;
    const v13 = {
      ...v14WithoutNewGlyphStages,
      version: 13 as const,
      glyphDisplacement: { ...v13GlyphDisplacement, enabled: true, mode: "horizontal-slices" as const },
    };
    expect(validateProjectV13Shape(v13).version).toBe(13);
    const migrated = migrateAndRepairProject(v13).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphDisplacement.sliceInfluence).toBe("legacy");
    expect(migrated.glyphInfluence).toEqual(baseState.glyphInfluence);
    expect(migrated.glyphCalmWater).toEqual(baseState.glyphCalmWater);
  });

  it("migrates exact v14 spatial targeting to explicit All typography scope", () => {
    const { version: _version, emitter, emitters, ...v14Fields } = baseState;
    const {
      influenceScope: _singleScope,
      neighborhoodSize: _singleNeighborhood,
      ...v14Emitter
    } = emitter;
    const v14Emitters = emitters.map((row) => {
      const {
        influenceScope: _rowScope,
        neighborhoodSize: _rowNeighborhood,
        ...v14Row
      } = row;
      return v14Row;
    });
    const v14 = { ...v14Fields, version: 14, emitter: v14Emitter, emitters: v14Emitters };
    expect(validateProjectV14Shape(v14).version).toBe(14);
    const migrated = migrateAndRepairProject(v14).project;
    expect(migrated.version).toBe(15);
    expect(migrated.emitter.influenceScope).toBe("all-typography");
    expect(migrated.emitters.every((row) => row.influenceScope === "all-typography")).toBe(true);
  });

  it("migrates and round-trips the Private / Sonics v8 authored configuration additively", () => {
    const raw = readPrivateSonicsV8();
    expect(validateProjectV8Shape(raw).version).toBe(8);

    const first = migrateAndRepairProject(raw).project;
    expect(first).toMatchObject({
      version: 15,
      artboard: { width: 1200, height: 720 },
      text: "Private\nSonics",
      fontSize: 540,
      textOffsetY: 52,
      renderer: "glyph-diffuser",
      diffuserDomain: "text-halo",
      diffuserComposition: "text-reactive",
      overlayMode: "warped-outline",
      glyphFieldMode: "strong",
      emitterMode: "single",
      emitter: {
        id: "private-sonics-counter",
        enabled: true,
        sourceMode: "counter-center",
      },
    });
    expect(first.font?.family).toBe("Garamond Display");
    expect(first.glyphDisplacement).toEqual(legacyGlyphDisplacement);
    expect(first.displayDislocation).toEqual(baseState.displayDislocation);
    expect(first.emitterMicroResponse).toEqual(baseState.emitterMicroResponse);
    expect(first.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
    expect(first.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);

    const saved = parseProjectDocumentText(serializeProjectDocument(first));
    expect(validateProjectV15Shape(saved).version).toBe(15);
    expect(migrateAndRepairProject(saved).project).toEqual(first);
  });

});

describe("protected current glyph fragmentation documents", () => {
  for (const mode of protectedFragmentationModes) {
    it(`round-trips every persisted ${mode} setting exactly`, () => {
      const source = currentFragmentationFixtures[mode];
      const reloaded = migrateAndRepairProject(parseProjectDocumentText(serializeProjectDocument(source))).project;

      expect(reloaded).toEqual(source);
      expect(reloaded.glyphDisplacement).toEqual(source.glyphDisplacement);
      expect(reloaded.glyphDisplacement.enabled).toBe(true);
      expect(reloaded.glyphDisplacement.mode).toBe(mode);
      expect(reloaded.dotGrid).toEqual(source.dotGrid);
    });
  }

  for (const mode of protectedFragmentationModes) {
    it(`migrates exact v9 ${mode} documents additively`, () => {
      const source = currentFragmentationFixtures[mode];
      const {
        displayDislocation: _displayDislocation,
        emitterMicroResponse: _emitterMicroResponse,
        glyphMicroWarp: _glyphMicroWarp,
        glyphFalloffDisplacement: _glyphFalloffDisplacement,
        glyphInfluence: _glyphInfluence,
        glyphCalmWater: _glyphCalmWater,
        ...v10Fields
      } = source;
      const { sliceInfluence: _sliceInfluence, ...v9GlyphDisplacement } = source.glyphDisplacement;
      const v9 = { ...v10Fields, glyphDisplacement: v9GlyphDisplacement, version: 9 };

      expect(validateProjectV9Shape(v9).version).toBe(9);
      const migrated = migrateAndRepairProject(v9).project;
      expect(migrated.version).toBe(15);
      expect(migrated.glyphDisplacement).toEqual(source.glyphDisplacement);
      expect(migrated.dotGrid).toEqual(source.dotGrid);
      expect(migrated.emitter).toEqual({ ...source.emitter, influenceScope: "all-typography" });
      expect(migrated.seed).toBe(source.seed);
      expect(migrated.displayDislocation).toEqual(baseState.displayDislocation);
      expect(migrated.displayDislocation.enabled).toBe(false);
      expect(migrated.emitterMicroResponse).toEqual(baseState.emitterMicroResponse);
      expect(migrated.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
      expect(migrated.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);
    });
  }

  it("migrates exact v10 Display Dislocation documents without reinterpreting their state", () => {
    const source = applyPreset(baseState, "Display Dislocation");
    const {
      emitterMicroResponse: _emitterMicroResponse,
      glyphMicroWarp: _glyphMicroWarp,
      glyphFalloffDisplacement: _glyphFalloffDisplacement,
      glyphInfluence: _glyphInfluence,
      glyphCalmWater: _glyphCalmWater,
      ...v11Fields
    } = source;
    const { sliceInfluence: _sliceInfluence, ...v10GlyphDisplacement } = source.glyphDisplacement;
    const v10 = { ...v11Fields, glyphDisplacement: v10GlyphDisplacement, version: 10 as const };

    expect(validateProjectV10Shape(v10).version).toBe(10);
    const migrated = migrateAndRepairProject(v10).project;
    expect(migrated.version).toBe(15);
    expect(migrated.displayDislocation).toEqual(source.displayDislocation);
    expect(migrated.displayDislocation.enabled).toBe(true);
    expect(migrated.glyphDisplacement).toEqual({ ...source.glyphDisplacement, sliceInfluence: "legacy" });
    expect(migrated.emitterMicroResponse).toEqual(baseState.emitterMicroResponse);
    expect(migrated.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
    expect(migrated.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);
  });

  it("migrates exact v11 mark-response documents by adding only disabled Glyph Micro Warp defaults", () => {
    const source: typeof baseState = {
      ...baseState,
      emitterMicroResponse: {
        ...baseState.emitterMicroResponse,
        enabled: true,
        positionDetail: 71,
      },
    };
    const {
      glyphMicroWarp: _glyphMicroWarp,
      glyphFalloffDisplacement: _glyphFalloffDisplacement,
      glyphInfluence: _glyphInfluence,
      glyphCalmWater: _glyphCalmWater,
      ...v12WithoutWarp
    } = source;
    const { sliceInfluence: _sliceInfluence, ...v11GlyphDisplacement } = source.glyphDisplacement;
    const v11 = { ...v12WithoutWarp, glyphDisplacement: v11GlyphDisplacement, version: 11 as const };

    expect(validateProjectV11Shape(v11).version).toBe(11);
    const migrated = migrateAndRepairProject(v11).project;
    expect(migrated.version).toBe(15);
    expect(migrated.emitterMicroResponse).toEqual(source.emitterMicroResponse);
    expect(migrated.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
    expect(migrated.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);
  });

  it("migrates exact v12 glyph-warp documents by adding only disabled Glyph Falloff Field defaults", () => {
    const source: typeof baseState = {
      ...baseState,
      glyphMicroWarp: { ...baseState.glyphMicroWarp, enabled: true, strength: 73 },
    };
    const {
      glyphFalloffDisplacement: _glyphFalloffDisplacement,
      glyphInfluence: _glyphInfluence,
      glyphCalmWater: _glyphCalmWater,
      ...v13WithoutFalloff
    } = source;
    const { sliceInfluence: _sliceInfluence, ...v12GlyphDisplacement } = source.glyphDisplacement;
    const v12 = { ...v13WithoutFalloff, glyphDisplacement: v12GlyphDisplacement, version: 12 as const };

    expect(validateProjectV12Shape(v12).version).toBe(12);
    const migrated = migrateAndRepairProject(v12).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphMicroWarp).toEqual(source.glyphMicroWarp);
    expect(migrated.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);
  });
});

describe("project import errors and repair reporting", () => {
  it("distinguishes invalid JSON syntax", () => {
    expect(capturedImportError(() => parseProjectDocumentText("{\"version\": 8,")).code).toBe("invalid-json");
    expect(() => parseProjectDocumentText("{\"version\": 8,"))
      .toThrow(/Invalid JSON syntax/);
  });

  it("distinguishes unsupported schemas", () => {
    expect(capturedImportError(() => migrateAndRepairProject({ version: 99, text: "FUTURE", renderer: "flow", seed: 1 })).code)
      .toBe("unsupported-schema");
  });

  it("repairs sparse historical documents before latest-shape validation", () => {
    const repaired = migrateAndRepairProject({ version: 8, renderer: "flow", seed: 1 }).project;
    expect(repaired).toMatchObject({
      version: 15,
      text: baseState.text,
      renderer: "flow",
      seed: 1,
      artboard: baseState.artboard,
      emitterDisplay: baseState.emitterDisplay,
      glyphDisplacement: legacyGlyphDisplacement,
      dotGrid: baseState.dotGrid,
      displayDislocation: baseState.displayDislocation,
      emitterMicroResponse: baseState.emitterMicroResponse,
      glyphMicroWarp: baseState.glyphMicroWarp,
      glyphInfluence: baseState.glyphInfluence,
      glyphCalmWater: baseState.glyphCalmWater,
    });
  });

  it("keeps missing-field errors on explicit historical shape validators", () => {
    expect(capturedImportError(() => validateProjectV8Shape({ version: 8, artboard: { width: 1200, height: 720 }, renderer: "flow" })).code)
      .toBe("missing-historical-field");
  });

  it("rejects foreign application envelopes instead of silently defaulting them", () => {
    expect(capturedImportError(() => migrateAndRepairProject({ app: "foreign-editor", version: 1, state: { text: "NOT SUBSTRATE" } })).code)
      .toBe("unsupported-schema");
    expect(() => migrateAndRepairProject({ app: "foreign-editor", version: 1, state: { text: "NOT SUBSTRATE" } }))
      .toThrow(/expected SUBSTRATE project fields at the JSON root/);
  });

  it("distinguishes migration failures from historical-shape failures", () => {
    expect(capturedImportError(() => migrateAndRepairProject({ version: 7, text: "BAD RENDERER", renderer: "removed-renderer", seed: 1 })).code)
      .toBe("migration-failed");
    expect(() => migrateAndRepairProject({ version: 7, text: "BAD RENDERER", renderer: "removed-renderer", seed: 1 }))
      .toThrow(/Unknown renderer/);
  });

  it("reports rather than silently discarding unsupported fields or preset values", () => {
    const result = migrateAndRepairProject({
      ...readLegacy(8),
      preset: "Archived Private Preset",
      experimentalLegacyKnob: 42,
    });
    expect(result.project.preset).toBe("Custom");
    expect(result.warnings).toContain("Ignored unsupported project fields: experimentalLegacyKnob.");
    expect(result.warnings).toContain('Preset "Archived Private Preset" is not recognized and was loaded as "Custom".');
  });
});
