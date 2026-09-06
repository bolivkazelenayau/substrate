import { describe, expect, it } from "vitest";
import { baseState, defaultDebugSettings } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";

const migratedDefaults = {
  ...baseState,
  emitter: { ...baseState.emitter, influenceScope: "all-typography" as const },
  emitters: baseState.emitters.map((emitter) => ({ ...emitter, influenceScope: "all-typography" as const })),
  glyphDisplacement: { ...baseState.glyphDisplacement, sliceInfluence: "legacy" as const },
};

describe("project schema", () => {
  it("round-trips the active multi-emitter blend mode", () => {
    const project = validateProject({
      ...baseState,
      emitterMode: "multiple",
      fieldBlendMode: "max",
    }).project;
    expect(project.fieldBlendMode).toBe("max");
    expect(validateProject(JSON.parse(JSON.stringify(project))).project.fieldBlendMode).toBe("max");
  });

  it("preserves multiline whitespace and repairs line height", () => {
    const text = "TYPE\n    FIELD";
    expect(validateProject({ ...baseState, text, lineHeight: 1.35 }).project).toMatchObject({ text, lineHeight: 1.35 });
    expect(validateProject({ ...baseState, text, lineHeight: Infinity }).project.lineHeight).toBe(baseState.lineHeight);
    expect(validateProject({ ...baseState, text, lineHeight: 99 }).project.lineHeight).toBe(8);
    expect(validateProject({ ...baseState, text, lineHeight: 0.1 }).project.lineHeight).toBe(0.25);
    expect(validateProject({ ...baseState, text, lineHeight: 5 }).project.lineHeight).toBe(5);
  });

  it("defaults, repairs, and round-trips contour thickness", () => {
    expect(baseState.contourStrokeWidth).toBe(1.4);
    expect(validateProject({ version: 8 }).project.contourStrokeWidth).toBe(1.4);
    expect(validateProject({ version: 7, text: "LEGACY" }).project.contourStrokeWidth).toBe(1.4);
    expect(validateProject({ ...baseState, contourStrokeWidth: Number.NaN }).project.contourStrokeWidth).toBe(1.4);
    expect(validateProject({ ...baseState, contourStrokeWidth: -20 }).project.contourStrokeWidth).toBe(0.25);
    expect(validateProject({ ...baseState, contourStrokeWidth: 999 }).project.contourStrokeWidth).toBe(16);

    const restored = validateProject(JSON.parse(JSON.stringify({
      ...baseState,
      contourStrokeWidth: 3.25,
    }))).project;
    expect(restored.contourStrokeWidth).toBe(3.25);
    expect(validateProject({ ...baseState, contourStrokeWidth: 1.15 }).project.contourStrokeWidth).toBe(1.15);
  });

  it("migrates and validates the separate Display Dislocation document state", () => {
    const legacyV9 = {
      ...baseState,
      version: 9,
    } as Record<string, unknown>;
    delete legacyV9.displayDislocation;
    delete legacyV9.emitterMicroResponse;
    delete legacyV9.glyphMicroWarp;
    delete legacyV9.glyphFalloffDisplacement;
    const migrated = validateProject(legacyV9);
    expect(migrated.project.version).toBe(15);
    expect(migrated.project.displayDislocation).toEqual(baseState.displayDislocation);
    expect(migrated.project.displayDislocation.enabled).toBe(false);

    const restored = validateProject({
      ...baseState,
      displayDislocation: {
        ...baseState.displayDislocation,
        enabled: true,
        mode: "blocks",
        responseRadius: 510,
        displacementAmount: 88,
        regionSize: 55,
        gap: 13,
        quantizationSteps: 11,
        direction: -45,
        alternatingOffset: 35,
        radialBias: 42,
        seed: 88001,
      },
    }).project;
    expect(restored.displayDislocation).toEqual({
      ...baseState.displayDislocation,
      enabled: true,
      mode: "blocks",
      responseRadius: 510,
      displacementAmount: 88,
      regionSize: 55,
      gap: 13,
      quantizationSteps: 11,
      direction: -45,
      alternatingOffset: 35,
      radialBias: 42,
      seed: 88001,
    });
  });

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

  it("migrates version 1 projects to version 15", () => {
    const result = validateProject({ version: 1, text: "OLD", renderer: "dots" });
    expect(result.project.version).toBe(15);
    expect(result.project.artboard).toEqual({ width: 1200, height: 720 });
    expect(result.project.text).toBe("OLD");
    expect(result.project.renderer).toBe("dots");
    expect(result.project.exportFrameMode).toBe("current");
    expect(result.project.font).toBeNull();
    expect(result.warnings).toContain("Project was migrated to schema version 15.");
  });

  it("migrates version 2 projects and preserves existing debug settings", () => {
    const result = validateProject({
      ...baseState,
      version: 2,
      debug: { ...defaultDebugSettings, emitter: true },
    });
    expect(result.project.version).toBe(15);
    expect(result.project.debug.emitter).toBe(true);
    expect(result.project.debug.glyphBounds).toBe(false);
  });

  it("rejects unsupported future versions", () => {
    expect(() => validateProject({ version: 99 })).toThrow("newer than this app supports");
  });

  it("migrates v7 artboards and repairs invalid v8 dimensions", () => {
    expect(validateProject({ ...baseState, version: 7, artboard: undefined }).project.artboard)
      .toEqual({ width: 1200, height: 720 });
    expect(validateProject({ ...baseState, artboard: { width: 1800, height: 900 } }).project.artboard)
      .toEqual({ width: 1800, height: 900 });
    expect(validateProject({ ...baseState, artboard: { width: -1, height: Infinity } }).project.artboard)
      .toEqual({ width: 64, height: 720 });
    expect(validateProject({ ...baseState, artboard: { width: 999_999, height: 1 } }).project.artboard)
      .toEqual({ width: 16_384, height: 64 });
  });

  it("clamps numeric values to supported ranges", () => {
    const { project } = validateProject({
      version: 3,
      fontSize: 999999,
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
      fontSize: 4096,
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

  it("preserves large reasonable visual dimensions and clamps pathological values", () => {
    const reasonable = validateProject({
      ...baseState,
      fontSize: 640,
      outlineStrokeWidth: 64,
      waveDotRadius: 24,
      diffuserDotRadius: 32,
      outlineWarpMaxDisplacement: 240,
      emitter: { ...baseState.emitter, radius: 3000 },
    }).project;
    expect(reasonable).toMatchObject({
      fontSize: 640,
      outlineStrokeWidth: 64,
      waveDotRadius: 24,
      diffuserDotRadius: 32,
      outlineWarpMaxDisplacement: 240,
      emitter: expect.objectContaining({ radius: 3000 }),
    });

    const pathological = validateProject({
      ...baseState,
      fontSize: Infinity,
      outlineStrokeWidth: Number.MAX_VALUE,
      waveDotRadius: -5,
      diffuserDotRadius: NaN,
      outlineWarpMaxDisplacement: Number.MAX_VALUE,
      emitter: { ...baseState.emitter, radius: Number.MAX_VALUE },
    }).project;
    expect(pathological).toMatchObject({
      fontSize: baseState.fontSize,
      outlineStrokeWidth: 512,
      waveDotRadius: 0.1,
      diffuserDotRadius: baseState.diffuserDotRadius,
      outlineWarpMaxDisplacement: 2048,
      emitter: expect.objectContaining({ radius: 8192 }),
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
    expect(project).toEqual(migratedDefaults);
  });

  it("migrates v6 projects to persisted artwork appearance defaults", () => {
    const { project, warnings } = validateProject({ ...baseState, version: 6 });
    expect(project).toMatchObject({
      version: 15,
      artboard: { width: 1200, height: 720 },
      primaryColor: "#e8ff45",
      outlineColor: "#e8ff45",
      backgroundColor: "#11110f",
      transparentBackground: false,
    });
    expect(warnings).toContain("Project was migrated to schema version 15.");
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
      version: 15,
      artboard: { width: 1200, height: 720 },
      kerningMode: "font",
      kerningStrength: 1,
      opticalSpacing: false,
      opticalSpacingStrength: 0,
      textAlign: "center",
      textOffsetY: 0,
    });
    expect(warnings).toContain("Project was migrated to schema version 15.");
  });

  it("validates and clamps typography controls", () => {
    const { project } = validateProject({
      ...baseState,
      kerningMode: "invalid",
      kerningStrength: 99,
      opticalSpacing: true,
      opticalSpacingStrength: -5,
      textAlign: "justify",
      textOffsetY: 99999,
    });
    expect(project).toMatchObject({
      kerningMode: "font",
      kerningStrength: 2,
      opticalSpacing: true,
      opticalSpacingStrength: 0,
      textAlign: "center",
      textOffsetY: 2048,
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
      outlineWarpMaxDisplacement: 99999,
      preserveCounters: false,
    }).project;
    expect(project).toMatchObject({
      overlayMode: "warped-outline",
      outlineWarpAmount: 60,
      outlineWarpScale: 0.25,
      outlineWarpSmoothing: 1,
      outlineWarpEdgeBias: 0,
      outlineWarpMaxDisplacement: 2048,
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
      radius: 8192,
      selfInfluence: 0,
      neighborInfluence: 3,
    });
    expect(project.waveContourMode).toBe("dotted");
    expect(project.waveDotSpacing).toBe(40);
    expect(project.waveDotRadius).toBe(0.1);
  });

  it("defaults, clamps, and round-trips additive emitter display settings", () => {
    expect(validateProject({ version: 8 }).project.emitterDisplay).toEqual(baseState.emitterDisplay);
    const project = validateProject({
      ...baseState,
      emitterDisplay: {
        ...baseState.emitterDisplay,
        mode: "orbit",
        distortionStrength: 999,
        distortionRadius: -10,
        noiseScale: 999,
        gridSize: -5,
        gridAmount: 120,
        interiorSuppression: -20,
        edgeBias: 120,
        orbitAmount: 64,
        divergence: -140,
      },
    }).project;
    expect(project.emitterDisplay).toEqual({
      mode: "orbit",
      distortionStrength: 100,
      distortionRadius: 8,
      noiseScale: 160,
      gridSize: 0,
      gridAmount: 100,
      interiorSuppression: 0,
      edgeBias: 100,
      orbitAmount: 64,
      divergence: -100,
    });
    expect(validateProject(JSON.parse(JSON.stringify(project))).project.emitterDisplay)
      .toEqual(project.emitterDisplay);
  });

  it("migrates, clamps, and round-trips orthogonal emitter micro response settings", () => {
    const legacyV10 = { ...baseState, version: 10 } as Record<string, unknown>;
    delete legacyV10.emitterMicroResponse;
    delete legacyV10.glyphMicroWarp;
    delete legacyV10.glyphFalloffDisplacement;
    const migrated = validateProject(legacyV10).project;
    expect(migrated.version).toBe(15);
    expect(migrated.emitterMicroResponse).toEqual(baseState.emitterMicroResponse);

    const project = validateProject({
      ...baseState,
      emitterMicroResponse: {
        ...baseState.emitterMicroResponse,
        enabled: true,
        positionDetail: 120,
        densityBreakup: -5,
        detailScale: 500,
        responseRadius: -1,
        maxDisplacement: 500,
        occupancy: "disperse-exterior",
        exteriorPush: 120,
        tangentialFlow: -4,
        divergence: 101,
        exteriorShell: 500,
      },
    }).project;
    expect(project.emitterMicroResponse).toEqual({
      ...baseState.emitterMicroResponse,
      enabled: true,
      positionDetail: 100,
      densityBreakup: 0,
      detailScale: 160,
      responseRadius: 8,
      maxDisplacement: 96,
      occupancy: "disperse-exterior",
      exteriorPush: 100,
      tangentialFlow: 0,
      divergence: 100,
      exteriorShell: 240,
    });
    expect(validateProject(JSON.parse(JSON.stringify(project))).project.emitterMicroResponse)
      .toEqual(project.emitterMicroResponse);
  });

  it("migrates, clamps, and round-trips parsed-outline Glyph Micro Warp settings", () => {
    const legacyV11 = { ...baseState, version: 11 } as Record<string, unknown>;
    delete legacyV11.glyphMicroWarp;
    delete legacyV11.glyphFalloffDisplacement;
    const migrated = validateProject(legacyV11).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);

    const project = validateProject({
      ...baseState,
      glyphMicroWarp: {
        ...baseState.glyphMicroWarp,
        enabled: true,
        strength: 900,
        responseRadius: -5,
        detailScale: 500,
        detailOctaves: 9,
        normalDisplacement: 120,
        tangentialDisplacement: -4,
        edgeTurbulence: 120,
        quantizationSteps: 99,
        maxDisplacement: 500,
        preserveCounters: false,
        seedInfluence: -1,
      },
    }).project;
    expect(project.glyphMicroWarp).toEqual({
      ...baseState.glyphMicroWarp,
      enabled: true,
      strength: 100,
      responseRadius: 8,
      detailScale: 160,
      detailOctaves: 3,
      normalDisplacement: 100,
      tangentialDisplacement: 0,
      edgeTurbulence: 100,
      quantizationSteps: 16,
      maxDisplacement: 48,
      preserveCounters: false,
      seedInfluence: 0,
    });
    expect(validateProject(JSON.parse(JSON.stringify(project))).project.glyphMicroWarp)
      .toEqual(project.glyphMicroWarp);
  });

  it("migrates v12 and safely validates Glyph Falloff Field settings", () => {
    const legacyV12 = { ...baseState, version: 12 } as Record<string, unknown>;
    delete legacyV12.glyphFalloffDisplacement;
    const migrated = validateProject(legacyV12).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphFalloffDisplacement).toEqual(baseState.glyphFalloffDisplacement);

    const project = validateProject({
      ...baseState,
      glyphFalloffDisplacement: {
        mode: "contour-rings",
        strength: 999,
        fieldWidth: -1,
        falloff: "invalid",
        ringFrequency: 99,
        ringSharpness: 0,
      },
    }).project;
    expect(project.glyphFalloffDisplacement).toEqual({
      ...baseState.glyphFalloffDisplacement,
      mode: "contour-rings",
      strength: 96,
      fieldWidth: 4,
      ringFrequency: 16,
      ringSharpness: 0.5,
    });
    expect(validateProject(JSON.parse(JSON.stringify(project))).project.glyphFalloffDisplacement)
      .toEqual(project.glyphFalloffDisplacement);
  });

  it("migrates v13 Slice semantics and validates shared influence plus Calm Water", () => {
    const {
      glyphInfluence: _glyphInfluence,
      glyphCalmWater: _glyphCalmWater,
      glyphDisplacement,
      ...v13Fields
    } = baseState;
    const { sliceInfluence: _sliceInfluence, ...v13GlyphDisplacement } = glyphDisplacement;
    const migrated = validateProject({
      ...v13Fields,
      version: 13,
      glyphDisplacement: { ...v13GlyphDisplacement, enabled: true, mode: "horizontal-slices" },
    }).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphDisplacement.sliceInfluence).toBe("legacy");
    expect(migrated.glyphInfluence).toEqual(baseState.glyphInfluence);
    expect(migrated.glyphCalmWater).toEqual(baseState.glyphCalmWater);

    const repaired = validateProject({
      ...baseState,
      glyphInfluence: { radius: -5, edgeSoftness: 99_999, falloff: "invalid" },
      glyphCalmWater: {
        ...baseState.glyphCalmWater,
        enabled: true,
        strength: 999,
        frequencyLinked: false,
        frequencyMultiplier: 0,
        wavelength: 2,
        surfaceVariation: 999,
        drift: -5,
        detail: 101,
        preserveCounters: false,
      },
      glyphDisplacement: { ...baseState.glyphDisplacement, sliceInfluence: "invalid" },
    }).project;
    expect(repaired.glyphInfluence).toEqual({
      radius: 0,
      edgeSoftness: 8_192,
      falloff: baseState.glyphInfluence.falloff,
    });
    expect(repaired.glyphCalmWater).toEqual({
      ...baseState.glyphCalmWater,
      enabled: true,
      strength: 64,
      frequencyLinked: false,
      frequencyMultiplier: 0.25,
      wavelength: 30,
      surfaceVariation: 100,
      drift: 0,
      detail: 100,
      preserveCounters: false,
    });
    expect(repaired.glyphDisplacement.sliceInfluence).toBe(baseState.glyphDisplacement.sliceInfluence);
    expect(validateProject(JSON.parse(JSON.stringify(repaired))).project).toEqual(repaired);
  });
});
