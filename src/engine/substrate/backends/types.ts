import type { SubstrateBuildInput, SubstrateBuildResult } from "../types";

export type SubstrateBackendId = "cpu-main" | "cpu-worker";
export type WorkerSupportStatus = "supported" | "partially-supported" | "unavailable";
export type WorkerFailureCode =
  | "worker-unavailable"
  | "worker-constructor-failed"
  | "worker-timeout"
  | "worker-self-test-failed"
  | "worker-build-failed"
  | "offscreen-canvas-unavailable"
  | "path2d-unavailable"
  | "rasterization-failed"
  | "worker-crashed"
  | "unknown";

export interface WorkerCreationDiagnostics {
  workerUrl: string;
  workerType: string;
  offscreenCanvasType: string;
  path2DType: string;
  exceptionName: string | null;
  exceptionMessage: string | null;
  exceptionStack: string | null;
}

export interface WorkerSelfTestResult {
  status: WorkerSupportStatus;
  moduleWorker: boolean;
  offscreenCanvas: boolean;
  path2D: boolean;
  rasterization: boolean;
  transferableArrays: boolean;
  failureCode: WorkerFailureCode | null;
  reason: string | null;
  creation: WorkerCreationDiagnostics;
}

export interface SubstrateBackendTiming {
  totalMs: number;
  mainThreadMs: number;
  workerComputeMs: number;
  roundTripMs: number;
}

export interface SubstrateBackendResult extends SubstrateBuildResult {
  requestId: number;
  backend: SubstrateBackendId;
  timing: SubstrateBackendTiming;
}

export interface SubstrateComputeBackend {
  readonly id: SubstrateBackendId;
  readonly label: string;
  readonly available: boolean;
  readonly availabilityReason: string | null;
  readonly capability: WorkerSelfTestResult | null;
  compute(input: SubstrateBuildInput): Promise<SubstrateBackendResult>;
  selfTest?(): Promise<WorkerSelfTestResult>;
  dispose(): void;
}

export type SubstrateBuildPhase = "idle" | "building" | "ready" | "fallback" | "error";

export interface SubstrateBackendStatus {
  phase: SubstrateBuildPhase;
  requestId: number;
  requestedBackend: SubstrateBackendId;
  activeBackend: SubstrateBackendId | null;
  workerCapability: WorkerSelfTestResult | null;
  fallbackCode: WorkerFailureCode | null;
  fallbackReason: string | null;
  timing: SubstrateBackendTiming | null;
  activeRequestId: number | null;
  latestRequestedId: number;
  pendingRequestCount: number;
  coalescedRequestCount: number;
  droppedObsoleteRequestCount: number;
  skippedObsoleteRequest: boolean;
}
