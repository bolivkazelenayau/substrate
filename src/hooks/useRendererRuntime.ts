import { useMemo } from "react";
import { measure } from "../engine/performance";
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
  const liveGeometry = useMemo(
    () => {
      const liveTrace = traceStartSpan("renderer.runtime.live", { inputKey: geometryKey });
      const timed = measure(() => generateRendererGeometry(project, liveContext));
      recordPreviewGeometryBuild(timed.durationMs);
      liveTrace({ outputKey: timed.value.id, detail: { generationDurationMs: timed.durationMs, authority: "live" } });
      return timed.value;
    },
    // Appearance-only project changes deliberately preserve geometry identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, liveContext],
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
