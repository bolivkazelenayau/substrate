import type { GraphOutputKind } from "./socketTypes";

export interface GraphNode {
  id: string;
  type: string;
  version: number;
  parameters: Record<string, unknown>;
  position?: { x: number; y: number };
}

export interface GraphConnection {
  id: string;
  from: { nodeId: string; socketId: string };
  to: { nodeId: string; socketId: string };
}

export interface GraphOutput {
  nodeId: string;
  socketId: string;
  kind: GraphOutputKind;
}

/**
 * Future runtime IR only. This type is deliberately absent from ProjectState
 * and the schema-v7 import/export boundary.
 */
export interface GraphDocument {
  version: 1;
  nodes: GraphNode[];
  connections: GraphConnection[];
  outputs: GraphOutput[];
}
