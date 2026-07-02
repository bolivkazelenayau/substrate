import type { TextGeometry } from "./glyphGeometry";
import { ARTBOARD_LIMITS } from "./artboard";
import { resolveTextBoundsModel } from "./textBounds";
import type { ProjectState } from "../types";

export interface ArtboardExpansionPlan {
  available: boolean;
  changed: boolean;
  padding: number;
  nextState: ProjectState;
  projectedInkBounds: { x: number; y: number; width: number; height: number };
  reason?: string;
}

export const AUTO_GROW_ARTBOARD_WARNING = "Auto-grow could not contain artwork within safe artboard limits.";

export function artboardExpansionTriggerKey(plan: ArtboardExpansionPlan): string {
  const { projectedInkBounds } = plan;
  return [
    plan.nextState.artboard.width,
    plan.nextState.artboard.height,
    plan.nextState.textOffsetY,
    projectedInkBounds.x,
    projectedInkBounds.y,
    projectedInkBounds.width,
    projectedInkBounds.height,
    plan.available ? 1 : 0,
    plan.changed ? 1 : 0,
  ].join(":");
}

export function planArtboardExpansionToText(
  state: ProjectState,
  textGeometry: TextGeometry | null,
): ArtboardExpansionPlan {
  const inkBounds = resolveTextBoundsModel(state, textGeometry).inkBounds;
  const padding = Math.max(48, 0.04 * Math.max(state.artboard.width, state.artboard.height));
  const leftDeficit = padding - inkBounds.x;
  const rightDeficit = inkBounds.x + inkBounds.width + padding - state.artboard.width;
  let widthDelta = 0;
  let horizontalShift = 0;

  if (state.textAlign === "left") {
    if (leftDeficit > 0) return unavailable("Left-aligned ink requires horizontal offset compensation.");
    widthDelta = Math.max(0, rightDeficit);
  } else if (state.textAlign === "right") {
    if (rightDeficit > 0) return unavailable("Right-aligned ink requires horizontal offset compensation.");
    widthDelta = Math.max(0, leftDeficit);
    horizontalShift = widthDelta;
  } else {
    widthDelta = Math.max(0, leftDeficit * 2, rightDeficit * 2);
    horizontalShift = widthDelta / 2;
  }

  const verticalShift = Math.max(0, padding - inkBounds.y);
  const projectedInkBounds = {
    ...inkBounds,
    x: inkBounds.x + horizontalShift,
    y: inkBounds.y + verticalShift,
  };
  const width = Math.ceil(Math.max(
    state.artboard.width + widthDelta,
    projectedInkBounds.x + projectedInkBounds.width + padding,
  ));
  const height = Math.ceil(Math.max(
    state.artboard.height,
    projectedInkBounds.y + projectedInkBounds.height + padding,
  ));
  if (width > ARTBOARD_LIMITS.max || height > ARTBOARD_LIMITS.max) {
    return unavailable(`Required artboard exceeds the ${ARTBOARD_LIMITS.max}px safety limit.`);
  }

  const nextState: ProjectState = {
    ...state,
    artboard: { width, height },
    textOffsetY: state.textOffsetY + verticalShift,
  };
  return {
    available: true,
    changed: width !== state.artboard.width || height !== state.artboard.height || verticalShift !== 0,
    padding,
    nextState,
    projectedInkBounds,
  };

  function unavailable(reason: string): ArtboardExpansionPlan {
    return {
      available: false,
      changed: false,
      padding,
      nextState: state,
      projectedInkBounds: inkBounds,
      reason,
    };
  }
}
