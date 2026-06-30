import { useMemo } from "react";
import { generateRendererGeometry, rendererGeometryStateKey } from "../engine/rendererRuntime";
import type { ProjectState, RenderContext } from "../types";

export function useRendererRuntime(project: ProjectState, context: RenderContext) {
  const geometryKey = rendererGeometryStateKey(project);
  const geometry = useMemo(
    () => generateRendererGeometry(project, context),
    [project, context],
  );
  return { geometryKey, geometry };
}
