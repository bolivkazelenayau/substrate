import { VIEWPORT } from "./constants";
import type { GlyphBounds, TextGeometry } from "./glyphGeometry";
import type { ProjectState } from "../types";
import { resolveTextBoundsModel } from "./textBounds";
import { artboardBounds } from "./artboard";
import type { ArtboardRect } from "./sceneLayout";

export interface ContourDomain {
  bounds: GlyphBounds;
  padding: number;
  resolutionScaleX: number;
  resolutionScaleY: number;
  expanded: boolean;
}

const LARGE_TYPE_DOMAIN_THRESHOLD = 220;
const MAX_DOMAIN_SCALE = 3;
const OVERSCANNED_RENDERERS = new Set<ProjectState["renderer"]>([
  "sdf-flow",
  "sdf-streamlines",
  "sdf-contours",
  "sdf-halftone",
  "wave-contours",
]);

export const TEXT_ARTBOARD_OVERFLOW_WARNING = "Text bounds exceed the artboard. Export will be clipped to the artboard viewBox.";

export function resolveSourceTextBounds(
  state: ProjectState,
  textGeometry: TextGeometry | null,
  reportedBounds: GlyphBounds | null = null,
): GlyphBounds {
  const model = resolveTextBoundsModel(state, textGeometry);
  return model.glyphUnionBounds ?? reportedBounds ?? model.inkBounds;
}

/**
 * Compares ink bounds against the AUTHORED artboard minimum. Used to surface
 * an authored-overflow warning. The effective rect grows to contain ink
 * deterministically; this authored-space check only informs diagnostics that
 * the artwork expanded past the persisted minimum.
 */
export function textBoundsExceedArtboard(
  bounds: GlyphBounds,
  artboard: { width: number; height: number } = { width: VIEWPORT.width, height: VIEWPORT.height },
) {
  return bounds.x < 0
    || bounds.y < 0
    || bounds.x + bounds.width > artboard.width
    || bounds.y + bounds.height > artboard.height;
}

export function getTextArtboardOverflowWarning(state: ProjectState, textGeometry: TextGeometry | null) {
  return textBoundsExceedArtboard(resolveSourceTextBounds(state, textGeometry), state.artboard)
    ? TEXT_ARTBOARD_OVERFLOW_WARNING
    : null;
}

/**
 * Resolve the substrate domain. For small typography and non-overscan
 * renderers, the domain is the effective scene rect (origin-aware). For
 * large-SDF renderers (OVERSCANNED_RENDERERS), the domain may overscan
 * further when the typography itself extends the artboard and the renderer
 * needs extra room for line/sampling spread.
 *
 * The `effectiveArtboard` becomes the base domain (origin-aware). The
 * previous authored-artboard-only domain (`artboardBounds(state.artboard)`)
 * is replaced entirely with the scene effective rect; this is what makes the
 * substrate raster span the same space the renderer iterates over.
 */
export function resolveContourDomain(
  state: ProjectState,
  textGeometry: TextGeometry | null,
  reportedBounds: GlyphBounds | null,
  effectiveArtboard?: ArtboardRect,
): ContourDomain {
  const effective = artboardBounds(effectiveArtboard ?? { x: 0, y: 0, width: state.artboard.width, height: state.artboard.height });
  if (state.fontSize <= LARGE_TYPE_DOMAIN_THRESHOLD || !OVERSCANNED_RENDERERS.has(state.renderer)) {
    return { bounds: effective, padding: 0, resolutionScaleX: 1, resolutionScaleY: 1, expanded: false };
  }

  const effectiveBounds = resolveSourceTextBounds(state, textGeometry, reportedBounds);
  const contourSpread = state.fontSize * (0.055 + state.amplitude / 44 * 0.065);
  const overlaySpread = state.overlayMode === "warped-outline"
    ? state.outlineWarpMaxDisplacement + state.outlineStrokeWidth / 2
    : state.outlineStrokeWidth / 2;
  const padding = Math.min(effective.width * 0.3, Math.max(24, contourSpread, overlaySpread));
  const desiredLeft = Math.min(effective.x, effectiveBounds.x - padding);
  const desiredTop = Math.min(effective.y, effectiveBounds.y - padding);
  const desiredRight = Math.max(effective.x + effective.width, effectiveBounds.x + effectiveBounds.width + padding);
  const desiredBottom = Math.max(effective.y + effective.height, effectiveBounds.y + effectiveBounds.height + padding);
  // Hard safety caps remain relative to the effective rect to preserve the
  // substrate domain's clamping semantics. The effective rect is the new
  // domain anchor; the hard caps grow proportionally with it.
  const hardLeft = effective.x - effective.width * (MAX_DOMAIN_SCALE - 1);
  const hardTop = effective.y - effective.height * (MAX_DOMAIN_SCALE - 1);
  const hardRight = effective.x + effective.width * (MAX_DOMAIN_SCALE - 1);
  const hardBottom = effective.y + effective.height * (MAX_DOMAIN_SCALE - 1);
  const left = Math.max(hardLeft, desiredLeft);
  const top = Math.max(hardTop, desiredTop);
  const right = Math.min(hardRight, desiredRight);
  const bottom = Math.min(hardBottom, desiredBottom);
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  return {
    bounds,
    padding,
    // Keep raster density/budget semantics stable: overscan expands world-space
    // coverage, not candidate density or maxNodes demand.
    resolutionScaleX: 1,
    resolutionScaleY: 1,
    expanded: bounds.x !== effective.x || bounds.y !== effective.y || bounds.width !== effective.width || bounds.height !== effective.height,
  };
}