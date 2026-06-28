import type { SubstrateData, SubstrateDebugMode } from "./types";
import { measure } from "../performance";

export interface CachedDebugImage {
  url: string | null;
  durationMs: number;
}

const debugImageCache = new WeakMap<SubstrateData, Map<SubstrateDebugMode, CachedDebugImage>>();
const debugImagePromises = new WeakMap<SubstrateData, Map<SubstrateDebugMode, Promise<CachedDebugImage>>>();
const debugImageGenerationIds = new WeakMap<SubstrateData, Map<SubstrateDebugMode, number>>();
let debugImageGenerationId = 0;

export function createSubstrateDebugDataUrl(substrate: SubstrateData, mode: SubstrateDebugMode): string | null {
  if (!["mask", "edge", "distance"].includes(mode)) return null;
  const canvas = document.createElement("canvas");
  canvas.width = substrate.width;
  canvas.height = substrate.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(substrate.width, substrate.height);
  const maxAbsolute = Math.max(Math.abs(substrate.diagnostics.minDistance), Math.abs(substrate.diagnostics.maxDistance), 1);
  for (let index = 0; index < substrate.width * substrate.height; index += 1) {
    let red = 0;
    let green = 0;
    let blue = 0;
    if (mode === "mask") {
      red = green = blue = Math.round(substrate.mask.data[index] * 255);
    } else if (mode === "edge") {
      const value = Math.round(substrate.edge.data[index] * 255);
      red = value;
      green = Math.round(value * 0.8);
      blue = Math.round(value * 0.2);
    } else {
      const signed = substrate.distance.data[index] / maxAbsolute;
      if (signed >= 0) {
        green = Math.round(80 + signed * 175);
        blue = Math.round(120 + signed * 135);
      } else {
        red = Math.round(80 + -signed * 175);
        green = Math.round(40 + -signed * 60);
      }
    }
    image.data[index * 4] = red;
    image.data[index * 4 + 1] = green;
    image.data[index * 4 + 2] = blue;
    image.data[index * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

export function getCachedSubstrateDebugImage(substrate: SubstrateData, mode: SubstrateDebugMode): CachedDebugImage {
  let modes = debugImageCache.get(substrate);
  if (!modes) {
    modes = new Map();
    debugImageCache.set(substrate, modes);
  }
  const cached = modes.get(mode);
  if (cached) return cached;
  const result = measure(() => createSubstrateDebugDataUrl(substrate, mode));
  const image = { url: result.value, durationMs: result.durationMs };
  modes.set(mode, image);
  return image;
}

export interface DeferredDebugImage extends CachedDebugImage {
  generationId: number;
}

export function getDeferredSubstrateDebugImage(
  substrate: SubstrateData,
  mode: SubstrateDebugMode,
): Promise<DeferredDebugImage> {
  if (!["mask", "edge", "distance"].includes(mode)) {
    return Promise.resolve({ url: null, durationMs: 0, generationId: debugImageGenerationId });
  }
  let modes = debugImageCache.get(substrate);
  const cached = modes?.get(mode);
  const cachedGenerationId = debugImageGenerationIds.get(substrate)?.get(mode) ?? 0;
  if (cached) return Promise.resolve({ ...cached, generationId: cachedGenerationId });

  let promises = debugImagePromises.get(substrate);
  if (!promises) {
    promises = new Map();
    debugImagePromises.set(substrate, promises);
  }
  const pending = promises.get(mode);
  if (pending) {
    return pending.then((image) => ({
      ...image,
      generationId: debugImageGenerationIds.get(substrate)?.get(mode) ?? 0,
    }));
  }

  const promise = new Promise<CachedDebugImage>((resolve) => {
    const generate = () => {
      const image = getCachedSubstrateDebugImage(substrate, mode);
      debugImageGenerationId += 1;
      let ids = debugImageGenerationIds.get(substrate);
      if (!ids) {
        ids = new Map();
        debugImageGenerationIds.set(substrate, ids);
      }
      ids.set(mode, debugImageGenerationId);
      resolve(image);
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(generate, { timeout: 250 });
    } else {
      globalThis.setTimeout(generate, 0);
    }
  });
  promises.set(mode, promise);
  return promise.then((image) => ({
    ...image,
    generationId: debugImageGenerationIds.get(substrate)?.get(mode) ?? 0,
  }));
}
