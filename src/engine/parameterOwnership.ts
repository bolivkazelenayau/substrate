import type { FieldControlId, ProjectState } from "../types";
import type { RendererDependencyKey } from "./renderers/rendererManifest";
import { applyPreset, baseState, presets } from "./presets";

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

/** Product-facing destination. This is orthogonal to tier, capability,
 * activity, and the persisted ProjectState value. */
export type ProductSurface =
  | "PRIMARY"
  | "ADVANCED"
  | "TUNING"
  | "SAFETY"
  | "PERFORMANCE"
  | "DIAGNOSTICS"
  | "LEGACY";

export type SurfaceConfidence = "high" | "medium";

export interface ControlOwnershipDescriptor {
  stage: SemanticStage;
  owner: string;
  tier: ControlTier;
  productSurface: ProductSurface;
  shared: boolean;
  rendererLocal: boolean;
  rendererRequirements?: readonly RendererDependencyKey[];
  activeWhen?: string;
  confidence?: SurfaceConfidence;
  phase2Candidate?: boolean;
}

type ControlOwnershipInput = Omit<ControlOwnershipDescriptor, "productSurface"> & {
  productSurface?: ProductSurface;
};

/**
 * Stable semantic identities for every authoring control. This remains UI
 * metadata only: ProjectState is still the persistence and rendering
 * authority. Exact nested IDs are registered before wildcard feature IDs so
 * a control can move surfaces without changing its persisted meaning.
 */
const CONTROL_OWNERSHIP_DEFINITIONS = {
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
  "emitter.sourceMode": { stage: "emitters", owner: "Emitter source", tier: "advanced", shared: true, rendererLocal: false, rendererRequirements: ["emitters"] },
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
  "glyphMicroWarp.responseRadius": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.falloff": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.detailScale": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.normalDisplacement": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.tangentialDisplacement": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphMicroWarp.edgeTurbulence": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], confidence: "medium", phase2Candidate: true },
  "glyphMicroWarp.detailOctaves": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphMicroWarp.quantizationSteps": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphMicroWarp.maxDisplacement": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "SAFETY" },
  "glyphMicroWarp.preserveCounters": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "SAFETY" },
  "glyphMicroWarp.seedInfluence": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphMicroWarp.*": { stage: "glyph-geometry", owner: "Glyph Micro Warp", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.enabled": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.strength": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.frequencyLinked": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.frequencyMultiplier": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.wavelength": { stage: "glyph-geometry", owner: "Calm Water", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphCalmWater.surfaceVariation": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], confidence: "medium", phase2Candidate: true },
  "glyphCalmWater.drift": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], confidence: "medium", phase2Candidate: true },
  "glyphCalmWater.detail": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphCalmWater.preserveCounters": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "SAFETY" },
  "glyphCalmWater.*": { stage: "glyph-geometry", owner: "Calm Water", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.enabled": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.mode": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "primary", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },
  "glyphDisplacement.quantizationSteps": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphDisplacement.jitter": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], confidence: "medium", phase2Candidate: true },
  "glyphDisplacement.seedInfluence": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphDisplacement.*": { stage: "glyph-geometry", owner: "Glyph Fragmentation", tier: "advanced", shared: false, rendererLocal: false, rendererRequirements: ["textGeometry", "glyphDisplacement"] },

  renderer: { stage: "renderer", owner: "Renderer selection", tier: "primary", shared: false, rendererLocal: false },
  preset: { stage: "renderer", owner: "Preset recipe", tier: "primary", shared: false, rendererLocal: false },
  maxNodes: { stage: "renderer", owner: "Renderer safety budget", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["debug"], productSurface: "PERFORMANCE" },
  substrateQuality: { stage: "preview-export", owner: "Preview Performance", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  waveContourMode: { stage: "renderer", owner: "Wave Contours", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  contourStrokeWidth: { stage: "renderer", owner: "Contour renderer", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  dotGrid: { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.enabled": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.spacing": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.radius": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.threshold": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  "dotGrid.edgeSoftness": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["halftone"], confidence: "medium", phase2Candidate: true },
  "dotGrid.*": { stage: "renderer", owner: "SDF Halftone Dot Matrix", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["halftone"] },
  waveDotSpacing: { stage: "renderer", owner: "Wave Contours", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  waveDotRadius: { stage: "renderer", owner: "Wave Contours", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["contours"] },
  glyphFieldMode: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"] },
  glyphFieldInfluence: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"], productSurface: "TUNING", confidence: "high" },
  glyphFieldDisplacement: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"], productSurface: "TUNING", confidence: "high" },
  glyphFieldDensity: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"], productSurface: "TUNING", confidence: "high" },
  glyphFieldRadius: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"], productSurface: "TUNING", confidence: "high" },
  glyphFieldOpacity: { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"], productSurface: "TUNING", confidence: "high" },
  "glyphField.*": { stage: "renderer", owner: "SDF glyph modulation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphModulation"] },
  diffuserDomain: { stage: "renderer", owner: "Glyph Diffuser", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserComposition: { stage: "renderer", owner: "Glyph Diffuser", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserDotRadius: { stage: "renderer", owner: "Glyph Diffuser", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  diffuserRingContrast: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], confidence: "medium", phase2Candidate: true },
  ringSharpness: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], productSurface: "TUNING", confidence: "high" },
  bandWidth: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], confidence: "medium", phase2Candidate: true },
  diffuserHaloPadding: { stage: "renderer", owner: "Glyph Diffuser detail", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  displayDislocation: { stage: "renderer", owner: "Display Dislocation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"] },
  "displayDislocation.quantizationSteps": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"], productSurface: "TUNING", confidence: "high" },
  "displayDislocation.seed": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"], productSurface: "TUNING", confidence: "high" },
  "displayDislocation.alternatingOffset": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"], confidence: "medium", phase2Candidate: true },
  "displayDislocation.radialBias": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"], confidence: "medium", phase2Candidate: true },
  "displayDislocation.*": { stage: "renderer", owner: "Display Dislocation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["displayDislocation"] },

  emitterDisplay: { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.mode": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.distortionStrength": { stage: "mark-response", owner: "Emitter Display Response", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], confidence: "medium" },
  "emitterDisplay.distortionRadius": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.noiseScale": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], productSurface: "TUNING", confidence: "high" },
  "emitterDisplay.gridSize": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], productSurface: "TUNING", confidence: "high" },
  "emitterDisplay.gridAmount": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], productSurface: "TUNING", confidence: "high" },
  "emitterDisplay.edgeBias": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], productSurface: "TUNING", confidence: "high" },
  "emitterDisplay.interiorSuppression": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"], productSurface: "LEGACY", confidence: "high" },
  "emitterDisplay.orbitAmount": { stage: "mark-response", owner: "Emitter Display Response", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.divergence": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  "emitterDisplay.*": { stage: "mark-response", owner: "Emitter Display Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterDisplay"] },
  emitterMicroResponse: { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.enabled": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.occupancy": { stage: "mark-response", owner: "Emitter Micro Response", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.responseRadius": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.falloff": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.positionDetail": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], productSurface: "TUNING", confidence: "high" },
  "emitterMicroResponse.densityBreakup": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], productSurface: "TUNING", confidence: "high" },
  "emitterMicroResponse.detailScale": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], productSurface: "TUNING", confidence: "high" },
  "emitterMicroResponse.maxDisplacement": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], productSurface: "SAFETY", confidence: "high" },
  "emitterMicroResponse.exteriorShell": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  "emitterMicroResponse.exteriorPush": { stage: "mark-response", owner: "Disperse Exterior", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], confidence: "medium", phase2Candidate: true },
  "emitterMicroResponse.tangentialFlow": { stage: "mark-response", owner: "Disperse Exterior", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], confidence: "medium", phase2Candidate: true },
  "emitterMicroResponse.divergence": { stage: "mark-response", owner: "Disperse Exterior", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"], confidence: "medium", phase2Candidate: true },
  "emitterMicroResponse.*": { stage: "mark-response", owner: "Emitter Micro Response", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["emitterMicroResponse"] },
  glyphFalloffDisplacement: { stage: "mark-response", owner: "Glyph Falloff Field", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.mode": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.strength": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.fieldWidth": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.falloff": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.ringFrequency": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },
  "glyphFalloffDisplacement.ringSharpness": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"], productSurface: "TUNING", confidence: "high" },
  "glyphFalloffDisplacement.*": { stage: "mark-response", owner: "Glyph Falloff Field", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["glyphFalloffDisplacement"] },

  primaryColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  outlineColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  backgroundColor: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  transparentBackground: { stage: "appearance", owner: "Appearance", tier: "primary", shared: true, rendererLocal: false },
  overlayMode: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  outlineStrokeWidth: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  textOverlayOpacity: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  edgeErosionAmount: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"] },
  edgeErosionWidth: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], productSurface: "TUNING", confidence: "high" },
  interiorProtection: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], productSurface: "TUNING", confidence: "high" },
  outlineWarpAmount: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "primary", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpScale: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"] },
  outlineWarpSmoothing: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"], productSurface: "TUNING", confidence: "high" },
  outlineWarpEdgeBias: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"], productSurface: "TUNING", confidence: "high" },
  outlineWarpMaxDisplacement: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser", "warp"], productSurface: "SAFETY" },
  preserveCounters: { stage: "appearance", owner: "Glyph Diffuser presentation", tier: "advanced", shared: false, rendererLocal: true, rendererRequirements: ["diffuser"], productSurface: "SAFETY" },

  "preview.backend": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  "preview.quality": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  "preview.fpsCap": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  "preview.reducedMotion": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  "preview.pauseWhenHidden": { stage: "preview-export", owner: "Preview", tier: "advanced", shared: false, rendererLocal: false, productSurface: "PERFORMANCE" },
  exportMode: { stage: "preview-export", owner: "Export", tier: "primary", shared: false, rendererLocal: false },
  exportFrameMode: { stage: "preview-export", owner: "Export", tier: "primary", shared: false, rendererLocal: false },
  precision: { stage: "preview-export", owner: "Export", tier: "advanced", shared: false, rendererLocal: false },
  "project.import": { stage: "preview-export", owner: "Project IO", tier: "primary", shared: false, rendererLocal: false },
  diagnosticsMode: { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false, productSurface: "DIAGNOSTICS" },
  debug: { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false, productSurface: "DIAGNOSTICS" },
  "debug.*": { stage: "diagnostics", owner: "Diagnostics", tier: "diagnostic", shared: false, rendererLocal: false, productSurface: "DIAGNOSTICS" },
  "diagnostics.fps": { stage: "diagnostics", owner: "Performance instrumentation", tier: "diagnostic", shared: false, rendererLocal: false, productSurface: "DIAGNOSTICS" },
  "diagnostics.webgpu": { stage: "diagnostics", owner: "WebGPU field instrumentation", tier: "diagnostic", shared: false, rendererLocal: false, productSurface: "DIAGNOSTICS" },
} satisfies Record<string, ControlOwnershipInput>;

function productSurfaceFor(descriptor: ControlOwnershipInput): ProductSurface {
  if (descriptor.productSurface) return descriptor.productSurface;
  return descriptor.tier === "primary" ? "PRIMARY" : descriptor.tier === "diagnostic" ? "DIAGNOSTICS" : "ADVANCED";
}

export const CONTROL_OWNERSHIP = Object.fromEntries(
  Object.entries(CONTROL_OWNERSHIP_DEFINITIONS).map(([id, descriptor]) => [
    id,
    { ...descriptor, productSurface: productSurfaceFor(descriptor) },
  ]),
) as Record<string, ControlOwnershipDescriptor>;

export function getControlOwnership(id: string): ControlOwnershipDescriptor | undefined {
  const root = id.split(".")[0];
  return CONTROL_OWNERSHIP[id] ?? CONTROL_OWNERSHIP[`${root}.*`] ?? CONTROL_OWNERSHIP[root];
}

export function getProductSurface(id: string): ProductSurface | undefined {
  return getControlOwnership(id)?.productSurface;
}

/** High-confidence tuning rows are the only rows physically removed in Phase 1. */
export const HIGH_CONFIDENCE_TUNING_IDS = [
  "glyphMicroWarp.detailOctaves",
  "glyphMicroWarp.quantizationSteps",
  "glyphMicroWarp.seedInfluence",
  "glyphCalmWater.detail",
  "glyphDisplacement.quantizationSteps",
  "glyphDisplacement.seedInfluence",
  "glyphFieldInfluence",
  "glyphFieldDisplacement",
  "glyphFieldDensity",
  "glyphFieldRadius",
  "glyphFieldOpacity",
  "ringSharpness",
  "displayDislocation.quantizationSteps",
  "displayDislocation.seed",
  "emitterDisplay.noiseScale",
  "emitterDisplay.gridSize",
  "emitterDisplay.gridAmount",
  "emitterDisplay.edgeBias",
  "emitterMicroResponse.positionDetail",
  "emitterMicroResponse.densityBreakup",
  "emitterMicroResponse.detailScale",
  "glyphFalloffDisplacement.ringSharpness",
  "edgeErosionWidth",
  "interiorProtection",
  "outlineWarpSmoothing",
  "outlineWarpEdgeBias",
] as const;

export const PHASE_2_CANDIDATES = [
  { parameter: "glyphMicroWarp.edgeTurbulence", feature: "Micro Warp", currentDestination: "Advanced", reason: "Runtime evidence shows refinement of the same warp family, but a sweep must confirm it never creates a separate roughness family.", experiment: "Compare edge turbulence at matched strength/detail scale across parsed glyphs and renderers.", consequence: "Hiding it could remove a meaningful rough-versus-clean contour family." },
  { parameter: "glyphCalmWater.surfaceVariation", feature: "Calm Water", currentDestination: "Advanced", reason: "Variation changes secondary wave character, but the audit did not prove it creates a separate design intent.", experiment: "A/B zero, midpoint, and maximum variation at fixed strength and wavelength in diffuser and halftone renderers.", consequence: "Hiding it could reduce irregular water-surface references." },
  { parameter: "glyphCalmWater.drift", feature: "Calm Water", currentDestination: "Advanced", reason: "Drift is directional and visible in some scales, yet ordinary viewing often reads the same family.", experiment: "Compare drift extremes at matched rhythm and strength across multiline and single-line type.", consequence: "Hiding it could remove controlled directional surface motion." },
  { parameter: "glyphDisplacement.jitter", feature: "Fragmentation", currentDestination: "Advanced", reason: "Jitter changes regularity, but its separation from a future regularity macro is unresolved.", experiment: "Sweep jitter with gap, size, and mode held constant for slice, grid, and radial families.", consequence: "Hiding it could eliminate broken or irregular fragment references." },
  { parameter: "diffuserRingContrast", feature: "Glyph Diffuser", currentDestination: "Advanced", reason: "Preset recipes use it heavily, but the runtime comparison did not establish an independent ring intent.", experiment: "Compare contrast at fixed sharpness, band width, and domain across diffuser compositions.", consequence: "Hiding it could make soft-to-graphic ring matching less precise." },
  { parameter: "bandWidth", feature: "Glyph Diffuser", currentDestination: "Advanced", reason: "Band width can rescue a preset and may be more than a finish coefficient at extreme values.", experiment: "Sweep band width independently from ring contrast and halo padding at matched dot radius.", consequence: "Hiding it could make band-scale correction inaccessible." },
  { parameter: "dotGrid.edgeSoftness", feature: "Dot Matrix", currentDestination: "Advanced", reason: "Boundary softness is renderer-local and may materially correct glyph inclusion.", experiment: "Compare edge softness at threshold extremes and across small/large grid spacing.", consequence: "Hiding it could remove boundary-calibration control." },
  { parameter: "displayDislocation.alternatingOffset", feature: "Display Dislocation", currentDestination: "Advanced", reason: "Alternating parity creates visible band structure, but confidence remains medium pending comparison with direction and gap.", experiment: "Sweep parity at fixed region size, gap, direction, and radial bias in all three region modes.", consequence: "Hiding it could remove alternating-band compositions." },
  { parameter: "displayDislocation.radialBias", feature: "Display Dislocation", currentDestination: "Advanced", reason: "Emitter-relative direction is distinct in principle, but the audit requires a direct spatial comparison.", experiment: "Compare radial bias against authored direction for centered, custom, and multiple emitter anchors.", consequence: "Hiding it could remove emitter-relative dislocation flow." },
  { parameter: "emitterDisplay.distortionStrength", feature: "Emitter Display Response", currentDestination: "Advanced", reason: "The amount is product-facing but confidence is medium because behavior-specific amount semantics vary by mode.", experiment: "Compare matched amounts for field, distort, exclude, and orbit across supported renderers.", consequence: "Hiding it could make response intensity harder to author." },
  { parameter: "emitterMicroResponse.exteriorPush", feature: "Disperse Exterior", currentDestination: "Advanced", reason: "It is part of a meaningful exterior family, but its compound relationship with tangent flow and divergence is unresolved.", experiment: "Parameter-isolation sweep with occupancy fixed to Disperse Exterior and shell held constant.", consequence: "Hiding it could remove controllable exterior motion character." },
  { parameter: "emitterMicroResponse.tangentialFlow", feature: "Disperse Exterior", currentDestination: "Advanced", reason: "Tangential flow changes direction, but the audit has not proven a stable compound mapping.", experiment: "Compare tangent-only, push-only, and combined motion on counters and exterior silhouettes.", consequence: "Hiding it could remove rotational exterior flow." },
  { parameter: "emitterMicroResponse.divergence", feature: "Disperse Exterior", currentDestination: "Advanced", reason: "Divergence contributes to exterior spread but may be a lower-level character coefficient.", experiment: "Sweep divergence independently at matched push/tangent values and inspect mark-family changes.", consequence: "Hiding it could make outward spread correction inaccessible." },
] as const;

export const GLYPH_MODULATION_MACRO_RECIPES = {
  off: { glyphFieldInfluence: baseState.glyphFieldInfluence, glyphFieldDisplacement: baseState.glyphFieldDisplacement, glyphFieldDensity: baseState.glyphFieldDensity, glyphFieldRadius: baseState.glyphFieldRadius, glyphFieldOpacity: baseState.glyphFieldOpacity },
  subtle: { glyphFieldInfluence: 68, glyphFieldDisplacement: 9, glyphFieldDensity: 32, glyphFieldRadius: 45, glyphFieldOpacity: 20 },
  strong: { glyphFieldInfluence: 92, glyphFieldDisplacement: 22, glyphFieldDensity: 86, glyphFieldRadius: 45, glyphFieldOpacity: 20 },
} satisfies Record<ProjectState["glyphFieldMode"], Record<string, number>>;

export type SurfaceFeature =
  | "micro-warp"
  | "calm-water"
  | "fragmentation"
  | "glyph-modulation"
  | "glyph-diffuser"
  | "display-dislocation"
  | "emitter-display-response"
  | "emitter-micro-response"
  | "glyph-falloff"
  | "appearance"
  | "legacy-interior-suppression";

export type SurfaceState = "default" | "tuned" | "custom" | "legacy";

export interface ProductFeatureState {
  state: SurfaceState;
  changedParameterIds: readonly string[];
  hasNonDefaultValues: boolean;
}

const FEATURE_PARAMETER_IDS: Record<SurfaceFeature, readonly string[]> = {
  "micro-warp": ["glyphMicroWarp.edgeTurbulence", "glyphMicroWarp.detailOctaves", "glyphMicroWarp.quantizationSteps", "glyphMicroWarp.seedInfluence"],
  "calm-water": ["glyphCalmWater.surfaceVariation", "glyphCalmWater.drift", "glyphCalmWater.detail"],
  fragmentation: ["glyphDisplacement.quantizationSteps", "glyphDisplacement.jitter", "glyphDisplacement.seedInfluence"],
  "glyph-modulation": ["glyphFieldInfluence", "glyphFieldDisplacement", "glyphFieldDensity", "glyphFieldRadius", "glyphFieldOpacity"],
  "glyph-diffuser": ["diffuserRingContrast", "ringSharpness", "bandWidth"],
  "display-dislocation": ["displayDislocation.quantizationSteps", "displayDislocation.seed"],
  "emitter-display-response": ["emitterDisplay.noiseScale", "emitterDisplay.gridSize", "emitterDisplay.gridAmount", "emitterDisplay.edgeBias"],
  "emitter-micro-response": ["emitterMicroResponse.positionDetail", "emitterMicroResponse.densityBreakup", "emitterMicroResponse.detailScale"],
  "glyph-falloff": ["glyphFalloffDisplacement.ringSharpness"],
  appearance: ["edgeErosionWidth", "interiorProtection", "outlineWarpSmoothing", "outlineWarpEdgeBias"],
  "legacy-interior-suppression": ["emitterDisplay.interiorSuppression"],
};

function readPath(state: ProjectState, id: string): unknown {
  const parts = id.split(".");
  let value: unknown = state;
  for (const part of parts) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function expectedValue(state: ProjectState, recipe: ProjectState, id: string, feature: SurfaceFeature): unknown {
  if (feature === "glyph-modulation" && state.preset === "Custom") {
    return GLYPH_MODULATION_MACRO_RECIPES[state.glyphFieldMode][id as keyof typeof GLYPH_MODULATION_MACRO_RECIPES["off"]];
  }
  return readPath(recipe, id);
}

function knownPresetRecipe(state: ProjectState, feature: SurfaceFeature): ProjectState | undefined {
  if (state.preset !== "Custom") return applyPreset(baseState, state.preset);
  const ids = FEATURE_PARAMETER_IDS[feature];
  const builtInIds = Object.keys(presets) as Array<Exclude<ProjectState["preset"], "Custom">>;
  return builtInIds
    .map((preset) => applyPreset(baseState, preset))
    .find((recipe) => ids.every((id) => Object.is(readPath(state, id), expectedValue(state, recipe, id, feature))));
}

export function getProductFeatureState(state: ProjectState, feature: SurfaceFeature): ProductFeatureState {
  const knownRecipe = knownPresetRecipe(state, feature);
  const recipe = knownRecipe ?? baseState;
  const ids = FEATURE_PARAMETER_IDS[feature];
  const changedParameterIds = ids.filter((id) => !Object.is(readPath(state, id), expectedValue(state, recipe, id, feature)));
  const differsFromBase = ids.some((id) => !Object.is(readPath(state, id), readPath(baseState, id)));
  const legacyActive = feature === "legacy-interior-suppression"
    && state.emitterDisplay.mode !== "field"
    && state.emitterDisplay.interiorSuppression > 0;
  const canonicalMacro = feature === "glyph-modulation" && state.preset === "Custom" && changedParameterIds.length === 0;
  const hasNonDefaultValues = changedParameterIds.length > 0 || (differsFromBase && !canonicalMacro) || legacyActive;
  return {
    state: legacyActive ? "legacy" : !hasNonDefaultValues ? "default" : state.preset === "Custom" && !knownRecipe ? "custom" : "tuned",
    changedParameterIds,
    hasNonDefaultValues,
  };
}

/** Concise legacy map retained for existing consumers. */
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

// Keep the historical type import part of the public module surface for
// consumers that used FieldControlId while reading this ownership module.
export type { FieldControlId };
