import type { DistanceGradient, SubstrateData } from "./types";

function bilinear(data: Float32Array, width: number, height: number, x: number, y: number) {
  const px = Math.max(0, Math.min(width - 1, x));
  const py = Math.max(0, Math.min(height - 1, y));
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;
  const top = data[y0 * width + x0] * (1 - tx) + data[y0 * width + x1] * tx;
  const bottom = data[y1 * width + x0] * (1 - tx) + data[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

function worldToRaster(substrate: SubstrateData, x: number, y: number) {
  return {
    x: x / substrate.viewportWidth * (substrate.width - 1),
    y: y / substrate.viewportHeight * (substrate.height - 1),
  };
}

export function sampleMask(substrate: SubstrateData, x: number, y: number) {
  const point = worldToRaster(substrate, x, y);
  return bilinear(substrate.mask.data, substrate.width, substrate.height, point.x, point.y);
}

export function sampleEdge(substrate: SubstrateData, x: number, y: number) {
  const point = worldToRaster(substrate, x, y);
  return bilinear(substrate.edge.data, substrate.width, substrate.height, point.x, point.y);
}

export function sampleDistance(substrate: SubstrateData, x: number, y: number) {
  const point = worldToRaster(substrate, x, y);
  return bilinear(substrate.distance.data, substrate.width, substrate.height, point.x, point.y);
}

export function sampleDistanceGradient(substrate: SubstrateData, x: number, y: number): DistanceGradient {
  const stepX = substrate.scaleX;
  const stepY = substrate.scaleY;
  const gx = (sampleDistance(substrate, x + stepX, y) - sampleDistance(substrate, x - stepX, y)) / (stepX * 2);
  const gy = (sampleDistance(substrate, x, y + stepY) - sampleDistance(substrate, x, y - stepY)) / (stepY * 2);
  return { x: gx, y: gy, magnitude: Math.hypot(gx, gy) };
}
