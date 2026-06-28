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

export interface SubstrateBackendState {
  data: SubstrateData | null;
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

export function useSubstrateBackend(input: SubstrateBuildInput): SubstrateBackendState {
  const [workerBackend] = useState(() => createCpuWorkerSubstrateBackend());
  const latestRequest = useRef(0);
  const lastEnqueuedInput = useRef<SubstrateBuildInput | null>(null);
  const disposeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [backendState, setBackendState] = useState<SubstrateBackendState>({
    data: null,
    error: null,
    status: initialStatus,
  });
  const [scheduler] = useState(() => new LatestOnlyScheduler<SubstrateBuildInput, SubstrateFallbackResult>(
    (schedule) => {
      if (!mounted.current) return;
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
    if (lastEnqueuedInput.current === input) return;
    lastEnqueuedInput.current = input;
    const requestId = ++latestRequest.current;
    const schedule = scheduler.snapshot();
    setBackendState((current) => ({
      data: current.data,
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
      run: (nextInput) => computeSubstrateWithFallback(workerBackend, cpuMainSubstrateBackend, nextInput),
      complete: ({ result, fallbackCode, fallbackReason }, stale) => {
        if (!mounted.current || stale || latestRequest.current !== requestId) return;
        const latestSchedule = scheduler.snapshot();
        setBackendState({
          data: result.data,
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
        if (!mounted.current || stale || latestRequest.current !== requestId) return;
        const latestSchedule = scheduler.snapshot();
        setBackendState((current) => ({
          data: current.data,
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
  }, [input, scheduler, workerBackend]);

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
