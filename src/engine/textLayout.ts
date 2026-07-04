import { TEXT_LAYOUT, VIEWPORT } from "./constants";
import type { ProjectState } from "../types";
import type { TextGeometry } from "./glyphGeometry";
import { projectArtboard } from "./artboard";

export interface TextLayout {
  x: number;
  baselineY: number;
  anchor: "middle";
  fontFamily: string;
  fontWeight: number;
  fontSize: number;
  tracking: number;
  text: string;
  lineAdvance: number;
  lines: Array<{
    lineIndex: number;
    text: string;
    x: number;
    originX: number;
    baselineY: number;
    advanceWidth: number;
  }>;
}

function estimatedLineAdvance(state: ProjectState, text: string) {
  const length = Array.from(text).length;
  return length * state.fontSize * 0.66 + Math.max(0, length - 1) * state.tracking;
}

function alignedBoundsX(state: ProjectState, width: number) {
  const artboard = projectArtboard(state);
  if (state.textAlign === "left") return VIEWPORT.paddingX;
  if (state.textAlign === "right") return artboard.width - VIEWPORT.paddingX - width;
  return artboard.centerX - width / 2;
}

export function getTextLayout(state: ProjectState, useCustomFont = true): TextLayout {
  const sourceLines = state.text.replace(/\r\n?/g, "\n").split("\n");
  const lineAdvance = state.fontSize * state.lineHeight;
  const firstBaselineY = TEXT_LAYOUT.baselineY + state.textOffsetY - (sourceLines.length - 1) * lineAdvance / 2;
  const lines = sourceLines.map((text, lineIndex) => {
    const advanceWidth = estimatedLineAdvance(state, text);
    const originX = alignedBoundsX(state, advanceWidth);
    return {
      lineIndex,
      text,
      originX,
      x: originX + advanceWidth / 2,
      baselineY: firstBaselineY + lineIndex * lineAdvance,
      advanceWidth,
    };
  });
  const first = lines[0];
  return {
    ...TEXT_LAYOUT,
    x: first.x,
    baselineY: first.baselineY,
    fontFamily: useCustomFont ? state.font?.family ?? TEXT_LAYOUT.fontFamily : TEXT_LAYOUT.fontFamily,
    fontSize: state.fontSize,
    tracking: state.tracking,
    text: state.text,
    lineAdvance,
    lines,
  };
}

export function getTextLayoutBounds(state: ProjectState) {
  const layout = getTextLayout(state);
  return unionRectangles(layout.lines.map((line) => ({
    x: line.originX,
    y: line.baselineY - state.fontSize,
    width: line.advanceWidth,
    height: state.fontSize * 1.18,
  })));
}

function unionRectangles(rectangles: Array<{ x: number; y: number; width: number; height: number }>) {
  const x1 = Math.min(...rectangles.map((rect) => rect.x));
  const y1 = Math.min(...rectangles.map((rect) => rect.y));
  const x2 = Math.max(...rectangles.map((rect) => rect.x + rect.width));
  const y2 = Math.max(...rectangles.map((rect) => rect.y + rect.height));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function getApproximateTextInkBounds(state: ProjectState) {
  const layoutBounds = getTextLayoutBounds(state);
  const horizontalOverhang = state.fontSize * 0.08;
  const verticalOverhang = state.fontSize * 0.04;
  return {
    x: layoutBounds.x - horizontalOverhang,
    y: layoutBounds.y - verticalOverhang,
    width: layoutBounds.width + horizontalOverhang * 2,
    height: layoutBounds.height + verticalOverhang * 2,
  };
}

/** @deprecated Prefer the explicitly named layout/ink bounds helpers. */
export const getTextBounds = getApproximateTextInkBounds;

export function centerPreservingTypographySizePatch(
  state: ProjectState,
  nextFontSize: number,
  textGeometry: TextGeometry | null,
): Pick<ProjectState, "fontSize" | "textOffsetY"> {
  if (!Number.isFinite(nextFontSize) || nextFontSize <= 0 || nextFontSize === state.fontSize) {
    return { fontSize: state.fontSize, textOffsetY: state.textOffsetY };
  }
  const currentBounds = textGeometry?.bounds ?? getTextBounds(state);
  const currentCenterY = currentBounds.y + currentBounds.height / 2;
  let projectedCenterY: number;
  if (textGeometry?.bounds && state.fontSize > 0) {
    const scale = nextFontSize / state.fontSize;
    projectedCenterY = textGeometry.baselineY + (currentCenterY - textGeometry.baselineY) * scale;
  } else {
    const projectedBounds = getTextBounds({ ...state, fontSize: nextFontSize });
    projectedCenterY = projectedBounds.y + projectedBounds.height / 2;
  }
  return {
    fontSize: nextFontSize,
    textOffsetY: state.textOffsetY + currentCenterY - projectedCenterY,
  };
}

export function getTypographyLimitations(state: ProjectState, parsedFontPathsAvailable: boolean) {
  if (parsedFontPathsAvailable) return [];
  const limitations: string[] = [];
  if (state.kerningMode === "font" && state.kerningStrength !== 1) {
    limitations.push("Kerning strength requires parsed font outlines.");
  }
  if (state.opticalSpacing && state.opticalSpacingStrength > 0) {
    limitations.push("Optical spacing requires parsed font outlines.");
  }
  return limitations;
}

export function textAttributes(layout: TextLayout) {
  return {
    x: layout.x,
    y: layout.baselineY,
    textAnchor: layout.anchor,
    fontFamily: layout.fontFamily,
    fontSize: layout.fontSize,
    fontWeight: layout.fontWeight,
    letterSpacing: layout.tracking,
  };
}
