import {
  mountWebGpuTexturePreview,
  type TexturePreviewFrameTiming,
  type TexturePreviewParameters,
  type WebGpuTexturePreviewController,
  type WebGpuTexturePreviewResult,
} from "./webgpuTexturePreview";
import {
  summarizeTimingSamples,
  type TimingStatistics,
} from "./webgpuRepeatedBenchmark";
import type { WebGpuDeviceResult } from "./webgpuSupport";

type Clock = () => number;

export interface AnimationFrameScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

export interface SustainedTexturePreviewFrame {
  frameIndex: number;
  timestampMs: number;
  intervalMs: number | null;
  timing: TexturePreviewFrameTiming;
}

export interface SustainedTexturePreviewSummary {
  mode: "normal-unsynchronized" | "synchronized-diagnostic";
  diagnosticMode: TexturePreviewPacingMode;
  backend: "none" | "canvas-2d" | "webgpu-texture" | "cpu-canvas";
  requestedFrameCount: number;
  completedFrameCount: number;
  requestedWarmupCount: number;
  completedWarmupCount: number;
  totalWallClockMs: number;
  approximateFps: number;
  targetFrameMs: number;
  lateFrameCount: number;
  droppedFrameCount: number;
  intervalP95Exceeds25Ms: boolean;
  droppedFrameThreshold: number;
  droppedFramesExceedThreshold: boolean;
  enqueueMs: TimingStatistics;
  frameIntervalMs: TimingStatistics;
  synchronizedQueueCompletionMs: TimingStatistics;
  frames: SustainedTexturePreviewFrame[];
  warmupFrames: SustainedTexturePreviewFrame[];
  metadata: TexturePreviewPacingMetadata;
}

export type SustainedTexturePreviewRunnerState =
  | "idle"
  | "running"
  | "stopped"
  | "completed"
  | "device-lost"
  | "disposed";

export interface SustainedTexturePreviewRunOptions {
  frameCount?: number;
  targetFps?: number;
  diagnosticSync?: boolean;
  diagnosticMode?: TexturePreviewPacingMode;
  warmupFrameCount?: number;
  parameters?:
    | TexturePreviewParameters
    | ((frameIndex: number) => TexturePreviewParameters);
}

export type TexturePreviewPacingMode =
  | "raf-only"
  | "canvas-2d"
  | "webgpu-render-only"
  | "webgpu-compute-render"
  | "webgpu-static-frame"
  | "webgpu-render-only-static"
  | "webgpu-render-only-changing"
  | "webgpu-compute-render-changing";

export interface TexturePreviewPacingMetadata {
  internalTextureSize: number | null;
  canvasBitmapWidth: number | null;
  canvasBitmapHeight: number | null;
  cssDisplayWidth: number | null;
  cssDisplayHeight: number | null;
  devicePixelRatio: number;
  mode: TexturePreviewPacingMode;
  warmupCount: number;
  recordedFrameCount: number;
}

export interface SustainedTexturePreviewRunner {
  start(
    options?: SustainedTexturePreviewRunOptions,
  ): Promise<SustainedTexturePreviewSummary>;
  runSustainedTiming(
    options?: SustainedTexturePreviewRunOptions,
  ): Promise<SustainedTexturePreviewSummary>;
  stop(): void;
  getState(): SustainedTexturePreviewRunnerState;
  getTimingSummary(): SustainedTexturePreviewSummary | null;
  dispose(): void;
}

export interface SustainedTexturePreviewHarness {
  start(
    options?: SustainedTexturePreviewRunOptions,
  ): Promise<SustainedTexturePreviewSummary>;
  runSustainedTiming(
    options?: SustainedTexturePreviewRunOptions,
  ): Promise<SustainedTexturePreviewSummary>;
  stop(): void;
  getState(): SustainedTexturePreviewRunnerState;
  getTimingSummary(): SustainedTexturePreviewSummary | null;
  getMountResult(): WebGpuTexturePreviewResult;
  recreate(): Promise<WebGpuTexturePreviewResult>;
  dispose(): void;
}

export const TEXTURE_PREVIEW_PACING_MODES: readonly TexturePreviewPacingMode[] = [
  "raf-only",
  "canvas-2d",
  "webgpu-render-only",
  "webgpu-compute-render",
];

export const TEXTURE_PREVIEW_PRESENTATION_MODES: readonly TexturePreviewPacingMode[] =
  [
    "webgpu-render-only-static",
    "webgpu-render-only-changing",
    "webgpu-compute-render-changing",
  ];

export interface TexturePreviewPacingSuiteEntry {
  size: 256 | 512;
  cssDisplaySize: number;
  mode: TexturePreviewPacingMode;
  mountStatus: "not-required" | "ready" | "cpu-fallback" | "error";
  fallbackReason: string | null;
  failureReason: string | null;
  metadata: TexturePreviewPacingMetadata;
  summary: SustainedTexturePreviewSummary | null;
}

export interface TexturePreviewPacingSuiteResult {
  frameCount: number;
  sizes: Array<256 | 512>;
  modes: TexturePreviewPacingMode[];
  entries: TexturePreviewPacingSuiteEntry[];
}

const defaultClock: Clock = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

const defaultAnimationFrame: AnimationFrameScheduler = {
  request(callback) {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(callback);
    }
    return setTimeout(() => callback(defaultClock()), 16) as unknown as number;
  },
  cancel(handle) {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
      return;
    }
    clearTimeout(handle);
  },
};

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be greater than zero.`);
  }
  return value;
}

export function summarizeSustainedTexturePreview(
  frames: readonly SustainedTexturePreviewFrame[],
  options: {
    mode: SustainedTexturePreviewSummary["mode"];
    diagnosticMode?: TexturePreviewPacingMode;
    backend?: SustainedTexturePreviewSummary["backend"];
    requestedFrameCount: number;
    targetFps: number;
    totalWallClockMs: number;
    warmupFrames?: readonly SustainedTexturePreviewFrame[];
    metadata?: Partial<TexturePreviewPacingMetadata>;
    droppedFrameThreshold?: number;
  },
): SustainedTexturePreviewSummary {
  const targetFrameMs = 1000 / options.targetFps;
  const warmupFrames = [...(options.warmupFrames ?? [])];
  const intervals = frames.flatMap(({ intervalMs }) =>
    intervalMs === null ? [] : [intervalMs],
  );
  const enqueue = frames.map(({ timing }) => timing.frameEnqueueMs);
  const completion = frames.flatMap(({ timing }) =>
    timing.queueCompletionMs === null ? [] : [timing.queueCompletionMs],
  );
  const intervalStats = summarizeTimingSamples(intervals);
  const droppedFrameThreshold = options.droppedFrameThreshold ?? 5;
  const diagnosticMode =
    options.diagnosticMode ?? "webgpu-compute-render";
  return {
    mode: options.mode,
    diagnosticMode,
    backend: options.backend ?? "webgpu-texture",
    requestedFrameCount: options.requestedFrameCount,
    completedFrameCount: frames.length,
    requestedWarmupCount:
      options.metadata?.warmupCount ?? warmupFrames.length,
    completedWarmupCount: warmupFrames.length,
    totalWallClockMs: options.totalWallClockMs,
    approximateFps:
      options.totalWallClockMs > 0
        ? (frames.length * 1000) / options.totalWallClockMs
        : 0,
    targetFrameMs,
    lateFrameCount: intervals.filter(
      (interval) => interval > targetFrameMs * 1.1,
    ).length,
    droppedFrameCount: intervals.filter(
      (interval) => interval > targetFrameMs * 1.5,
    ).length,
    intervalP95Exceeds25Ms:
      intervalStats.p95 !== null && intervalStats.p95 > 25,
    droppedFrameThreshold,
    droppedFramesExceedThreshold:
      intervals.filter((interval) => interval > targetFrameMs * 1.5).length >
      droppedFrameThreshold,
    enqueueMs: summarizeTimingSamples(enqueue),
    frameIntervalMs: intervalStats,
    synchronizedQueueCompletionMs: summarizeTimingSamples(completion),
    frames: [...frames],
    warmupFrames,
    metadata: {
      internalTextureSize:
        options.metadata?.internalTextureSize ?? null,
      canvasBitmapWidth:
        options.metadata?.canvasBitmapWidth ?? null,
      canvasBitmapHeight:
        options.metadata?.canvasBitmapHeight ?? null,
      cssDisplayWidth:
        options.metadata?.cssDisplayWidth ?? null,
      cssDisplayHeight:
        options.metadata?.cssDisplayHeight ?? null,
      devicePixelRatio:
        options.metadata?.devicePixelRatio ??
        (typeof devicePixelRatio === "number" ? devicePixelRatio : 1),
      mode: diagnosticMode,
      warmupCount:
        options.metadata?.warmupCount ?? warmupFrames.length,
      recordedFrameCount:
        options.metadata?.recordedFrameCount ?? frames.length,
    },
  };
}

export function createTexturePreviewSustainedRunner(
  controller: WebGpuTexturePreviewController | null,
  options: {
    animationFrame?: AnimationFrameScheduler;
    clock?: Clock;
    canvas2dDraw?: (frameIndex: number) => void;
    metadata?: Partial<TexturePreviewPacingMetadata>;
  } = {},
): SustainedTexturePreviewRunner {
  const animationFrame = options.animationFrame ?? defaultAnimationFrame;
  const clock = options.clock ?? defaultClock;
  let state: SustainedTexturePreviewRunnerState = "idle";
  let lastSummary: SustainedTexturePreviewSummary | null = null;
  let activeHandle: number | null = null;
  let activeFinish: ((state: SustainedTexturePreviewRunnerState) => void) | null =
    null;
  let activePromise: Promise<SustainedTexturePreviewSummary> | null = null;

  const unsubscribeLoss = controller?.onDeviceLost(() => {
    if (state === "running") {
      activeFinish?.("device-lost");
    } else if (state !== "disposed") {
      state = "device-lost";
    }
  }) ?? (() => undefined);

  const start = (
    runOptions: SustainedTexturePreviewRunOptions = {},
  ): Promise<SustainedTexturePreviewSummary> => {
    if (state === "disposed") {
      return Promise.reject(new Error("Sustained preview runner is disposed."));
    }
    if (controller?.getState() === "lost") {
      state = "device-lost";
      return Promise.resolve(
        summarizeSustainedTexturePreview([], {
          mode: runOptions.diagnosticSync
            ? "synchronized-diagnostic"
            : "normal-unsynchronized",
          diagnosticMode:
            runOptions.diagnosticMode ?? "webgpu-compute-render",
          backend: controller?.backend ?? "none",
          requestedFrameCount: runOptions.frameCount ?? 300,
          warmupFrames: [],
          metadata: {
            ...options.metadata,
            warmupCount: runOptions.warmupFrameCount ?? 0,
            recordedFrameCount: 0,
          },
          targetFps: runOptions.targetFps ?? 60,
          totalWallClockMs: 0,
        }),
      );
    }
    if (state === "running" && activePromise) {
      return Promise.reject(
        new Error("A sustained preview run is already active."),
      );
    }

    const frameCount = Math.floor(
      positiveNumber(runOptions.frameCount ?? 300, "frameCount"),
    );
    const warmupFrameCount = Math.floor(runOptions.warmupFrameCount ?? 0);
    if (warmupFrameCount < 0) {
      return Promise.reject(
        new RangeError("warmupFrameCount must be non-negative."),
      );
    }
    const targetFps = positiveNumber(runOptions.targetFps ?? 60, "targetFps");
    const diagnosticSync = runOptions.diagnosticSync ?? false;
    const diagnosticMode =
      runOptions.diagnosticMode ?? "webgpu-compute-render";
    const mode = diagnosticSync
      ? "synchronized-diagnostic"
      : "normal-unsynchronized";
    const frames: SustainedTexturePreviewFrame[] = [];
    const warmupFrames: SustainedTexturePreviewFrame[] = [];
    const started = clock();
    let recordingStarted: number | null =
      warmupFrameCount === 0 ? started : null;
    let previousTimestamp: number | null = null;
    state = "running";

    activePromise = new Promise<SustainedTexturePreviewSummary>((resolve) => {
      let finished = false;
      const finish = (nextState: SustainedTexturePreviewRunnerState) => {
        if (finished) {
          return;
        }
        finished = true;
        if (activeHandle !== null) {
          animationFrame.cancel(activeHandle);
          activeHandle = null;
        }
        state = nextState;
        lastSummary = summarizeSustainedTexturePreview(frames, {
          mode,
          diagnosticMode,
          backend:
            diagnosticMode === "canvas-2d"
              ? "canvas-2d"
              : diagnosticMode === "raf-only"
                ? "none"
                : (controller?.backend ?? "none"),
          requestedFrameCount: frameCount,
          targetFps,
          totalWallClockMs: Math.max(
            0,
            clock() - (recordingStarted ?? started),
          ),
          warmupFrames,
          metadata: {
            ...options.metadata,
            mode: diagnosticMode,
            warmupCount: warmupFrameCount,
            recordedFrameCount: frames.length,
          },
        });
        activeFinish = null;
        activePromise = null;
        resolve(lastSummary);
      };
      activeFinish = finish;

      const schedule = () => {
        activeHandle = animationFrame.request(async (timestamp) => {
          activeHandle = null;
          if (state !== "running") {
            return;
          }
          const frameIndex = warmupFrames.length + frames.length;
          const configured = runOptions.parameters;
          const parameters =
            typeof configured === "function"
              ? configured(frameIndex)
              : (configured ?? {
                  phaseOffset: frameIndex * 0.035,
                  frequencyScale: 1.15,
                });
          let timing: TexturePreviewFrameTiming;
          try {
            if (diagnosticMode === "raf-only") {
              timing = {
                frameEnqueueMs: 0,
                queueCompletionMs: null,
                synchronized: false,
                cpuFallbackMs: null,
              };
            } else if (diagnosticMode === "canvas-2d") {
              const drawStarted = clock();
              options.canvas2dDraw?.(frameIndex);
              timing = {
                frameEnqueueMs: Math.max(0, clock() - drawStarted),
                queueCompletionMs: null,
                synchronized: false,
                cpuFallbackMs: null,
              };
            } else if (controller) {
              const staticMode =
                diagnosticMode === "webgpu-static-frame" ||
                diagnosticMode === "webgpu-render-only-static";
              timing = await controller.render(
                staticMode
                  ? (typeof configured === "function"
                      ? configured(0)
                      : (configured ?? {
                          phaseOffset: 0,
                          frequencyScale: 1.15,
                        }))
                  : parameters,
                {
                  synchronize: diagnosticSync,
                  skipCompute:
                    diagnosticMode === "webgpu-render-only" ||
                    diagnosticMode === "webgpu-render-only-static" ||
                    diagnosticMode === "webgpu-render-only-changing",
                  presentationPhase:
                    diagnosticMode === "webgpu-render-only-changing" ||
                    diagnosticMode === "webgpu-compute-render-changing"
                      ? frameIndex * 0.06
                      : 0,
                },
              );
            } else {
              throw new Error(
                `${diagnosticMode} requires a preview controller.`,
              );
            }
          } catch {
            finish(
              controller?.getState() === "lost"
                ? "device-lost"
                : "stopped",
            );
            return;
          }
          if (timing.skippedReason === "device-lost") {
            finish("device-lost");
            return;
          }
          const sample = {
            frameIndex,
            timestampMs: timestamp,
            intervalMs:
              previousTimestamp === null
                ? null
                : Math.max(0, timestamp - previousTimestamp),
            timing,
          };
          if (frameIndex < warmupFrameCount) {
            warmupFrames.push(sample);
            if (warmupFrames.length === warmupFrameCount) {
              recordingStarted = clock();
            }
          } else {
            frames.push(sample);
          }
          previousTimestamp = timestamp;
          if (warmupFrames.length + frames.length >= warmupFrameCount + frameCount) {
            finish("completed");
          } else {
            schedule();
          }
        });
      };
      schedule();
    });
    return activePromise;
  };

  return {
    start,
    runSustainedTiming: start,
    stop() {
      if (state === "running") {
        activeFinish?.("stopped");
      }
    },
    getState: () => state,
    getTimingSummary: () => lastSummary,
    dispose() {
      if (state === "disposed") {
        return;
      }
      if (state === "running") {
        activeFinish?.("stopped");
      }
      state = "disposed";
      unsubscribeLoss();
    },
  };
}

export async function createSustainedTexturePreviewHarness(
  canvas: HTMLCanvasElement,
  options: {
    size?: 256 | 512;
    canvasFormat?: string;
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    animationFrame?: AnimationFrameScheduler;
    clock?: Clock;
  } = {},
): Promise<SustainedTexturePreviewHarness | null> {
  let mountResult = await mountWebGpuTexturePreview(canvas, options);
  if (mountResult.status === "error" || !mountResult.controller) {
    return null;
  }
  let runner = createTexturePreviewSustainedRunner(mountResult.controller, {
    animationFrame: options.animationFrame,
    clock: options.clock,
    metadata: {
      internalTextureSize: options.size ?? 256,
      canvasBitmapWidth: canvas.width,
      canvasBitmapHeight: canvas.height,
      cssDisplayWidth:
        Number.parseFloat(canvas.style?.width ?? "") || null,
      cssDisplayHeight:
        Number.parseFloat(canvas.style?.height ?? "") || null,
      devicePixelRatio:
        typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
    },
  });

  const harness: SustainedTexturePreviewHarness = {
    start: (runOptions) => runner.start(runOptions),
    runSustainedTiming: (runOptions) =>
      runner.runSustainedTiming(runOptions),
    stop: () => runner.stop(),
    getState: () => runner.getState(),
    getTimingSummary: () => runner.getTimingSummary(),
    getMountResult: () => mountResult,
    async recreate() {
      runner.dispose();
      mountResult.controller?.dispose();
      mountResult = await mountWebGpuTexturePreview(canvas, options);
      if (mountResult.status !== "error" && mountResult.controller) {
        runner = createTexturePreviewSustainedRunner(
          mountResult.controller,
          {
            animationFrame: options.animationFrame,
            clock: options.clock,
            metadata: {
              internalTextureSize: options.size ?? 256,
              canvasBitmapWidth: canvas.width,
              canvasBitmapHeight: canvas.height,
              cssDisplayWidth:
                Number.parseFloat(canvas.style?.width ?? "") || null,
              cssDisplayHeight:
                Number.parseFloat(canvas.style?.height ?? "") || null,
              devicePixelRatio:
                typeof devicePixelRatio === "number"
                  ? devicePixelRatio
                  : 1,
            },
          },
        );
      }
      return mountResult;
    },
    dispose() {
      runner.dispose();
      mountResult.controller?.dispose();
    },
  };
  return harness;
}

const activePacingCleanups = new Set<() => void>();

function isWebGpuPacingMode(mode: TexturePreviewPacingMode): boolean {
  return (
    mode === "webgpu-render-only" ||
    mode === "webgpu-compute-render" ||
    mode === "webgpu-static-frame" ||
    mode === "webgpu-render-only-static" ||
    mode === "webgpu-render-only-changing" ||
    mode === "webgpu-compute-render-changing"
  );
}

function fallbackReason(result: WebGpuTexturePreviewResult): string | null {
  if (result.status !== "cpu-fallback") {
    return null;
  }
  if (result.reason) {
    return result.reason;
  }
  if (result.gpu.status === "unavailable") {
    return result.gpu.reason;
  }
  if (result.gpu.status === "error") {
    return `${result.gpu.stage}-error`;
  }
  return "webgpu-preview-fallback";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultPacingCanvas(
  size: 256 | 512,
  mode: TexturePreviewPacingMode,
  cssDisplaySize = size,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.setAttribute("data-webgpu-pacing-preview", mode);
  Object.assign(canvas.style, {
    position: "fixed",
    right: "16px",
    bottom: "16px",
    width: `${cssDisplaySize}px`,
    height: `${cssDisplaySize}px`,
    zIndex: "99999",
    border: "1px solid #d7ff00",
  });
  document.body.append(canvas);
  return canvas;
}

export function cleanupTexturePreviewPacingHarnesses(): void {
  for (const cleanup of [...activePacingCleanups]) {
    cleanup();
  }
  if (typeof document !== "undefined") {
    document
      .querySelectorAll("[data-webgpu-pacing-preview]")
      .forEach((canvas) => canvas.remove());
  }
}

export async function runTexturePreviewPacingSuite(
  options: {
    frameCount?: number;
    sizes?: readonly (256 | 512)[];
    modes?: readonly TexturePreviewPacingMode[];
    targetFps?: number;
    warmupFrameCount?: number;
    diagnosticSync?: boolean;
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    animationFrame?: AnimationFrameScheduler;
    clock?: Clock;
    createCanvas?: (
      size: 256 | 512,
      mode: TexturePreviewPacingMode,
      cssDisplaySize: number,
    ) => HTMLCanvasElement;
    variants?: readonly {
      internalSize: 256 | 512;
      cssDisplaySize: number;
    }[];
  } = {},
): Promise<TexturePreviewPacingSuiteResult> {
  const frameCount = Math.floor(
    positiveNumber(options.frameCount ?? 300, "frameCount"),
  );
  const sizes = [...(options.sizes ?? [256, 512])] as Array<256 | 512>;
  const variants =
    options.variants ??
    sizes.map((size) => ({
      internalSize: size,
      cssDisplaySize: size,
    }));
  const modes = [
    ...(options.modes ?? TEXTURE_PREVIEW_PACING_MODES),
  ];
  const entries: TexturePreviewPacingSuiteEntry[] = [];

  for (const variant of variants) {
    const size = variant.internalSize;
    const cssDisplaySize = variant.cssDisplaySize;
    for (const diagnosticMode of modes) {
      let canvas: HTMLCanvasElement | null = null;
      let controller: WebGpuTexturePreviewController | null = null;
      let runner: SustainedTexturePreviewRunner | null = null;
      let mountStatus: TexturePreviewPacingSuiteEntry["mountStatus"] =
        "not-required";
      let entryFallbackReason: string | null = null;
      const metadata: TexturePreviewPacingMetadata = {
        internalTextureSize: size,
        canvasBitmapWidth: size,
        canvasBitmapHeight: size,
        cssDisplayWidth: cssDisplaySize,
        cssDisplayHeight: cssDisplaySize,
        devicePixelRatio:
          typeof devicePixelRatio === "number" ? devicePixelRatio : 1,
        mode: diagnosticMode,
        warmupCount: options.warmupFrameCount ?? 60,
        recordedFrameCount: frameCount,
      };
      const cleanup = () => {
        runner?.dispose();
        controller?.dispose();
        canvas?.remove();
        activePacingCleanups.delete(cleanup);
      };
      activePacingCleanups.add(cleanup);

      try {
        let canvas2dDraw: ((frameIndex: number) => void) | undefined;
        if (diagnosticMode !== "raf-only") {
          canvas = (options.createCanvas ?? defaultPacingCanvas)(
            size,
            diagnosticMode,
            cssDisplaySize,
          );
        }
        if (diagnosticMode === "canvas-2d") {
          const drawing = canvas?.getContext("2d");
          if (drawing) {
            canvas2dDraw = (frameIndex) => {
              const hue = frameIndex % 360;
              drawing.fillStyle = `hsl(${hue} 70% 45%)`;
              drawing.fillRect(0, 0, size, size);
              drawing.fillStyle = "#ffffff";
              drawing.fillRect(
                frameIndex % size,
                0,
                Math.max(1, Math.floor(size / 32)),
                size,
              );
            };
          }
        } else if (isWebGpuPacingMode(diagnosticMode)) {
          const mounted = await mountWebGpuTexturePreview(canvas!, {
            size,
            requestDevice: options.requestDevice,
            clock: options.clock,
          });
          mountStatus = mounted.status;
          entryFallbackReason = fallbackReason(mounted);
          if (mounted.status === "error") {
            throw mounted.error;
          }
          if (!mounted.controller) {
            throw new Error(
              entryFallbackReason ??
                "WebGPU preview did not provide a runnable controller.",
            );
          }
          controller = mounted.controller;
        }

        runner = createTexturePreviewSustainedRunner(controller, {
          animationFrame: options.animationFrame,
          clock: options.clock,
          canvas2dDraw,
          metadata: {
            ...metadata,
            canvasBitmapWidth: canvas?.width ?? metadata.canvasBitmapWidth,
            canvasBitmapHeight:
              canvas?.height ?? metadata.canvasBitmapHeight,
          },
        });
        const summary = await runner.runSustainedTiming({
          frameCount,
          targetFps: options.targetFps,
          diagnosticSync: options.diagnosticSync,
          diagnosticMode,
          warmupFrameCount: options.warmupFrameCount ?? 60,
        });
        entries.push({
          size,
          cssDisplaySize,
          mode: diagnosticMode,
          mountStatus,
          fallbackReason: entryFallbackReason,
          failureReason: null,
          metadata: summary.metadata,
          summary,
        });
      } catch (error) {
        entries.push({
          size,
          cssDisplaySize,
          mode: diagnosticMode,
          mountStatus:
            mountStatus === "not-required" ? "error" : mountStatus,
          fallbackReason: entryFallbackReason,
          failureReason: errorMessage(error),
          metadata,
          summary: null,
        });
      } finally {
        cleanup();
      }
    }
  }

  return {
    frameCount,
    sizes: [...new Set(variants.map(({ internalSize }) => internalSize))],
    modes,
    entries,
  };
}

export function texturePreviewPacingTableRows(
  result: TexturePreviewPacingSuiteResult,
): Array<Record<string, string | number | null>> {
  return result.entries.map(
    ({
      size,
      cssDisplaySize,
      mode,
      mountStatus,
      fallbackReason,
      failureReason,
      summary,
    }) => ({
    size,
    cssDisplaySize,
    mode,
    mountStatus,
    backend: summary?.backend ?? mountStatus,
    fallbackReason,
    failureReason,
    fps: summary?.approximateFps ?? null,
    intervalMedian: summary?.frameIntervalMs.median ?? null,
    intervalP95: summary?.frameIntervalMs.p95 ?? null,
    late: summary?.lateFrameCount ?? null,
    dropped: summary?.droppedFrameCount ?? null,
    warmupFrames: summary?.completedWarmupCount ?? null,
    recordedFrames: summary?.completedFrameCount ?? null,
    p95Exceeds25Ms: summary?.intervalP95Exceeds25Ms ? 1 : 0,
    droppedExceedsThreshold:
      summary?.droppedFramesExceedThreshold ? 1 : 0,
    enqueueMedian: summary?.enqueueMs.median ?? null,
    synchronizedQueueCompletionMedian:
      summary?.synchronizedQueueCompletionMs.median ?? null,
    }),
  );
}

export function reportTexturePreviewPacingSuite(
  result: TexturePreviewPacingSuiteResult,
): void {
  console.table(texturePreviewPacingTableRows(result));
}
