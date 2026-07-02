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

export function intersectArtboard(
  bounds: GlyphBounds,
  artboard: { width: number; height: number } = VIEWPORT,
): GlyphBounds | null {
  const x = Math.max(0, bounds.x);
  const y = Math.max(0, bounds.y);
  const right = Math.min(artboard.width, bounds.x + bounds.width);
  const bottom = Math.min(artboard.height, bounds.y + bounds.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function resolveSimpleMarkBounds(state: ProjectState): GlyphBounds {
  const artboard = projectArtboard(state);
  return state.fontSize > LARGE_TYPE_SAMPLING_THRESHOLD
    ? { x: 0, y: 0, width: artboard.width, height: artboard.height }
    : {
        x: VIEWPORT.paddingX,
        y: VIEWPORT.paddingY,
        width: artboard.width - VIEWPORT.paddingX * 2,
        height: artboard.height - VIEWPORT.paddingY * 2,
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
