import type { SubstrateBuildInput } from "../types";
import type { SubstrateBackendResult, SubstrateComputeBackend, WorkerFailureCode } from "./types";
import { mapWorkerFailure } from "./cpuWorkerBackend";

export interface SubstrateFallbackResult {
  result: SubstrateBackendResult;
  fallbackCode: WorkerFailureCode | null;
  fallbackReason: string | null;
}

export async function computeSubstrateWithFallback(
  preferred: SubstrateComputeBackend,
  fallback: SubstrateComputeBackend,
  input: SubstrateBuildInput,
): Promise<SubstrateFallbackResult> {
  if (preferred.available) {
    try {
      const result = await preferred.compute(input);
      if (result.error) throw new Error(result.error);
      return { result, fallbackCode: null, fallbackReason: null };
    } catch (error) {
      const failure = mapWorkerFailure(error);
      const fallbackResult = await fallback.compute(input);
      return {
        result: fallbackResult,
        fallbackCode: failure.code,
        fallbackReason: failure.reason,
      };
    }
  }
  return {
    result: await fallback.compute(input),
    fallbackCode: preferred.capability?.failureCode ?? "worker-unavailable",
    fallbackReason: preferred.availabilityReason ?? `${preferred.label} is unavailable.`,
  };
}

export function isCurrentSubstrateRequest(latestRequestId: number, completedRequestId: number) {
  return latestRequestId === completedRequestId;
}
