import type { GraphDocument } from "./graphTypes";

export type GraphValidationIssue = {
  code:
    | "missing-output-node"
    | "duplicate-node-id"
    | "duplicate-connection-id"
    | "missing-source-node"
    | "missing-target-node"
    | "self-connection";
  message: string;
};

function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const duplicates: string[] = [];
  for (const id of ids) {
    if (seen.has(id) && !reported.has(id)) {
      duplicates.push(id);
      reported.add(id);
    }
    seen.add(id);
  }
  return duplicates;
}

/** Dependency-free structural validation for the future runtime IR. */
export function validateGraphDocument(graph: GraphDocument): GraphValidationIssue[] {
  const issues: GraphValidationIssue[] = [];
  const nodeIds = new Set(graph.nodes.map(({ id }) => id));

  for (const id of duplicateIds(graph.nodes.map(({ id }) => id))) {
    issues.push({
      code: "duplicate-node-id",
      message: `Graph node id "${id}" is duplicated.`,
    });
  }
  for (const id of duplicateIds(graph.connections.map(({ id }) => id))) {
    issues.push({
      code: "duplicate-connection-id",
      message: `Graph connection id "${id}" is duplicated.`,
    });
  }
  if (!nodeIds.has(graph.outputNodeId)) {
    issues.push({
      code: "missing-output-node",
      message: `Graph output node "${graph.outputNodeId}" does not exist.`,
    });
  }
  for (const connection of graph.connections) {
    if (!nodeIds.has(connection.fromNodeId)) {
      issues.push({
        code: "missing-source-node",
        message: `Connection "${connection.id}" source node "${connection.fromNodeId}" does not exist.`,
      });
    }
    if (!nodeIds.has(connection.toNodeId)) {
      issues.push({
        code: "missing-target-node",
        message: `Connection "${connection.id}" target node "${connection.toNodeId}" does not exist.`,
      });
    }
    if (connection.fromNodeId === connection.toNodeId) {
      issues.push({
        code: "self-connection",
        message: `Connection "${connection.id}" connects node "${connection.fromNodeId}" to itself.`,
      });
    }
  }

  return issues;
}
