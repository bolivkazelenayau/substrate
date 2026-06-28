export type RendererId = "flow" | "ripple" | "dots" | "sdf-flow" | "sdf-streamlines" | "sdf-contours" | "sdf-halftone" | "wave-contours" | "glyph-diffuser";
export type ExportMode = "artwork" | "editable";
export type ExportFrameMode = "current" | "time-zero";
export type SubstrateQuality = "low" | "medium" | "high" | "ultra";
export type PresetId = "Edge Current" | "Sonic Ripple" | "Signal Dust" | "SDF Current" | "Contour Thread" | "Topographic Type" | "Halftone Press" | "Glyph Ripple" | "Dotted Diffuser" | "Sonic Halftone" | "Sonic Contours" | "Sonic Stream" | "Sonic Diffuser" | "Sonic Warp" | "Sonic Interference" | "Counter Resonance" | "Custom";
export type FieldControlId = "density" | "amplitude" | "frequency" | "turbulence" | "edgeInfluence" | "maxNodes";
export type PreviewFpsCap = 24 | 30 | 60;
export type GlyphEmitterSourceMode = "center" | "centroid" | "counter-center" | "custom";
export type GlyphEmitterFalloff = "smoothstep" | "gaussian" | "linear";
export type GlyphEmitterBlendMode = "add" | "max";
export type WaveContourMode = "continuous" | "dotted";
export type EmitterMode = "single" | "multiple";
export type FieldBlendMode = "add" | "max";
export type DiffuserDomainMode = "inside-text" | "halo" | "text-halo";
export type DiffuserCompositionMode = "clipped" | "behind-text" | "through-text" | "text-reactive" | "edge-eroded";
export type OverlayMode = "solid" | "outline" | "knockout" | "hidden" | "warped-outline";
export type GlyphFieldModulationMode = "off" | "subtle" | "strong";

export interface GlyphEmitter {
  id: string;
  glyphId: string | null;
  enabled: boolean;
  sourceMode: GlyphEmitterSourceMode;
  fieldType: "radial-wave";
  amplitude: number;
  frequency: number;
  phase: number;
  radius: number;
  falloff: GlyphEmitterFalloff;
  selfInfluence: number;
  neighborInfluence: number;
  blendMode: GlyphEmitterBlendMode;
  customX: number;
  customY: number;
}

export interface GlyphEmitterInstance {
  id: string;
  glyphId: string | null;
  enabled: boolean;
  weight: number;
  phaseOffset: number;
  radiusMultiplier: number;
  label: string;
}
export type PreviewBackendPreference = "auto" | "canvas-2d" | "svg-dom";

export interface PreviewSettings {
  fpsCap: PreviewFpsCap;
  pauseWhenHidden: boolean;
  reducedMotion: boolean;
  backend: PreviewBackendPreference;
}

export interface PreviewDiagnostics {
  estimatedFps: number;
  frameTimeMs: number;
  timingValidity: "valid" | "unstable" | "invalid";
  clockState: "running" | "paused" | "hidden" | "exporting" | "static" | "reduced-motion";
}

export interface DebugSettings {
  substrateMode: SubstrateDebugMode;
  maskBounds: boolean;
  glyphOutlines: boolean;
  glyphBounds: boolean;
  baseline: boolean;
  glyphOrigins: boolean;
  markOrigins: boolean;
  emitter: boolean;
  waveField: boolean;
  markCount: boolean;
  frameTime: boolean;
  costEstimate: boolean;
}

export interface FontMetadata {
  family: string;
  fullName: string;
  fileName: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
}

export interface ProjectState {
  version: 5;
  text: string;
  fontSize: number;
  tracking: number;
  renderer: RendererId;
  seed: number;
  density: number;
  amplitude: number;
  frequency: number;
  turbulence: number;
  edgeInfluence: number;
  exportMode: ExportMode;
  exportFrameMode: ExportFrameMode;
  precision: number;
  maxNodes: number;
  substrateQuality: SubstrateQuality;
  preset: PresetId;
  emitter: GlyphEmitter;
  emitterMode: EmitterMode;
  emitters: GlyphEmitterInstance[];
  fieldBlendMode: FieldBlendMode;
  waveContourMode: WaveContourMode;
  waveDotSpacing: number;
  waveDotRadius: number;
  diffuserDomain: DiffuserDomainMode;
  diffuserComposition: DiffuserCompositionMode;
  diffuserDotRadius: number;
  diffuserRingContrast: number;
  ringSharpness: number;
  bandWidth: number;
  diffuserHaloPadding: number;
  textOverlayOpacity: number;
  edgeErosionAmount: number;
  edgeErosionWidth: number;
  interiorProtection: number;
  overlayMode: OverlayMode;
  outlineStrokeWidth: number;
  outlineWarpAmount: number;
  outlineWarpScale: number;
  outlineWarpSmoothing: number;
  outlineWarpEdgeBias: number;
  outlineWarpMaxDisplacement: number;
  preserveCounters: boolean;
  glyphFieldMode: GlyphFieldModulationMode;
  glyphFieldInfluence: number;
  glyphFieldDisplacement: number;
  glyphFieldDensity: number;
  glyphFieldRadius: number;
  glyphFieldOpacity: number;
  debug: DebugSettings;
  font: FontMetadata | null;
}

export interface RenderContext {
  timeMs: number;
  frame: number;
  textGeometry?: TextGeometry | null;
  substrateData?: SubstrateData | null;
  glyphField?: CompositeWaveField | null;
  sampleGlyphField?: (x: number, y: number) => number;
  sampleGlyphFieldGradient?: (x: number, y: number) => GlyphFieldGradient;
  glyphFieldDiagnostics?: GlyphFieldDiagnostics | null;
  viewport?: {
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
}
import type { TextGeometry } from "./engine/glyphGeometry";
import type { SubstrateData, SubstrateDebugMode } from "./engine/substrate/types";
import type { CompositeWaveField, GlyphFieldDiagnostics, GlyphFieldGradient } from "./engine/field/compositeWaveField";
