import type { NodeInputSocket, NodeOutputSocket } from "./socketTypes";

export interface NodeDefinition {
  type: string;
  version: number;
  label: string;
  inputs: readonly NodeInputSocket[];
  outputs: readonly NodeOutputSocket[];
}
