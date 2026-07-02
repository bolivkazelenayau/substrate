import { getRenderer } from "../engine/renderers";
import type { ProjectState } from "../types";
import type { GraphDocument } from "./graphTypes";
import { createRendererNodeDefinition } from "./rendererNodeAdapter";

/**
 * Builds the smallest graph that represents the current renderer selection.
 * Project controls remain execution input; they are not expanded into nodes.
 */
export function buildRendererGraphFromProject(project: ProjectState): GraphDocument {
  const renderer = getRenderer(project.renderer);
  const definition = createRendererNodeDefinition(renderer);
  const outputNodeId = `renderer:${renderer.id}`;
  return {
    version: 1,
    nodes: [{
      id: outputNodeId,
      type: definition.type,
      label: definition.label,
      params: {},
    }],
    connections: [],
    outputNodeId,
  };
}
