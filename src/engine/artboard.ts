import type { GlyphBounds } from "./glyphGeometry";
import type { ProjectState, RenderContext } from "../types";
import { type ArtboardRect } from "./sceneLayout";

export const DEFAULT_ARTBOARD = { width: 1200, height: 720 } as const;
export const ARTBOARD_LIMITS = { min: 64, max: 16_384 } as const;

export interface ArtboardDimensions {
  width: number;
  height: number;
}

/**
 * The artboard viewport contract used by renderers, sampling, diagnostics,
 * Canvas preview, and export. `x`/`y` carry the effective rect origin and are
 * always required — renderers and indexing must subtract the origin before
 * cell-indexing and clamp against `artboardLeft/Right/Top/Bottom`.
 */
export interface ArtboardViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

export function artboardBounds(artboard: ArtboardDimensions | ArtboardRect): GlyphBounds {
  if ("x" in artboard) return { x: artboard.x, y: artboard.y, width: artboard.width, height: artboard.height };
  return { x: 0, y: 0, width: artboard.width, height: artboard.height };
}

export function artboardViewport(artboard: ArtboardDimensions | ArtboardRect): ArtboardViewport {
  if ("x" in artboard) {
    return {
      x: artboard.x,
      y: artboard.y,
      width: artboard.width,
      height: artboard.height,
      centerX: artboard.x + artboard.width / 2,
      centerY: artboard.y + artboard.height / 2,
    };
  }
  return {
    x: 0,
    y: 0,
    width: artboard.width,
    height: artboard.height,
    centerX: artboard.width / 2,
    centerY: artboard.height / 2,
  };
}

/**
 * Returns the AUTHORED artboard viewport. This is the stable authored
 * minimum — the canonical typography placement center and the floor for the
 * effective scene rect. Renderers, sampling, and diagnostics must consume the
 * EFFECTIVE rect from `context.viewport` (via `contextArtboard`), not the
 * authored one, when the scene may have grown.
 */
export function projectArtboard(state: Pick<ProjectState, "artboard">): ArtboardViewport {
  return artboardViewport(state.artboard);
}

/**
 * Returns the EFFECTIVE scene rect consumed by renderers and samplers. The
 * `RenderContext.viewport` field now carries the full effective rect (with
 * non-zero origin); this helper exposes it as the canonical authority so
 * renderers do not duplicate the `viewport ?? default` fallback.
 */
export function contextArtboard(context: RenderContext): ArtboardViewport {
  return context.viewport ?? artboardViewport(DEFAULT_ARTBOARD);
}

export { type ArtboardRect };