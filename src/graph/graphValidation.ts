import * as v from "valibot";
import type { GraphDocument } from "./graphTypes";

const outputKindSchema = v.picklist([
  "scalar-field",
  "vector-field",
  "mask-field",
  "distance-field",
  "geometry",
  "appearance",
]);
const endpointSchema = v.object({ nodeId: v.string(), socketId: v.string() });
const nodeSchema = v.object({
  id: v.string(),
  type: v.string(),
  version: v.number(),
  parameters: v.record(v.string(), v.unknown()),
  position: v.optional(v.object({ x: v.number(), y: v.number() })),
});
const graphDocumentSchema = v.object({
  version: v.literal(1),
  nodes: v.array(nodeSchema),
  connections: v.array(v.object({
    id: v.string(),
    from: endpointSchema,
    to: endpointSchema,
  })),
  outputs: v.array(v.object({
    nodeId: v.string(),
    socketId: v.string(),
    kind: outputKindSchema,
  })),
});

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Graph contains duplicate ${label}.`);
  }
}

export function validateGraphDocument(input: unknown): GraphDocument {
  const graph = v.parse(graphDocumentSchema, input) as GraphDocument;
  assertUnique(graph.nodes.map(({ id }) => id), "node ids");
  assertUnique(graph.connections.map(({ id }) => id), "connection ids");
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));
  for (const connection of graph.connections) {
    if (!nodeIds.has(connection.from.nodeId) || !nodeIds.has(connection.to.nodeId)) {
      throw new Error(`Connection "${connection.id}" references an unknown node.`);
    }
  }
  for (const output of graph.outputs) {
    if (!nodeIds.has(output.nodeId)) {
      throw new Error(`Graph output references unknown node "${output.nodeId}".`);
    }
  }
  return graph;
}
