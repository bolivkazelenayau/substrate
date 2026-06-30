import type { GraphNodeType } from "./graphTypes";
import type { GraphSocket } from "./socketTypes";

export type NodeCategory =
  | "input"
  | "substrate"
  | "field"
  | "renderer"
  | "appearance"
  | "output";

export type NodeDefinition = {
  type: GraphNodeType;
  label: string;
  category: NodeCategory;
  inputs: GraphSocket[];
  outputs: GraphSocket[];
  experimental?: boolean;
};
