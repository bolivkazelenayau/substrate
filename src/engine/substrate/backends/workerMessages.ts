import type { SubstrateBuildInput, SubstrateBuildResult } from "../types";
import type { WorkerFailureCode } from "./types";

export interface SubstrateWorkerSelfTestRequest {
  type: "self-test";
  requestId: number;
}

export interface SubstrateWorkerPingRequest {
  type: "ping";
  requestId: number;
}

export interface SubstrateWorkerBuildRequest {
  type: "build";
  requestId: number;
  input: SubstrateBuildInput;
}

export interface SubstrateWorkerBuildSuccess {
  type: "result";
  requestId: number;
  result: SubstrateBuildResult;
  workerComputeMs: number;
}

export interface SubstrateWorkerBuildFailure {
  type: "error";
  requestId: number;
  code: WorkerFailureCode;
  error: string;
}

export interface SubstrateWorkerSelfTestSuccess {
  type: "self-test-result";
  requestId: number;
  offscreenCanvas: boolean;
  path2D: boolean;
  rasterization: boolean;
  probe: Float32Array;
  error: string | null;
}

export interface SubstrateWorkerPong {
  type: "pong";
  requestId: number;
}

export type SubstrateWorkerRequest = SubstrateWorkerBuildRequest | SubstrateWorkerSelfTestRequest | SubstrateWorkerPingRequest;
export type SubstrateWorkerResponse = SubstrateWorkerBuildSuccess | SubstrateWorkerBuildFailure | SubstrateWorkerSelfTestSuccess | SubstrateWorkerPong;
