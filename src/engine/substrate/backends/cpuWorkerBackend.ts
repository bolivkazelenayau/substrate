import type { SubstrateBuildInput } from "../types";
import type {
  SubstrateBackendResult,
  SubstrateComputeBackend,
  WorkerCreationDiagnostics,
  WorkerFailureCode,
  WorkerSelfTestResult,
} from "./types";
import type { SubstrateWorkerRequest, SubstrateWorkerResponse } from "./workerMessages";

export const DEFAULT_WORKER_TIMEOUT_MS = 8_000;

export class WorkerBackendError extends Error {
  constructor(
    readonly code: WorkerFailureCode,
    message: string,
    readonly creation?: WorkerCreationDiagnostics,
  ) {
    super(message);
    this.name = "WorkerBackendError";
  }
}

export interface WorkerLike {
  postMessage(message: SubstrateWorkerRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SubstrateWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

type WorkerFactory = () => WorkerLike;
type PendingRequest = {
  timer: ReturnType<typeof setTimeout>;
  phase: "startup" | "self-test" | "build";
  handle: (message: SubstrateWorkerResponse) => void;
  reject: (error: Error) => void;
};

const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();

function mainThreadApiType(name: "Worker" | "OffscreenCanvas" | "Path2D") {
  return typeof globalThis[name];
}

function createDiagnostics(workerUrl: string, error?: unknown): WorkerCreationDiagnostics {
  const exception = error != null && typeof error === "object"
    ? error as { name?: unknown; message?: unknown; stack?: unknown }
    : null;
  return {
    workerUrl,
    workerType: mainThreadApiType("Worker"),
    offscreenCanvasType: mainThreadApiType("OffscreenCanvas"),
    path2DType: mainThreadApiType("Path2D"),
    exceptionName: typeof exception?.name === "string" ? exception.name : error == null ? null : typeof error,
    exceptionMessage: typeof exception?.message === "string" ? exception.message : error == null ? null : String(error),
    exceptionStack: typeof exception?.stack === "string" ? exception.stack : null,
  };
}

function creationFailureMessage(diagnostics: WorkerCreationDiagnostics) {
  const exception = [diagnostics.exceptionName, diagnostics.exceptionMessage].filter(Boolean).join(": ");
  return `${exception || "Worker constructor failed."} URL: ${diagnostics.workerUrl} `
    + `(Worker=${diagnostics.workerType}, OffscreenCanvas=${diagnostics.offscreenCanvasType}, Path2D=${diagnostics.path2DType})`;
}

export function parseWorkerSelfTest(
  message: Extract<SubstrateWorkerResponse, { type: "self-test-result" }>,
  creation: WorkerCreationDiagnostics = createDiagnostics("test-worker"),
): WorkerSelfTestResult {
  const transferableArrays = message.probe instanceof Float32Array
    && message.probe.length === 2
    && message.probe[0] === 17
    && message.probe[1] === 29;
  let failureCode: WorkerFailureCode | null = null;
  if (!message.offscreenCanvas) failureCode = "offscreen-canvas-unavailable";
  else if (!message.path2D) failureCode = "path2d-unavailable";
  else if (!message.rasterization) failureCode = "rasterization-failed";
  else if (!transferableArrays) failureCode = "unknown";
  const fullySupported = message.offscreenCanvas && message.path2D && message.rasterization && transferableArrays;
  return {
    status: fullySupported ? "supported" : message.offscreenCanvas ? "partially-supported" : "unavailable",
    moduleWorker: true,
    offscreenCanvas: message.offscreenCanvas,
    path2D: message.path2D,
    rasterization: message.rasterization,
    transferableArrays,
    failureCode,
    reason: fullySupported ? null : message.error ?? workerFailureMessage(failureCode ?? "unknown"),
    creation,
  };
}

export function workerFailureMessage(code: WorkerFailureCode) {
  const messages: Record<WorkerFailureCode, string> = {
    "worker-unavailable": "Module Worker API is unavailable.",
    "worker-constructor-failed": "The module Worker constructor failed.",
    "worker-timeout": "The substrate worker did not respond before the timeout.",
    "worker-self-test-failed": "The substrate worker replied with a failed self-test.",
    "worker-build-failed": "The substrate worker failed while building the substrate.",
    "offscreen-canvas-unavailable": "OffscreenCanvas is unavailable in the worker.",
    "path2d-unavailable": "Path2D is unavailable in the worker.",
    "rasterization-failed": "Worker rasterization failed.",
    "worker-crashed": "The substrate worker crashed.",
    unknown: "Unknown substrate worker error.",
  };
  return messages[code];
}

export function mapWorkerFailure(error: unknown): { code: WorkerFailureCode; reason: string } {
  if (error instanceof WorkerBackendError) return { code: error.code, reason: error.message };
  const reason = error instanceof Error ? error.message : workerFailureMessage("unknown");
  const normalized = reason.toLowerCase();
  if (normalized.includes("offscreen")) return { code: "offscreen-canvas-unavailable", reason };
  if (normalized.includes("path2d")) return { code: "path2d-unavailable", reason };
  if (normalized.includes("raster")) return { code: "rasterization-failed", reason };
  if (normalized.includes("constructor")) return { code: "worker-constructor-failed", reason };
  if (normalized.includes("timeout") || normalized.includes("timed out")) return { code: "worker-timeout", reason };
  if (normalized.includes("self-test")) return { code: "worker-self-test-failed", reason };
  if (normalized.includes("build")) return { code: "worker-build-failed", reason };
  if (normalized.includes("crash")) return { code: "worker-crashed", reason };
  if (normalized.includes("worker api") || normalized.includes("worker is not defined")) {
    return { code: "worker-unavailable", reason };
  }
  if (normalized === "worker unavailable") return { code: "worker-unavailable", reason };
  return { code: "unknown", reason };
}

export class CpuWorkerSubstrateBackend implements SubstrateComputeBackend {
  readonly id = "cpu-worker" as const;
  readonly label = "CPU / Web Worker";
  readonly available: boolean;
  readonly availabilityReason: string | null;
  readonly creationDiagnostics: WorkerCreationDiagnostics;
  capability: WorkerSelfTestResult | null = null;
  private worker: WorkerLike | null = null;
  private nextRequestId = 0;
  private startupPromise: Promise<void> | null = null;
  private selfTestPromise: Promise<WorkerSelfTestResult> | null = null;
  private pending = new Map<number, PendingRequest>();

  constructor(
    private readonly workerFactory: WorkerFactory,
    private readonly options: { timeoutMs?: number; skipSelfTest?: boolean; workerUrl?: string } = {},
  ) {
    const workerUrl = options.workerUrl ?? "injected-worker";
    this.creationDiagnostics = createDiagnostics(workerUrl);
    try {
      this.worker = workerFactory();
      this.available = true;
      this.availabilityReason = null;
      this.worker.onmessage = (event) => this.handleMessage(event.data);
      this.worker.onerror = (event) => this.failAll(new WorkerBackendError(
        "worker-crashed",
        `${event.message || workerFailureMessage("worker-crashed")}${event.filename ? ` (${event.filename}:${event.lineno}:${event.colno})` : ""}`,
        this.creationDiagnostics,
      ));
    } catch (error) {
      const diagnostics = createDiagnostics(workerUrl, error);
      Object.assign(this.creationDiagnostics, diagnostics);
      this.available = false;
      const code: WorkerFailureCode = diagnostics.workerType === "function"
        ? "worker-constructor-failed"
        : "worker-unavailable";
      this.availabilityReason = creationFailureMessage(diagnostics);
      this.capability = {
        status: "unavailable",
        moduleWorker: false,
        offscreenCanvas: false,
        path2D: false,
        rasterization: false,
        transferableArrays: false,
        failureCode: code,
        reason: this.availabilityReason,
        creation: diagnostics,
      };
      if (typeof console !== "undefined") console.error("[SUBSTRATE] Worker creation failed.", diagnostics);
    }
  }

  async startupProbe(): Promise<void> {
    if (!this.worker || !this.available) {
      throw new WorkerBackendError(
        this.capability?.failureCode ?? "worker-unavailable",
        this.availabilityReason ?? workerFailureMessage("worker-unavailable"),
        this.creationDiagnostics,
      );
    }
    if (this.options.skipSelfTest) return;
    if (this.startupPromise) return this.startupPromise;
    this.startupPromise = new Promise<void>((resolve, reject) => {
      const requestId = ++this.nextRequestId;
      this.registerPending(requestId, "startup", (message) => {
        if (message.type === "pong") {
          resolve();
          return;
        }
        reject(new WorkerBackendError("worker-crashed", "Unexpected response to worker startup ping.", this.creationDiagnostics));
      }, reject);
      try {
        this.worker!.postMessage({ type: "ping", requestId });
      } catch (error) {
        this.clearPending(requestId);
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        reject(new WorkerBackendError("worker-crashed", `Worker startup ping failed: ${message}`, this.creationDiagnostics));
      }
    });
    return this.startupPromise;
  }

  async selfTest(): Promise<WorkerSelfTestResult> {
    if (this.capability) return this.capability;
    if (!this.worker || !this.available) {
      this.capability = {
        status: "unavailable",
        moduleWorker: false,
        offscreenCanvas: false,
        path2D: false,
        rasterization: false,
        transferableArrays: false,
        failureCode: "worker-unavailable",
        reason: this.availabilityReason ?? workerFailureMessage("worker-unavailable"),
        creation: this.creationDiagnostics,
      };
      return this.capability;
    }
    if (this.options.skipSelfTest) {
      this.capability = {
        status: "supported",
        moduleWorker: true,
        offscreenCanvas: true,
        path2D: true,
        rasterization: true,
        transferableArrays: true,
        failureCode: null,
        reason: null,
        creation: this.creationDiagnostics,
      };
      return this.capability;
    }
    if (this.selfTestPromise) return this.selfTestPromise;
    this.selfTestPromise = this.startupProbe().then(() => new Promise<WorkerSelfTestResult>((resolve, reject) => {
      const requestId = ++this.nextRequestId;
      this.registerPending(requestId, "self-test", (message) => {
        if (message.type === "error") {
          reject(new WorkerBackendError("worker-self-test-failed", `${message.code}: ${message.error}`, this.creationDiagnostics));
          return;
        }
        if (message.type !== "self-test-result") {
          reject(new WorkerBackendError("worker-self-test-failed", "Unexpected worker self-test response.", this.creationDiagnostics));
          return;
        }
        const result = parseWorkerSelfTest(message, this.creationDiagnostics);
        this.capability = result;
        resolve(result);
      }, reject);
      this.worker!.postMessage({ type: "self-test", requestId });
    })).catch((error) => {
      const failure = mapWorkerFailure(error);
      this.capability = {
        status: failure.code === "worker-unavailable" || failure.code === "worker-constructor-failed"
          || failure.code === "worker-crashed" || failure.code === "worker-timeout"
          ? "unavailable"
          : "partially-supported",
        moduleWorker: failure.code !== "worker-unavailable" && failure.code !== "worker-constructor-failed",
        offscreenCanvas: false,
        path2D: false,
        rasterization: false,
        transferableArrays: false,
        failureCode: failure.code,
        reason: failure.reason,
        creation: this.creationDiagnostics,
      };
      throw error;
    });
    return this.selfTestPromise;
  }

  async compute(input: SubstrateBuildInput): Promise<SubstrateBackendResult> {
    if (!this.worker || !this.available) {
      throw new WorkerBackendError(
        this.capability?.failureCode ?? "worker-unavailable",
        this.availabilityReason ?? workerFailureMessage("worker-unavailable"),
        this.creationDiagnostics,
      );
    }
    const capability = await this.selfTest();
    if (capability.status !== "supported") {
      throw new WorkerBackendError(
        "worker-self-test-failed",
        `${capability.failureCode ?? "unknown"}: ${capability.reason ?? workerFailureMessage("unknown")}`,
        this.creationDiagnostics,
      );
    }
    const requestId = ++this.nextRequestId;
    const started = now();
    return new Promise((resolve, reject) => {
      this.registerPending(requestId, "build", (message) => {
        if (message.type === "error") {
          reject(new WorkerBackendError("worker-build-failed", `${message.code}: ${message.error}`, this.creationDiagnostics));
          return;
        }
        if (message.type !== "result") {
          reject(new WorkerBackendError("worker-build-failed", "Unexpected worker build response.", this.creationDiagnostics));
          return;
        }
        const roundTripMs = now() - started;
        resolve({
          ...message.result,
          requestId: message.requestId,
          backend: "cpu-worker",
          timing: {
            totalMs: roundTripMs,
            mainThreadMs: Math.max(0, roundTripMs - message.workerComputeMs),
            workerComputeMs: message.workerComputeMs,
            roundTripMs,
          },
        });
      }, reject);
      this.worker!.postMessage({ type: "build", requestId, input });
    });
  }

  dispose() {
    this.failAll(new WorkerBackendError("worker-unavailable", "Substrate worker was disposed.", this.creationDiagnostics));
    this.worker?.terminate();
    this.worker = null;
  }

  private registerPending(
    requestId: number,
    phase: PendingRequest["phase"],
    handle: PendingRequest["handle"],
    reject: PendingRequest["reject"],
  ) {
    const timer = setTimeout(() => {
      const pending = this.pending.get(requestId);
      if (!pending) return;
      this.pending.delete(requestId);
      pending.reject(new WorkerBackendError(
        "worker-timeout",
        `${phase} did not respond within ${this.timeoutMs} ms.`,
        this.creationDiagnostics,
      ));
    }, this.timeoutMs);
    this.pending.set(requestId, { timer, phase, handle, reject });
  }

  private clearPending(requestId: number) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
  }

  private handleMessage(message: SubstrateWorkerResponse) {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.clearPending(message.requestId);
    pending.handle(message);
  }

  private failAll(error: Error) {
    this.pending.forEach(({ timer, reject }) => {
      clearTimeout(timer);
      reject(error);
    });
    this.pending.clear();
  }

  private get timeoutMs() {
    return this.options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  }
}

export function createCpuWorkerSubstrateBackend() {
  const workerUrl = new URL("../substrate.worker.ts", import.meta.url).href;
  return new CpuWorkerSubstrateBackend(() => new Worker(
    new URL("../substrate.worker.ts", import.meta.url),
    { type: "module", name: "substrate-cpu-worker" },
  ), { workerUrl });
}
