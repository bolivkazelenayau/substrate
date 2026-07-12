import { useMemo, useRef } from "react";
import { getRenderer } from "../engine/renderers";
import { measure } from "../engine/performance";
import { traceDuplicateLiveRendererPrevented } from "../engine/pipelineTrace";
import {
  generateRendererGeometry,
  rendererGeometryStateKey,
  summarizeGeometry,
} from "../engine/rendererRuntime";
import {
  selectEstimateContext,
  selectExportContext,
} from "../engine/renderContextLifecycle";
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
  const liveRevisionKey = renderer.usesTime
    ? `${geometryKey}|${liveContext.timeMs}:${liveContext.frame}`
    : geometryKey;
  const lastLiveRevisionRef = useRef<{ key: string; geometry: ReturnType<typeof generateRendererGeometry> } | null>(null);
  const liveGeometry = useMemo(
    () => {
      const cached = lastLiveRevisionRef.current;
      if (cached?.key === liveRevisionKey) {
        traceDuplicateLiveRendererPrevented(liveRevisionKey);
        return cached.geometry;
      }
      const authoritativeContext = renderer.usesTime
        ? liveContext
        : { ...liveContext, timeMs: 0, frame: 0 };
      const liveTrace = traceStartSpan("renderer.runtime.live", { inputKey: liveRevisionKey });
      const timed = measure(() => generateRendererGeometry(project, authoritativeContext));
      recordPreviewGeometryBuild(timed.durationMs);
      liveTrace({ outputKey: timed.value.id, detail: { generationDurationMs: timed.durationMs, authority: "live" } });
      lastLiveRevisionRef.current = { key: liveRevisionKey, geometry: timed.value };
      return timed.value;
    },
    // Semantic renderer identity excludes presentation clock for static renderers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, liveRevisionKey, project],
  );
  const exportContext = selectExportContext(project, liveContext, staticContext);
  const staticExportGeometry = useMemo(
    () => {
      if (project.exportFrameMode !== "time-zero") return null;
      const exportTrace = traceStartSpan("renderer.runtime.export", { inputKey: geometryKey });
      const geometry = generateRendererGeometry(project, staticContext);
      exportTrace({ outputKey: geometry.id, detail: { authority: "export-time-zero" } });
      return geometry;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, project.exportFrameMode, staticContext],
  );
  const exportGeometry = project.exportFrameMode === "current"
    ? liveGeometry
    : staticExportGeometry!;
  const estimateContext = selectEstimateContext(staticContext);
  const estimateGeometry = useMemo(
    () => {
      const estimateTrace = traceStartSpan("renderer.runtime.estimate", { inputKey: geometryKey });
      const geometry = generateRendererGeometry(project, estimateContext);
      estimateTrace({ outputKey: geometry.id, detail: { authority: "estimate" } });
      return geometry;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, estimateContext],
  );
  const geometrySummary = useMemo(
    () => summarizeGeometry(exportGeometry),
    [exportGeometry],
  );

  return {
    geometryKey,
    liveGeometry,
    exportContext,
    exportGeometry,
    estimateContext,
    estimateGeometry,
    geometrySummary,
  };
}
