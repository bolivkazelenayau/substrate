import { ARTBOARD_LIMITS } from "./artboard";
import type { GlyphBounds, TextGeometry } from "./glyphGeometry";
import { resolveTextBoundsModel } from "./textBounds";
import type { ProjectState } from "../types";

/**
 * The user-authored artboard minimum. Persisted in the ProjectState document
 * (schema v8). Effective artboard geometry is never persisted: it is re-derived
 * from this authored minimum plus the current authoritative artwork bounds on
 * every production resolve. Existing saved dimensions are treated as the
 * authored baseline exactly as saved — they are not repaired, shrunk, or
 * re-grown by the runtime.
 */
export interface AuthoredArtboard {
  width: number;
  height: number;
}

/**
 * Full artboard rect with explicit origin. The authored artboard always has
 * origin `(0, 0)`. The effective artboard may have non-zero (often negative)
 * x/y when the authoritative artwork grows beyond the authored minimum.
 */
export interface ArtboardRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Bounds = GlyphBounds;

export interface TypographyPlacement {
  /** Canonical placement-box origin relative to authored artboard center. */
  canonicalOrigin: Point;
  /** Canonical baseline at `textOffsetY === 0`, derived from authored center. */
  canonicalBaseline: number;
  /** Persisted user-authored displacement delta. */
  authoredOffset: Point;
  /** Resolved origin after applying `authoredOffset`. */
  resolvedOrigin: Point;
  /** Resolved baseline after applying `authoredOffset.y`. */
  resolvedBaseline: number;
  /** Stable layout-box bounds (compositional box) used as placement authority. */
  layoutBounds: Bounds;
  /** Authoritative ink/glyph bounds after resolution. Used for containment. */
  inkBounds: Bounds;
  /** Union of layout + ink arrival bounds. */
  placementBounds: Bounds;
  /** Stable identity for invalidation/keys. */
  key: string;
}

export interface ResolvedSceneLayout {
  authoredArtboard: AuthoredArtboard;
  authoredArtboardRect: ArtboardRect;
  effectiveArtboard: ArtboardRect;
  typography: TypographyPlacement;
  artworkBounds: Bounds;
  containmentPadding: number;
  expandedX: boolean;
  expandedY: boolean;
  /** True when the computed effective rect was clamped against ARTBOARD_LIMITS.max. */
  safetyLimitHit: boolean;
  key: string;
}

export const SCENE_SAFETY_LIMIT_WARNING = "Author artwork cannot be fully contained within the safe artboard limits; export is clipped to the maximum safe rect.";

/**
 * The canonical vertical placement-box height factor. Matches the
 * `fontSize * 1.18` layout-box convention used by `glyphLayout.ts` and
 * `textLayout.ts` so the canonical placement is verifiably "layout-box
 * centered on the authored artboard center".
 */
export const TYPOGRAPHY_PLACEMENT_BOX_HEIGHT_FACTOR = 1.18;

/**
 * Canonical baseline offset above the authored center, expressed as a
 * fraction of `fontSize`. Derived from the placement-box height factor:
 * the layout-box center for a single line sits at
 * `baselineY - fontSize + (heightFactor * fontSize) / 2`
 * = `baselineY - (1 - heightFactor / 2) * fontSize`.
 * Setting that center to `authoredCenterY` yields
 * `canonicalBaseline = authoredCenterY + (1 - heightFactor / 2) * fontSize`.
 */
export const TYPOGRAPHY_CANONICAL_BASELINE_FACTOR = 1 - TYPOGRAPHY_PLACEMENT_BOX_HEIGHT_FACTOR / 2;

/**
 * Deterministic numeric rounding for scene geometry. Avoids floating-point
 * key churn across re-resolutions of the same authored input.
 */
export function roundSceneNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Containment padding around the authoritative artwork bounds. Independent
 * of the current artboard dimensions so growth cannot create a feedback loop.
 * Matches the previous `planArtboardExpansionToText` padding contract.
 */
export function resolveContainmentPadding(state: ProjectState): number {
  return Math.max(48, state.fontSize * 0.08);
}

export function artboardLeft(rect: ArtboardRect): number {
  return rect.x;
}

export function artboardRight(rect: ArtboardRect): number {
  return rect.x + rect.width;
}

export function artboardTop(rect: ArtboardRect): number {
  return rect.y;
}

export function artboardBottom(rect: ArtboardRect): number {
  return rect.y + rect.height;
}

export function artboardCenter(rect: ArtboardRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function artboardCenterX(rect: ArtboardRect): number {
  return rect.x + rect.width / 2;
}

export function artboardCenterY(rect: ArtboardRect): number {
  return rect.y + rect.height / 2;
}

/**
 * Convert a world point to normalized artboard coordinates `[0, 1]` along
 * both axes. Out-of-rect points are clamped to the rect's extent.
 */
export function worldToArtboardNormalized(rect: ArtboardRect, point: Point): Point {
  const nx = rect.width > 0 ? (point.x - rect.x) / rect.width : 0;
  const ny = rect.height > 0 ? (point.y - rect.y) / rect.height : 0;
  return { x: Math.max(0, Math.min(1, nx)), y: Math.max(0, Math.min(1, ny)) };
}

/**
 * Convert normalized `[0, 1]` artboard coordinates back to world space.
 */
export function artboardNormalizedToWorld(rect: ArtboardRect, point: Point): Point {
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}

/**
 * Clamp a world point to the artboard rect's extent.
 */
export function clampPointToArtboard(rect: ArtboardRect, point: Point): Point {
  return {
    x: Math.max(rect.x, Math.min(rect.x + rect.width, point.x)),
    y: Math.max(rect.y, Math.min(rect.y + rect.height, point.y)),
  };
}

/**
 * Local (rect-relative) coordinates for occupancy/cell indexing. Per the
 * scene contract, occupancy and sampling must index by `worldX - rect.x`
 * / `worldY - rect.y` — never by the raw world coordinate.
 */
export function worldToLocal(rect: ArtboardRect, point: Point): Point {
  return { x: point.x - rect.x, y: point.y - rect.y };
}

export function authoredArtboardRect(authored: AuthoredArtboard): ArtboardRect {
  return { x: 0, y: 0, width: authored.width, height: authored.height };
}

/**
 * Canonical typographic baseline for the authored artboard center, before
 * the user-authored `textOffsetY` displacement is applied. Stable across
 * round trips because `authoredArtboard.height` (persisted authored input)
 * is the only geometrical input, and `fontSize` is also an authored input.
 */
export function canonicalBaselineAtAuthoredCenter(
  authoredCenterY: number,
  fontSize: number,
): number {
  return authoredCenterY + TYPOGRAPHY_CANONICAL_BASELINE_FACTOR * fontSize;
}

function emptyBounds(point: Point): Bounds {
  return { x: point.x, y: point.y, width: 0, height: 0 };
}

function union(a: Bounds, b: Bounds): Bounds {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) };
}

/**
 * Resolve the full scene layout from `ProjectState` plus the current
 * authoritative typography geometry. This is the single production authority
 * for typography placement, effective artboard rect, and scene identity.
 *
 * The resolver is pure: it never writes back to `ProjectState`. The
 * `authoredOffset.y` (`state.textOffsetY`) is interpreted strictly as a
 * user-authored displacement delta; it is never rewritten for containment,
 * Size changes, font changes, or auto-grow.
 */
export function resolveSceneLayout(
  state: ProjectState,
  textGeometry: TextGeometry | null,
): ResolvedSceneLayout {
  const authored: AuthoredArtboard = {
    width: state.artboard.width,
    height: state.artboard.height,
  };
  const authoredRect = authoredArtboardRect(authored);
  const authoredCenterXValue = authored.width / 2;
  const authoredCenterYValue = authored.height / 2;
  const authoredCenter: Point = { x: authoredCenterXValue, y: authoredCenterYValue };

  const canonicalBaseline = canonicalBaselineAtAuthoredCenter(authoredCenterYValue, state.fontSize);
  const canonicalOrigin: Point = { x: authoredCenterXValue, y: canonicalBaseline };
  const authoredOffset: Point = { x: 0, y: state.textOffsetY };
  const resolvedOrigin: Point = {
    x: canonicalOrigin.x + authoredOffset.x,
    y: canonicalOrigin.y + authoredOffset.y,
  };
  const resolvedBaseline = canonicalBaseline + authoredOffset.y;

  const boundsModel = resolveTextBoundsModel(state, textGeometry);
  const layoutBounds = boundsModel.layoutBounds;
  const inkBounds = boundsModel.inkBounds;
  const placementBounds = union(layoutBounds, inkBounds);

  const padding = resolveContainmentPadding(state);

  const paddedLeft = placementBounds.x - padding;
  const paddedRight = placementBounds.x + placementBounds.width + padding;
  const paddedTop = placementBounds.y - padding;
  const paddedBottom = placementBounds.y + placementBounds.height + padding;

  const halfWidth = Math.max(
    authored.width / 2,
    authoredCenterXValue - paddedLeft,
    paddedRight - authoredCenterXValue,
  );
  const halfHeight = Math.max(
    authored.height / 2,
    authoredCenterYValue - paddedTop,
    paddedBottom - authoredCenterYValue,
  );

  const growthHalfWidth = ARTBOARD_LIMITS.max / 2;
  const growthHalfHeight = ARTBOARD_LIMITS.max / 2;
  const safetyLimitHit = halfWidth > growthHalfWidth || halfHeight > growthHalfHeight;
  const clampedHalfWidth = Math.min(halfWidth, growthHalfWidth);
  const clampedHalfHeight = Math.min(halfHeight, growthHalfHeight);

  const effectiveX = roundSceneNumber(authoredCenterXValue - clampedHalfWidth);
  const effectiveY = roundSceneNumber(authoredCenterYValue - clampedHalfHeight);
  const effectiveWidth = roundSceneNumber(clampedHalfWidth * 2);
  const effectiveHeight = roundSceneNumber(clampedHalfHeight * 2);

  const effectiveArtboard: ArtboardRect = {
    x: effectiveX,
    y: effectiveY,
    width: effectiveWidth,
    height: effectiveHeight,
  };

  const artworkBounds = placementBounds;
  const expandedX = effectiveWidth > authored.width;
  const expandedY = effectiveHeight > authored.height;

  const typographyKey = [
    "typography-placement",
    roundSceneNumber(canonicalOrigin.x),
    roundSceneNumber(canonicalOrigin.y),
    roundSceneNumber(authoredOffset.x),
    roundSceneNumber(authoredOffset.y),
    roundSceneNumber(resolvedBaseline),
    roundSceneNumber(layoutBounds.x),
    roundSceneNumber(layoutBounds.y),
    roundSceneNumber(layoutBounds.width),
    roundSceneNumber(layoutBounds.height),
    roundSceneNumber(inkBounds.x),
    roundSceneNumber(inkBounds.y),
    roundSceneNumber(inkBounds.width),
    roundSceneNumber(inkBounds.height),
  ].join(":");

  const sceneKey = [
    "scene-layout",
    `authored:${roundSceneNumber(authored.width)}x${roundSceneNumber(authored.height)}`,
    `effective:${roundSceneNumber(effectiveX)},${roundSceneNumber(effectiveY)},${roundSceneNumber(effectiveWidth)}x${roundSceneNumber(effectiveHeight)}`,
    `typography:${typographyKey}`,
    `padding:${roundSceneNumber(padding)}`,
    `expanded:${expandedX ? 1 : 0},${expandedY ? 1 : 0}`,
  ].join("|");

  return {
    authoredArtboard: authored,
    authoredArtboardRect: authoredRect,
    effectiveArtboard,
    typography: {
      canonicalOrigin,
      canonicalBaseline,
      authoredOffset,
      resolvedOrigin,
      resolvedBaseline,
      layoutBounds,
      inkBounds,
      placementBounds,
      key: typographyKey,
    },
    artworkBounds,
    containmentPadding: padding,
    expandedX,
    expandedY,
    safetyLimitHit,
    key: sceneKey,
  };
}

export function sceneLayoutKey(layout: ResolvedSceneLayout): string {
  return layout.key;
}

export function typographyPlacementKey(layout: ResolvedSceneLayout): string {
  return layout.typography.key;
}

/**
 * True when the resolved effective artboard is exactly equal to the authored
 * minimum (no symmetric growth on either axis). Used by diagnostics only.
 */
export function isAuthoredSceneUnexpanded(layout: ResolvedSceneLayout): boolean {
  return !layout.expandedX && !layout.expandedY;
}

export { emptyBounds };