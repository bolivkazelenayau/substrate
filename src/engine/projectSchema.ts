import { baseState, defaultDebugSettings, presetIds } from "./presets";
import { LINE_HEIGHT_BOUNDS, SIZE_HARD_LIMITS } from "./numericBounds";
import type { ExportFrameMode, ExportMode, FontMetadata, ProjectState, RendererId } from "../types";
import { ARTBOARD_LIMITS, DEFAULT_ARTBOARD } from "./artboard";
import { CONTOUR_STROKE_WIDTH_LIMITS } from "./contourStroke";

type UnknownRecord = Record<string, unknown>;

export const CURRENT_PROJECT_VERSION = 12 as const;

const rendererIds: RendererId[] = ["flow", "ripple", "dots", "sdf-flow", "sdf-streamlines", "sdf-contours", "sdf-halftone", "wave-contours", "glyph-diffuser"];
const exportModes: ExportMode[] = ["artwork", "editable"];
const exportFrameModes: ExportFrameMode[] = ["current", "time-zero"];
const substrateDebugModes = ["none", "glyph-outlines", "mask", "edge", "distance", "gradient"] as const;
const substrateQualities = ["low", "medium", "high", "ultra"] as const;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const clamp = (value: unknown, fallback: number, min: number, max: number, integer = false) => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const clamped = Math.min(max, Math.max(min, numeric));
  return integer ? Math.round(clamped) : clamped;
};
const enumValue = <T extends string>(value: unknown, values: readonly T[], fallback: T): T =>
  typeof value === "string" && values.includes(value as T) ? value as T : fallback;
const colorValue = (value: unknown, fallback: string): string =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

export interface ProjectValidationResult {
  project: ProjectState;
  warnings: string[];
}

function projectVersion(input: UnknownRecord): number {
  if (input.version === undefined) return 1;
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 1) {
    throw new Error("Project schema version must be a positive integer.");
  }
  if (input.version > CURRENT_PROJECT_VERSION) {
    throw new Error(`Project version ${input.version} is newer than this app supports.`);
  }
  return input.version;
}

export function migrateProject(input: unknown): UnknownRecord {
  if (!isRecord(input)) throw new Error("Project must be a JSON object.");
  const version = projectVersion(input);
  let migrated: UnknownRecord = { ...input };
  if (version <= 3) {
    migrated = {
      ...migrated,
      version: 4,
      exportFrameMode: migrated.exportFrameMode ?? "current",
      debug: { ...defaultDebugSettings, ...(isRecord(migrated.debug) ? migrated.debug : {}) },
      font: version <= 2 ? null : migrated.font,
      emitter: { ...baseState.emitter },
      waveContourMode: "continuous",
      waveDotSpacing: 11,
      waveDotRadius: 1.8,
    };
  }
  if (version <= 4) {
    // v4 → v5: add multi-emitter fields. The old single `emitter` is kept intact
    // (shared params + single source). `emitterMode` defaults to "single" so old
    // projects render identically. One emitter instance is derived from the old
    // emitter's glyphId so switching to "multiple" mode immediately has one entry.
    const oldEmitter = isRecord(migrated.emitter) ? migrated.emitter : {};
    const oldGlyphId = typeof oldEmitter.glyphId === "string" ? oldEmitter.glyphId : null;
    const oldBlendMode = typeof oldEmitter.blendMode === "string" ? oldEmitter.blendMode : baseState.emitter.blendMode;
    migrated = {
      ...migrated,
      version: 5,
      emitterMode: "single",
      emitters: [{ id: "emitter-1", glyphId: oldGlyphId, enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 1, label: "Emitter 1" }],
      fieldBlendMode: oldBlendMode === "max" ? "max" : "add",
    };
  }
  if (version <= 5) {
    migrated = {
      ...migrated,
      version: 6,
      kerningMode: migrated.kerningMode ?? "font",
      kerningStrength: migrated.kerningStrength ?? 1,
      opticalSpacing: migrated.opticalSpacing ?? false,
      opticalSpacingStrength: migrated.opticalSpacingStrength ?? 0,
      textAlign: migrated.textAlign ?? "center",
      textOffsetY: migrated.textOffsetY ?? 0,
    };
  }
  if (version <= 6) {
    migrated = {
      ...migrated,
      version: 7,
      primaryColor: migrated.primaryColor ?? baseState.primaryColor,
      outlineColor: migrated.outlineColor ?? baseState.outlineColor,
      backgroundColor: migrated.backgroundColor ?? baseState.backgroundColor,
      transparentBackground: migrated.transparentBackground ?? baseState.transparentBackground,
    };
  }
  if (version <= 7) {
    migrated = {
      ...migrated,
      version: 8,
      artboard: migrated.artboard ?? { ...DEFAULT_ARTBOARD },
    };
  }
  if (version <= 8) {
    migrated = {
      ...migrated,
      version: 9,
      emitterDisplay: migrated.emitterDisplay ?? { ...baseState.emitterDisplay },
      glyphDisplacement: migrated.glyphDisplacement ?? { ...baseState.glyphDisplacement },
      dotGrid: migrated.dotGrid ?? { ...baseState.dotGrid },
    };
  }
  if (version <= 9) {
    migrated = {
      ...migrated,
      version: 10,
      displayDislocation: migrated.displayDislocation ?? { ...baseState.displayDislocation },
    };
  }
  if (version <= 10) {
    migrated = {
      ...migrated,
      version: 11,
      emitterMicroResponse: migrated.emitterMicroResponse ?? { ...baseState.emitterMicroResponse },
    };
  }
  if (version <= 11) {
    migrated = {
      ...migrated,
      version: 12,
      glyphMicroWarp: migrated.glyphMicroWarp ?? { ...baseState.glyphMicroWarp },
    };
  }
  return migrated;
}

function validateEmitterInstances(value: unknown) {
  if (!Array.isArray(value)) return baseState.emitters;
  const usedIds = new Set<string>();
  const nextId = () => {
    let suffix = 1;
    while (usedIds.has(`emitter-${suffix}`)) suffix += 1;
    return `emitter-${suffix}`;
  };
  return value.filter(isRecord).slice(0, 8).map((instance, index) => {
    const requestedId = typeof instance.id === "string" ? instance.id.trim().slice(0, 64) : "";
    const id = requestedId && !usedIds.has(requestedId) ? requestedId : nextId();
    usedIds.add(id);
    return {
      id,
      glyphId: typeof instance.glyphId === "string" ? instance.glyphId.slice(0, 128) : null,
      enabled: typeof instance.enabled === "boolean" ? instance.enabled : true,
      weight: clamp(instance.weight, 1, 0, 2),
      phaseOffset: clamp(instance.phaseOffset, 0, -Math.PI * 4, Math.PI * 4),
      radiusMultiplier: clamp(instance.radiusMultiplier, 1, 0.25, 2),
      label: typeof instance.label === "string" ? instance.label.slice(0, 32) : `Emitter ${index + 1}`,
    };
  });
}

export function validateProject(input: unknown): ProjectValidationResult {
  const originalVersion = isRecord(input) && typeof input.version === "number" ? input.version : 1;
  const source = migrateProject(input);
  const warnings: string[] = [];

  if (source.renderer !== undefined && !rendererIds.includes(source.renderer as RendererId)) {
    throw new Error(`Unknown renderer "${String(source.renderer)}".`);
  }
  if (source.exportMode !== undefined && !exportModes.includes(source.exportMode as ExportMode)) {
    throw new Error(`Unknown export mode "${String(source.exportMode)}".`);
  }

  const debugSource = isRecord(source.debug) ? source.debug : {};
  const emitterSource = isRecord(source.emitter) ? source.emitter : {};
  const emitterDisplaySource = isRecord(source.emitterDisplay) ? source.emitterDisplay : {};
  const emitterMicroResponseSource = isRecord(source.emitterMicroResponse) ? source.emitterMicroResponse : {};
  const glyphMicroWarpSource = isRecord(source.glyphMicroWarp) ? source.glyphMicroWarp : {};
  const glyphDisplacementSource = isRecord(source.glyphDisplacement) ? source.glyphDisplacement : {};
  const dotGridSource = isRecord(source.dotGrid) ? source.dotGrid : {};
  const displayDislocationSource = isRecord(source.displayDislocation) ? source.displayDislocation : {};
  const fontSource = isRecord(source.font) ? source.font : null;
  const font: FontMetadata | null = fontSource
    && typeof fontSource.family === "string"
    && typeof fontSource.fileName === "string"
    && typeof fontSource.unitsPerEm === "number"
    ? {
        family: fontSource.family,
        fullName: typeof fontSource.fullName === "string" ? fontSource.fullName : fontSource.family,
        fileName: fontSource.fileName,
        unitsPerEm: clamp(fontSource.unitsPerEm, 1000, 16, 16384, true),
        ascender: clamp(fontSource.ascender, 800, -32768, 32767),
        descender: clamp(fontSource.descender, -200, -32768, 32767),
      }
    : null;
  const preset = source.preset === undefined
    ? baseState.preset
    : enumValue(source.preset, presetIds, "Custom");
  const project: ProjectState = {
    version: 12,
    artboard: {
      width: clamp(isRecord(source.artboard) ? source.artboard.width : undefined, DEFAULT_ARTBOARD.width, ARTBOARD_LIMITS.min, ARTBOARD_LIMITS.max, true),
      height: clamp(isRecord(source.artboard) ? source.artboard.height : undefined, DEFAULT_ARTBOARD.height, ARTBOARD_LIMITS.min, ARTBOARD_LIMITS.max, true),
    },
    text: typeof source.text === "string" ? source.text.slice(0, 280) : baseState.text,
    fontSize: clamp(source.fontSize, baseState.fontSize, 1, SIZE_HARD_LIMITS.typographySize),
    lineHeight: clamp(source.lineHeight, baseState.lineHeight, LINE_HEIGHT_BOUNDS.hardMin, LINE_HEIGHT_BOUNDS.hardMax),
    tracking: clamp(source.tracking, baseState.tracking, -10, 18),
    kerningMode: enumValue(source.kerningMode, ["font", "none"], baseState.kerningMode),
    kerningStrength: clamp(source.kerningStrength, baseState.kerningStrength, 0, 2),
    opticalSpacing: typeof source.opticalSpacing === "boolean" ? source.opticalSpacing : baseState.opticalSpacing,
    opticalSpacingStrength: clamp(source.opticalSpacingStrength, baseState.opticalSpacingStrength, 0, 1),
    textAlign: enumValue(source.textAlign, ["left", "center", "right"], baseState.textAlign),
    textOffsetY: clamp(source.textOffsetY, baseState.textOffsetY, -SIZE_HARD_LIMITS.textOffset, SIZE_HARD_LIMITS.textOffset),
    renderer: enumValue(source.renderer, rendererIds, baseState.renderer),
    seed: clamp(source.seed, baseState.seed, 0, 999999, true),
    density: clamp(source.density, baseState.density, 10, 80),
    amplitude: clamp(source.amplitude, baseState.amplitude, 2, 44),
    frequency: clamp(source.frequency, baseState.frequency, 6, 34),
    turbulence: clamp(source.turbulence, baseState.turbulence, 0, 100),
    edgeInfluence: clamp(source.edgeInfluence, baseState.edgeInfluence, 0, 100),
    exportMode: enumValue(source.exportMode, exportModes, baseState.exportMode),
    primaryColor: colorValue(source.primaryColor, baseState.primaryColor),
    outlineColor: colorValue(source.outlineColor, baseState.outlineColor),
    backgroundColor: colorValue(source.backgroundColor, baseState.backgroundColor),
    transparentBackground: typeof source.transparentBackground === "boolean"
      ? source.transparentBackground
      : baseState.transparentBackground,
    exportFrameMode: enumValue(source.exportFrameMode, exportFrameModes, baseState.exportFrameMode),
    precision: clamp(source.precision, baseState.precision, 0, 3, true),
    maxNodes: clamp(source.maxNodes, baseState.maxNodes, 400, 5000, true),
    substrateQuality: enumValue(source.substrateQuality, substrateQualities, baseState.substrateQuality),
    preset,
    emitter: {
      id: typeof emitterSource.id === "string" ? emitterSource.id.slice(0, 64) : baseState.emitter.id,
      glyphId: typeof emitterSource.glyphId === "string" ? emitterSource.glyphId.slice(0, 128) : null,
      enabled: typeof emitterSource.enabled === "boolean" ? emitterSource.enabled : baseState.emitter.enabled,
      sourceMode: enumValue(emitterSource.sourceMode, ["center", "centroid", "counter-center", "custom"], baseState.emitter.sourceMode),
      fieldType: "radial-wave",
      amplitude: clamp(emitterSource.amplitude, baseState.emitter.amplitude, 0, 4),
      frequency: clamp(emitterSource.frequency, baseState.emitter.frequency, 0.005, 0.5),
      phase: clamp(emitterSource.phase, baseState.emitter.phase, -Math.PI * 4, Math.PI * 4),
      radius: clamp(emitterSource.radius, baseState.emitter.radius, 20, SIZE_HARD_LIMITS.emitterRadius),
      falloff: enumValue(emitterSource.falloff, ["smoothstep", "gaussian", "linear"], baseState.emitter.falloff),
      selfInfluence: clamp(emitterSource.selfInfluence, baseState.emitter.selfInfluence, 0, 3),
      neighborInfluence: clamp(emitterSource.neighborInfluence, baseState.emitter.neighborInfluence, 0, 3),
      blendMode: enumValue(emitterSource.blendMode, ["add", "max"], baseState.emitter.blendMode),
      customX: clamp(emitterSource.customX, baseState.emitter.customX, 0, 1200),
      customY: clamp(emitterSource.customY, baseState.emitter.customY, 0, 720),
    },
    emitterMode: enumValue(source.emitterMode, ["single", "multiple"], baseState.emitterMode),
    emitters: validateEmitterInstances(source.emitters),
    emitterDisplay: {
      mode: enumValue(emitterDisplaySource.mode, ["field", "distort", "exclude", "orbit"], baseState.emitterDisplay.mode),
      distortionStrength: clamp(emitterDisplaySource.distortionStrength, baseState.emitterDisplay.distortionStrength, 0, 100),
      distortionRadius: clamp(emitterDisplaySource.distortionRadius, baseState.emitterDisplay.distortionRadius, 8, 720),
      noiseScale: clamp(emitterDisplaySource.noiseScale, baseState.emitterDisplay.noiseScale, 2, 160),
      gridSize: clamp(emitterDisplaySource.gridSize, baseState.emitterDisplay.gridSize, 0, 96),
      gridAmount: clamp(emitterDisplaySource.gridAmount, baseState.emitterDisplay.gridAmount, 0, 100),
      interiorSuppression: clamp(emitterDisplaySource.interiorSuppression, baseState.emitterDisplay.interiorSuppression, 0, 100),
      edgeBias: clamp(emitterDisplaySource.edgeBias, baseState.emitterDisplay.edgeBias, 0, 100),
      orbitAmount: clamp(emitterDisplaySource.orbitAmount, baseState.emitterDisplay.orbitAmount, 0, 100),
      divergence: clamp(emitterDisplaySource.divergence, baseState.emitterDisplay.divergence, -100, 100),
    },
    emitterMicroResponse: {
      enabled: typeof emitterMicroResponseSource.enabled === "boolean"
        ? emitterMicroResponseSource.enabled
        : baseState.emitterMicroResponse.enabled,
      positionDetail: clamp(
        emitterMicroResponseSource.positionDetail,
        baseState.emitterMicroResponse.positionDetail,
        0,
        100,
      ),
      densityBreakup: clamp(
        emitterMicroResponseSource.densityBreakup,
        baseState.emitterMicroResponse.densityBreakup,
        0,
        100,
      ),
      detailScale: clamp(
        emitterMicroResponseSource.detailScale,
        baseState.emitterMicroResponse.detailScale,
        2,
        160,
      ),
      responseRadius: clamp(
        emitterMicroResponseSource.responseRadius,
        baseState.emitterMicroResponse.responseRadius,
        8,
        SIZE_HARD_LIMITS.emitterRadius,
      ),
      falloff: enumValue(
        emitterMicroResponseSource.falloff,
        ["smoothstep", "gaussian", "linear"],
        baseState.emitterMicroResponse.falloff,
      ),
      maxDisplacement: clamp(
        emitterMicroResponseSource.maxDisplacement,
        baseState.emitterMicroResponse.maxDisplacement,
        0,
        96,
      ),
      occupancy: enumValue(
        emitterMicroResponseSource.occupancy,
        ["legacy", "exclude-interior", "disperse-exterior"],
        baseState.emitterMicroResponse.occupancy,
      ),
      exteriorPush: clamp(
        emitterMicroResponseSource.exteriorPush,
        baseState.emitterMicroResponse.exteriorPush,
        0,
        100,
      ),
      tangentialFlow: clamp(
        emitterMicroResponseSource.tangentialFlow,
        baseState.emitterMicroResponse.tangentialFlow,
        0,
        100,
      ),
      divergence: clamp(
        emitterMicroResponseSource.divergence,
        baseState.emitterMicroResponse.divergence,
        0,
        100,
      ),
      exteriorShell: clamp(
        emitterMicroResponseSource.exteriorShell,
        baseState.emitterMicroResponse.exteriorShell,
        1,
        240,
      ),
    },
    glyphMicroWarp: {
      enabled: typeof glyphMicroWarpSource.enabled === "boolean"
        ? glyphMicroWarpSource.enabled
        : baseState.glyphMicroWarp.enabled,
      strength: clamp(glyphMicroWarpSource.strength, baseState.glyphMicroWarp.strength, 0, 100),
      responseRadius: clamp(
        glyphMicroWarpSource.responseRadius,
        baseState.glyphMicroWarp.responseRadius,
        8,
        SIZE_HARD_LIMITS.emitterRadius,
      ),
      falloff: enumValue(
        glyphMicroWarpSource.falloff,
        ["smoothstep", "gaussian", "linear"],
        baseState.glyphMicroWarp.falloff,
      ),
      detailScale: clamp(glyphMicroWarpSource.detailScale, baseState.glyphMicroWarp.detailScale, 4, 160),
      detailOctaves: clamp(glyphMicroWarpSource.detailOctaves, baseState.glyphMicroWarp.detailOctaves, 1, 3, true),
      normalDisplacement: clamp(
        glyphMicroWarpSource.normalDisplacement,
        baseState.glyphMicroWarp.normalDisplacement,
        0,
        100,
      ),
      tangentialDisplacement: clamp(
        glyphMicroWarpSource.tangentialDisplacement,
        baseState.glyphMicroWarp.tangentialDisplacement,
        0,
        100,
      ),
      edgeTurbulence: clamp(glyphMicroWarpSource.edgeTurbulence, baseState.glyphMicroWarp.edgeTurbulence, 0, 100),
      quantizationSteps: clamp(
        glyphMicroWarpSource.quantizationSteps,
        baseState.glyphMicroWarp.quantizationSteps,
        0,
        16,
        true,
      ),
      maxDisplacement: clamp(
        glyphMicroWarpSource.maxDisplacement,
        baseState.glyphMicroWarp.maxDisplacement,
        0,
        48,
      ),
      preserveCounters: typeof glyphMicroWarpSource.preserveCounters === "boolean"
        ? glyphMicroWarpSource.preserveCounters
        : baseState.glyphMicroWarp.preserveCounters,
      seedInfluence: clamp(glyphMicroWarpSource.seedInfluence, baseState.glyphMicroWarp.seedInfluence, 0, 100),
    },
    glyphDisplacement: {
      enabled: typeof glyphDisplacementSource.enabled === "boolean" ? glyphDisplacementSource.enabled : baseState.glyphDisplacement.enabled,
      mode: enumValue(glyphDisplacementSource.mode, ["warp", "horizontal-slices", "vertical-slices", "grid", "radial-sectors"], baseState.glyphDisplacement.mode),
      strength: clamp(glyphDisplacementSource.strength, baseState.glyphDisplacement.strength, 0, 320),
      responseRadius: clamp(glyphDisplacementSource.responseRadius, baseState.glyphDisplacement.responseRadius, 8, SIZE_HARD_LIMITS.emitterRadius),
      falloff: enumValue(glyphDisplacementSource.falloff, ["smoothstep", "gaussian", "linear"], baseState.glyphDisplacement.falloff),
      fragmentSize: clamp(glyphDisplacementSource.fragmentSize, baseState.glyphDisplacement.fragmentSize, 4, 320),
      gap: clamp(glyphDisplacementSource.gap, baseState.glyphDisplacement.gap, 0, 120),
      quantizationSteps: clamp(glyphDisplacementSource.quantizationSteps, baseState.glyphDisplacement.quantizationSteps, 1, 32, true),
      direction: clamp(glyphDisplacementSource.direction, baseState.glyphDisplacement.direction, -360, 360),
      radialTangential: clamp(glyphDisplacementSource.radialTangential, baseState.glyphDisplacement.radialTangential, -100, 100),
      jitter: clamp(glyphDisplacementSource.jitter, baseState.glyphDisplacement.jitter, 0, 100),
      fragmentRotation: clamp(glyphDisplacementSource.fragmentRotation, baseState.glyphDisplacement.fragmentRotation, 0, 12),
      seedInfluence: clamp(glyphDisplacementSource.seedInfluence, baseState.glyphDisplacement.seedInfluence, 0, 100),
    },
    dotGrid: {
      enabled: typeof dotGridSource.enabled === "boolean" ? dotGridSource.enabled : baseState.dotGrid.enabled,
      spacing: clamp(dotGridSource.spacing, baseState.dotGrid.spacing, 3, 80),
      radius: clamp(dotGridSource.radius, baseState.dotGrid.radius, 0.1, SIZE_HARD_LIMITS.dotRadius),
      threshold: clamp(dotGridSource.threshold, baseState.dotGrid.threshold, 0, 1),
      edgeSoftness: clamp(dotGridSource.edgeSoftness, baseState.dotGrid.edgeSoftness, 0, 1),
    },
    displayDislocation: {
      enabled: typeof displayDislocationSource.enabled === "boolean"
        ? displayDislocationSource.enabled
        : baseState.displayDislocation.enabled,
      mode: enumValue(
        displayDislocationSource.mode,
        ["horizontal-bands", "vertical-bands", "blocks"],
        baseState.displayDislocation.mode,
      ),
      responseRadius: clamp(
        displayDislocationSource.responseRadius,
        baseState.displayDislocation.responseRadius,
        8,
        SIZE_HARD_LIMITS.emitterRadius,
      ),
      falloff: enumValue(
        displayDislocationSource.falloff,
        ["smoothstep", "gaussian", "linear"],
        baseState.displayDislocation.falloff,
      ),
      displacementAmount: clamp(
        displayDislocationSource.displacementAmount,
        baseState.displayDislocation.displacementAmount,
        0,
        160,
      ),
      regionSize: clamp(displayDislocationSource.regionSize, baseState.displayDislocation.regionSize, 4, 320),
      gap: clamp(displayDislocationSource.gap, baseState.displayDislocation.gap, 0, 120),
      quantizationSteps: clamp(
        displayDislocationSource.quantizationSteps,
        baseState.displayDislocation.quantizationSteps,
        1,
        32,
        true,
      ),
      direction: clamp(displayDislocationSource.direction, baseState.displayDislocation.direction, -360, 360),
      alternatingOffset: clamp(
        displayDislocationSource.alternatingOffset,
        baseState.displayDislocation.alternatingOffset,
        0,
        100,
      ),
      radialBias: clamp(displayDislocationSource.radialBias, baseState.displayDislocation.radialBias, 0, 100),
      seed: clamp(displayDislocationSource.seed, baseState.displayDislocation.seed, 0, 999999, true),
    },
    fieldBlendMode: enumValue(source.fieldBlendMode, ["add", "max"], baseState.fieldBlendMode),
    waveContourMode: enumValue(source.waveContourMode, ["continuous", "dotted"], baseState.waveContourMode),
    contourStrokeWidth: clamp(source.contourStrokeWidth, baseState.contourStrokeWidth, CONTOUR_STROKE_WIDTH_LIMITS.min, CONTOUR_STROKE_WIDTH_LIMITS.max),
    waveDotSpacing: clamp(source.waveDotSpacing, baseState.waveDotSpacing, 3, 40),
    waveDotRadius: clamp(source.waveDotRadius, baseState.waveDotRadius, 0.1, SIZE_HARD_LIMITS.dotRadius),
    diffuserDomain: enumValue(source.diffuserDomain, ["inside-text", "halo", "text-halo"], baseState.diffuserDomain),
    diffuserComposition: enumValue(source.diffuserComposition, ["clipped", "behind-text", "through-text", "text-reactive", "edge-eroded"], baseState.diffuserComposition),
    diffuserDotRadius: clamp(source.diffuserDotRadius, baseState.diffuserDotRadius, 0.1, SIZE_HARD_LIMITS.dotRadius),
    diffuserRingContrast: clamp(source.diffuserRingContrast, baseState.diffuserRingContrast, 0, 1),
    ringSharpness: clamp(source.ringSharpness, baseState.ringSharpness, 0.5, 8),
    bandWidth: clamp(source.bandWidth, baseState.bandWidth, 0.05, 0.8),
    diffuserHaloPadding: clamp(source.diffuserHaloPadding, baseState.diffuserHaloPadding, 0, 400),
    textOverlayOpacity: clamp(source.textOverlayOpacity, baseState.textOverlayOpacity, 0, 1),
    edgeErosionAmount: clamp(source.edgeErosionAmount, baseState.edgeErosionAmount, 0, 1),
    edgeErosionWidth: clamp(source.edgeErosionWidth, baseState.edgeErosionWidth, 0, 64),
    interiorProtection: clamp(source.interiorProtection, baseState.interiorProtection, 0, 1),
    overlayMode: enumValue(source.overlayMode, ["solid", "outline", "knockout", "hidden", "warped-outline"], baseState.overlayMode),
    outlineStrokeWidth: clamp(source.outlineStrokeWidth, baseState.outlineStrokeWidth, 0.25, SIZE_HARD_LIMITS.outlineWidth),
    outlineWarpAmount: clamp(source.outlineWarpAmount, baseState.outlineWarpAmount, 0, 60),
    outlineWarpScale: clamp(source.outlineWarpScale, baseState.outlineWarpScale, 0.25, 3),
    outlineWarpSmoothing: clamp(source.outlineWarpSmoothing, baseState.outlineWarpSmoothing, 0, 1),
    outlineWarpEdgeBias: clamp(source.outlineWarpEdgeBias, baseState.outlineWarpEdgeBias, 0, 1),
    outlineWarpMaxDisplacement: clamp(source.outlineWarpMaxDisplacement, baseState.outlineWarpMaxDisplacement, 0, SIZE_HARD_LIMITS.displacement),
    preserveCounters: typeof source.preserveCounters === "boolean" ? source.preserveCounters : baseState.preserveCounters,
    glyphFieldMode: enumValue(source.glyphFieldMode, ["off", "subtle", "strong"], baseState.glyphFieldMode),
    glyphFieldInfluence: clamp(source.glyphFieldInfluence, baseState.glyphFieldInfluence, 0, 100),
    glyphFieldDisplacement: clamp(source.glyphFieldDisplacement, baseState.glyphFieldDisplacement, 0, 40),
    glyphFieldDensity: clamp(source.glyphFieldDensity, baseState.glyphFieldDensity, 0, 100),
    glyphFieldRadius: clamp(source.glyphFieldRadius, baseState.glyphFieldRadius, 0, 100),
    glyphFieldOpacity: clamp(source.glyphFieldOpacity, baseState.glyphFieldOpacity, 0, 100),
    debug: {
      substrateMode: enumValue(debugSource.substrateMode, substrateDebugModes, "none"),
      maskBounds: typeof debugSource.maskBounds === "boolean" ? debugSource.maskBounds : defaultDebugSettings.maskBounds,
      glyphOutlines: typeof debugSource.glyphOutlines === "boolean" ? debugSource.glyphOutlines : defaultDebugSettings.glyphOutlines,
      glyphBounds: typeof debugSource.glyphBounds === "boolean" ? debugSource.glyphBounds : defaultDebugSettings.glyphBounds,
      baseline: typeof debugSource.baseline === "boolean" ? debugSource.baseline : defaultDebugSettings.baseline,
      glyphOrigins: typeof debugSource.glyphOrigins === "boolean" ? debugSource.glyphOrigins : defaultDebugSettings.glyphOrigins,
      markOrigins: typeof debugSource.markOrigins === "boolean" ? debugSource.markOrigins : defaultDebugSettings.markOrigins,
      emitter: typeof debugSource.emitter === "boolean" ? debugSource.emitter : defaultDebugSettings.emitter,
      waveField: typeof debugSource.waveField === "boolean" ? debugSource.waveField : defaultDebugSettings.waveField,
      markCount: typeof debugSource.markCount === "boolean" ? debugSource.markCount : defaultDebugSettings.markCount,
      frameTime: typeof debugSource.frameTime === "boolean" ? debugSource.frameTime : defaultDebugSettings.frameTime,
      costEstimate: typeof debugSource.costEstimate === "boolean" ? debugSource.costEstimate : defaultDebugSettings.costEstimate,
    },
    font,
  };

  if (originalVersion < CURRENT_PROJECT_VERSION) warnings.push(`Project was migrated to schema version ${CURRENT_PROJECT_VERSION}.`);
  if (typeof source.text === "string" && source.text.length > 280) warnings.push("Text was truncated to 280 characters.");
  return { project, warnings };
}
