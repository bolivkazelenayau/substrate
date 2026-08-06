export type RendererId = "flow" | "ripple" | "dots" | "sdf-flow" | "sdf-streamlines" | "sdf-contours" | "sdf-halftone" | "wave-contours" | "glyph-diffuser";
export type ExportMode = "artwork" | "editable";
export type ExportFrameMode = "current" | "time-zero";
export type ArtboardOverflowMode = "clip" | "auto-grow";
export type SubstrateQuality = "low" | "medium" | "high" | "ultra";
export type PresetId = "Edge Current" | "Sonic Ripple" | "Signal Dust" | "SDF Current" | "Contour Thread" | "Topographic Type" | "Halftone Press" | "Glyph Ripple" | "Dotted Diffuser" | "Sonic Halftone" | "Sonic Contours" | "Sonic Stream" | "Sonic Diffuser" | "Sonic Warp" | "Sonic Interference" | "Counter Resonance" | "Split Field" | "Fragment Matrix" | "Display Dislocation" | "Custom";
export type FieldControlId = "density" | "amplitude" | "frequency" | "turbulence" | "edgeInfluence" | "maxNodes";
export type PreviewFpsCap = 24 | 30 | 60;
export type GlyphEmitterSourceMode = "center" | "centroid" | "counter-center" | "custom";
export type GlyphEmitterFalloff = "smoothstep" | "gaussian" | "linear";
export type GlyphEmitterBlendMode = "add" | "max";
export type EmitterDisplayMode = "field" | "distort" | "exclude" | "orbit";
export type EmitterOccupancyMode = "legacy" | "exclude-interior" | "disperse-exterior";
export type GlyphFalloffDisplacementMode = "off" | "contour-rings";
export type GlyphDisplacementMode = "warp" | "horizontal-slices" | "vertical-slices" | "grid" | "radial-sectors";
export type DisplayDislocationMode = "horizontal-bands" | "vertical-bands" | "blocks";
export type WaveContourMode = "continuous" | "dotted";
export type EmitterMode = "single" | "multiple";
export type FieldBlendMode = "add" | "max";
export type DiffuserDomainMode = "inside-text" | "halo" | "text-halo";
export type DiffuserCompositionMode = "clipped" | "behind-text" | "through-text" | "text-reactive" | "edge-eroded";
export type OverlayMode = "solid" | "outline" | "knockout" | "hidden" | "warped-outline";
export type GlyphFieldModulationMode = "off" | "subtle" | "strong";
export type KerningMode = "font" | "none";
export type TextAlign = "left" | "center" | "right";

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

export interface EmitterDisplaySettings {
  mode: EmitterDisplayMode;
  distortionStrength: number;
  distortionRadius: number;
  noiseScale: number;
  gridSize: number;
  gridAmount: number;
  interiorSuppression: number;
  edgeBias: number;
  orbitAmount: number;
  divergence: number;
}

/**
 * Fine, emitter-local response applied after a renderer has resolved a mark's
 * final footprint. This is deliberately independent from the released
 * `emitterDisplay` modes and from both glyph-domain displacement systems.
 */
export interface EmitterMicroResponseSettings {
  /** Enables positional microstructure and density breakup. */
  enabled: boolean;
  positionDetail: number;
  densityBreakup: number;
  detailScale: number;
  responseRadius: number;
  falloff: GlyphEmitterFalloff;
  maxDisplacement: number;
  occupancy: EmitterOccupancyMode;
  exteriorPush: number;
  tangentialFlow: number;
  divergence: number;
  exteriorShell: number;
}

/**
 * Post-candidate displacement driven by the authoritative glyph signed-distance
 * field. The disabled mode is an exact no-op and therefore preserves legacy
 * renderer geometry and export output.
 */
export interface GlyphFalloffDisplacementSettings {
  mode: GlyphFalloffDisplacementMode;
  /** Maximum world-space displacement at the glyph contour. */
  strength: number;
  /** Width of the signed-distance response band on either side of the contour. */
  fieldWidth: number;
  falloff: GlyphEmitterFalloff;
  /** Number of contour-following cycles across `fieldWidth`. */
  ringFrequency: number;
  /** Shapes broad waves into narrow, display-like crests. */
  ringSharpness: number;
}

/**
 * Fine, emitter-local deformation of parsed glyph contours. Unlike
 * `emitterMicroResponse`, this stage derives the authoritative typography
 * geometry before masks, SDFs, renderers, and export consume it.
 */
export interface GlyphMicroWarpSettings {
  enabled: boolean;
  /** Global, art-directable amount. Normal and tangent remain independent. */
  strength: number;
  responseRadius: number;
  falloff: GlyphEmitterFalloff;
  /** World-space wavelength of the coherent contour detail. */
  detailScale: number;
  detailOctaves: number;
  normalDisplacement: number;
  tangentialDisplacement: number;
  edgeTurbulence: number;
  /** Zero keeps continuous displacement; positive values create steps. */
  quantizationSteps: number;
  maxDisplacement: number;
  preserveCounters: boolean;
  seedInfluence: number;
}

/**
 * Authoring controls for the vector glyph-domain stage. These values affect
 * derived typography geometry, never already-generated renderer marks.
 */
export interface GlyphDisplacementSettings {
  enabled: boolean;
  mode: GlyphDisplacementMode;
  strength: number;
  responseRadius: number;
  falloff: GlyphEmitterFalloff;
  fragmentSize: number;
  gap: number;
  quantizationSteps: number;
  direction: number;
  /** -100 = tangential, 0 = authored direction, 100 = radial. */
  radialTangential: number;
  jitter: number;
  fragmentRotation: number;
  seedInfluence: number;
}

/** Regular world-grid rendering controls owned by SDF Halftone. */
export interface DotGridSettings {
  enabled: boolean;
  spacing: number;
  radius: number;
  threshold: number;
  edgeSoftness: number;
}

/**
 * Renderer-local inverse-domain displacement for SDF Halftone's regular dot
 * grid. This is deliberately independent from polygonal glyph fragmentation.
 */
export interface DisplayDislocationSettings {
  enabled: boolean;
  mode: DisplayDislocationMode;
  responseRadius: number;
  falloff: GlyphEmitterFalloff;
  displacementAmount: number;
  regionSize: number;
  gap: number;
  quantizationSteps: number;
  direction: number;
  /** Percentage chance that region parity, rather than seed noise, sets sign. */
  alternatingOffset: number;
  /** 0 = authored direction, 100 = radial push from the emitter. */
  radialBias: number;
  seed: number;
}
export type PreviewBackendPreference = "canvas-2d" | "svg-dom";
export type PreviewQuality = "full" | "balanced" | "performance";
export type DiagnosticsMode = "off" | "compact" | "full";

export interface PreviewSettings {
  fpsCap: PreviewFpsCap;
  pauseWhenHidden: boolean;
  reducedMotion: boolean;
  backend: PreviewBackendPreference;
  quality: PreviewQuality;
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
  version: 13;
  artboard: {
    width: number;
    height: number;
  };
  text: string;
  fontSize: number;
  lineHeight: number;
  tracking: number;
  kerningMode: KerningMode;
  kerningStrength: number;
  opticalSpacing: boolean;
  opticalSpacingStrength: number;
  textAlign: TextAlign;
  textOffsetY: number;
  renderer: RendererId;
  seed: number;
  density: number;
  amplitude: number;
  frequency: number;
  turbulence: number;
  edgeInfluence: number;
  exportMode: ExportMode;
  primaryColor: string;
  outlineColor: string;
  backgroundColor: string;
  transparentBackground: boolean;
  exportFrameMode: ExportFrameMode;
  precision: number;
  maxNodes: number;
  substrateQuality: SubstrateQuality;
  preset: PresetId;
  emitter: GlyphEmitter;
  emitterMode: EmitterMode;
  emitters: GlyphEmitterInstance[];
  emitterDisplay: EmitterDisplaySettings;
  emitterMicroResponse: EmitterMicroResponseSettings;
  glyphFalloffDisplacement: GlyphFalloffDisplacementSettings;
  glyphMicroWarp: GlyphMicroWarpSettings;
  glyphDisplacement: GlyphDisplacementSettings;
  dotGrid: DotGridSettings;
  displayDislocation: DisplayDislocationSettings;
  fieldBlendMode: FieldBlendMode;
  waveContourMode: WaveContourMode;
  contourStrokeWidth: number;
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
  /** Stable semantic identity for the text geometry consumed by renderers. */
  textGeometryKey?: string | null;
  substrateData?: SubstrateData | null;
  /** Stable semantic identity for the substrate output consumed by renderers. */
  substrateKey?: string | null;
  glyphField?: CompositeWaveField | null;
  sampleGlyphField?: (x: number, y: number) => number;
  sampleGlyphFieldGradient?: (x: number, y: number) => GlyphFieldGradient;
  glyphFieldDiagnostics?: GlyphFieldDiagnostics | null;
  viewport?: {
    x: number;
    y: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
}
import type { TextGeometry } from "./engine/glyphGeometry";
import type { SubstrateData, SubstrateDebugMode } from "./engine/substrate/types";
import type { CompositeWaveField, GlyphFieldDiagnostics, GlyphFieldGradient } from "./engine/field/compositeWaveField";
