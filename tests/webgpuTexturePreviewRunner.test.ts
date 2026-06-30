import { describe, expect, it, vi } from "vitest";
import {
  createSustainedTexturePreviewHarness,
  createTexturePreviewSustainedRunner,
  runTexturePreviewPacingSuite,
  summarizeSustainedTexturePreview,
  TEXTURE_PREVIEW_PRESENTATION_MODES,
  texturePreviewPacingTableRows,
  type AnimationFrameScheduler,
} from "../src/engine/gpu/webgpuTexturePreviewRunner";
import type {
  TexturePreviewControllerState,
  TexturePreviewFrameTiming,
  WebGpuTexturePreviewController,
} from "../src/engine/gpu/webgpuTexturePreview";

function fakeAnimationFrames(): AnimationFrameScheduler & {
  runNext(timestamp: number): Promise<void>;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, (timestamp: number) => void>();
  return {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancel(handle) {
      callbacks.delete(handle);
    },
    async runNext(timestamp) {
      const entry = callbacks.entries().next().value as
        | [number, (value: number) => void]
        | undefined;
      if (!entry) {
        throw new Error("No animation frame scheduled.");
      }
      callbacks.delete(entry[0]);
      entry[1](timestamp);
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function automaticAnimationFrames(): AnimationFrameScheduler {
  let nextHandle = 1;
  let timestamp = 0;
  const active = new Set<number>();
  return {
    request(callback) {
      const handle = nextHandle;
      nextHandle += 1;
      active.add(handle);
      queueMicrotask(() => {
        if (!active.delete(handle)) {
          return;
        }
        timestamp += 16;
        callback(timestamp);
      });
      return handle;
    },
    cancel(handle) {
      active.delete(handle);
    },
  };
}

function mockController(
  timing: TexturePreviewFrameTiming = {
    frameEnqueueMs: 0.2,
    queueCompletionMs: null,
    synchronized: false,
    cpuFallbackMs: null,
  },
): WebGpuTexturePreviewController & { lose(): void } {
  let state: TexturePreviewControllerState = "active";
  const listeners = new Set<(details: { message?: string }) => void>();
  return {
    size: 256,
    backend: "webgpu-texture",
    render: vi.fn(async (_parameters, options) => ({
      ...timing,
      synchronized: options?.synchronize === true,
      queueCompletionMs: options?.synchronize ? 5 : null,
    })),
    getState: () => state,
    onDeviceLost(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateField: vi.fn(),
    lose() {
      state = "lost";
      for (const listener of listeners) {
        listener({ message: "synthetic loss" });
      }
    },
    dispose() {
      state = "disposed";
    },
  };
}

describe("sustained texture preview runner", () => {
  it("defines the Gate 4C presentation modes", () => {
    expect(TEXTURE_PREVIEW_PRESENTATION_MODES).toEqual([
      "webgpu-render-only-static",
      "webgpu-render-only-changing",
      "webgpu-compute-render-changing",
    ]);
  });

  it("summarizes frame timing and late-frame indicators", () => {
    const summary = summarizeSustainedTexturePreview(
      [
        {
          frameIndex: 0,
          timestampMs: 0,
          intervalMs: null,
          timing: {
            frameEnqueueMs: 0.2,
            queueCompletionMs: null,
            synchronized: false,
            cpuFallbackMs: null,
          },
        },
        {
          frameIndex: 1,
          timestampMs: 16,
          intervalMs: 16,
          timing: {
            frameEnqueueMs: 0.4,
            queueCompletionMs: null,
            synchronized: false,
            cpuFallbackMs: null,
          },
        },
        {
          frameIndex: 2,
          timestampMs: 50,
          intervalMs: 34,
          timing: {
            frameEnqueueMs: 0.3,
            queueCompletionMs: null,
            synchronized: false,
            cpuFallbackMs: null,
          },
        },
      ],
      {
        mode: "normal-unsynchronized",
        requestedFrameCount: 3,
        targetFps: 60,
        totalWallClockMs: 50,
      },
    );

    expect(summary).toMatchObject({
      completedFrameCount: 3,
      approximateFps: 60,
      lateFrameCount: 1,
      droppedFrameCount: 1,
      enqueueMs: { min: 0.2, median: 0.3, max: 0.4, sampleCount: 3 },
      frameIntervalMs: { median: 25, sampleCount: 2 },
      synchronizedQueueCompletionMs: { sampleCount: 0 },
    });
  });

  it("runs normal frames without synchronization and supports stop", async () => {
    const scheduler = fakeAnimationFrames();
    const controller = mockController();
    let now = 0;
    const runner = createTexturePreviewSustainedRunner(controller, {
      animationFrame: scheduler,
      clock: () => now,
    });
    const completed = runner.start({ frameCount: 3 });
    expect(runner.getState()).toBe("running");
    now = 16;
    await scheduler.runNext(16);
    now = 32;
    await scheduler.runNext(32);
    runner.stop();
    const summary = await completed;

    expect(runner.getState()).toBe("stopped");
    expect(summary.completedFrameCount).toBe(2);
    expect(summary.mode).toBe("normal-unsynchronized");
    expect(controller.render).toHaveBeenCalledTimes(2);
    expect(controller.render).toHaveBeenLastCalledWith(
      expect.any(Object),
      {
        synchronize: false,
        skipCompute: false,
        presentationPhase: 0,
      },
    );
  });

  it("labels diagnostic synchronization as opt-in", async () => {
    const scheduler = fakeAnimationFrames();
    const controller = mockController();
    let now = 0;
    const runner = createTexturePreviewSustainedRunner(controller, {
      animationFrame: scheduler,
      clock: () => now,
    });
    const completed = runner.runSustainedTiming({
      frameCount: 1,
      diagnosticSync: true,
    });
    now = 20;
    await scheduler.runNext(20);
    const summary = await completed;

    expect(summary.mode).toBe("synchronized-diagnostic");
    expect(summary.synchronizedQueueCompletionMs).toMatchObject({
      median: 5,
      sampleCount: 1,
    });
    expect(controller.render).toHaveBeenCalledWith(expect.any(Object), {
      synchronize: true,
      skipCompute: false,
      presentationPhase: 0,
    });
  });

  it("stops safely when the WebGPU device is lost", async () => {
    const scheduler = fakeAnimationFrames();
    const controller = mockController();
    const runner = createTexturePreviewSustainedRunner(controller, {
      animationFrame: scheduler,
    });
    const completed = runner.start({ frameCount: 10 });
    controller.lose();
    const summary = await completed;

    expect(runner.getState()).toBe("device-lost");
    expect(summary.completedFrameCount).toBe(0);
  });

  it("transitions from idle through running to completed", async () => {
    const scheduler = fakeAnimationFrames();
    const runner = createTexturePreviewSustainedRunner(mockController(), {
      animationFrame: scheduler,
    });
    expect(runner.getState()).toBe("idle");
    const completed = runner.start({ frameCount: 1 });
    expect(runner.getState()).toBe("running");
    await scheduler.runNext(16);
    await completed;
    expect(runner.getState()).toBe("completed");
  });

  it("excludes warmup frames and reports warmup metadata", async () => {
    const scheduler = fakeAnimationFrames();
    const runner = createTexturePreviewSustainedRunner(mockController(), {
      animationFrame: scheduler,
      metadata: {
        internalTextureSize: 256,
        canvasBitmapWidth: 256,
        canvasBitmapHeight: 256,
        cssDisplayWidth: 512,
        cssDisplayHeight: 512,
        devicePixelRatio: 2,
      },
    });
    const completed = runner.start({
      frameCount: 1,
      warmupFrameCount: 2,
      diagnosticMode: "webgpu-compute-render-changing",
    });
    await scheduler.runNext(16);
    await scheduler.runNext(32);
    await scheduler.runNext(48);
    const summary = await completed;

    expect(summary).toMatchObject({
      requestedWarmupCount: 2,
      completedWarmupCount: 2,
      requestedFrameCount: 1,
      completedFrameCount: 1,
      diagnosticMode: "webgpu-compute-render-changing",
      metadata: {
        internalTextureSize: 256,
        canvasBitmapWidth: 256,
        cssDisplayWidth: 512,
        devicePixelRatio: 2,
        warmupCount: 2,
        recordedFrameCount: 1,
      },
    });
    expect(summary.warmupFrames).toHaveLength(2);
    expect(summary.frames).toHaveLength(1);
    expect(summary.enqueueMs.sampleCount).toBe(1);
  });

  it("rejects overlapping runs on the same runner", async () => {
    const scheduler = fakeAnimationFrames();
    const runner = createTexturePreviewSustainedRunner(mockController(), {
      animationFrame: scheduler,
    });
    const first = runner.start({ frameCount: 2 });
    await expect(runner.start({ frameCount: 1 })).rejects.toThrow(
      "already active",
    );
    runner.stop();
    await first;
  });

  it("cancels an active run when disposed", async () => {
    const scheduler = fakeAnimationFrames();
    const runner = createTexturePreviewSustainedRunner(mockController(), {
      animationFrame: scheduler,
    });
    const completed = runner.start({ frameCount: 5 });
    runner.dispose();
    const summary = await completed;
    expect(runner.getState()).toBe("disposed");
    expect(summary.completedFrameCount).toBe(0);
  });

  it("labels raf-only and canvas-2d diagnostic modes", async () => {
    const scheduler = fakeAnimationFrames();
    const draw = vi.fn();
    const runner = createTexturePreviewSustainedRunner(null, {
      animationFrame: scheduler,
      canvas2dDraw: draw,
    });
    const rafRun = runner.start({
      frameCount: 1,
      diagnosticMode: "raf-only",
    });
    await scheduler.runNext(16);
    expect((await rafRun).diagnosticMode).toBe("raf-only");

    const canvasRun = runner.start({
      frameCount: 1,
      diagnosticMode: "canvas-2d",
    });
    await scheduler.runNext(32);
    const canvasSummary = await canvasRun;
    expect(canvasSummary).toMatchObject({
      diagnosticMode: "canvas-2d",
      backend: "canvas-2d",
    });
    expect(draw).toHaveBeenCalledOnce();
  });

  it("runs render-only mode without a compute update", async () => {
    const scheduler = fakeAnimationFrames();
    const controller = mockController();
    const runner = createTexturePreviewSustainedRunner(controller, {
      animationFrame: scheduler,
    });
    const completed = runner.start({
      frameCount: 1,
      diagnosticMode: "webgpu-render-only",
    });
    await scheduler.runNext(16);
    const summary = await completed;

    expect(summary.diagnosticMode).toBe("webgpu-render-only");
    expect(controller.render).toHaveBeenCalledWith(expect.any(Object), {
      synchronize: false,
      skipCompute: true,
      presentationPhase: 0,
    });
  });

  it("creates a sustained harness over the CPU fallback", async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: (type: string) =>
        type === "2d"
          ? {
              createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
              }),
              putImageData: () => undefined,
            }
          : null,
    };
    const harness = await createSustainedTexturePreviewHarness(
      canvas as HTMLCanvasElement,
      {
        size: 256,
        requestDevice: async () => ({
          status: "unavailable",
          reason: "gpu-unavailable",
        }),
        animationFrame: fakeAnimationFrames(),
      },
    );

    expect(harness).not.toBeNull();
    expect(harness?.getMountResult()).toMatchObject({
      status: "cpu-fallback",
      rendered: true,
    });
    harness?.dispose();
  });

  it("runs and reports a raf-only pacing suite without WebGPU", async () => {
    const scheduler = fakeAnimationFrames();
    const run = runTexturePreviewPacingSuite({
      sizes: [256],
      modes: ["raf-only"],
      frameCount: 1,
      warmupFrameCount: 0,
      animationFrame: scheduler,
    });
    await scheduler.runNext(16);
    const result = await run;
    expect(result.entries[0]).toMatchObject({
      size: 256,
      mode: "raf-only",
      mountStatus: "not-required",
      fallbackReason: null,
      failureReason: null,
      summary: {
        diagnosticMode: "raf-only",
        backend: "none",
      },
    });
    expect(texturePreviewPacingTableRows(result)[0]).toMatchObject({
      mode: "raf-only",
      synchronizedQueueCompletionMedian: null,
    });
  });

  it("mounts every Gate 4C WebGPU mode or reports an explicit fallback", async () => {
    const createCanvas = (
      _size: 256 | 512,
      _mode: string,
      cssDisplaySize: number,
    ) => ({
      width: 0,
      height: 0,
      style: {
        width: `${cssDisplaySize}px`,
        height: `${cssDisplaySize}px`,
      },
      setAttribute: () => undefined,
      remove: vi.fn(),
      getContext: (type: string) =>
        type === "2d"
          ? {
              createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
              }),
              putImageData: () => undefined,
            }
          : null,
    }) as unknown as HTMLCanvasElement;
    const result = await runTexturePreviewPacingSuite({
      frameCount: 1,
      warmupFrameCount: 0,
      variants: [{ internalSize: 256, cssDisplaySize: 512 }],
      modes: [...TEXTURE_PREVIEW_PRESENTATION_MODES],
      animationFrame: automaticAnimationFrames(),
      createCanvas,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(result.entries).toHaveLength(3);
    for (const entry of result.entries) {
      expect(entry).toMatchObject({
        mountStatus: "cpu-fallback",
        fallbackReason: "gpu-unavailable",
        failureReason: null,
        metadata: {
          internalTextureSize: 256,
          canvasBitmapWidth: 256,
          cssDisplayWidth: 512,
          mode: entry.mode,
          warmupCount: 0,
          recordedFrameCount: 1,
        },
        summary: {
          backend: "cpu-canvas",
          completedFrameCount: 1,
        },
      });
    }
    const rows = texturePreviewPacingTableRows(result);
    expect(rows.every((row) => row.backend === "cpu-canvas")).toBe(true);
    expect(
      rows.every((row) => row.fallbackReason === "gpu-unavailable"),
    ).toBe(true);
  });

  it("reports an explicit failure when neither WebGPU nor fallback can mount", async () => {
    const result = await runTexturePreviewPacingSuite({
      frameCount: 1,
      warmupFrameCount: 0,
      variants: [{ internalSize: 256, cssDisplaySize: 256 }],
      modes: ["webgpu-render-only-static"],
      animationFrame: automaticAnimationFrames(),
      createCanvas: () =>
        ({
          width: 0,
          height: 0,
          style: {},
          setAttribute: () => undefined,
          remove: () => undefined,
          getContext: () => null,
        }) as unknown as HTMLCanvasElement,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });
    const entry = result.entries[0];

    expect(entry).toMatchObject({
      mountStatus: "cpu-fallback",
      fallbackReason: "canvas-2d-unavailable",
      failureReason: "canvas-2d-unavailable",
      summary: null,
      metadata: {
        internalTextureSize: 256,
        cssDisplayWidth: 256,
      },
    });
    expect(texturePreviewPacingTableRows(result)[0]).toMatchObject({
      mountStatus: "cpu-fallback",
      backend: "cpu-fallback",
      fallbackReason: "canvas-2d-unavailable",
      failureReason: "canvas-2d-unavailable",
    });
  });
});
