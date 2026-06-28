export interface GlyphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlyphPath {
  d: string;
  bounds: GlyphBounds | null;
}

export interface PositionedGlyph {
  glyphId: string;
  character: string;
  sourceCharacter: string;
  textIndex: number;
  glyphIndex: number;
  glyphName: string | null;
  advanceWidth: number;
  x: number;
  y: number;
  path: GlyphPath;
  center: { x: number; y: number };
  centroid: { x: number; y: number };
  counterCenter: { x: number; y: number } | null;
  sourceAnchor: { x: number; y: number };
  emitterEligible: boolean;
}

export interface TextGeometry {
  glyphs: PositionedGlyph[];
  bounds: GlyphBounds | null;
  baselineY: number;
  originX: number;
  advanceWidth: number;
  sourceText: string;
  hasOutlines: boolean;
}

export function unionBounds(bounds: Array<GlyphBounds | null>): GlyphBounds | null {
  const visible = bounds.filter((value): value is GlyphBounds => value !== null);
  if (visible.length === 0) return null;
  const x1 = Math.min(...visible.map((value) => value.x));
  const y1 = Math.min(...visible.map((value) => value.y));
  const x2 = Math.max(...visible.map((value) => value.x + value.width));
  const y2 = Math.max(...visible.map((value) => value.y + value.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function validateTextGeometry(geometry: TextGeometry) {
  const visibleCharacters = Array.from(geometry.sourceText).filter((character) => !/\s/.test(character));
  const outlinedGlyphs = geometry.glyphs.filter((glyph) => glyph.path.d.length > 0);
  const boundsFinite = geometry.bounds === null || Object.values(geometry.bounds).every(Number.isFinite);
  return {
    glyphCountReasonable: geometry.glyphs.length <= Array.from(geometry.sourceText).length && geometry.glyphs.length > 0,
    visibleGlyphPathsPresent: outlinedGlyphs.length >= visibleCharacters.length,
    boundsFinite,
    valid: geometry.glyphs.length > 0 && outlinedGlyphs.length >= visibleCharacters.length && boundsFinite,
  };
}
