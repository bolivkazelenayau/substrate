import type { TextGeometry } from "./glyphGeometry";
import type { SubstrateBuildInput } from "./substrate";
import type { ProjectState } from "../types";
import { getRendererManifest } from "./renderers/rendererManifest";
import { emitterGeometryKey, rendererGeometryStateKey } from "./rendererRuntime";
import { glyphModulationCacheKey } from "./controlOwnership";
import type { RendererRequirements } from "./rendererRequirements";

export const SUBSTRATE_NOT_REQUIRED_KEY = "substrate:not-required";

function key(prefix: string, value: unknown): string {
  return `${prefix}:${JSON.stringify(value)}`;
}

/** Typography geometry inputs only — excludes renderer, debug, theme, and UI state. */
export function typographyStageKey(state: ProjectState, fontResourceKey: string): string {
  return key("typography-input", {
    text: state.text,
    font: fontResourceKey,
    fontSize: state.fontSize,
    lineHeight: state.lineHeight,
    tracking: state.tracking,
    kerningMode: state.kerningMode,
    kerningStrength: state.kerningStrength,
    opticalSpacing: state.opticalSpacing,
    opticalSpacingStrength: state.opticalSpacingStrength,
    textAlign: state.textAlign,
    textOffsetY: state.textOffsetY,
    precision: state.precision,
    artboard: state.artboard,
  });
}

/** Scene layout inputs only — excludes camera, diagnostics, and presentation. */
export function sceneLayoutStageKey(state: ProjectState, textGeometry: TextGeometry | null): string {
  return key("scene-layout-input", {
    artboard: state.artboard,
    fontSize: state.fontSize,
    text: state.text,
    textOffsetY: state.textOffsetY,
    lineHeight: state.lineHeight,
    tracking: state.tracking,
    textAlign: state.textAlign,
    textGeometryBounds: textGeometry?.bounds ?? null,
  });
}

/** Substrate raster inputs only. */
export function substrateStageKey(input: SubstrateBuildInput, typographyKey: string | null): string {
  return key("substrate-input", {
    typographyKey,
    sourceText: input.sourceText,
    fontSize: input.fontSize,
    tracking: input.tracking,
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    baselineY: input.baselineY,
    textX: input.textX,
    lineHeight: input.lineHeight,
    textAlign: input.textAlign,
    kerningMode: input.kerningMode,
    resolution: input.resolution,
    bounds: input.bounds,
    domainBounds: input.domainBounds,
    viewport: input.viewport,
  });
}

/** Project fields that affect substrate raster input construction. */
export function substrateProjectSliceKey(state: ProjectState): string {
  return key("substrate-project-slice", {
    text: state.text,
    fontSize: state.fontSize,
    tracking: state.tracking,
    lineHeight: state.lineHeight,
    textAlign: state.textAlign,
    kerningMode: state.kerningMode,
    substrateQuality: state.substrateQuality,
    font: state.font?.fileName ?? "native-fallback",
    renderer: state.renderer,
    amplitude: state.amplitude,
    overlayMode: state.overlayMode,
    outlineStrokeWidth: state.outlineStrokeWidth,
    outlineWarpAmount: state.outlineWarpAmount,
    outlineWarpScale: state.outlineWarpScale,
    outlineWarpSmoothing: state.outlineWarpSmoothing,
    outlineWarpEdgeBias: state.outlineWarpEdgeBias,
    outlineWarpMaxDisplacement: state.outlineWarpMaxDisplacement,
  });
}

/** Static render-context identity — excludes camera, diagnostics, and presentation. */
export function staticRenderContextStageKey(
  renderer: ProjectState["renderer"],
  requirements: Pick<RendererRequirements, "staticField" | "glyphField" | "substrate">,
  sceneKey: string,
  typographyOutputKey: string | null,
  substrateOutputKey: string | null,
  emitterKey: string,
): string {
  return key("static-context-input", {
    renderer,
    staticField: requirements.staticField,
    glyphField: requirements.glyphField,
    substrate: requirements.substrate,
    sceneKey,
    typographyOutputKey,
    substrateOutputKey: requirements.substrate ? substrateOutputKey : SUBSTRATE_NOT_REQUIRED_KEY,
    emitterKey,
  });
}

/** Renderer geometry identity — excludes camera, theme, diagnostics, and presentation. */
export function rendererGeometryStageKey(state: ProjectState, substrateIdentity: string, timeKey: string): string {
  const manifest = getRendererManifest(state.renderer);
  return key("renderer-geometry", {
    rendererState: rendererGeometryStateKey(state),
    substrateIdentity: manifest.usesSubstrate ? substrateIdentity : "unused",
    emitter: emitterGeometryKey(state, null),
    glyphModulation: glyphModulationCacheKey(state),
    time: manifest.usesTime ? timeKey : "0:0",
  });
}