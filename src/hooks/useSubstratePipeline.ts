import { useMemo } from "react";
import type { TextGeometry } from "../engine/glyphGeometry";
import { SUBSTRATE_RESOLUTIONS } from "../engine/substrate";
import { getTextLayout } from "../engine/textLayout";
import type { ProjectState } from "../types";
import { useSubstrateBackend } from "./useSubstrateBackend";
import { resolveContourDomain } from "../engine/contourDomain";
import { resolveTextBoundsModel } from "../engine/textBounds";
import { projectArtboard } from "../engine/artboard";

export function useSubstratePipeline(project: ProjectState, textGeometry: TextGeometry | null) {
  const input = useMemo(() => {
    const layout = getTextLayout(project, Boolean(textGeometry?.hasOutlines));
    const bounds = resolveTextBoundsModel(project, textGeometry).inkBounds;
    const domain = resolveContourDomain(project, textGeometry, bounds);
    const baseResolution = SUBSTRATE_RESOLUTIONS[project.substrateQuality];
    const artboard = projectArtboard(project);
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
      resolution: {
        width: Math.round(baseResolution.width * domain.resolutionScaleX),
        height: Math.round(baseResolution.width * artboard.height / artboard.width * domain.resolutionScaleY),
      },
      bounds,
      domainBounds: domain.bounds,
      viewport: artboard,
    };
  }, [project, textGeometry]);
  return useSubstrateBackend(input);
}
