import type { ProjectState, RendererId } from "../types";

const GLYPH_MODULATION_RENDERERS = new Set<RendererId>(["sdf-halftone", "sdf-contours", "sdf-streamlines"]);

export interface ControlActivity {
  renderer: RendererId;
  overlayMode: ProjectState["overlayMode"];
  parsedFontPaths: boolean;
  glyphModulation: boolean;
  glyphDensityModulation: boolean;
  glyphRadiusModulation: boolean;
  glyphOpacityModulation: boolean;
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
