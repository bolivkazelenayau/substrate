import type { ProjectState, RenderContext } from "../types";
import { VIEWPORT } from "./constants";
import { buildCompositeWaveField, createGlyphFieldContext } from "./field/compositeWaveField";

/**
 * Creates the stable render context representing frame 0.
 * Decoupled from the live animation clock to prevent regenerating static geometries.
 */
export function createStaticRenderContext(
  state: ProjectState,
  textGeometry: RenderContext["textGeometry"],
  substrateData: RenderContext["substrateData"]
): RenderContext {
  const base: RenderContext = {
    timeMs: 0,
    frame: 0,
    textGeometry,
    substrateData,
    viewport: VIEWPORT,
  };
  return { ...base, ...createGlyphFieldContext(buildCompositeWaveField(state, base)) };
}

/**
 * Selects the appropriate context for final or paused exports.
 */
export function selectExportContext(
  state: ProjectState,
  liveContext: RenderContext,
  staticContext: RenderContext
): RenderContext {
  return state.exportFrameMode === "current" ? liveContext : staticContext;
}

/**
 * Selects the context used to estimate geometry byte cost and validate limits.
 * Extracted as a test seam to strictly enforce identity stability across frames.
 */
export function selectEstimateContext(staticContext: RenderContext): RenderContext {
  return staticContext;
}
