import { useEffect, useRef, useState } from "react";
import {
  cpuMainSubstrateBackend,
  computeSubstrateWithFallback,
  createCpuWorkerSubstrateBackend,
  LatestOnlyScheduler,
  type LatestOnlySchedulerSnapshot,
  type SubstrateBackendStatus,
  type SubstrateBuildInput,
  type SubstrateData,
  type SubstrateFallbackResult,
} from "../engine/substrate";
import { SUBSTRATE_NOT_REQUIRED_KEY } from "../engine/pipelineStageKeys";
import { tracePipelineStage } from "../engine/pipelineTrace";
import { traceEvent, traceStartSpan } from "../dev/interactionTrace";

export interface SubstrateBackendState {
  data: SubstrateData | null;
  /** Identity of data currently visible to preview; null while only stale data exists. */
  outputKey: string | null;
  error: string | null;
  status: SubstrateBackendStatus;
}

const initialSchedule: LatestOnlySchedulerSnapshot = {
  activeRequestId: null,
  latestRequestedId: 0,
  pendingRequestCount: 0,
  coalescedRequestCount: 0,
  droppedObsoleteRequestCount: 0,
  skippedObsoleteRequest: false,
};

const initialStatus: SubstrateBackendStatus = {
  phase: "idle",
  requestId: 0,
  requestedBackend: "cpu-worker",
  activeBackend: null,
  workerCapability: null,
  fallbackCode: null,
  fallbackReason: null,
  timing: null,
  ...initialSchedule,
};

const notRequiredStatus: SubstrateBackendStatus = {
  ...initialStatus,
  phase: "not-required",
  requestedBackend: "cpu-worker",
  activeBackend: null,
};

export function useSubstrateBackend(input: SubstrateBuildInput, inputKey: string, enabled = true): SubstrateBackendState {
  const [workerBackend] = useState(() => createCpuWorkerSubstrateBackend());
  const latestRequest = useRef(0);
  const lastEnqueuedInput = useRef<SubstrateBuildInput | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [backendState, setBackendState] = useState<SubstrateBackendState>({
    data: null,
    outputKey: null,
    error: null,
    status: initialStatus,
  });
  const [scheduler] = useState(() => new LatestOnlyScheduler<SubstrateBuildInput, SubstrateFallbackResult>(
    (schedule) => {
      if (!mounted.current) return;
      traceEvent({
        stage: "substrate.scheduler",
        phase: "instant",
        counts: {
          active: schedule.activeRequestId === null ? 0 : 1,
          pending: schedule.pendingRequestCount,
          coalesced: schedule.coalescedRequestCount,
          droppedObsolete: schedule.droppedObsoleteRequestCount,
        },
        detail: {
          latestRequestedId: schedule.latestRequestedId,
          skippedObsoleteRequest: schedule.skippedObsoleteRequest,
        },
      });
      setBackendState((current) => ({
        ...current,
        status: {
          ...current.status,
          ...schedule,
          requestId: schedule.latestRequestedId,
          phase: schedule.activeRequestId !== null || schedule.pendingRequestCount > 0
            ? "building"
            : current.status.phase,
        },
      }));
    },
  ));

  useEffect(() => {
    if (!enabled) {
      // Invalidate in-flight worker completions when substrate is not required.
      latestRequest.current += 1;
      lastEnqueuedInput.current = null;
      tracePipelineStage("substrate", "skipped", { reason: "capability-not-required" });
      tracePipelineStage("substrate", "invalidated", { reason: "capability-not-required" });
      setBackendState({
        data: null,
        outputKey: SUBSTRATE_NOT_REQUIRED_KEY,
        error: null,
        status: notRequiredStatus,
      });
      return;
    }
    tracePipelineStage("substrate", "required");
    if (lastEnqueuedInput.current === input) return;

    const executeSchedule = () => {
      lastEnqueuedInput.current = input;
      const requestId = ++latestRequest.current;
      const requestTrace = traceStartSpan("substrate.request", {
        inputKey,
        detail: { requestId, source: "useSubstrateBackend" },
      });
      const schedule = scheduler.snapshot();
      setBackendState((current) => ({
        data: current.data,
        outputKey: current.outputKey,
        error: null,
        status: {
          ...current.status,
          phase: "building",
          requestId,
          requestedBackend: "cpu-worker",
          activeBackend: workerBackend.available ? "cpu-worker" : "cpu-main",
          workerCapability: workerBackend.capability,
          fallbackCode: workerBackend.available ? null : workerBackend.capability?.failureCode ?? "worker-unavailable",
          fallbackReason: workerBackend.available ? null : workerBackend.availabilityReason,
          timing: null,
          ...schedule,
          latestRequestedId: requestId,
        },
      }));

      scheduler.schedule({
        id: requestId,
        input,
        run: async (nextInput) => {
          const computeTrace = traceStartSpan("substrate.compute", { inputKey });
          try {
            const result = await computeSubstrateWithFallback(workerBackend, cpuMainSubstrateBackend, nextInput);
            computeTrace({
              outputKey: inputKey,
              counts: {
                width: result.result.data.width,
                height: result.result.data.height,
                cells: result.result.data.width * result.result.data.height,
              },
              bytes: { plannedResident: result.result.data.width * result.result.data.height * Float32Array.BYTES_PER_ELEMENT * 3 },
              detail: {
                backend: result.result.backend,
                fallbackCode: result.fallbackCode,
                workerComputeMs: result.result.timing.workerComputeMs,
                roundTripMs: result.result.timing.roundTripMs,
              },
            });
            return result;
          } catch (error) {
            computeTrace({ detail: { error: error instanceof Error ? error.message : String(error) } });
            throw error;
          }
        },
        complete: ({ result, fallbackCode, fallbackReason }, stale) => {
          requestTrace({
            outputKey: inputKey,
            counts: { width: result.data.width, height: result.data.height },
            bytes: { plannedResident: result.data.width * result.data.height * Float32Array.BYTES_PER_ELEMENT * 3 },
            detail: {
              backend: result.backend,
              stale,
              fallbackCode,
              fallbackReason,
              workerComputeMs: result.timing.workerComputeMs,
              roundTripMs: result.timing.roundTripMs,
            },
          });
          traceEvent({
            stage: stale ? "substrate.stale-result" : "substrate.result",
            phase: "instant",
            inputKey,
            outputKey: stale ? undefined : inputKey,
            detail: { requestId, stale, backend: result.backend },
          });
          if (!mounted.current || stale || latestRequest.current !== requestId) return;
          const latestSchedule = scheduler.snapshot();
          setBackendState({
            data: result.data,
            outputKey: inputKey,
            error: result.error,
            status: {
              phase: result.error ? "error" : fallbackReason ? "fallback" : "ready",
              requestId,
              requestedBackend: "cpu-worker",
              activeBackend: result.backend,
              workerCapability: workerBackend.capability,
              fallbackCode,
              fallbackReason,
              timing: result.timing,
              ...latestSchedule,
            },
          });
        },
        fail: (error, stale) => {
          requestTrace({
            inputKey,
            detail: { requestId, stale, error: error instanceof Error ? error.message : String(error) },
          });
          if (!mounted.current || stale || latestRequest.current !== requestId) return;
          const latestSchedule = scheduler.snapshot();
          setBackendState((current) => ({
            data: current.data,
            outputKey: current.outputKey,
            error: error instanceof Error ? error.message : "Substrate build failed.",
            status: {
              ...current.status,
              phase: "error",
              requestId,
              timing: null,
              ...latestSchedule,
            },
          }));
        },
      });
    };

    const timerId = setTimeout(executeSchedule, 50);
    return () => clearTimeout(timerId);
  }, [enabled, input, inputKey, scheduler, workerBackend]);

  useEffect(() => {
    mounted.current = true;
    if (disposeTimer.current) {
      clearTimeout(disposeTimer.current);
      disposeTimer.current = null;
    }
    return () => {
      mounted.current = false;
      // React Strict Mode immediately re-runs this effect in development. Delay disposal
      // one task so the rehearsal setup can retain the live state-held backend.
      disposeTimer.current = setTimeout(() => workerBackend.dispose(), 0);
    };
  }, [workerBackend]);

  return backendState;
}
