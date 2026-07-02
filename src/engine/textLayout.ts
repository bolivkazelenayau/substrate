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
}

function estimatedTextAdvance(state: ProjectState) {
  return state.text.length * state.fontSize * 0.66
    + Math.max(0, state.text.length - 1) * state.tracking;
}

function alignedBoundsX(state: ProjectState, width: number) {
  const artboard = projectArtboard(state);
  if (state.textAlign === "left") return VIEWPORT.paddingX;
  if (state.textAlign === "right") return artboard.width - VIEWPORT.paddingX - width;
  return artboard.centerX - width / 2;
}

export function getTextLayout(state: ProjectState, useCustomFont = true): TextLayout {
  const width = estimatedTextAdvance(state);
  const boundsX = alignedBoundsX(state, width);
  return {
    ...TEXT_LAYOUT,
    x: boundsX + width / 2,
    baselineY: TEXT_LAYOUT.baselineY + state.textOffsetY,
    fontFamily: useCustomFont ? state.font?.family ?? TEXT_LAYOUT.fontFamily : TEXT_LAYOUT.fontFamily,
    fontSize: state.fontSize,
    tracking: state.tracking,
    text: state.text,
  };
}

export function getTextLayoutBounds(state: ProjectState) {
  const estimatedWidth = estimatedTextAdvance(state);
  return {
    x: alignedBoundsX(state, estimatedWidth),
    y: TEXT_LAYOUT.baselineY + state.textOffsetY - state.fontSize,
    width: estimatedWidth,
    height: state.fontSize * 1.18,
  };
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
