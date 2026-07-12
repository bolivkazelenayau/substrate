import type { FieldControlId } from "../types";

export type ParameterClass =
  | "typography"
  | "scene"
  | "substrate"
  | "renderer-geometry"
  | "renderer-style"
  | "diagnostics-ui";

/** Concise ownership map for active renderer controls (Part L). */
export const PARAMETER_OWNERSHIP: Record<string, ParameterClass> = {
  text: "typography",
  fontSize: "typography",
  textOffsetY: "scene",
  artboard: "scene",
  tracking: "typography",
  lineHeight: "typography",
  textAlign: "typography",
  seed: "renderer-geometry",
  density: "renderer-geometry",
  amplitude: "renderer-geometry",
  frequency: "renderer-geometry",
  turbulence: "renderer-geometry",
  edgeInfluence: "renderer-geometry",
  maxNodes: "renderer-geometry",
  substrateQuality: "substrate",
  primaryColor: "renderer-style",
  backgroundColor: "renderer-style",
  transparentBackground: "renderer-style",
  exportFrameMode: "diagnostics-ui",
};