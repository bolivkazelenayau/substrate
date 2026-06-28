import type { EdgeMap, RasterMask } from "./types";

export function buildEdgeMap(mask: RasterMask, threshold = 0.5): EdgeMap {
  const { width, height } = mask;
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const inside = mask.data[index] >= threshold;
      let edge = false;
      for (let offsetY = -1; offsetY <= 1 && !edge; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nx = x + offsetX;
          const ny = y + offsetY;
          const neighborInside = nx >= 0 && nx < width && ny >= 0 && ny < height
            ? mask.data[ny * width + nx] >= threshold
            : false;
          if (neighborInside !== inside) {
            edge = true;
            break;
          }
        }
      }
      data[index] = edge ? 1 : 0;
    }
  }
  return { width, height, data };
}
