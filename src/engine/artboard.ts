import type { GlyphBounds } from "./glyphGeometry";
import type { ProjectState, RenderContext } from "../types";

export const DEFAULT_ARTBOARD = { width: 1200, height: 720 } as const;
export const ARTBOARD_LIMITS = { min: 64, max: 16_384 } as const;

export interface ArtboardDimensions {
  width: number;
  height: number;
}

export function artboardBounds(artboard: ArtboardDimensions): GlyphBounds {
  return { x: 0, y: 0, width: artboard.width, height: artboard.height };
}

export function artboardViewport(artboard: ArtboardDimensions) {
  return {
    width: artboard.width,
    height: artboard.height,
    centerX: artboard.width / 2,
    centerY: artboard.height / 2,
  };
}

export function projectArtboard(state: Pick<ProjectState, "artboard">) {
  return artboardViewport(state.artboard);
}

export function contextArtboard(context: RenderContext) {
  return context.viewport ?? artboardViewport(DEFAULT_ARTBOARD);
}
