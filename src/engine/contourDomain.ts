import { VIEWPORT } from "./constants";
import type { GlyphBounds, TextGeometry } from "./glyphGeometry";
import type { ProjectState } from "../types";
import { resolveTextBoundsModel } from "./textBounds";
import { artboardBounds, projectArtboard } from "./artboard";

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

export function resolveContourDomain(
  state: ProjectState,
  textGeometry: TextGeometry | null,
  reportedBounds: GlyphBounds | null,
): ContourDomain {
  const viewport = projectArtboard(state);
  const artboard = artboardBounds(state.artboard);
  if (state.fontSize <= LARGE_TYPE_DOMAIN_THRESHOLD || !OVERSCANNED_RENDERERS.has(state.renderer)) {
    return { bounds: artboard, padding: 0, resolutionScaleX: 1, resolutionScaleY: 1, expanded: false };
  }

  const effectiveBounds = resolveSourceTextBounds(state, textGeometry, reportedBounds);
  const contourSpread = state.fontSize * (0.055 + state.amplitude / 44 * 0.065);
  const overlaySpread = state.overlayMode === "warped-outline"
    ? state.outlineWarpMaxDisplacement + state.outlineStrokeWidth / 2
    : state.outlineStrokeWidth / 2;
  const padding = Math.min(viewport.width * 0.3, Math.max(24, contourSpread, overlaySpread));
  const desiredLeft = Math.min(0, effectiveBounds.x - padding);
  const desiredTop = Math.min(0, effectiveBounds.y - padding);
  const desiredRight = Math.max(viewport.width, effectiveBounds.x + effectiveBounds.width + padding);
  const desiredBottom = Math.max(viewport.height, effectiveBounds.y + effectiveBounds.height + padding);
  const hardLeft = -viewport.width;
  const hardTop = -viewport.height;
  const hardRight = viewport.width * (MAX_DOMAIN_SCALE - 1);
  const hardBottom = viewport.height * (MAX_DOMAIN_SCALE - 1);
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
    expanded: bounds.x !== 0 || bounds.y !== 0 || bounds.width !== viewport.width || bounds.height !== viewport.height,
  };
}
