import type { GlyphBounds, TextGeometry } from "./glyphGeometry";
import { getApproximateTextInkBounds, getTextLayoutBounds } from "./textLayout";
import type { ProjectState } from "../types";
import { artboardBounds } from "./artboard";

export interface TextBoundsModel {
  layoutBounds: GlyphBounds;
  inkBounds: GlyphBounds;
  glyphUnionBounds: GlyphBounds | null;
  artboardBounds: GlyphBounds;
  inkBoundsSource: "parsed-glyph-union" | "native-approximate";
}

export function resolveTextBoundsModel(
  state: ProjectState,
  textGeometry: TextGeometry | null,
): TextBoundsModel {
  const glyphUnionBounds = textGeometry?.hasOutlines ? textGeometry.bounds : null;
  return {
    layoutBounds: textGeometry?.hasOutlines
      ? {
          x: textGeometry.originX,
          y: textGeometry.baselineY - state.fontSize,
          width: textGeometry.advanceWidth,
          height: state.fontSize * 1.18,
        }
      : getTextLayoutBounds(state),
    inkBounds: glyphUnionBounds ?? getApproximateTextInkBounds(state),
    glyphUnionBounds,
    artboardBounds: artboardBounds(state.artboard),
    inkBoundsSource: glyphUnionBounds ? "parsed-glyph-union" : "native-approximate",
  };
}

export const NATIVE_TEXT_BOUNDS_WARNING = "Native text fallback uses approximate text bounds.";
