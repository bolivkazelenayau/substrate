export interface GlyphDisplacementScenario {
  mode: "warp" | "horizontal-slices" | "vertical-slices" | "grid" | "radial-sectors";
  strength: number;
  responseRadius: number;
  fragmentSize: number;
  gap: number;
  quantizationSteps: number;
  direction: number;
  radialTangential: number;
  jitter: number;
  fragmentRotation: number;
  dotGrid: boolean;
  gridSpacing: number;
  fontSize: number;
}

export const glyphDisplacementScenarios = {
  horizontal: {
    mode: "horizontal-slices",
    strength: 108,
    responseRadius: 620,
    fragmentSize: 46,
    gap: 15,
    quantizationSteps: 6,
    direction: 0,
    radialTangential: 0,
    jitter: 8,
    fragmentRotation: 0.5,
    dotGrid: true,
    gridSpacing: 11,
    fontSize: 260,
  },
  grid: {
    mode: "grid",
    strength: 92,
    responseRadius: 560,
    fragmentSize: 54,
    gap: 12,
    quantizationSteps: 6,
    direction: -15,
    radialTangential: 30,
    jitter: 20,
    fragmentRotation: 1.5,
    dotGrid: true,
    gridSpacing: 11,
    fontSize: 260,
  },
  radial: {
    mode: "radial-sectors",
    strength: 132,
    responseRadius: 230,
    fragmentSize: 38,
    gap: 9,
    quantizationSteps: 8,
    direction: 0,
    radialTangential: 100,
    jitter: 6,
    fragmentRotation: 0.75,
    dotGrid: true,
    gridSpacing: 11,
    fontSize: 280,
  },
  dotMatrix: {
    mode: "grid",
    strength: 78,
    responseRadius: 600,
    fragmentSize: 58,
    gap: 10,
    quantizationSteps: 6,
    direction: 0,
    radialTangential: 25,
    jitter: 12,
    fragmentRotation: 0.75,
    dotGrid: true,
    gridSpacing: 12,
    fontSize: 260,
  },
  combined: {
    mode: "grid",
    strength: 88,
    responseRadius: 520,
    fragmentSize: 52,
    gap: 12,
    quantizationSteps: 6,
    direction: 10,
    radialTangential: 40,
    jitter: 18,
    fragmentRotation: 1.5,
    dotGrid: true,
    gridSpacing: 11,
    fontSize: 260,
  },
} as const satisfies Record<string, GlyphDisplacementScenario>;
