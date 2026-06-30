import { useMemo } from "react";
import type { LoadedFont } from "../engine/fontLoader";
import { layoutGlyphs } from "../engine/glyphLayout";
import { measure } from "../engine/performance";
import type { ProjectState } from "../types";

export function useTypographyGeometry(project: ProjectState, loadedFont: LoadedFont | null) {
  return useMemo(
    () => measure(() => loadedFont ? layoutGlyphs(project, loadedFont) : null),
    [project, loadedFont],
  );
}
