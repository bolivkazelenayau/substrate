import type { DistanceField, EdgeMap, RasterMask } from "./types";

const SQRT_TWO = Math.SQRT2;

export function buildSignedDistanceField(mask: RasterMask, edge: EdgeMap, worldScaleX: number, worldScaleY: number): DistanceField {
  const { width, height } = mask;
  const count = width * height;
  const distance = new Float32Array(count);
  const fallback = Math.hypot(width, height);
  let hasEdge = false;
  for (let index = 0; index < count; index += 1) {
    if (edge.data[index] > 0) {
      distance[index] = 0;
      hasEdge = true;
    } else {
      distance[index] = Number.POSITIVE_INFINITY;
    }
  }

  if (hasEdge) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        let value = distance[index];
        if (x > 0) value = Math.min(value, distance[index - 1] + 1);
        if (y > 0) value = Math.min(value, distance[index - width] + 1);
        if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + SQRT_TWO);
        if (x < width - 1 && y > 0) value = Math.min(value, distance[index - width + 1] + SQRT_TWO);
        distance[index] = value;
      }
    }
    for (let y = height - 1; y >= 0; y -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = y * width + x;
        let value = distance[index];
        if (x < width - 1) value = Math.min(value, distance[index + 1] + 1);
        if (y < height - 1) value = Math.min(value, distance[index + width] + 1);
        if (x < width - 1 && y < height - 1) value = Math.min(value, distance[index + width + 1] + SQRT_TWO);
        if (x > 0 && y < height - 1) value = Math.min(value, distance[index + width - 1] + SQRT_TWO);
        distance[index] = value;
      }
    }
  }

  const worldScale = (worldScaleX + worldScaleY) / 2;
  for (let index = 0; index < count; index += 1) {
    const unsigned = (Number.isFinite(distance[index]) ? distance[index] : fallback) * worldScale;
    distance[index] = mask.data[index] >= 0.5 ? unsigned : -unsigned;
  }
  return { width, height, data: distance };
}
