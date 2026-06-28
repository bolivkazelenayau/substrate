import { buildSubstrate } from "./buildSubstrate";
import type { RasterSurfaceFactory } from "./rasterizeGlyphs";
import type { SubstrateWorkerRequest, SubstrateWorkerResponse } from "./backends/workerMessages";

const workerRasterSurfaceFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("OffscreenCanvas 2D context is unavailable.");
  if (typeof Path2D === "undefined") throw new Error("Path2D is unavailable in this worker.");
  return {
    context,
    createPath: (pathData) => new Path2D(pathData),
  };
};

self.onmessage = (event: MessageEvent<SubstrateWorkerRequest>) => {
  const message = event.data;
  if (message.type === "ping") {
    const response: SubstrateWorkerResponse = { type: "pong", requestId: message.requestId };
    self.postMessage(response);
    return;
  }
  if (message.type === "self-test") {
    const offscreenCanvas = typeof OffscreenCanvas !== "undefined";
    const path2D = typeof Path2D !== "undefined";
    let rasterization = false;
    let error: string | null = null;
    if (offscreenCanvas && path2D) {
      try {
        const canvas = new OffscreenCanvas(16, 16);
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("OffscreenCanvas 2D context is unavailable.");
        context.fillStyle = "black";
        context.fillRect(0, 0, 16, 16);
        context.fillStyle = "white";
        context.fill(new Path2D("M2 2H14V14H2Z"));
        rasterization = context.getImageData(8, 8, 1, 1).data[0] > 0;
        if (!rasterization) error = "Worker rasterization probe produced no coverage.";
      } catch (cause) {
        error = cause instanceof Error ? cause.message : "Worker rasterization probe failed.";
      }
    } else {
      error = !offscreenCanvas
        ? "OffscreenCanvas is unavailable in the worker."
        : "Path2D is unavailable in the worker.";
    }
    const probe = new Float32Array([17, 29]);
    const response: SubstrateWorkerResponse = {
      type: "self-test-result",
      requestId: message.requestId,
      offscreenCanvas,
      path2D,
      rasterization,
      probe,
      error,
    };
    self.postMessage(response, { transfer: [probe.buffer] });
    return;
  }
  if (message.type !== "build") return;
  const started = performance.now();
  try {
    const result = buildSubstrate(message.input, workerRasterSurfaceFactory);
    if (result.error) {
      const error = result.error;
      const normalized = error.toLowerCase();
      const code = normalized.includes("offscreen")
        ? "offscreen-canvas-unavailable"
        : normalized.includes("path2d")
          ? "path2d-unavailable"
          : normalized.includes("raster")
            ? "rasterization-failed"
            : "unknown";
      const response: SubstrateWorkerResponse = { type: "error", requestId: message.requestId, code, error };
      self.postMessage(response);
      return;
    }
    const response: SubstrateWorkerResponse = {
      type: "result",
      requestId: message.requestId,
      result,
      workerComputeMs: performance.now() - started,
    };
    const transfers = [
      result.data.mask.data.buffer,
      result.data.edge.data.buffer,
      result.data.distance.data.buffer,
    ];
    self.postMessage(response, { transfer: transfers });
  } catch (error) {
    const response: SubstrateWorkerResponse = {
      type: "error",
      requestId: message.requestId,
      code: "unknown",
      error: error instanceof Error ? error.message : "Unknown substrate worker error.",
    };
    self.postMessage(response);
  }
};
