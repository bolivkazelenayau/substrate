export interface GlyphBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GlyphPath {
  d: string;
  bounds: GlyphBounds | null;
  commands: GlyphPathCommand[];
}

export interface GlyphPathCommand {
  type: "M" | "L" | "Q" | "C" | "Z";
  x?: number;
  y?: number;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface PositionedGlyph {
  glyphId: string;
  character: string;
  sourceCharacter: string;
  textIndex: number;
  glyphIndex: number;
  glyphName: string | null;
  advanceWidth: number;
  lineIndex?: number;
  glyphIndexInLine?: number;
  globalGlyphIndex?: number;
  x: number;
  y: number;
  path: GlyphPath;
  center: { x: number; y: number };
  centroid: { x: number; y: number };
  counterCenter: { x: number; y: number } | null;
  sourceAnchor: { x: number; y: number };
  emitterEligible: boolean;
}

export interface TextLineGeometry {
  lineIndex: number;
  text: string;
  originX: number;
  baselineY: number;
  advanceWidth: number;
  bounds: GlyphBounds | null;
}

export interface TextGeometry {
  glyphs: PositionedGlyph[];
  lines?: TextLineGeometry[];
  bounds: GlyphBounds | null;
  layoutBounds?: GlyphBounds;
  baselineY: number;
  originX: number;
  advanceWidth: number;
  sourceText: string;
  hasOutlines: boolean;
  /** Present when parsed contours have passed through Glyph Micro Warp. */
  microWarp?: {
    sourceTypographyKey: string;
    warpKey: string;
    geometryKey: string;
    sourcePointCount: number;
    warpedPointCount: number;
    affectedPointCount: number;
    emitterCount: number;
    maxDisplacement: number;
    affectedBounds: GlyphBounds | null;
    safetyStatus: "complete" | "displacement-clamped" | "topology-guarded" | "point-budget-limited";
  };
  /** Present only when this geometry is the active derived glyph domain. */
  displacement?: {
    sourceTypographyKey: string;
    displacementKey: string;
    geometryKey: string;
    mode: "warp" | "horizontal-slices" | "vertical-slices" | "grid" | "radial-sectors";
    fragmentCount: number;
    fragmentBounds: GlyphBounds[];
    clippingStatus: "complete" | "budget-limited" | "triangulation-fallback";
  };
}

export interface GlyphOutline {
  d: string;
  commands: GlyphPathCommand[];
}

export interface GlyphDomain {
  glyphId: string;
  character: string;
  textIndex: number;
  glyphIndex?: number;
  bounds: GlyphBounds;
  worldBounds: GlyphBounds | null;
  outline: GlyphOutline | null;
  worldTransform: { a: number; b: number; c: number; d: number; e: number; f: number };
  visible: "inside" | "partial" | "outside";
  eligible: boolean;
  approximate: boolean;
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
