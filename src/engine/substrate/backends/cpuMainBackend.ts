import { measure } from "../../performance";
import { buildSubstrate } from "../buildSubstrate";
import type { SubstrateComputeBackend } from "./types";
import type { RasterSurfaceFactory } from "../rasterizeGlyphs";

export function createCpuMainSubstrateBackend(factory?: RasterSurfaceFactory): SubstrateComputeBackend {
  let nextRequestId = 0;
  return {
    id: "cpu-main",
    label: "CPU / main thread",
    available: true,
    availabilityReason: null,
    capability: null,
    async compute(input) {
      const requestId = ++nextRequestId;
      const measured = measure(() => buildSubstrate(input, factory));
      return {
        ...measured.value,
        requestId,
        backend: "cpu-main",
        timing: {
          totalMs: measured.durationMs,
          mainThreadMs: measured.durationMs,
          workerComputeMs: 0,
          roundTripMs: 0,
        },
      };
    },
    dispose() {},
  };
}

export const cpuMainSubstrateBackend = createCpuMainSubstrateBackend();
