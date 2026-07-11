export interface CanvasWorldTransformArtboard {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Canvas equivalent of SVG's default `preserveAspectRatio="xMidYMid meet"`. */
export function canvasWorldTransform(backingWidth: number, backingHeight: number, artboard: CanvasWorldTransformArtboard) {
  const scale = Math.min(backingWidth / artboard.width, backingHeight / artboard.height);
  const insetX = (backingWidth - artboard.width * scale) / 2;
  const insetY = (backingHeight - artboard.height * scale) / 2;
  return {
    a: scale, b: 0, c: 0, d: scale,
    e: insetX - artboard.x * scale,
    f: insetY - artboard.y * scale,
  } as const;
}
