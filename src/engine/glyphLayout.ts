import { VIEWPORT } from "./constants";
import type { LoadedFont } from "./fontLoader";
import type { GlyphBounds, GlyphPathCommand, PositionedGlyph, TextGeometry } from "./glyphGeometry";
import { unionBounds } from "./glyphGeometry";
import type { ProjectState } from "../types";
import { getTextLayout } from "./textLayout";
import { projectArtboard } from "./artboard";

function pathBounds(box: { x1: number; y1: number; x2: number; y2: number }, hasPath: boolean): GlyphBounds | null {
  if (!hasPath || ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite)) return null;
  return { x: box.x1, y: box.y1, width: box.x2 - box.x1, height: box.y2 - box.y1 };
}

function normalizeCommands(commands: Array<Record<string, unknown>>): GlyphPathCommand[] {
  return commands.flatMap((command) => {
    const type = command.type;
    if (type !== "M" && type !== "L" && type !== "Q" && type !== "C" && type !== "Z") return [];
    const number = (key: string) => typeof command[key] === "number" ? command[key] as number : undefined;
    return [{
      type,
      x: number("x"),
      y: number("y"),
      x1: number("x1"),
      y1: number("y1"),
      x2: number("x2"),
      y2: number("y2"),
    }];
  });
}

export function layoutGlyphs(state: ProjectState, loaded: LoadedFont): TextGeometry {
  const characters = Array.from(state.text);
  const glyphs = characters.map((character) => loaded.font.charToGlyph(character));
  const scale = state.fontSize / loaded.font.unitsPerEm;
  const advances = glyphs.map((glyph) => (glyph.advanceWidth ?? loaded.font.unitsPerEm) * scale);
  const kerningScale = state.kerningMode === "font" ? state.kerningStrength : 0;
  const kernings = glyphs.map((glyph, index) => index < glyphs.length - 1
    ? loaded.font.getKerningValue(glyph, glyphs[index + 1]) * scale * kerningScale
    : 0);
  const opticalAdjustments = getOpticalAdjustments(state, loaded, glyphs, advances);
  const totalAdvance = advances.reduce((sum, advance) => sum + advance, 0)
    + kernings.reduce((sum, kerning) => sum + kerning, 0)
    + opticalAdjustments.reduce((sum, adjustment) => sum + adjustment, 0)
    + Math.max(0, glyphs.length - 1) * state.tracking;
  const artboard = projectArtboard(state);
  const originX = state.textAlign === "left"
    ? VIEWPORT.paddingX
    : state.textAlign === "right"
      ? artboard.width - VIEWPORT.paddingX - totalAdvance
      : artboard.centerX - totalAdvance / 2;
  const layout = getTextLayout(state);
  const baselineY = layout.baselineY;
  let cursorX = originX;
  let textIndex = 0;
  const positioned: PositionedGlyph[] = glyphs.map((glyph, index) => {
    const character = characters[index];
    const path = glyph.getPath(cursorX, baselineY, state.fontSize, { kerning: false }, loaded.font);
    const d = path.toPathData(state.precision);
    const bounds = pathBounds(path.getBoundingBox(), path.commands.length > 0 && d.length > 0);
    const center = bounds
      ? { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
      : { x: cursorX + advances[index] / 2, y: baselineY - state.fontSize / 2 };
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
      y: baselineY,
      path: {
        d,
        bounds,
        commands: normalizeCommands(path.commands as unknown as Array<Record<string, unknown>>),
      },
      center,
      centroid: center,
      counterCenter,
      sourceAnchor: counterCenter ?? center,
      emitterEligible: !/\s/.test(character),
    };
    cursorX += advances[index] + kernings[index] + opticalAdjustments[index]
      + (index < glyphs.length - 1 ? state.tracking : 0);
    textIndex += character.length;
    return result;
  });
  const bounds = unionBounds(positioned.map((glyph) => glyph.path.bounds));
  return {
    glyphs: positioned,
    bounds,
    baselineY,
    originX,
    advanceWidth: totalAdvance,
    sourceText: state.text,
    hasOutlines: positioned.some((glyph) => glyph.path.d.length > 0),
  };
}

function getOpticalAdjustments(
  state: ProjectState,
  loaded: LoadedFont,
  glyphs: ReturnType<LoadedFont["font"]["charToGlyph"]>[],
  advances: number[],
) {
  const adjustments = new Array(glyphs.length).fill(0) as number[];
  if (!state.opticalSpacing || state.opticalSpacingStrength <= 0 || glyphs.length < 2) return adjustments;
  const scale = state.fontSize / loaded.font.unitsPerEm;
  const pairGaps = glyphs.slice(0, -1).map((glyph, index) => {
    const currentBounds = glyph.getBoundingBox();
    const nextBounds = glyphs[index + 1].getBoundingBox();
    const currentVisible = currentBounds.x2 > currentBounds.x1;
    const nextVisible = nextBounds.x2 > nextBounds.x1;
    if (!currentVisible || !nextVisible) return null;
    const rightBearing = advances[index] - currentBounds.x2 * scale;
    const nextLeftBearing = nextBounds.x1 * scale;
    const gap = rightBearing + nextLeftBearing;
    return Number.isFinite(gap) ? gap : null;
  });
  const finiteGaps = pairGaps.filter((gap): gap is number => gap !== null).sort((a, b) => a - b);
  if (finiteGaps.length === 0) return adjustments;
  const middle = Math.floor(finiteGaps.length / 2);
  const referenceGap = finiteGaps.length % 2 === 0
    ? (finiteGaps[middle - 1] + finiteGaps[middle]) / 2
    : finiteGaps[middle];
  const limit = state.fontSize * 0.08;
  pairGaps.forEach((gap, index) => {
    if (gap === null) return;
    const raw = (referenceGap - gap) * state.opticalSpacingStrength;
    adjustments[index] = Math.max(-limit, Math.min(limit, raw));
  });
  return adjustments;
}
