import { VIEWPORT } from "./constants";
import type { GlyphBounds } from "./glyphGeometry";
import type { ProjectState, RenderContext } from "../types";
import { contextArtboard, projectArtboard } from "./artboard";

const LARGE_TYPE_SAMPLING_THRESHOLD = 220;

export interface GlyphSamplingDiagnostic {
  glyphIndex: number;
  textIndex: number;
  character: string;
  rawBounds: GlyphBounds;
  visibleBounds: GlyphBounds | null;
  rawArea: number;
  visibleArea: number;
  candidateCount: number;
  retainedCandidateCount: number;
  generatedMarkCount: number;
  droppedMarkCount: number;
  retainedDensity: number;
  visibility: "outside" | "partial" | "inside";
}

/**
 * Intersect glyph bounds with the effective artboard rect (origin-aware).
 * Returns the overlap of `bounds` with `[rect.x, rect.x+rect.width]
 * × [rect.y, rect.y+rect.height]` or `null` if there is no overlap.
 */
export function intersectArtboard(
  bounds: GlyphBounds,
  artboard: { x?: number; y?: number; width: number; height: number } = VIEWPORT,
): GlyphBounds | null {
  const left = artboard.x ?? 0;
  const top = artboard.y ?? 0;
  const x = Math.max(left, bounds.x);
  const y = Math.max(top, bounds.y);
  const right = Math.min(left + artboard.width, bounds.x + bounds.width);
  const bottom = Math.min(top + artboard.height, bounds.y + bounds.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * Resolve the authored-space fallback mark sampling bounds. The renderer
 * always receives the EFFECTIVE rect via context; this helper performs the
 * authored-space derivation (used as the fallback bound for static sampling
 * when no glyph-intersected bound is available).
 */
export function resolveSimpleMarkBounds(
  state: ProjectState,
  effectiveArtboard: { x: number; y: number; width: number; height: number } = projectArtboard(state),
): GlyphBounds {
  return state.fontSize > LARGE_TYPE_SAMPLING_THRESHOLD
    ? {
        x: effectiveArtboard.x,
        y: effectiveArtboard.y,
        width: effectiveArtboard.width,
        height: effectiveArtboard.height,
      }
    : {
        x: effectiveArtboard.x + VIEWPORT.paddingX,
        y: effectiveArtboard.y + VIEWPORT.paddingY,
        width: effectiveArtboard.width - VIEWPORT.paddingX * 2,
        height: effectiveArtboard.height - VIEWPORT.paddingY * 2,
      };
}

export function resolveVisibleGlyphSamplingBounds(
  state: ProjectState,
  context: RenderContext,
  fallback: GlyphBounds,
): GlyphBounds[] {
  if (state.fontSize <= LARGE_TYPE_SAMPLING_THRESHOLD || !context.textGeometry?.glyphs.length) return [fallback];
  const visible = context.textGeometry.glyphs
    .map((glyph) => glyph.path.bounds && intersectArtboard(glyph.path.bounds, contextArtboard(context)))
    .filter((bounds): bounds is GlyphBounds => bounds !== null);
  return visible.length > 0 ? visible : [fallback];
}

export function buildGlyphSamplingDiagnostics(
  context: RenderContext,
  candidates: Array<{ x: number; y: number }>,
  retainedMarks: Array<{ x: number; y: number }>,
): GlyphSamplingDiagnostic[] {
  return (context.textGeometry?.glyphs ?? []).map((glyph, glyphIndex) => {
    const rawBounds = glyph.path.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
    const visibleBounds = intersectArtboard(rawBounds, contextArtboard(context));
    const contains = (bounds: GlyphBounds | null, point: { x: number; y: number }) => Boolean(bounds
      && point.x >= bounds.x
      && point.x <= bounds.x + bounds.width
      && point.y >= bounds.y
      && point.y <= bounds.y + bounds.height);
    const candidateCount = candidates.filter((point) => contains(rawBounds, point)).length;
    const retainedCandidateCount = candidates.filter((point) => contains(visibleBounds, point)).length;
    const generatedMarkCount = retainedMarks.filter((point) => contains(visibleBounds, point)).length;
    const rawArea = Math.max(0, rawBounds.width * rawBounds.height);
    const visibleArea = visibleBounds ? visibleBounds.width * visibleBounds.height : 0;
    return {
      glyphIndex: glyph.glyphIndex,
      textIndex: glyph.textIndex,
      character: glyph.character,
      rawBounds,
      visibleBounds,
      rawArea,
      visibleArea,
      candidateCount,
      retainedCandidateCount,
      generatedMarkCount,
      droppedMarkCount: Math.max(0, candidateCount - retainedCandidateCount),
      retainedDensity: visibleArea > 0 ? generatedMarkCount / visibleArea : 0,
      visibility: !visibleBounds ? "outside" : visibleArea + 0.001 < rawArea ? "partial" : "inside",
    };
  });
}

export function sampleBoundsFairly(
  bounds: GlyphBounds[],
  attemptIndex: number,
  random: () => number,
) {
  const selected = bounds[attemptIndex % bounds.length];
  return {
    x: selected.x + random() * selected.width,
    y: selected.y + random() * selected.height,
  };
}