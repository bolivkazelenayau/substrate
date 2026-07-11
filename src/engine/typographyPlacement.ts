import type { GlyphBounds } from "./glyphGeometry";
import type { ProjectState } from "../types";

export interface ResolvedTypographyPlacement {
  canonicalOrigin: { x: number; y: number };
  canonicalBaseline: number;
  authoredOffset: { x: number; y: number };
  resolvedOrigin: { x: number; y: number };
  resolvedBaseline: number;
  layoutBounds: GlyphBounds;
  inkBounds: GlyphBounds;
  visualCenter: { x: number; y: number };
  key: string;
}

/**
 * Layout bounds are the sole vertical authority. A line box spans from
 * baseline-fontSize to baseline+0.18*fontSize, so its center is baseline-0.41*fontSize.
 * Multiline first baselines are shifted by half the total line advance.
 */
export function canonicalFirstBaseline(state: Pick<ProjectState, "artboard" | "fontSize" | "lineHeight" | "text" | "textOffsetY">): number {
  const lineCount = state.text.replace(/\r\n?/g, "\n").split("\n").length;
  const lineSpan = Math.max(0, lineCount - 1) * state.fontSize * state.lineHeight;
  const canonical = state.artboard.height / 2 + state.fontSize * 0.41 - lineSpan / 2;
  return canonical + state.textOffsetY;
}

export function resolveTypographyPlacement(
  state: Pick<ProjectState, "artboard" | "fontSize" | "lineHeight" | "text" | "textOffsetY">,
  layoutBounds: GlyphBounds,
  inkBounds: GlyphBounds,
  originX: number,
): ResolvedTypographyPlacement {
  const resolvedBaseline = canonicalFirstBaseline(state);
  const canonicalBaseline = resolvedBaseline - state.textOffsetY;
  const visualCenter = { x: layoutBounds.x + layoutBounds.width / 2, y: layoutBounds.y + layoutBounds.height / 2 };
  const result = {
    canonicalOrigin: { x: originX, y: canonicalBaseline },
    canonicalBaseline,
    authoredOffset: { x: 0, y: state.textOffsetY },
    resolvedOrigin: { x: originX, y: resolvedBaseline },
    resolvedBaseline,
    layoutBounds,
    inkBounds,
    visualCenter,
  };
  return { ...result, key: JSON.stringify(result) };
}
