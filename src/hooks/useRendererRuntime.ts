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

export function useRendererRuntime(
  project: ProjectState,
  liveContext: RenderContext,
  staticContext: RenderContext,
) {
  const geometryKey = rendererGeometryStateKey(project);
  const liveGeometry = useMemo(
    () => {
      const timed = measure(() => generateRendererGeometry(project, liveContext));
      recordPreviewGeometryBuild(timed.durationMs);
      return timed.value;
    },
    // Appearance-only project changes deliberately preserve geometry identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, liveContext],
  );
  const exportContext = selectExportContext(project, liveContext, staticContext);
  const staticExportGeometry = useMemo(
    () => project.exportFrameMode === "time-zero"
      ? generateRendererGeometry(project, staticContext)
      : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [geometryKey, project.exportFrameMode, staticContext],
  );
  const exportGeometry = project.exportFrameMode === "current"
    ? liveGeometry
    : staticExportGeometry!;
  const estimateContext = selectEstimateContext(staticContext);
  const estimateGeometry = useMemo(
    () => generateRendererGeometry(project, estimateContext),
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
