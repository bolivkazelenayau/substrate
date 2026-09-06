import type { ProjectState, RendererId } from "../types";
import { supportsEmitterDisplay } from "./field/emitterDisplayResponse";
import { emitterMicroResponseCapability, isEmitterMicroResponseConfigured, supportsEmitterMicroResponse } from "./field/emitterMicroResponse";
import { glyphFalloffDisplacementCapability, isGlyphFalloffDisplacementConfigured, supportsGlyphFalloffDisplacement } from "./field/glyphFalloffDisplacement";
import { isDisplayDislocationActive } from "./displayDislocation";
import { getRendererManifest } from "./renderers/rendererManifest";

const GLYPH_MODULATION_RENDERERS = new Set<RendererId>(["sdf-halftone", "sdf-contours", "sdf-streamlines"]);

export type ControlCapability = "supported" | "unaffected" | "unsupported";

/**
 * The minimum shared vocabulary needed by controls that can be retained while
 * inactive. `enabledByState` is authored state; `active` is the state the
 * current pipeline can actually consume.
 */
export interface PipelineControlActivity {
  enabledByState: boolean;
  supported: boolean;
  active: boolean;
  retained: boolean;
  reason?: string;
  incompatibleWith?: string;
}

export interface ControlActivity {
  renderer: RendererId;
  overlayMode: ProjectState["overlayMode"];
  parsedFontPaths: boolean;
  glyphModulation: boolean;
  glyphDensityModulation: boolean;
  glyphRadiusModulation: boolean;
  glyphOpacityModulation: boolean;
  emitterDisplay: boolean;
  emitterMicroResponse: boolean;
  emitterMicroResponseCapability: ControlCapability;
  glyphFalloffDisplacement: boolean;
  glyphFalloffDisplacementCapability: ControlCapability;
  glyphMicroWarpActivity: PipelineControlActivity;
  glyphCalmWaterActivity: PipelineControlActivity;
  emitterDisplayActivity: PipelineControlActivity;
  emitterMicroResponseActivity: PipelineControlActivity;
  glyphFalloffDisplacementActivity: PipelineControlActivity;
  dotGrid: PipelineControlActivity;
  glyphDisplacement: PipelineControlActivity;
  displayDislocation: PipelineControlActivity;
  glyphMicroWarp: boolean;
  diffuser: boolean;
  overlay: boolean;
  outlineActive: boolean;
  edgeErosion: boolean;
  warp: boolean;
  outlineStrokeWidth: number;
  overlaySource: "parsed-font" | "native-fallback" | "none";
  effectiveOverlay: string;
  disabledReason?: string;
  affectingOutput: string[];
}

export function getControlActivity(state: ProjectState, parsedFontPaths: boolean): ControlActivity {
  const manifest = getRendererManifest(state.renderer);
  const displayDislocationRendererSupport = manifest.dependencies.includes("displayDislocation");
  const displayDislocationActive = isDisplayDislocationActive(state);
  const glyphDisplacementSupported = parsedFontPaths && manifest.glyphDomainDisplacement === "supported";
  const glyphDisplacementActive = state.glyphDisplacement.enabled
    && glyphDisplacementSupported
    && !displayDislocationActive;
  const glyphDisplacementReason = !state.glyphDisplacement.enabled
    ? "disabled"
    : displayDislocationActive
      ? "Display Dislocation is active and owns the SDF Halftone dot-domain stage"
      : !parsedFontPaths
        ? "requires a loaded outline font"
        : manifest.glyphDomainDisplacement !== "supported"
          ? "unsupported by the current renderer"
          : undefined;
  const glyphMicroWarpActive = state.glyphMicroWarp.enabled
    && parsedFontPaths
    && state.emitter.enabled
    && state.glyphMicroWarp.strength > 0
    && state.glyphMicroWarp.maxDisplacement > 0
    && (state.glyphMicroWarp.normalDisplacement > 0 || state.glyphMicroWarp.tangentialDisplacement > 0);
  const glyphMicroWarpReason = !state.glyphMicroWarp.enabled
    ? "disabled"
    : !parsedFontPaths
      ? "requires a loaded outline font"
      : !state.emitter.enabled
        ? "requires an active emitter"
        : !glyphMicroWarpActive
          ? "zero response"
          : undefined;
  const glyphCalmWaterActive = state.glyphCalmWater.enabled
    && parsedFontPaths
    && state.emitter.enabled
    && state.glyphCalmWater.strength > 0;
  const glyphCalmWaterReason = !state.glyphCalmWater.enabled
    ? "disabled"
    : !parsedFontPaths
      ? "requires a loaded outline font"
      : !state.emitter.enabled
        ? "requires an active emitter"
        : !glyphCalmWaterActive
          ? "zero response"
          : undefined;
  const emitterDisplayActive = supportsEmitterDisplay(state.renderer)
    && state.emitter.enabled
    && state.emitterDisplay.mode !== "field";
  const emitterDisplayReason = !supportsEmitterDisplay(state.renderer)
    ? "unsupported by the current renderer"
    : !state.emitter.enabled
      ? "requires an active emitter"
      : state.emitterDisplay.mode === "field"
        ? "legacy field placement"
        : undefined;
  const emitterMicroResponseActive = isEmitterMicroResponseConfigured(state);
  const emitterMicroResponseReason = !supportsEmitterMicroResponse(state.renderer)
    ? "unsupported by the current renderer"
    : !state.emitter.enabled
      ? "requires an active emitter"
      : !emitterMicroResponseActive
        ? "disabled or zero response"
        : undefined;
  const glyphFalloffActive = isGlyphFalloffDisplacementConfigured(state);
  const glyphFalloffReason = !supportsGlyphFalloffDisplacement(state.renderer)
    ? glyphFalloffDisplacementCapability(state.renderer) === "unaffected"
      ? "this renderer is intentionally unaffected"
      : "unsupported by the current renderer"
    : !glyphFalloffActive
      ? "disabled or zero response"
      : undefined;
  const dotGridSupported = state.renderer === "sdf-halftone";
  const dotGridActive = dotGridSupported && state.dotGrid.enabled;
  const dotGridReason = !dotGridSupported
    ? "requires the SDF Halftone renderer"
    : !state.dotGrid.enabled
      ? "disabled"
      : undefined;
  const displayDislocationReason = !state.displayDislocation.enabled
    ? "disabled"
    : !displayDislocationRendererSupport
      ? "requires the SDF Halftone renderer"
      : !state.dotGrid.enabled
        ? "requires the Dot matrix grid"
        : !state.emitter.enabled
          ? "requires an active emitter"
          : state.displayDislocation.displacementAmount <= 0 || state.displayDislocation.responseRadius <= 0
            ? "zero response"
            : undefined;
  const glyphModulation = GLYPH_MODULATION_RENDERERS.has(state.renderer);
  const diffuser = state.renderer === "glyph-diffuser";
  const overlay = diffuser && state.overlayMode !== "hidden";
  const outlineActive = overlay && state.overlayMode === "outline";
  const edgeErosion = overlay
    && state.diffuserComposition === "edge-eroded"
    && state.overlayMode !== "outline";
  const warpRequested = diffuser && state.overlayMode === "warped-outline";
  const warp = warpRequested && parsedFontPaths;
  const effectiveOverlay = warpRequested && !parsedFontPaths ? "solid fallback" : state.overlayMode;
  const overlaySource: "parsed-font" | "native-fallback" | "none" = !overlay
    ? "none"
    : parsedFontPaths
      ? "parsed-font"
      : "native-fallback";
  const affectingOutput = [
    diffuser ? "diffuser controls" : null,
    overlay ? "overlay controls" : null,
    outlineActive ? "outline controls" : null,
    glyphModulation ? "glyph modulation controls" : null,
    warp ? "outline warp controls" : null,
    edgeErosion ? "edge erosion controls" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    renderer: state.renderer,
    overlayMode: state.overlayMode,
    parsedFontPaths,
    glyphModulation,
    glyphDensityModulation: state.renderer === "sdf-halftone" || state.renderer === "sdf-streamlines",
    glyphRadiusModulation: state.renderer === "sdf-halftone",
    glyphOpacityModulation: state.renderer === "sdf-halftone",
    emitterDisplay: supportsEmitterDisplay(state.renderer),
    emitterMicroResponse: supportsEmitterMicroResponse(state.renderer),
    emitterMicroResponseCapability: emitterMicroResponseCapability(state.renderer),
    glyphFalloffDisplacement: supportsGlyphFalloffDisplacement(state.renderer),
    glyphFalloffDisplacementCapability: glyphFalloffDisplacementCapability(state.renderer),
    glyphMicroWarpActivity: {
      enabledByState: state.glyphMicroWarp.enabled,
      supported: parsedFontPaths,
      active: glyphMicroWarpActive,
      retained: state.glyphMicroWarp.enabled && !glyphMicroWarpActive,
      reason: glyphMicroWarpReason,
    },
    glyphCalmWaterActivity: {
      enabledByState: state.glyphCalmWater.enabled,
      supported: parsedFontPaths,
      active: glyphCalmWaterActive,
      retained: state.glyphCalmWater.enabled && !glyphCalmWaterActive,
      reason: glyphCalmWaterReason,
    },
    emitterDisplayActivity: {
      enabledByState: state.emitterDisplay.mode !== "field",
      supported: supportsEmitterDisplay(state.renderer),
      active: emitterDisplayActive,
      retained: state.emitterDisplay.mode !== "field" && !emitterDisplayActive,
      reason: emitterDisplayReason,
    },
    emitterMicroResponseActivity: {
      enabledByState: state.emitterMicroResponse.enabled || state.emitterMicroResponse.occupancy !== "legacy",
      supported: supportsEmitterMicroResponse(state.renderer),
      active: emitterMicroResponseActive,
      retained: (state.emitterMicroResponse.enabled || state.emitterMicroResponse.occupancy !== "legacy") && !emitterMicroResponseActive,
      reason: emitterMicroResponseReason,
    },
    glyphFalloffDisplacementActivity: {
      enabledByState: state.glyphFalloffDisplacement.mode !== "off",
      supported: supportsGlyphFalloffDisplacement(state.renderer),
      active: glyphFalloffActive,
      retained: state.glyphFalloffDisplacement.mode !== "off" && !glyphFalloffActive,
      reason: glyphFalloffReason,
    },
    dotGrid: {
      enabledByState: state.dotGrid.enabled,
      supported: dotGridSupported,
      active: dotGridActive,
      retained: state.dotGrid.enabled && !dotGridActive,
      reason: dotGridReason,
    },
    glyphDisplacement: {
      enabledByState: state.glyphDisplacement.enabled,
      supported: glyphDisplacementSupported,
      active: glyphDisplacementActive,
      retained: state.glyphDisplacement.enabled && !glyphDisplacementActive,
      reason: glyphDisplacementReason,
      incompatibleWith: displayDislocationActive && state.glyphDisplacement.enabled
        ? "Display Dislocation"
        : undefined,
    },
    displayDislocation: {
      enabledByState: state.displayDislocation.enabled,
      supported: displayDislocationRendererSupport,
      active: displayDislocationActive,
      retained: state.displayDislocation.enabled && !displayDislocationActive,
      reason: displayDislocationReason,
      incompatibleWith: displayDislocationActive && state.glyphDisplacement.enabled
        ? "Glyph Fragmentation"
        : undefined,
    },
    glyphMicroWarp: parsedFontPaths,
    diffuser,
    overlay,
    outlineActive,
    edgeErosion,
    warp,
    outlineStrokeWidth: Number.isFinite(state.outlineStrokeWidth) ? Math.max(0.25, state.outlineStrokeWidth) : 1.5,
    overlaySource,
    effectiveOverlay,
    disabledReason: warpRequested && !parsedFontPaths
      ? "warped outline requires parsed font paths"
      : !glyphModulation && state.renderer === "glyph-diffuser"
        ? "Glyph Modulation is owned by SDF Halftone, SDF Contours, and SDF Streamlines"
        : undefined,
    affectingOutput,
  };
}

export function glyphModulationCacheKey(state: ProjectState) {
  if (!GLYPH_MODULATION_RENDERERS.has(state.renderer)) return "glyph-modulation:inactive";
  return [
    state.glyphFieldMode,
    state.glyphFieldInfluence,
    state.glyphFieldDisplacement,
    state.glyphFieldDensity,
    state.glyphFieldRadius,
    state.glyphFieldOpacity,
  ].join("~");
}
