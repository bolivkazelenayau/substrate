import type { GeometryGroup } from "./geometry";
import {
  applySizeSceneTransformToGeometry,
  resolveSizeSceneTransform,
  sizeSceneTransformToSvg,
  type SizeSceneTransform,
} from "./sizeSceneTransform";
import type { ResolvedSceneLayout } from "./sceneLayout";

export const SIZE_DRAFT_PREVIEW_ELEMENT_CAP = 500;

export function buildSizeDraftPresentationGeometry(
  exact: GeometryGroup,
  sourceScene: ResolvedSceneLayout,
  sourceFontSize: number,
  targetScene: ResolvedSceneLayout,
  targetFontSize: number,
): GeometryGroup {
  const transform = resolveSizeSceneTransform(sourceScene, sourceFontSize, targetScene, targetFontSize);
  return applySizeSceneTransformToGeometry(exact, transform, SIZE_DRAFT_PREVIEW_ELEMENT_CAP);
}

export function sizeDraftPresentationTransform(
  sourceScene: ResolvedSceneLayout,
  sourceFontSize: number,
  targetScene: ResolvedSceneLayout,
  targetFontSize: number,
): string | undefined {
  const transform = resolveSizeSceneTransform(sourceScene, sourceFontSize, targetScene, targetFontSize);
  return sizeSceneTransformToSvg(transform);
}

export type { SizeSceneTransform };