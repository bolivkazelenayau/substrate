import type { PresetId, ProjectState } from "../types";
import { COLORS } from "./constants";

type BuiltInPresetId = Exclude<PresetId, "Custom">;

export type PresetFamily =
  | "trace"
  | "wave"
  | "field"
  | "sdf"
  | "contour"
  | "halftone"
  | "diffuser"
  | "flow"
  | "warp"
  | "resonance"
  | "custom";

export type PresetMetadata =
  | {
      studyCode: string;
      legacyName: BuiltInPresetId;
      family: Exclude<PresetFamily, "custom">;
      description: string;
    }
  | {
      studyCode?: never;
      legacyName: "Custom";
      family: "custom";
      description: string;
    };

export const defaultDebugSettings: ProjectState["debug"] = {
  substrateMode: "none",
  maskBounds: false,
  glyphOutlines: false,
  glyphBounds: false,
  baseline: false,
  glyphOrigins: false,
  markOrigins: false,
  emitter: false,
  waveField: false,
  markCount: true,
  frameTime: false,
  costEstimate: false,
};

export const baseState: ProjectState = {
  version: 8,
  artboard: { width: 1200, height: 720 },
  text: "SUBSTRATE",
  fontSize: 148,
  tracking: -3,
  kerningMode: "font",
  kerningStrength: 1,
  opticalSpacing: false,
  opticalSpacingStrength: 0,
  textAlign: "center",
  textOffsetY: 0,
  renderer: "flow",
  seed: 24091,
  density: 46,
  amplitude: 22,
  frequency: 18,
  turbulence: 42,
  edgeInfluence: 68,
  exportMode: "artwork",
  primaryColor: COLORS.artwork,
  outlineColor: COLORS.artwork,
  backgroundColor: COLORS.background,
  transparentBackground: false,
  exportFrameMode: "current",
  precision: 1,
  maxNodes: 2800,
  substrateQuality: "medium",
  preset: "Edge Current",
  emitter: {
    id: "emitter-1",
    glyphId: null,
    enabled: false,
    sourceMode: "counter-center",
    fieldType: "radial-wave",
    amplitude: 1,
    frequency: 0.09,
    phase: 0,
    radius: 430,
    falloff: "smoothstep",
    selfInfluence: 1,
    neighborInfluence: 0.65,
    blendMode: "add",
    customX: 600,
    customY: 360,
  },
  emitterMode: "single",
  emitters: [{ id: "emitter-1", glyphId: null, enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 1, label: "Emitter 1" }],
  fieldBlendMode: "add",
  waveContourMode: "continuous",
  contourStrokeWidth: 1.15,
  waveDotSpacing: 11,
  waveDotRadius: 1.8,
  diffuserDomain: "text-halo",
  diffuserComposition: "behind-text",
  diffuserDotRadius: 2.2,
  diffuserRingContrast: 0.72,
  ringSharpness: 2.4,
  bandWidth: 0.28,
  diffuserHaloPadding: 80,
  textOverlayOpacity: 1,
  edgeErosionAmount: 0.2,
  edgeErosionWidth: 16,
  interiorProtection: 0.68,
  overlayMode: "solid",
  outlineStrokeWidth: 1.5,
  outlineWarpAmount: 8,
  outlineWarpScale: 1,
  outlineWarpSmoothing: 0.65,
  outlineWarpEdgeBias: 0.35,
  outlineWarpMaxDisplacement: 18,
  preserveCounters: true,
  glyphFieldMode: "off",
  glyphFieldInfluence: 60,
  glyphFieldDisplacement: 12,
  glyphFieldDensity: 45,
  glyphFieldRadius: 45,
  glyphFieldOpacity: 20,
  debug: defaultDebugSettings,
  font: null,
};

export const presets: Record<Exclude<PresetId, "Custom">, Partial<ProjectState>> = {
  "Edge Current": { renderer: "flow", density: 46, amplitude: 22, frequency: 18, turbulence: 42, edgeInfluence: 68, emitterMode: "single" },
  "Sonic Ripple": { renderer: "ripple", density: 34, amplitude: 32, frequency: 12, turbulence: 14, edgeInfluence: 82, emitterMode: "single" },
  "Signal Dust": { renderer: "dots", density: 58, amplitude: 12, frequency: 26, turbulence: 66, edgeInfluence: 52, emitterMode: "single" },
  "SDF Current": { renderer: "sdf-flow", density: 52, amplitude: 18, turbulence: 24, edgeInfluence: 78, maxNodes: 2400, emitterMode: "single" },
  "Contour Thread": { renderer: "sdf-streamlines", density: 42, amplitude: 30, turbulence: 18, edgeInfluence: 72, maxNodes: 3200, emitterMode: "single" },
  "Topographic Type": { renderer: "sdf-contours", density: 58, amplitude: 34, turbulence: 6, edgeInfluence: 38, maxNodes: 4000, emitterMode: "single" },
  "Halftone Press": { renderer: "sdf-halftone", density: 62, amplitude: 26, turbulence: 22, edgeInfluence: 44, maxNodes: 3000, emitterMode: "single" },
  "Glyph Ripple": {
    emitterMode: "single",
    renderer: "wave-contours",
    density: 48,
    amplitude: 28,
    frequency: 18,
    edgeInfluence: 45,
    maxNodes: 4000,
    waveContourMode: "continuous",
    emitter: { ...baseState.emitter, enabled: true, neighborInfluence: 0.62 },
  },
  "Dotted Diffuser": {
    emitterMode: "single",
    renderer: "wave-contours",
    density: 56,
    amplitude: 30,
    frequency: 21,
    edgeInfluence: 55,
    maxNodes: 3600,
    waveContourMode: "dotted",
    waveDotSpacing: 10,
    waveDotRadius: 1.7,
    emitter: { ...baseState.emitter, enabled: true, neighborInfluence: 0.88, falloff: "gaussian" },
  },
  "Sonic Halftone": {
    emitterMode: "single",
    renderer: "sdf-halftone", density: 70, amplitude: 22, turbulence: 11, edgeInfluence: 46, maxNodes: 3600,
    glyphFieldMode: "strong", glyphFieldInfluence: 92, glyphFieldDisplacement: 22, glyphFieldDensity: 86, glyphFieldRadius: 58,
    ringSharpness: 2.8, bandWidth: 0.34,
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 410, neighborInfluence: 0.82 },
  },
  "Sonic Contours": {
    emitterMode: "single",
    renderer: "sdf-contours", density: 56, amplitude: 28, turbulence: 3, edgeInfluence: 40, maxNodes: 4300,
    glyphFieldMode: "strong", glyphFieldInfluence: 72, glyphFieldDisplacement: 11,
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 430, neighborInfluence: 0.78 },
  },
  "Sonic Stream": {
    emitterMode: "single",
    renderer: "sdf-streamlines", density: 46, amplitude: 27, turbulence: 5, edgeInfluence: 64, maxNodes: 3800,
    glyphFieldMode: "subtle", glyphFieldInfluence: 68, glyphFieldDisplacement: 9, glyphFieldDensity: 32,
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 440, neighborInfluence: 0.72 },
  },
  "Sonic Diffuser": {
    emitterMode: "single",
    renderer: "glyph-diffuser",
    density: 68,
    amplitude: 26,
    frequency: 20,
    turbulence: 16,
    edgeInfluence: 72,
    maxNodes: 3200,
    diffuserDomain: "text-halo",
    diffuserComposition: "edge-eroded",
    diffuserDotRadius: 1.45,
    diffuserRingContrast: 0.94,
    ringSharpness: 3.2,
    bandWidth: 0.24,
    diffuserHaloPadding: 70,
    textOverlayOpacity: 1,
    edgeErosionAmount: 0.24,
    edgeErosionWidth: 18,
    interiorProtection: 0.66,
    overlayMode: "solid",
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 370, neighborInfluence: 0.68, falloff: "gaussian" },
  },
  "Sonic Warp": {
    emitterMode: "single",
    renderer: "glyph-diffuser",
    density: 60,
    amplitude: 28,
    frequency: 18,
    turbulence: 12,
    edgeInfluence: 70,
    maxNodes: 3400,
    diffuserDomain: "text-halo",
    diffuserComposition: "edge-eroded",
    diffuserDotRadius: 1.35,
    diffuserRingContrast: 0.92,
    ringSharpness: 3,
    bandWidth: 0.26,
    diffuserHaloPadding: 70,
    textOverlayOpacity: 1,
    edgeErosionAmount: 0.12,
    edgeErosionWidth: 16,
    interiorProtection: 0.72,
    overlayMode: "warped-outline",
    outlineWarpAmount: 19,
    outlineWarpScale: 1.05,
    outlineWarpSmoothing: 0.8,
    outlineWarpEdgeBias: 0.24,
    outlineWarpMaxDisplacement: 26,
    preserveCounters: true,
    emitter: { ...baseState.emitter, enabled: true, glyphId: "auto-o-middle", radius: 410, neighborInfluence: 0.74, falloff: "gaussian" },
  },
  "Sonic Interference": {
    renderer: "glyph-diffuser",
    density: 62,
    amplitude: 28,
    frequency: 19,
    turbulence: 14,
    edgeInfluence: 68,
    maxNodes: 3600,
    diffuserDomain: "text-halo",
    diffuserComposition: "behind-text",
    diffuserDotRadius: 1.5,
    diffuserRingContrast: 0.88,
    ringSharpness: 2.8,
    bandWidth: 0.28,
    diffuserHaloPadding: 60,
    textOverlayOpacity: 1,
    overlayMode: "solid",
    emitterMode: "multiple",
    fieldBlendMode: "add",
    emitters: [
      { id: "se-1", glyphId: "auto-middle", enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 1, label: "Middle" },
      { id: "se-2", glyphId: "auto-first", enabled: true, weight: 0.68, phaseOffset: Math.PI, radiusMultiplier: 0.82, label: "First" },
      { id: "se-3", glyphId: "auto-last", enabled: true, weight: 0.56, phaseOffset: Math.PI * 0.5, radiusMultiplier: 0.72, label: "Last" },
    ],
    emitter: { ...baseState.emitter, enabled: true, radius: 390, neighborInfluence: 0.72, falloff: "gaussian" },
  },
  "Counter Resonance": {
    renderer: "glyph-diffuser",
    density: 58,
    amplitude: 26,
    frequency: 21,
    turbulence: 10,
    edgeInfluence: 62,
    maxNodes: 3200,
    diffuserDomain: "text-halo",
    diffuserComposition: "behind-text",
    diffuserDotRadius: 1.6,
    diffuserRingContrast: 0.84,
    ringSharpness: 2.6,
    bandWidth: 0.3,
    diffuserHaloPadding: 50,
    textOverlayOpacity: 1,
    overlayMode: "solid",
    emitterMode: "multiple",
    fieldBlendMode: "add",
    emitters: [
      { id: "cr-1", glyphId: "auto-counter", enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 0.9, label: "Counter" },
      { id: "cr-2", glyphId: "auto-middle", enabled: true, weight: 0.62, phaseOffset: Math.PI, radiusMultiplier: 0.68, label: "Middle response" },
    ],
    emitter: { ...baseState.emitter, enabled: true, radius: 360, neighborInfluence: 0.68, selfInfluence: 0.9, falloff: "gaussian" },
  },
  "Split Field": {
    renderer: "wave-contours",
    density: 52,
    amplitude: 30,
    frequency: 17,
    turbulence: 8,
    edgeInfluence: 54,
    maxNodes: 4000,
    waveContourMode: "continuous",
    emitterMode: "multiple",
    fieldBlendMode: "add",
    emitters: [
      { id: "sf-1", glyphId: "auto-first", enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 1.12, label: "Leading field" },
      { id: "sf-2", glyphId: "auto-last", enabled: true, weight: 0.58, phaseOffset: Math.PI * 0.72, radiusMultiplier: 0.74, label: "Trailing field" },
    ],
    emitter: { ...baseState.emitter, enabled: true, radius: 420, neighborInfluence: 0.76, falloff: "smoothstep" },
  },
};

// Presentation only: the legacy preset name remains the persisted compatibility
// ID, while `presets` above remains the sole source of rendering state.
export const presetMetadata: Record<PresetId, PresetMetadata> = {
  "Edge Current": {
    studyCode: "TRACE / 01",
    legacyName: "Edge Current",
    family: "trace",
    description: "Masked flow lines shaped by glyph-edge field pressure.",
  },
  "Sonic Ripple": {
    studyCode: "ARC / 02",
    legacyName: "Sonic Ripple",
    family: "wave",
    description: "Radial wave interference around typographic mass.",
  },
  "Signal Dust": {
    studyCode: "DUST / 03",
    legacyName: "Signal Dust",
    family: "field",
    description: "Sparse particle field disturbed by the source glyphs.",
  },
  "SDF Current": {
    studyCode: "CURRENT / 04",
    legacyName: "SDF Current",
    family: "sdf",
    description: "Distance-field current lines flowing around letterforms.",
  },
  "Contour Thread": {
    studyCode: "THREAD / 05",
    legacyName: "Contour Thread",
    family: "contour",
    description: "Fine contour threads tracing the inner field structure.",
  },
  "Topographic Type": {
    studyCode: "STRATA / 06",
    legacyName: "Topographic Type",
    family: "contour",
    description: "Layered topographic contour bands inside typographic space.",
  },
  "Halftone Press": {
    studyCode: "PRESS / 07",
    legacyName: "Halftone Press",
    family: "halftone",
    description: "Print-like halftone pressure mapped through the glyph field.",
  },
  "Glyph Ripple": {
    studyCode: "RIPPLE / 08",
    legacyName: "Glyph Ripple",
    family: "wave",
    description: "Glyph-driven ripple structure with strong internal rhythm.",
  },
  "Dotted Diffuser": {
    studyCode: "DIFFUSE / 09",
    legacyName: "Dotted Diffuser",
    family: "diffuser",
    description: "Dot-field diffusion radiating from typographic structure.",
  },
  "Sonic Halftone": {
    studyCode: "HALFTONE / 10",
    legacyName: "Sonic Halftone",
    family: "halftone",
    description: "Sonic field modulation expressed as halftone density.",
  },
  "Sonic Contours": {
    studyCode: "CONTOUR / 11",
    legacyName: "Sonic Contours",
    family: "contour",
    description: "Sonic contour bands wrapping and cutting through glyph space.",
  },
  "Sonic Stream": {
    studyCode: "STREAM / 12",
    legacyName: "Sonic Stream",
    family: "flow",
    description: "Streamline field behavior driven by sonic typography.",
  },
  "Sonic Diffuser": {
    studyCode: "HALO / 13",
    legacyName: "Sonic Diffuser",
    family: "diffuser",
    description: "Diffused halo field surrounding the typographic source.",
  },
  "Sonic Warp": {
    studyCode: "WARP / 14",
    legacyName: "Sonic Warp",
    family: "warp",
    description: "Warped typographic field with distorted vector structure.",
  },
  "Sonic Interference": {
    studyCode: "INTERFERENCE / 15",
    legacyName: "Sonic Interference",
    family: "wave",
    description: "Crossing wave systems creating interference around the text.",
  },
  "Counter Resonance": {
    studyCode: "COUNTER / 16",
    legacyName: "Counter Resonance",
    family: "resonance",
    description: "Resonant field behavior focused on counters and internal forms.",
  },
  "Split Field": {
    studyCode: "SPLIT / 17",
    legacyName: "Split Field",
    family: "field",
    description: "Divided field behavior with separated typographic force zones.",
  },
  Custom: {
    legacyName: "Custom",
    family: "custom",
    description: "User-modified project state.",
  },
};

export const presetIds = [...Object.keys(presets), "Custom"] as PresetId[];

export function getPresetDisplayLabel(preset: PresetId) {
  const metadata = presetMetadata[preset];
  return metadata.studyCode ? `${metadata.studyCode} — ${metadata.legacyName}` : metadata.legacyName;
}

export function applyPreset(state: ProjectState, preset: PresetId): ProjectState {
  if (preset === "Custom") return { ...state, preset };
  return { ...state, ...presets[preset], preset };
}
