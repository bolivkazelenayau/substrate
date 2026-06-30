export interface Point {
  x: number;
  y: number;
}

export interface LineSegment {
  type: "line";
  start: Point;
  end: Point;
  opacity: number;
}

export interface CircleMark {
  type: "circle";
  center: Point;
  radius: number;
  opacity: number;
}

export interface Polyline {
  type: "polyline";
  points: Point[];
  opacity: number;
}

export interface PathGeometry {
  type: "path";
  d: string;
  opacity: number;
}

export type VectorGeometry = LineSegment | CircleMark | Polyline | PathGeometry;

export interface RendererDiagnostics {
  acceptedCandidates: number;
  rejectedCandidates: number;
  averageSampledDistance: number;
  substrateAvailable: boolean;
  fallback: boolean;
  requestedStreamlines?: number;
  acceptedStreamlines?: number;
  rejectedSeeds?: number;
  totalPolylinePoints?: number;
  averagePointsPerStreamline?: number;
  stoppedOutsideMask?: number;
  stoppedInvalidGradient?: number;
  occupancyRejections?: number;
  contourLevelCount?: number;
  extractedFragments?: number;
  totalContourPoints?: number;
  skippedFragments?: number;
  maxPositiveDistance?: number;
  averageFragmentLength?: number;
  maxNodesClipped?: boolean;
  requestedDots?: number;
  acceptedDots?: number;
  candidateCount?: number;
  preCapAcceptedCount?: number;
  cappedCount?: number;
  effectiveDensity?: number;
  effectiveStrengthResponse?: number;
  rejectedOutsideMask?: number;
  rejectedBySpacing?: number;
  averageRadius?: number;
  minRadius?: number;
  maxRadius?: number;
  warning?: string;
  selectedGlyph?: string;
  emitterAnchorX?: number;
  emitterAnchorY?: number;
  fieldWidth?: number;
  fieldHeight?: number;
  fieldMin?: number;
  fieldMax?: number;
  fieldBuildTimeMs?: number;
  contourExtractionTimeMs?: number;
  fieldMembership?: "glyph-bounds-approximate";
  waveContourMode?: "continuous" | "dotted";
  emitterSourceMode?: string;
  waveOutputCount?: number;
  diffuserDomain?: string;
  averageOpacity?: number;
  rejectedByInfluence?: number;
  rejectedFarFieldCandidates?: number;
  averageRingStrength?: number;
  averageFalloff?: number;
  acceptedCrestDots?: number;
  diffuserComposition?: string;
  rendererActiveFieldEmitterCount?: number;
  activeContributingEmitterCount?: number;
  zeroStrengthEmitterCount?: number;
  consumedFieldMode?: string;
  renderedMarkCountPerEmitter?: Record<string, number>;
  fieldNormalizationMode?: "none" | "local" | "global";
  artboardBoundsClipped?: boolean;
  artboardEdgeFeather?: number;
  emitterDomainDiagnostics?: Array<{
    id: string;
    anchorX: number;
    anchorY: number;
    weight: number;
    effectiveStrength: number;
    radiusMultiplier: number;
    effectiveRadius: number;
    samplingRadius: number;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
    sampleCount: number;
    renderedMarkCount: number;
  }>;
  glyphFieldEnabled?: boolean;
  glyphFieldMode?: string;
  averageGlyphFieldValue?: number;
  averageGlyphFieldDisplacement?: number;
  rejectedDisplacedCandidates?: number;
  fieldInfluencedAcceptanceCount?: number;
}

export interface GeometryGroup {
  id: string;
  geometries: VectorGeometry[];
  diagnostics?: RendererDiagnostics;
}

export function geometryNodeCost(group: GeometryGroup): number {
  return group.geometries.reduce((cost, geometry) => {
    if (geometry.type === "polyline") return cost + geometry.points.length;
    if (geometry.type === "path") return cost + Math.max(1, geometry.d.split(/[MLCQAZ]/i).length - 1);
    return cost + 1;
  }, 0);
}
