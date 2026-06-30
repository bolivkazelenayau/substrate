import { describe, expect, it } from "vitest";
import { baseState, defaultDebugSettings } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";

describe("project schema", () => {
  it("ignores runtime preview backend and quality fields on import", () => {
    const { project } = validateProject({
      ...baseState,
      previewBackend: "canvas-2d",
      previewMode: "svg-dom",
      previewQuality: "performance",
    });
    const serialized = JSON.stringify(project);
    expect(serialized).not.toMatch(/previewBackend|previewMode|previewQuality|canvas-2d|svg-dom/);
    expect(project).toEqual(baseState);
  });

  it("migrates version 1 projects to version 7", () => {
    const result = validateProject({ version: 1, text: "OLD", renderer: "dots" });
    expect(result.project.version).toBe(7);
    expect(result.project.text).toBe("OLD");
    expect(result.project.renderer).toBe("dots");
    expect(result.project.exportFrameMode).toBe("current");
    expect(result.project.font).toBeNull();
    expect(result.warnings).toContain("Project was migrated to schema version 7.");
  });

  it("migrates version 2 projects and preserves existing debug settings", () => {
    const result = validateProject({
      ...baseState,
      version: 2,
      debug: { ...defaultDebugSettings, emitter: true },
    });
    expect(result.project.version).toBe(7);
    expect(result.project.debug.emitter).toBe(true);
    expect(result.project.debug.glyphBounds).toBe(false);
  });

  it("rejects unsupported future versions", () => {
    expect(() => validateProject({ version: 99 })).toThrow("newer than this app supports");
  });

  it("clamps numeric values to supported ranges", () => {
    const { project } = validateProject({
      version: 3,
      fontSize: 999,
      tracking: -999,
      seed: -2,
      density: 0,
      amplitude: 100,
      frequency: 0,
      turbulence: 500,
      edgeInfluence: -1,
      precision: 10,
      maxNodes: 999999,
      substrateQuality: "cinema",
    });
    expect(project).toMatchObject({
      fontSize: 220,
      tracking: -10,
      seed: 0,
      density: 10,
      amplitude: 44,
      frequency: 6,
      turbulence: 100,
      edgeInfluence: 0,
      precision: 3,
      maxNodes: 5000,
      substrateQuality: "medium",
    });
  });

  it("validates substrate quality and fills it from defaults", () => {
    expect(validateProject({ version: 3, substrateQuality: "low" }).project.substrateQuality).toBe("low");
    expect(validateProject({ version: 3, substrateQuality: "ultra" }).project.substrateQuality).toBe("ultra");
    expect(validateProject({ version: 3, substrateQuality: "invalid" }).project.substrateQuality).toBe("medium");
    expect(validateProject({ version: 3 }).project.substrateQuality).toBe(baseState.substrateQuality);
  });

  it("rejects invalid renderer and export modes", () => {
    expect(() => validateProject({ version: 3, renderer: "reaction-diffusion" })).toThrow("Unknown renderer");
    expect(() => validateProject({ version: 3, exportMode: "pixels" })).toThrow("Unknown export mode");
  });

  it("fills missing fields from defaults", () => {
    const { project } = validateProject({ version: 3 });
    expect(project).toEqual(baseState);
  });

  it("migrates v6 projects to persisted artwork appearance defaults", () => {
    const { project, warnings } = validateProject({ ...baseState, version: 6 });
    expect(project).toMatchObject({
      version: 7,
      primaryColor: "#e8ff45",
      outlineColor: "#e8ff45",
      backgroundColor: "#11110f",
      transparentBackground: false,
    });
    expect(warnings).toContain("Project was migrated to schema version 7.");
  });

  it("preserves valid appearance colors and rejects invalid color strings", () => {
    expect(validateProject({
      ...baseState,
      primaryColor: "#Aa11CC",
      outlineColor: "#123456",
      backgroundColor: "#fedcba",
      transparentBackground: true,
    }).project).toMatchObject({
      primaryColor: "#aa11cc",
      outlineColor: "#123456",
      backgroundColor: "#fedcba",
      transparentBackground: true,
    });
    expect(validateProject({ ...baseState, primaryColor: "red" }).project.primaryColor).toBe(baseState.primaryColor);
  });

  it("migrates version 5 typography fields to layout-preserving defaults", () => {
    const { project, warnings } = validateProject({ ...baseState, version: 5 });
    expect(project).toMatchObject({
      version: 7,
      kerningMode: "font",
      kerningStrength: 1,
      opticalSpacing: false,
      opticalSpacingStrength: 0,
      textAlign: "center",
      textOffsetY: 0,
    });
    expect(warnings).toContain("Project was migrated to schema version 7.");
  });

  it("validates and clamps typography controls", () => {
    const { project } = validateProject({
      ...baseState,
      kerningMode: "invalid",
      kerningStrength: 99,
      opticalSpacing: true,
      opticalSpacingStrength: -5,
      textAlign: "justify",
      textOffsetY: 999,
    });
    expect(project).toMatchObject({
      kerningMode: "font",
      kerningStrength: 2,
      opticalSpacing: true,
      opticalSpacingStrength: 0,
      textAlign: "center",
      textOffsetY: 120,
    });
  });

  it("bounds emitters and repairs missing or duplicate IDs deterministically", () => {
    const emitters = Array.from({ length: 10 }, (_, index) => ({
      id: index < 2 ? "duplicate" : "",
      glyphId: `glyph-${index}`,
      enabled: true,
      weight: 1,
      phaseOffset: 0,
      radiusMultiplier: 1,
      label: `Emitter ${index + 1}`,
    }));
    const first = validateProject({ ...baseState, emitters }).project.emitters;
    const second = validateProject({ ...baseState, emitters }).project.emitters;
    expect(first).toHaveLength(8);
    expect(first).toEqual(second);
    expect(new Set(first.map((emitter) => emitter.id)).size).toBe(8);
    expect(first[0].id).toBe("duplicate");
    expect(first[1].id).toBe("emitter-1");
  });

  it("fills and validates warped-outline controls", () => {
    const defaults = validateProject({ version: 4 }).project;
    expect(defaults).toMatchObject({
      outlineWarpAmount: baseState.outlineWarpAmount,
      outlineWarpScale: baseState.outlineWarpScale,
      outlineWarpSmoothing: baseState.outlineWarpSmoothing,
      outlineWarpEdgeBias: baseState.outlineWarpEdgeBias,
      outlineWarpMaxDisplacement: baseState.outlineWarpMaxDisplacement,
      preserveCounters: baseState.preserveCounters,
    });
    const project = validateProject({
      version: 4,
      overlayMode: "warped-outline",
      outlineWarpAmount: 999,
      outlineWarpScale: 0,
      outlineWarpSmoothing: 4,
      outlineWarpEdgeBias: -2,
      outlineWarpMaxDisplacement: 999,
      preserveCounters: false,
    }).project;
    expect(project).toMatchObject({
      overlayMode: "warped-outline",
      outlineWarpAmount: 60,
      outlineWarpScale: 0.25,
      outlineWarpSmoothing: 1,
      outlineWarpEdgeBias: 0,
      outlineWarpMaxDisplacement: 80,
      preserveCounters: false,
    });
  });

  it("validates imported font metadata safely", () => {
    expect(validateProject({ version: 3, font: { family: 42 } }).project.font).toBeNull();
    const font = validateProject({
      version: 3,
      font: {
        family: "Fixture",
        fileName: "fixture.ttf",
        unitsPerEm: 999999,
        ascender: Infinity,
        descender: -999999,
      },
    }).project.font;
    expect(font).toEqual({
      family: "Fixture",
      fullName: "Fixture",
      fileName: "fixture.ttf",
      unitsPerEm: 16384,
      ascender: 800,
      descender: -32768,
    });
  });

  it("validates and clamps glyph emitter settings", () => {
    const project = validateProject({
      version: 4,
      emitter: {
        enabled: true,
        glyphId: "glyph-1",
        sourceMode: "counter-center",
        amplitude: 99,
        frequency: -1,
        radius: 9999,
        falloff: "gaussian",
        selfInfluence: -2,
        neighborInfluence: 8,
        blendMode: "max",
      },
      waveContourMode: "dotted",
      waveDotSpacing: 100,
      waveDotRadius: -1,
    }).project;
    expect(project.emitter).toMatchObject({
      enabled: true,
      glyphId: "glyph-1",
      amplitude: 4,
      frequency: 0.005,
      radius: 1400,
      selfInfluence: 0,
      neighborInfluence: 3,
    });
    expect(project.waveContourMode).toBe("dotted");
    expect(project.waveDotSpacing).toBe(40);
    expect(project.waveDotRadius).toBe(0.4);
  });
});
