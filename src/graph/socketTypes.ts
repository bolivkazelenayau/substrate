export type GraphOutputKind =
  | "scalar-field"
  | "vector-field"
  | "mask-field"
  | "distance-field"
  | "geometry"
  | "appearance";

export interface NodeInputSocket {
  id: string;
  label: string;
  accepts: readonly GraphOutputKind[];
  required?: boolean;
}

export interface NodeOutputSocket {
  id: string;
  label: string;
  kind: GraphOutputKind;
}
