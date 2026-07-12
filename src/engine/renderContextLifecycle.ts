import { artboardViewport, projectArtboard, type ArtboardViewport } from "./artboard";
import type { ArtboardRect } from "./sceneLayout";
import type { ProjectState, RenderContext } from "../types";
import { buildCompositeWaveField, createGlyphFieldContext } from "./field/compositeWaveField";
import type { RendererRequirements } from "./rendererRequirements";
import { tracePipelineStage } from "./pipelineTrace";
import { interactionTraceEnabled, traceKey, traceStartSpan } from "../dev/interactionTrace";

/**
 * Creates the stable render context representing frame 0. Decoupled from the
 * live animation clock to prevent regenerating static geometries.
 *
 * Production (`App` via `useSceneLayout`) always passes the resolved EFFECTIVE
 * scene rect so the render context honors non-zero origins. The optional
 * default falls back to the authored rect (origin zero); existing tests and
 * single-call production paths that do not grow the artboard behave
 * identically to the previous authored viewport.
 */
export function createStaticRenderContext(
  state: ProjectState,
  textGeometry: RenderContext["textGeometry"],
  substrateData: RenderContext["substrateData"],
  effectiveArtboard?: ArtboardRect,
  requirements?: Pick<RendererRequirements, "staticField" | "glyphField" | "substrate">,
): RenderContext {
  const contextTrace = traceStartSpan("field.static-context", {
    inputKey: interactionTraceEnabled ? traceKey({ renderer: state.renderer, artboard: state.artboard, effective: effectiveArtboard, text: state.text }) : undefined,
    detail: { renderer: state.renderer },
  });
  const viewport: ArtboardViewport = effectiveArtboard
    ? artboardViewport(effectiveArtboard)
    : projectArtboard(state);
  const base: RenderContext = {
    timeMs: 0,
    frame: 0,
    textGeometry,
    substrateData,
    viewport,
  };
  const needsField = requirements?.staticField || requirements?.glyphField;
  if (!needsField) {
    tracePipelineStage("field.static-context", "skipped", { reason: "capability-not-required" });
    contextTrace({
      outputKey: interactionTraceEnabled ? traceKey({ renderer: state.renderer, glyphField: null }) : undefined,
      counts: { fieldWidth: 0, fieldHeight: 0 },
    });
    return base;
  }
  tracePipelineStage("field.static-context", "required");
  const context = { ...base, ...createGlyphFieldContext(buildCompositeWaveField(state, base)) };
  contextTrace({
    outputKey: interactionTraceEnabled ? traceKey({ renderer: state.renderer, glyphField: context.glyphField?.worldBounds ?? null }) : undefined,
    counts: {
      fieldWidth: context.glyphField?.width ?? 0,
      fieldHeight: context.glyphField?.height ?? 0,
    },
  });
  return context;
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