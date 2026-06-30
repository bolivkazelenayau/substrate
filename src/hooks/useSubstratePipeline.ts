import { useMemo } from "react";
import { VIEWPORT } from "../engine/constants";
import type { TextGeometry } from "../engine/glyphGeometry";
import { SUBSTRATE_RESOLUTIONS } from "../engine/substrate";
import { getTextBounds, getTextLayout } from "../engine/textLayout";
import type { ProjectState } from "../types";
import { useSubstrateBackend } from "./useSubstrateBackend";

export function useSubstratePipeline(project: ProjectState, textGeometry: TextGeometry | null) {
  const input = useMemo(() => {
    const layout = getTextLayout(project, Boolean(textGeometry?.hasOutlines));
    return {
      sourceText: project.text,
      textGeometry,
      fontSize: project.fontSize,
      tracking: project.tracking,
      fontFamily: layout.fontFamily,
      fontWeight: layout.fontWeight,
      baselineY: layout.baselineY,
      textX: layout.x,
      kerningMode: project.kerningMode,
      resolution: SUBSTRATE_RESOLUTIONS[project.substrateQuality],
      bounds: textGeometry?.bounds ?? getTextBounds(project),
      viewport: VIEWPORT,
    };
  }, [project, textGeometry]);
  return useSubstrateBackend(input);
}
