import type { GraphSocketId } from "./graphTypes";

export type GraphValueKind =
  | "number"
  | "boolean"
  | "string"
  | "color"
  | "enum"
  | "point"
  | "bounds"
  | "glyph-geometry"
  | "mask-field"
  | "distance-field"
  | "scalar-field"
  | "vector-field"
  | "geometry"
  | "appearance";

export type GraphSocketDirection = "input" | "output";

export type GraphSocket = {
  id: GraphSocketId;
  label: string;
  kind: GraphValueKind;
  direction: GraphSocketDirection;
  required?: boolean;
  defaultValue?: unknown;
};
