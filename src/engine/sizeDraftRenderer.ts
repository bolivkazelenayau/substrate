import { createStaticRenderContext } from "./renderContextLifecycle";
import type { GeometryGroup } from "./geometry";
import { getRenderer } from "./renderers";
import { summarizeGeometry } from "./rendererRuntime";
import { measure } from "./performance";
import { interactionTraceEnabled, traceStartSpan } from "../dev/interactionTrace";
import { SIZE_DRAFT_RENDERER_MAX_NODES } from "./sizeRendererDraftPolicy";
import type { ResolvedSceneLayout } from "./sceneLayout";
import type { ProjectState, RenderContext } from "../types";
import type { TextGeometry } from "./glyphGeometry";

/** Bounded renderer-aware draft preview. Traces as `renderer.draft`, not authoritative `renderer.build`. */
export function buildRendererAwareSizeDraftGeometry(
  committedState: ProjectState,
  draftFontSize: number,
  draftScene: ResolvedSceneLayout,
  textGeometry: TextGeometry | null,
  clock: Pick<RenderContext, "timeMs" | "frame">,
): GeometryGroup {
  const draftState: ProjectState = {
    ...committedState,
    fontSize: draftFontSize,
    maxNodes: Math.min(committedState.maxNodes, SIZE_DRAFT_RENDERER_MAX_NODES),
  };
  const staticContext = createStaticRenderContext(draftState, textGeometry, null, draftScene.effectiveArtboard);
  const renderContext: RenderContext = { ...staticContext, ...clock };
  const renderer = getRenderer(draftState.renderer);
  const draftTrace = traceStartSpan("renderer.draft", {
    inputKey: interactionTraceEnabled ? `draft:${draftState.renderer}:${draftFontSize}` : undefined,
    detail: { rendererId: renderer.id, draftFontSize, maxNodes: draftState.maxNodes },
  });
  const result = measure(() => renderer.generateGeometry(draftState, renderContext));
  const geometry = result.value;
  draftTrace({
    outputKey: geometry.id,
    frameKey: geometry.id,
    counts: {
      elements: geometry.geometries.length,
      points: summarizeGeometry(geometry).pointCount,
    },
    detail: {
      rendererId: renderer.id,
      generationDurationMs: result.durationMs,
      draftPreview: true,
    },
  });
  return {
    ...geometry,
    id: `${geometry.id}:draft-renderer:${draftFontSize}`,
    diagnostics: geometry.diagnostics
      ? { ...geometry.diagnostics, fallback: true }
      : geometry.diagnostics,
  };
}