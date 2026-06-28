export const APP_NAME = "SUBSTRATE";
export const APP_VERSION = "0.14.0";

export const VIEWPORT = {
  width: 1200,
  height: 720,
  paddingX: 55,
  paddingY: 70,
  centerX: 600,
  centerY: 360,
} as const;

export const TEXT_LAYOUT = {
  x: VIEWPORT.centerX,
  baselineY: 405,
  anchor: "middle",
  fontFamily: "Arial Black, sans-serif",
  fontWeight: 900,
} as const;

export const COLORS = {
  background: "#11110f",
  artwork: "#e8ff45",
} as const;

export const SVG_IDS = {
  mask: "glyph-mask",
  background: "background",
  substrateMask: "substrate-mask",
  artwork: "generated-artwork",
  sourceText: "source-text-hidden",
  substrateOutline: "substrate-outline",
} as const;
