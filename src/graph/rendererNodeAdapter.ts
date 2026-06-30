import type { VectorRenderer } from "../engine/renderers/types";
import { getRendererManifest } from "../engine/renderers/rendererManifest";
import type { NodeDefinition } from "./nodeTypes";
import type { GraphSocket } from "./socketTypes";

/**
 * Definition-only bridge. The current renderer registry remains authoritative;
 * this does not register, load, or execute a renderer through a graph runtime.
 */
export function createRendererNodeDefinition(renderer: VectorRenderer): NodeDefinition {
  const manifest = getRendererManifest(renderer.id);
  const inputs: GraphSocket[] = [];
  if (manifest.dependencies.includes("substrate")) {
    inputs.push({
      id: "substrate",
      label: "Substrate",
      kind: "distance-field",
      direction: "input",
      required: true,
    });
  }
  if (manifest.dependencies.includes("field")) {
    inputs.push({
      id: "field",
      label: "Field",
      kind: "scalar-field",
      direction: "input",
    });
  }
  if (manifest.dependencies.includes("time")) {
    inputs.push({
      id: "time",
      label: "Time",
      kind: "number",
      direction: "input",
      defaultValue: 0,
    });
  }

  return {
    type: `renderer.${manifest.id}`,
    label: manifest.label,
    category: manifest.graphNode?.category ?? "renderer",
    inputs,
    outputs: [{
      id: "geometry",
      label: "Geometry",
      kind: "geometry",
      direction: "output",
    }],
    experimental: manifest.graphNode?.experimental,
  };
}
