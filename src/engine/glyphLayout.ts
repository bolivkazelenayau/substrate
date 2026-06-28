import { TEXT_LAYOUT, VIEWPORT } from "./constants";
import type { LoadedFont } from "./fontLoader";
import type { GlyphBounds, PositionedGlyph, TextGeometry } from "./glyphGeometry";
import { unionBounds } from "./glyphGeometry";
import type { ProjectState } from "../types";

function pathBounds(box: { x1: number; y1: number; x2: number; y2: number }, hasPath: boolean): GlyphBounds | null {
  if (!hasPath || ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)) return null;
  return { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 };
}

export function layoutGlyphs(state: ProjectState, loaded: LoadedFont): TextGeometry {
  const characters = Array.from(state.text);
  const glyphs = characters.map((character) => loaded.font.charToGlyph(character));
  const scale = state.fontSize / loaded.font.unitsPerEm;
  const advances = glyphs.map((glyph) => (glyph.advanceWidth ?? loaded.font.unitsPerEm) * scale);
  const kernings = glyphs.map((glyph, index) => index < glyphs.length - 1
    ? loaded.font.getKerningValue(glyph, glyphs[index + 1]) * scale
    : 0);
  const totalAdvance = advances.reduce((sum, advance) => sum + advance, 0)
    + kernings.reduce((sum, kerning) => sum + kerning, 0)
    + Math.max(0, glyphs.length - 1) * state.tracking;
  const originX = VIEWPORT.centerX - totalAdvance / 2;
  let cursorX = originX;
  let textIndex = 0;
  const positioned: PositionedGlyph[] = glyphs.map((glyph, index) => {
    const character = characters[index];
    const path = glyph.getPath(cursorX, TEXT_LAYOUT.baselineY, state.fontSize, { kerning: false }, loaded.font);
    const d = path.toPathData(state.precision);
    const bounds = pathBounds(path.getBoundingBox(), path.commands.length > 0 && d.length > 0);
    const center = bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : { x: cursorX + advances[index] / 2, y: TEXT_LAYOUT.baselineY - state.fontSize / 2 };
    const counterCenter = /[Oo0QPRBA]/.test(character) && bounds
      ? { x: center.x, y: center.y + (/P|R|B/.test(character) ? -bounds.height * 0.16 : 0) }
      : null;
    const result: PositionedGlyph = {
      glyphId: `glyph-${textIndex}-${glyph.index}`,
      character,
      sourceCharacter: character,
      textIndex,
      glyphIndex: glyph.index,
      glyphName: glyph.name,
      advanceWidth: advances[index],
      x: cursorX,
      y: TEXT_LAYOUT.baselineY,
      path: {
        d,
        bounds,
      },
      center,
      centroid: center,
      counterCenter,
      sourceAnchor: counterCenter ?? center,
      emitterEligible: !/\s/.test(character),
    };
    cursorX += advances[index] + kernings[index] + (index < glyphs.length - 1 ? state.tracking : 0);
    textIndex += character.length;
    return result;
  });
  const bounds = unionBounds(positioned.map((glyph) => glyph.path.bounds));
  return {
    glyphs: positioned,
    bounds,
    baselineY: TEXT_LAYOUT.baselineY,
    originX,
    advanceWidth: totalAdvance,
    sourceText: state.text,
    hasOutlines: positioned.some((glyph) => glyph.path.d.length > 0),
  };
}
