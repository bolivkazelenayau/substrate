import { useMemo } from "react";
import type { TextGeometry } from "../engine/glyphGeometry";
import { SUBSTRATE_RESOLUTIONS } from "../engine/substrate";
import { getTextLayout } from "../engine/textLayout";
import type { ArtboardRect } from "../engine/sceneLayout";
import type { ProjectState } from "../types";
import { useSubstrateBackend } from "./useSubstrateBackend";
import { resolveContourDomain } from "../engine/contourDomain";
import { resolveTextBoundsModel } from "../engine/textBounds";
import { substrateBuildInputKey } from "../engine/exportAuthority";
import { SUBSTRATE_NOT_REQUIRED_KEY } from "../engine/pipelineStageKeys";
import { resolveRendererRequirements } from "../engine/rendererRequirements";
import { planSubstrateRaster } from "../engine/safetyBudget";

export function useSubstratePipeline(
  project: ProjectState,
  textGeometry: TextGeometry | null,
  typographyKey: string | null,
  effectiveArtboard: ArtboardRect,
) {
  const input = useMemo(() => {
    const layout = getTextLayout(project, Boolean(textGeometry?.hasOutlines));
    const bounds = resolveTextBoundsModel(project, textGeometry).inkBounds;
    const domain = resolveContourDomain(project, textGeometry, bounds, effectiveArtboard);
    const baseResolution = SUBSTRATE_RESOLUTIONS[project.substrateQuality];
    // The substrate raster aspect follows the EFFECTIVE scene rect (which is
    // symmetric around the authored center). The previous code divided by the
    // authored artboard width/height, which broke aspect ratio whenever the
    // effective rect grew. The effective rect already encodes the symmetric
    // bounds required to cover the authoritative artwork after canonical
    // placement.
    const requestedResolution = {
      width: Math.round(baseResolution.width * domain.resolutionScaleX),
      height: Math.round(baseResolution.width * effectiveArtboard.height / effectiveArtboard.width * domain.resolutionScaleY),
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
      // The substrate domain bounds are the EFFECTIVE rect (with origin). When
      // `resolveContourDomain` overscans for large-SDF renderers, the
      // resulting domain already includes non-zero x/y and remains compatible
      // with the effective rect contract.
      domainBounds: domain.bounds,
      viewport: { x: effectiveArtboard.x, y: effectiveArtboard.y, width: effectiveArtboard.width, height: effectiveArtboard.height },
    };
  }, [project, textGeometry, effectiveArtboard]);
  const requirements = resolveRendererRequirements(project.renderer);
  const inputKey = requirements.substrate
    ? substrateBuildInputKey(input, typographyKey)
    : SUBSTRATE_NOT_REQUIRED_KEY;
  return { ...useSubstrateBackend(input, inputKey, requirements.substrate), input, inputKey, required: requirements.substrate };
}