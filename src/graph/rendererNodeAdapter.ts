import type { GeometryGroup } from "../engine/geometry";
import type { VectorRenderer } from "../engine/renderers/types";
import type { ProjectState, RenderContext } from "../types";
import type { NodeDefinition } from "./nodeTypes";

export interface RendererGeometryNodeAdapter {
  definition: NodeDefinition;
  renderer: VectorRenderer;
  evaluate(state: ProjectState, context: RenderContext): GeometryGroup;
}

/**
 * Type-level bridge only: existing renderers remain the source of geometry and
 * are not registered with, or executed by, a graph runtime in schema v7.
 */
export function adaptVectorRenderer(renderer: VectorRenderer): RendererGeometryNodeAdapter {
  return {
    definition: {
      type: `renderer.${renderer.id}`,
      version: 1,
      label: renderer.label,
      inputs: [],
      outputs: [{ id: "geometry", label: "Geometry", kind: "geometry" }],
    },
    renderer,
    evaluate: (state, context) => renderer.generateGeometry(state, context),
  };
}
