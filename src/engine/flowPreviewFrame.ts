import { VIEWPORT } from "./constants";
import type { GeometryGroup, LineSegment } from "./geometry";
import type { TextGeometry } from "./glyphGeometry";
import { generateRendererGeometry } from "./rendererRuntime";
import type { ProjectState, RenderContext } from "../types";

export interface FlowPreviewAppearance {
  primaryColor: string;
  outlineColor: string;
  backgroundColor: string;
  transparentBackground: boolean;
  strokeWidth: number;
}

/**
 * Shared, presentation-neutral Flow preview frame.
 *
 * SVG DOM consumes the same GeometryGroup through FlowPreview; Canvas resolves
 * it here inside its imperative clock. This module has no export dependency and
 * deliberately contains no DOM, Canvas, WebGPU, or serialization code.
 */
export interface FlowPreviewFrame {
  context: RenderContext;
  geometry: GeometryGroup;
  lines: LineSegment[];
  appearance: FlowPreviewAppearance;
  bounds: typeof VIEWPORT;
  textGeometry: TextGeometry | null;
}

export interface FlowCanvasStrokeBatch {
  opacity: number;
  lines: LineSegment[];
}

export const FLOW_CANVAS_OPACITY_BUCKETS = 24;

export function batchFlowLinesForCanvas(
  lines: LineSegment[],
  bucketCount = FLOW_CANVAS_OPACITY_BUCKETS,
): FlowCanvasStrokeBatch[] {
  const buckets = Array.from({ length: bucketCount }, () => [] as LineSegment[]);
  for (const line of lines) {
    const opacity = Math.min(1, Math.max(0, line.opacity ?? 1));
    const index = Math.min(bucketCount - 1, Math.floor(opacity * bucketCount));
    buckets[index].push(line);
  }
  return buckets.map((bucketLines, index) => ({
    opacity: (index + 0.5) / bucketCount,
    lines: bucketLines,
  }));
}

export function createFlowPreviewFrame(
  state: ProjectState,
  context: RenderContext,
  geometry: GeometryGroup = generateRendererGeometry(state, context),
): FlowPreviewFrame {
  if (geometry.geometries.some((item) => item.type !== "line")) {
    throw new Error("Flow preview requires line geometry.");
  }
  return {
    context,
    geometry,
    lines: geometry.geometries as LineSegment[],
    appearance: {
      primaryColor: state.primaryColor,
      outlineColor: state.outlineColor,
      backgroundColor: state.backgroundColor,
      transparentBackground: state.transparentBackground,
      strokeWidth: 1.4,
    },
    bounds: VIEWPORT,
    textGeometry: context.textGeometry ?? null,
  };
}
