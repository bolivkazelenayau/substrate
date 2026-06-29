import { TEXT_LAYOUT, VIEWPORT } from "./constants";
import type { ProjectState } from "../types";

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

function estimatedTextWidth(state: ProjectState) {
  return Math.min(VIEWPORT.width, state.text.length * state.fontSize * 0.66
    + Math.max(0, state.text.length - 1) * state.tracking);
}

function alignedBoundsX(state: ProjectState, width: number) {
  if (state.textAlign === "left") return VIEWPORT.paddingX;
  if (state.textAlign === "right") return VIEWPORT.width - VIEWPORT.paddingX - width;
  return VIEWPORT.centerX - width / 2;
}

export function getTextLayout(state: ProjectState, useCustomFont = true): TextLayout {
  const width = estimatedTextWidth(state);
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

export function getTextBounds(state: ProjectState) {
  const estimatedWidth = estimatedTextWidth(state);
  return {
    x: alignedBoundsX(state, estimatedWidth),
    y: TEXT_LAYOUT.baselineY + state.textOffsetY - state.fontSize,
    width: estimatedWidth,
    height: state.fontSize * 1.18,
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
