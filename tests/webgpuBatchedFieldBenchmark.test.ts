import { describe, expect, it, vi } from "vitest";
import {
  createBatchedFieldBenchmarkContext,
  disposeBatchedFieldBenchmarkContext,
  runBatchedDispatchSample,
  runRepeatedBatchedFieldBenchmarkSuite,
  WEBGPU_BATCH_SIZES,
} from "../src/engine/gpu/webgpuBatchedFieldBenchmark";
import { computeCpuField } from "../src/engine/gpu/webgpuFieldBenchmark";
import type {
  WebGpuBuffer,
  WebGpuDevice,
} from "../src/engine/gpu/webgpuSupport";

function mockDevice(mappedValues = computeCpuField(4, 4).values): {
  device: WebGpuDevice;
  pass: {
    dispatchWorkgroups: ReturnType<typeof vi.fn>;
  };
  buffers: WebGpuBuffer[];
} {
  const buffers: WebGpuBuffer[] = [];
  const pass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
  const device = {
    queue: {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    },
    createBuffer: vi.fn(() => {
      const buffer = {
        getMappedRange: vi.fn(() => mappedValues.buffer),
        mapAsync: vi.fn(async () => undefined),
        unmap: vi.fn(),
        destroy: vi.fn(),
      };
      buffers.push(buffer);
      return buffer;
    }),
    createShaderModule: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: vi.fn(() => pass),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    })),
    destroy: vi.fn(),
  } satisfies WebGpuDevice;
  return { device, pass, buffers };
}

describe("batched WebGPU field benchmark", () => {
  it("defines the required batch sizes", () => {
    expect(WEBGPU_BATCH_SIZES).toEqual([1, 2, 4, 8, 16, 32]);
  });

  it("returns explicit CPU fallback results without WebGPU", async () => {
    const report = await runRepeatedBatchedFieldBenchmarkSuite({
      sizes: [4],
      batchSizes: [1, 2],
      sampleCount: 2,
      warmupCount: 0,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(report.status).toBe("cpu-fallback");
    if (report.status !== "cpu-fallback") {
      throw new Error("Expected CPU fallback.");
    }
    expect(report.results[0]).toMatchObject({
      fallbackCount: 4,
      failureCount: 0,
      cpuValidation: { valid: true },
    });
  });

  it("reports timestamp-unavailable and still creates a usable context", async () => {
    const { device } = mockDevice();
    const created = await createBatchedFieldBenchmarkContext({
      maxSize: 4,
      enableTimestampQueries: true,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
        enabledFeatures: [],
      }),
    });

    expect(created.status).toBe("ready");
    if (created.status !== "ready") {
      throw new Error("Expected ready context.");
    }
    expect(created.context.timestamp).toEqual({
      status: "timestamp-unavailable",
      reason: "feature-unsupported",
    });
    disposeBatchedFieldBenchmarkContext(created.context);
  });

  it("encodes batches and normalizes timing per dispatch", async () => {
    const { device, pass } = mockDevice();
    const created = await createBatchedFieldBenchmarkContext({
      maxSize: 4,
      enableTimestampQueries: false,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      }),
    });
    if (created.status !== "ready") {
      throw new Error("Expected ready context.");
    }
    created.context.persistent.validatedSizes.add(4);

    const result = await runBatchedDispatchSample(created.context, 4, 4, {
      submissionsPerSync: 2,
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") {
      throw new Error("Expected successful sample.");
    }
    expect(result.dispatchCount).toBe(8);
    expect(pass.dispatchWorkgroups).toHaveBeenCalledTimes(8);
    expect(result.validationStatus).toBe("timing-only-validated-formula");
    expect(result.timestampStatus).toBe("timestamp-unavailable");
    expect(result.timings.gpuTimestampMs).toBeNull();
    expect(result.timings.normalizedPerDispatchMs).toBe(
      result.timings.batchTotalMs / 8,
    );
    disposeBatchedFieldBenchmarkContext(created.context);
  });

  it("summarizes batched samples without requiring timestamp support", async () => {
    const { device } = mockDevice();
    const report = await runRepeatedBatchedFieldBenchmarkSuite({
      sizes: [4],
      batchSizes: [2],
      submissionsPerSync: 2,
      sampleCount: 2,
      warmupCount: 1,
      enableTimestampQueries: true,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
        enabledFeatures: [],
      }),
    });

    expect(report.status).toBe("success");
    if (report.status !== "success") {
      throw new Error("Expected successful report.");
    }
    expect(report.timestampStatus).toBe("timestamp-unavailable");
    expect(report.timestampReason).toBe("feature-unsupported");
    expect(report.results[0].samples).toHaveLength(2);
    expect(
      report.results[0].statistics.normalizedPerDispatchMs.sampleCount,
    ).toBe(2);
    expect(
      report.results[0].statistics.gpuTimestampMs.sampleCount,
    ).toBe(0);
    expect(report.results[0].failureCount).toBe(0);
  });

  it("summarizes normalized batched timings deterministically", async () => {
    const { device } = mockDevice();
    const normalized = [2, 4];
    const report = await runRepeatedBatchedFieldBenchmarkSuite({
      sizes: [4],
      batchSizes: [2],
      submissionsPerSync: 1,
      sampleCount: 2,
      warmupCount: 0,
      enableTimestampQueries: false,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      }),
      runSample: async (_context, size, batchSize, options) => {
        const value = normalized.shift() ?? 0;
        return {
          status: "success",
          size,
          batchSize,
          submissionsPerSync: options?.submissionsPerSync ?? 1,
          dispatchCount: batchSize,
          validationStatus: "timing-only-validated-formula",
          timestampStatus: "timestamp-unavailable",
          timings: {
            cpuBaselinePerFieldMs: 1,
            uploadMs: 0,
            commandEncodingMs: 0,
            submissionMs: 0,
            queueCompletionMs: value * batchSize,
            batchTotalMs: value * batchSize,
            normalizedPerDispatchMs: value,
            totalGpuNoReadbackMs: value * batchSize,
            gpuTimestampMs: null,
            gpuTimestampPerDispatchMs: null,
          },
        };
      },
    });

    expect(report.status).toBe("success");
    if (report.status !== "success") {
      throw new Error("Expected successful report.");
    }
    expect(
      report.results[0].statistics.normalizedPerDispatchMs,
    ).toMatchObject({
      min: 2,
      median: 3,
      mean: 3,
      p95: 4,
      max: 4,
      sampleCount: 2,
    });
  });
});
