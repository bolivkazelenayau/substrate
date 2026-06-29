import type { GlyphBounds, TextGeometry } from "../glyphGeometry";
import type { KerningMode } from "../../types";

export interface SubstrateResolution {
  width: number;
  height: number;
}

export interface RasterMask {
  width: number;
  height: number;
  data: Float32Array;
}

export interface EdgeMap {
  width: number;
  height: number;
  data: Float32Array;
}

export interface DistanceField {
  width: number;
  height: number;
  data: Float32Array;
}

export interface DistanceGradient {
  x: number;
  y: number;
  magnitude: number;
}

export type SubstrateDebugMode = "none" | "glyph-outlines" | "mask" | "edge" | "distance" | "gradient";
export type SubstrateType = "glyph-paths" | "native-text-fallback" | "empty";

export interface SubstrateDiagnostics {
  maskCoverage: number;
  edgePixelCount: number;
  minDistance: number;
  maxDistance: number;
  rasterizeTimeMs: number;
  edgeMapTimeMs: number;
  distanceFieldTimeMs: number;
  buildTimeMs: number;
}

export interface SubstrateData {
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  scaleX: number;
  scaleY: number;
  sourceText: string;
  substrateType: SubstrateType;
  mask: RasterMask;
  edge: EdgeMap;
  distance: DistanceField;
  bounds: GlyphBounds | null;
  diagnostics: SubstrateDiagnostics;
}

export interface SubstrateBuildResult {
  data: SubstrateData;
  error: string | null;
}

export interface SubstrateBuildInput {
  sourceText: string;
  textGeometry: TextGeometry | null;
  fontSize: number;
  tracking: number;
  fontFamily: string;
  fontWeight: number;
  baselineY: number;
  textX: number;
  kerningMode?: KerningMode;
  resolution: SubstrateResolution;
  bounds: GlyphBounds | null;
}
