import type { FieldControlId } from "../types";
import type { RendererDependencyKey } from "./renderers/rendererManifest";

export type ParameterClass =
  | "typography"
  | "scene"
  | "substrate"
  | "renderer-geometry"
  | "renderer-style"
  | "diagnostics-ui";

export type SemanticStage =
  | "typography"
  | "field"
  | "emitters"
  | "glyph-geometry"
  | "renderer"
  | "mark-response"
  | "appearance"
  | "preview-export"
  | "diagnostics";

export type ControlTier = "primary" | "advanced" | "diagnostic";

export interface ControlOwnershipDescriptor {
  stage: SemanticStage;
  owner: string;
  tier: ControlTier;
  shared: boolean;
  rendererLocal: boolean;
  rendererRequirements?: readonly RendererDependencyKey[];
  activeWhen?: string;
}

/**
 * Stable semantic identities for every authoring control. This is deliberately
 * descriptive rather than a generic form schema: panels use it to name the
 * owner and capability contract, while ProjectState remains the persistence
 * authority.
 */
export const CONTROL_OWNERSHIP = {
  text: { stage: "typography", owner: "Typography source", tier: "primary", shared: true, rendererLocal: false },
  font: { stage: "typography", owner: "Typography source", tier: "primary", shared: true, rendererLocal: false, activeWhen: "loaded outline font for exact glyph geometry" },
  fontSize: { stage: "typography", owner: "Typography source", tier: "primary", shared: true, rendererLocal: false },
  tracking: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  lineHeight: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  kerningMode: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  kerningStrength: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  textAlign: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  textOffsetY: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  opticalSpacing: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },
  opticalSpacingStrength: { stage: "typography", owner: "Typography layout", tier: "advanced", shared: true, rendererLocal: false },

  density: { stage: "field", owner: "Core field", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["field"] },
  amplitude: { stage: "field", owner: "Core field", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["field"] },
  frequency: { stage: "field", owner: "Core field detail", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field"] },
  turbulence: { stage: "field", owner: "Core field detail", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field"] },
  edgeInfluence: { stage: "field", owner: "Core field detail", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field"] },
  fieldBlendMode: { stage: "field", owner: "Emitter field composition", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },

  emitterMode: { stage: "emitters", owner: "Emitter sources", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.enabled": { stage: "emitters", owner: "Emitter field definition", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.glyphId": { stage: "emitters", owner: "Emitter source", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.sourceMode": { stage: "emitters", owner: "Emitter source", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.customX": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.customY": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitter.amplitude": { stage: "emitters", owner: "Emitter field definition", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.frequency": { stage: "emitters", owner: "Emitter field definition", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.phase": { stage: "emitters", owner: "Emitter field definition", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.radius": { stage: "emitters", owner: "Emitter field definition", tier: "primary", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.falloff": { stage: "emitters", owner: "Emitter field definition", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.selfInfluence": { stage: "emitters", owner: "Influence targeting", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitter.neighborInfluence": { stage: "emitters", owner: "Influence targeting", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["field", "emitters"] },
  "emitters[].glyphId": { stage: "emitters", owner: "Emitter source", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].enabled": { stage: "emitters", owner: "Emitter source", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].weight": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].phaseOffset": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].radiusMultiplier": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].influenceScope": { stage: "emitters", owner: "Influence targeting", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },
  "emitters[].neighborhoodSize": { stage: "emitters", owner: "Influence targeting", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["emitters"] },

  "glyphInfluence.radius": { stage: "glyph-geometry", owner: "Glyph Influence envelope", tier: "primary", shared: true, rendererLocal: false, activeWhen: "an emitter is enabled and a glyph-domain consumer is enabled" },
  "glyphInfluence.edgeSoftness": { stage: "glyph-geometry", owner: "Glyph Influence envelope", tier: "advanced", shared: true, rendererLocal: false, activeWhen: "an emitter is enabled and a glyph-domain consumer is enabled" },
  "glyphInfluence.falloff": { stage: "glyph-geometry", owner: "Glyph Influence envelope", tier: "advanced", shared: true, rendererLocal: false, activeWhen: "an emitter is enabled and a glyph-domain consumer is enabled" },
  "glyphMicroWarp.enabled": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.strength": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.*": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.enabled": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.strength": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.*": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.enabled": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.mode": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.*": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },

  renderer: { stage: "renderer", owner: "Renderer selection", tier: "primary", shared: false, rendererLocal: false },
  preset: { stage: "renderer", owner: "Preset recipe", tier: "primary", shared: false, rendererLocal: false },
  maxNodes: { stage: "renderer", owner: "Renderer safety budget", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["debug"] },
  waveContourMode: { stage: "renderer", owner: "Wave Contours", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  contourStrokeWidth: { stage: "renderer", owner: "Contour renderer", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  dotGrid: { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.*": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  glyphFieldMode: { stage: "renderer", owner: "SDF glyph modulation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"] },
  "glyphField.*": { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"] },
  diffuserDomain: { stage: "renderer", owner: "Glyph Diffuser", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserComposition: { stage: "renderer", owner: "Glyph Diffuser", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserDotRadius: { stage: "renderer", owner: "Glyph Diffuser", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserRingContrast: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  ringSharpness: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  bandWidth: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserHaloPadding: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  displayDislocation: { stage: "renderer", owner: "Display Dislocation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"] },
  "displayDislocation.*": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"] },

  emitterDisplay: { stage: "mark-response", owner: "Emitter Display Response", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.*": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  emitterMicroResponse: { stage: "mark-response", owner: "Emitter Micro Response", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.*": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  glyphFalloffDisplacement: { stage: "mark-response", owner: "Glyph Falloff Field", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.*": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },

  primaryColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  outlineColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  backgroundColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  transparentBackground: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  overlayMode: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  outlineStrokeWidth: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  textOverlayOpacity: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  edgeErosionAmount: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  edgeErosionWidth: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  interiorProtection: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  outlineWarpAmount: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpScale: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpSmoothing: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpEdgeBias: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpMaxDisplacement: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  preserveCounters: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },

  "preview.backend": { stage: "preview-export", owner: "Preview", tier: "primary", shared: false, rendererLocal: false },
  "preview.quality": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false },
  "preview.fpsCap": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false },
  "preview.reducedMotion": { stage: "preview-export", owner: "Preview", tier: "primary", shared: false, rendererLocal: false },
  "preview.pauseWhenHidden": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false },
  exportMode: { stage: "preview-export", owner: "Export", tier: "primary", shared: false, rendererLocal: false },
  exportFrameMode: { stage: "preview-export", owner: "Export", tier: "primary", shared: false, rendererLocal: false },
  precision: { stage: "preview-export", owner: "Export", tier: "advanced", shared: false, rendererLocal: false },
  "project.import": { stage: "preview-export", owner: "Project IO", tier: "advanced", shared: false, rendererLocal: false },
  diagnosticsMode: { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false },
  debug: { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false },
  "debug.*": { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false },
  "diagnostics.fps": { stage: "diagnostics", owner: "Performance instrumentation", tier: "diagnostic", shared: false, rendererLocal: false },
  "diagnostics.webgpu": { stage: "diagnostics", owner: "WebGPU field instrumentation", tier: "diagnostic", shared: false, rendererLocal: false },
} satisfies Record<string, ControlOwnershipDescriptor>;

export function getControlOwnership(id: string): ControlOwnershipDescriptor | undefined {
  const ownership = CONTROL_OWNERSHIP as Record<string, ControlOwnershipDescriptor>;
  const root = id.split(".")[0];
  return ownership[id] ?? ownership[`${root}.*`] ?? ownership[root];
}

/** Concise ownership map for active renderer controls (Part L). */
export const PARAMETER_OWNERSHIP: Record<string, ParameterClass> = {
  text: "typography",
  fontSize: "typography",
  textOffsetY: "scene",
  artboard: "scene",
  tracking: "typography",
  lineHeight: "typography",
  textAlign: "typography",
  seed: "renderer-geometry",
  density: "renderer-geometry",
  amplitude: "renderer-geometry",
  frequency: "renderer-geometry",
  turbulence: "renderer-geometry",
  edgeInfluence: "renderer-geometry",
  maxNodes: "renderer-geometry",
  substrateQuality: "substrate",
  primaryColor: "renderer-style",
  backgroundColor: "renderer-style",
  transparentBackground: "renderer-style",
  exportFrameMode: "diagnostics-ui",
};
