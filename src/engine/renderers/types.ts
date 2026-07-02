import type { GeometryGroup } from "../geometry";
import type { FieldControlId, ProjectState, RenderContext, RendererId } from "../../types";

export type SvgElementType = "line" | "circle" | "polyline" | "mixed";

export interface CostEstimate {
  marks: number;
  nodes: number;
  label: string;
}

export interface VectorRenderer {
  id: RendererId;
  label: string;
  supportedControls: readonly FieldControlId[];
  svgElementType: SvgElementType;
  usesTime: boolean;
  usesSubstrate: boolean;
  usesGlyphEmitterField?: boolean;
  clipPreviewToText?: (state: ProjectState) => boolean;
  showTextOverlay?: (state: ProjectState) => boolean;
  textOverlayOpacity?: (state: ProjectState) => number;
  strokeWidth?: (state: ProjectState) => number | undefined;
  generateGeometry(state: ProjectState, context: RenderContext): GeometryGroup;
  estimateCost(state: ProjectState): CostEstimate;
}

export function requestedMarkCount(state: ProjectState) {
  return Math.min(state.maxNodes, Math.round(state.density * 34));
}

export function simpleCost(state: ProjectState, label: string): CostEstimate {
  const marks = requestedMarkCount(state);
  return { marks, nodes: marks, label: `${marks.toLocaleString()} ${label}` };
}
