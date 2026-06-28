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

export function getTextLayout(state: ProjectState, useCustomFont = true): TextLayout {
  return {
    ...TEXT_LAYOUT,
    fontFamily: useCustomFont ? state.font?.family ?? TEXT_LAYOUT.fontFamily : TEXT_LAYOUT.fontFamily,
    fontSize: state.fontSize,
    tracking: state.tracking,
    text: state.text,
  };
}

export function getTextBounds(state: ProjectState) {
  const estimatedWidth = Math.min(VIEWPORT.width, state.text.length * state.fontSize * 0.66 + Math.max(0, state.text.length - 1) * state.tracking);
  return {
    x: VIEWPORT.centerX - estimatedWidth / 2,
    y: TEXT_LAYOUT.baselineY - state.fontSize,
    width: estimatedWidth,
    height: state.fontSize * 1.18,
  };
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
