import { useMemo } from "react";
import type { TextGeometry } from "../engine/glyphGeometry";
import { SUBSTRATE_RESOLUTIONS } from "../engine/substrate";
import { getTextLayout } from "../engine/textLayout";
import type { ProjectState } from "../types";
import { useSubstrateBackend } from "./useSubstrateBackend";
import { resolveContourDomain } from "../engine/contourDomain";
import { resolveTextBoundsModel } from "../engine/textBounds";
import { projectArtboard } from "../engine/artboard";
import { substrateBuildInputKey } from "../engine/exportAuthority";
import { planSubstrateRaster } from "../engine/safetyBudget";

export function useSubstratePipeline(project: ProjectState, textGeometry: TextGeometry | null, typographyKey: string | null) {
  const input = useMemo(() => {
    const layout = getTextLayout(project, Boolean(textGeometry?.hasOutlines));
    const bounds = resolveTextBoundsModel(project, textGeometry).inkBounds;
    const domain = resolveContourDomain(project, textGeometry, bounds);
    const baseResolution = SUBSTRATE_RESOLUTIONS[project.substrateQuality];
    const artboard = projectArtboard(project);
    const requestedResolution = {
      width: Math.round(baseResolution.width * domain.resolutionScaleX),
      height: Math.round(baseResolution.width * artboard.height / artboard.width * domain.resolutionScaleY),
    };
    const rasterPlan = planSubstrateRaster({ requestedWidth: requestedResolution.width, requestedHeight: requestedResolution.height });
    return {
      sourceText: project.text,
      textGeometry,
      fontSize: project.fontSize,
      tracking: project.tracking,
      fontFamily: layout.fontFamily,
      fontWeight: layout.fontWeight,
      baselineY: layout.baselineY,
      textX: layout.x,
      lineHeight: project.lineHeight,
      textAlign: project.textAlign,
      kerningMode: project.kerningMode,
      resolution: { width: rasterPlan.width, height: rasterPlan.height },
      rasterPlan,
      bounds,
      domainBounds: domain.bounds,
      viewport: artboard,
    };
  }, [project, textGeometry]);
  const inputKey = substrateBuildInputKey(input, typographyKey);
  return { ...useSubstrateBackend(input, inputKey), input, inputKey };
}
