export interface ParsedPathCommand extends Record<string, unknown> {
  type: string;
}

export interface ParsedPath {
  commands: ParsedPathCommand[];
  toPathData(precision?: number): string;
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
}

export interface ParsedGlyph {
  index: number;
  name: string | null;
  advanceWidth?: number;
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number };
  getPath(
    x?: number,
    y?: number,
    fontSize?: number,
    options?: { kerning?: boolean },
    font?: ParsedFont,
  ): ParsedPath;
}

export interface ParsedFont {
  names: {
    fontFamily?: Record<string, string>;
    fullName?: Record<string, string>;
  };
  unitsPerEm: number;
  ascender: number;
  descender: number;
  glyphs: { length: number };
  charToGlyph(character: string): ParsedGlyph;
  getKerningValue(leftGlyph: ParsedGlyph, rightGlyph: ParsedGlyph): number;
}

export interface FontEngine {
  parse(buffer: ArrayBuffer): ParsedFont;
}
