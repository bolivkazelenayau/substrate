import { createCanvas, Path2D } from "@napi-rs/canvas";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CpuWorkerSubstrateBackend,
  computeSubstrateWithFallback,
  createCpuMainSubstrateBackend,
  isCurrentSubstrateRequest,
  getBackendDiagnosticItems,
  LatestOnlyScheduler,
  mapWorkerFailure,
  parseWorkerSelfTest,
  type SubstrateBuildInput,
  type SubstrateBuildResult,
  type SubstrateBackendResult,
  type SubstrateComputeBackend,
  type SubstrateWorkerRequest,
  type SubstrateWorkerResponse,
  type WorkerLike,
} from "../src/engine/substrate";
import { createSvg } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import { validateSvgReload } from "../src/engine/svgValidation";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";

const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

const input: SubstrateBuildInput = {
  sourceText: "",
  textGeometry: null,
  fontSize: 148,
  tracking: 0,
  fontFamily: "sans-serif",
  fontWeight: 900,
  baselineY: 405,
  textX: 600,
  resolution: { width: 32, height: 20 },
  bounds: null,
};

class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<SubstrateWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: SubstrateWorkerRequest[] = [];
  terminated = false;

  postMessage(message: SubstrateWorkerRequest) {
    this.requests.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  respond(message: SubstrateWorkerResponse) {
    this.onmessage?.({ data: message } as MessageEvent<SubstrateWorkerResponse>);
  }

  crash(message: string) {
    this.onerror?.({ message, filename: "substrate.worker.ts", lineno: 7, colno: 3 } as ErrorEvent);
  }
}

let synchronousResult: SubstrateBuildResult;

beforeAll(async () => {
  synchronousResult = await createCpuMainSubstrateBackend(canvasFactory).compute(input);
});

describe("substrate compute backends", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("wraps the synchronous builder as cpu-main with timing diagnostics", async () => {
    const backend = createCpuMainSubstrateBackend(canvasFactory);
    const result = await backend.compute(input);
    expect(result.backend).toBe("cpu-main");
    expect(result.requestId).toBe(1);
    expect(result.data.mask.data).toHaveLength(640);
    expect(result.timing).toMatchObject({
      workerComputeMs: 0,
      roundTripMs: 0,
    });
    expect(result.timing.mainThreadMs).toBeGreaterThanOrEqual(0);
  });

  it("correlates typed worker replies by requestId even when results arrive out of order", async () => {
    const worker = new FakeWorker();
    const backend = new CpuWorkerSubstrateBackend(() => worker, { skipSelfTest: true });
    const first = backend.compute(input);
    const second = backend.compute({ ...input, sourceText: "B" });
    await Promise.resolve();
    expect(worker.requests.map((request) => request.requestId)).toEqual([1, 2]);

    worker.respond({ type: "result", requestId: 2, result: synchronousResult, workerComputeMs: 4 });
    worker.respond({ type: "result", requestId: 1, result: synchronousResult, workerComputeMs: 5 });

    expect((await second).requestId).toBe(2);
    expect((await first).requestId).toBe(1);
    backend.dispose();
    expect(worker.terminated).toBe(true);
  });

  it("falls back from cpu-worker to cpu-main with an explicit reason", async () => {
    const preferred: SubstrateComputeBackend = {
      id: "cpu-worker",
      label: "CPU / Web Worker",
      available: true,
      availabilityReason: null,
      capability: null,
      compute: async () => { throw new Error("worker unavailable"); },
      dispose() {},
    };
    const fallback = createCpuMainSubstrateBackend(canvasFactory);
    const result = await computeSubstrateWithFallback(preferred, fallback, input);
    expect(result.result.backend).toBe("cpu-main");
    expect(result.fallbackCode).toBe("worker-unavailable");
    expect(result.fallbackReason).toBe("worker unavailable");
  });

  it("rejects stale completion ids", () => {
    expect(isCurrentSubstrateRequest(7, 7)).toBe(true);
    expect(isCurrentSubstrateRequest(8, 7)).toBe(false);
  });

  it("coalesces active substrate work to the newest pending request", async () => {
    const runs: number[] = [];
    const completions: Array<{ id: number; stale: boolean }> = [];
    const resolvers = new Map<number, (value: number) => void>();
    const scheduler = new LatestOnlyScheduler<number, number>();
    const schedule = (id: number) => scheduler.schedule({
      id,
      input: id,
      run: async (value) => {
        runs.push(value);
        return new Promise<number>((resolve) => resolvers.set(value, resolve));
      },
      complete: (_result, stale) => completions.push({ id, stale }),
      fail: () => {},
    });

    schedule(1);
    schedule(2);
    schedule(3);
    expect(runs).toEqual([1]);
    expect(scheduler.snapshot()).toMatchObject({
      activeRequestId: 1,
      latestRequestedId: 3,
      pendingRequestCount: 1,
      coalescedRequestCount: 2,
      droppedObsoleteRequestCount: 1,
      skippedObsoleteRequest: true,
    });

    resolvers.get(1)?.(1);
    await vi.waitFor(() => expect(runs).toEqual([1, 3]));
    expect(completions).toContainEqual({ id: 1, stale: true });
    resolvers.get(3)?.(3);
    await vi.waitFor(() => expect(completions).toContainEqual({ id: 3, stale: false }));
    expect(runs).not.toContain(2);
  });

  it("keeps cpu-main fallback valid when invoked through the latest-only scheduler", async () => {
    const preferred: SubstrateComputeBackend = {
      id: "cpu-worker",
      label: "CPU / Web Worker",
      available: true,
      availabilityReason: null,
      capability: null,
      compute: async () => { throw new Error("worker unavailable"); },
      dispose() {},
    };
    const fallback = createCpuMainSubstrateBackend(canvasFactory);
    const completed: SubstrateBackendResult[] = [];
    const scheduler = new LatestOnlyScheduler<SubstrateBuildInput, Awaited<ReturnType<typeof computeSubstrateWithFallback>>>();
    scheduler.schedule({
      id: 1,
      input,
      run: (next) => computeSubstrateWithFallback(preferred, fallback, next),
      complete: ({ result }, stale) => {
        if (!stale) completed.push(result);
      },
      fail: () => {},
    });
    await vi.waitFor(() => expect(completed).toHaveLength(1));
    expect(completed[0].backend).toBe("cpu-main");
  });

  it("parses supported and partial worker self-test results", () => {
    const supported = parseWorkerSelfTest({
      type: "self-test-result",
      requestId: 1,
      offscreenCanvas: true,
      path2D: true,
      rasterization: true,
      probe: new Float32Array([17, 29]),
      error: null,
    });
    expect(supported).toMatchObject({ status: "supported", transferableArrays: true, failureCode: null });
    const partial = parseWorkerSelfTest({
      type: "self-test-result",
      requestId: 2,
      offscreenCanvas: true,
      path2D: false,
      rasterization: false,
      probe: new Float32Array([17, 29]),
      error: "Path2D is unavailable in the worker.",
    });
    expect(partial).toMatchObject({ status: "partially-supported", failureCode: "path2d-unavailable" });
  });

  it("maps explicit fallback reasons", () => {
    expect(mapWorkerFailure(new Error("OffscreenCanvas is unavailable in the worker."))).toMatchObject({ code: "offscreen-canvas-unavailable" });
    expect(mapWorkerFailure(new Error("Path2D is unavailable in the worker."))).toMatchObject({ code: "path2d-unavailable" });
    expect(mapWorkerFailure(new Error("Worker rasterization failed."))).toMatchObject({ code: "rasterization-failed" });
  });

  it("preserves Worker constructor exceptions and reports the resolved worker URL", async () => {
    vi.stubGlobal("Worker", function Worker() {});
    const backend = new CpuWorkerSubstrateBackend(
      () => { throw new DOMException("Blocked by worker-src policy", "SecurityError"); },
      { workerUrl: "http://127.0.0.1:5173/src/engine/substrate/substrate.worker.ts" },
    );
    expect(backend.available).toBe(false);
    expect(backend.capability).toMatchObject({
      failureCode: "worker-constructor-failed",
      creation: {
        workerUrl: "http://127.0.0.1:5173/src/engine/substrate/substrate.worker.ts",
        workerType: "function",
        exceptionName: "SecurityError",
        exceptionMessage: "Blocked by worker-src policy",
      },
    });
    const fallback = await computeSubstrateWithFallback(backend, createCpuMainSubstrateBackend(canvasFactory), input);
    expect(fallback.fallbackCode).toBe("worker-constructor-failed");
    expect(fallback.fallbackReason).toContain("SecurityError: Blocked by worker-src policy");
    expect(fallback.fallbackReason).toContain("substrate.worker.ts");
  });

  it("completes ping/pong startup before beginning the full self-test", async () => {
    const worker = new FakeWorker();
    const backend = new CpuWorkerSubstrateBackend(() => worker);
    const selfTest = backend.selfTest();
    expect(worker.requests.map(({ type }) => type)).toEqual(["ping"]);
    worker.respond({ type: "pong", requestId: 1 });
    await vi.waitFor(() => expect(worker.requests.map(({ type }) => type)).toEqual(["ping", "self-test"]));
    expect(worker.requests.map(({ type }) => type)).toEqual(["ping", "self-test"]);
    worker.respond({
      type: "self-test-result",
      requestId: 2,
      offscreenCanvas: true,
      path2D: true,
      rasterization: true,
      probe: new Float32Array([17, 29]),
      error: null,
    });
    await expect(selfTest).resolves.toMatchObject({ status: "supported", moduleWorker: true });
    backend.dispose();
  });

  it("reports self-test timeout separately from constructor unavailability", async () => {
    const worker = new FakeWorker();
    const backend = new CpuWorkerSubstrateBackend(() => worker, { timeoutMs: 50 });
    const selfTest = backend.selfTest();
    worker.respond({ type: "pong", requestId: 1 });
    await vi.waitFor(() => expect(worker.requests.at(-1)?.type).toBe("self-test"), { interval: 1 });
    await expect(selfTest).rejects.toMatchObject({
      code: "worker-timeout",
      message: expect.stringContaining("self-test did not respond"),
    });
    expect(backend.capability?.failureCode).toBe("worker-timeout");
    backend.dispose();
  });

  it("reports a worker runtime crash separately from constructor unavailability", async () => {
    const worker = new FakeWorker();
    const backend = new CpuWorkerSubstrateBackend(() => worker);
    const selfTest = backend.selfTest();
    worker.respond({ type: "pong", requestId: 1 });
    await vi.waitFor(() => expect(worker.requests.at(-1)?.type).toBe("self-test"), { interval: 1 });
    worker.crash("Uncaught worker boot error");
    await expect(selfTest).rejects.toMatchObject({
      code: "worker-crashed",
      message: expect.stringContaining("Uncaught worker boot error"),
    });
    expect(backend.capability?.failureCode).toBe("worker-crashed");
    backend.dispose();
  });

  it("times out, ignores the stale late result, and accepts a newer response", async () => {
    const worker = new FakeWorker();
    const backend = new CpuWorkerSubstrateBackend(() => worker, { skipSelfTest: true, timeoutMs: 5 });
    const stale = backend.compute(input);
    await Promise.resolve();
    await expect(stale).rejects.toMatchObject({ code: "worker-timeout" });
    worker.respond({ type: "result", requestId: 1, result: synchronousResult, workerComputeMs: 1 });

    const current = backend.compute({ ...input, sourceText: "CURRENT" });
    await Promise.resolve();
    worker.respond({ type: "result", requestId: 2, result: synchronousResult, workerComputeMs: 1 });
    await expect(current).resolves.toMatchObject({ requestId: 2, backend: "cpu-worker" });
    backend.dispose();
  });

  it("cpu-main fallback substrate still exports vector-only SVG", async () => {
    const preferred: SubstrateComputeBackend = {
      id: "cpu-worker",
      label: "CPU / Web Worker",
      available: false,
      availabilityReason: "Path2D is unavailable in the worker.",
      capability: null,
      compute: async () => { throw new Error("unreachable"); },
      dispose() {},
    };
    const fallback = createCpuMainSubstrateBackend(canvasFactory);
    const { result } = await computeSubstrateWithFallback(preferred, fallback, input);
    const state = { ...baseState, renderer: "flow" as const, density: 10, maxNodes: 20 };
    const svg = createSvg(state, { timeMs: 0, frame: 0, substrateData: result.data }, null);
    const validation = validateSvgReload(svg, false);
    expect(validation.valid).toBe(true);
    expect(validation.document?.querySelector("image")).toBeNull();
  });

  it("formats a stable backend diagnostics display shape", () => {
    const items = getBackendDiagnosticItems({
      phase: "fallback",
      requestId: 9,
      requestedBackend: "cpu-worker",
      activeBackend: "cpu-main",
      workerCapability: {
        status: "partially-supported",
        moduleWorker: true,
        offscreenCanvas: true,
        path2D: false,
        rasterization: false,
        transferableArrays: true,
        failureCode: "path2d-unavailable",
        reason: "Path2D is unavailable in the worker.",
        creation: {
          workerUrl: "test-worker",
          workerType: "function",
          offscreenCanvasType: "function",
          path2DType: "function",
          exceptionName: null,
          exceptionMessage: null,
          exceptionStack: null,
        },
      },
      fallbackCode: "path2d-unavailable",
      fallbackReason: "Path2D is unavailable in the worker.",
      timing: { totalMs: 12, mainThreadMs: 12, workerComputeMs: 0, roundTripMs: 0 },
      activeRequestId: null,
      latestRequestedId: 9,
      pendingRequestCount: 0,
      coalescedRequestCount: 2,
      droppedObsoleteRequestCount: 1,
      skippedObsoleteRequest: false,
    });
    expect(items).toEqual([
      "CPU-MAIN",
      "FALLBACK",
      "SUPPORT PARTIALLY-SUPPORTED",
      "REQ 9",
      "ACTIVE NONE",
      "LATEST 9",
      "PENDING 0",
      "COALESCED 2",
      "DROPPED 1",
      "TOTAL 12.0MS",
      "WORKER 0.0MS",
      "MAIN 12.0MS",
      "RTT 0.0MS",
      "PATH2D-UNAVAILABLE: Path2D is unavailable in the worker.",
    ]);
  });
});
