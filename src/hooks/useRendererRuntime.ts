import { useMemo } from "react";
import { getRenderer } from "../engine/renderers";
import { measure } from "../engine/performance";
import { tracePipelineStage } from "../engine/pipelineTrace";
import {
  generateRendererGeometry,
  rendererGeometryCacheKey,
  rendererGeometryStateKey,
  summarizeGeometry,
} from "../engine/rendererRuntime";
import { selectEstimateContext } from "../engine/renderContextLifecycle";
import { recordPreviewGeometryBuild } from "../engine/previewRuntimeDiagnostics";
import type { ProjectState, RenderContext } from "../types";
import { traceStartSpan } from "../dev/interactionTrace";

export function useRendererRuntime(
  project: ProjectState,
  liveContext: RenderContext,
  staticContext: RenderContext,
) {
  const geometryKey = rendererGeometryStateKey(project);
  const renderer = getRenderer(project.renderer);
  // Live revision identity must include every geometry input the renderer consumes:
  // project scalar state, viewport, substrate output identity, text/glyph geometry
  // identity, and (for animated renderers) the presentation clock. A single semantic
  // key is the authority; no mutable ref cache is consulted.
  const liveRevisionKey = `${geometryKey}|${rendererGeometryCacheKey(project, liveContext)}`;
  const liveGeometry = useMemo(
    () => {
      const authoritativeContext = renderer.usesTime
        ? liveContext
        : { ...liveContext, timeMs: 0, frame: 0 };
      const liveTrace = traceStartSpan("renderer.runtime.live", { inputKey: liveRevisionKey });
      const timed = measure(() => generateRendererGeometry(project, authoritativeContext));
      recordPreviewGeometryBuild(timed.durationMs);
      liveTrace({ outputKey: timed.value.id, detail: { generationDurationMs: timed.durationMs, authority: "live" } });
      return timed.value;
    },
    // Semantic renderer identity includes context-dependent inputs for static renderers.
    // `liveRevisionKey` is the single authority; no mutable ref cache is needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, liveRevisionKey, project],
  );
  // Static (time-zero / estimate) geometry is shared: both consumers read the
  // same authoritative static context, so a single memo removes one of the
  // three flow-geometry regeneration sites noted in the architecture audit.
  const staticGeometry = useMemo(
    () => {
      const staticTrace = traceStartSpan("renderer.runtime.static", { inputKey: geometryKey });
      const geometry = generateRendererGeometry(project, staticContext);
      staticTrace({ outputKey: geometry.id, detail: { authority: "static" } });
      return geometry;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, staticContext],
  );
  const exportGeometry = project.exportFrameMode === "current" ? liveGeometry : staticGeometry;
  const estimateContext = selectEstimateContext(staticContext);
  const estimateGeometry = staticGeometry;
  const geometrySummary = useMemo(
    () => summarizeGeometry(exportGeometry),
    [exportGeometry],
  );

  return {
    geometryKey,
    liveGeometry,
    exportGeometry,
    estimateContext,
    estimateGeometry,
    geometrySummary,
  };
}
