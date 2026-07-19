import type { ArtboardRect, AuthoredArtboard } from "./sceneLayout";

/**
 * Preview stage sizing relative to the authored artboard.
 *
 * The scene still uses the effective artboard as the SVG/canvas viewBox (so
 * multi-line line-height growth is fully contained and export stays correct).
 * But the *CSS size* of the stage must not fit the effective rect into the
 * frame — that zooms out when only vertical spacing grows and makes glyphs
 * look smaller while fontSize is unchanged.
 *
 * Instead: fit an authored-aspect host into the frame (stable scale), then size
 * the stage as (effective / authored) of that host. Glyph world size then maps
 * to a stable screen size; extra line-height only makes the stage taller.
 */
export function resolvePreviewStageScale(
  authored: AuthoredArtboard,
  effective: Pick<ArtboardRect, "width" | "height">,
) {
  const authoredWidth = Math.max(1, authored.width);
  const authoredHeight = Math.max(1, authored.height);
  const effectiveWidth = Math.max(1, effective.width);
  const effectiveHeight = Math.max(1, effective.height);
  return {
    authoredAspectRatio: authoredWidth / authoredHeight,
    effectiveAspectRatio: effectiveWidth / effectiveHeight,
    widthRatio: effectiveWidth / authoredWidth,
    heightRatio: effectiveHeight / authoredHeight,
  };
}
