export type GraphId = string;
export type GraphNodeId = string;
export type GraphSocketId = string;
export type GraphConnectionId = string;
export type GraphNodeType = string;

export type GraphNode = {
  id: GraphNodeId;
  type: GraphNodeType;
  label?: string;
  params: Record<string, unknown>;
  /**
   * Reserved for a future editor. Position is presentation metadata and must
   * not affect graph evaluation.
   */
  position?: {
    x: number;
    y: number;
  };
};

export type GraphConnection = {
  id: GraphConnectionId;
  fromNodeId: GraphNodeId;
  fromSocketId: GraphSocketId;
  toNodeId: GraphNodeId;
  toSocketId: GraphSocketId;
};

/**
 * Future runtime IR only. It is not ProjectState and is deliberately absent
 * from the schema-v7 project import/export boundary.
 */
export type GraphDocument = {
  version: 1;
  nodes: GraphNode[];
  connections: GraphConnection[];
  outputNodeId: GraphNodeId;
};
