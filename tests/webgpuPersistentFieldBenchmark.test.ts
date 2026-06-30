import { describe, expect, it, vi } from "vitest";
import {
  createPersistentFieldBenchmarkContext,
  disposePersistentFieldBenchmarkContext,
  runPersistentFieldSample,
  runRepeatedPersistentFieldBenchmarkSuite,
} from "../src/engine/gpu/webgpuPersistentFieldBenchmark";
import type {
  WebGpuBuffer,
  WebGpuDevice,
} from "../src/engine/gpu/webgpuSupport";

function mockDevice(mappedValues = new Float32Array(16)): {
  device: WebGpuDevice;
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
  return { device, buffers };
}

describe("persistent WebGPU field benchmark", () => {
  it("returns explicit CPU fallback results without WebGPU", async () => {
    const report = await runRepeatedPersistentFieldBenchmarkSuite({
      sizes: [4],
      modes: ["readback-validation", "no-readback"],
      sampleCount: 2,
      warmupCount: 1,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(report.status).toBe("cpu-fallback");
    if (report.status !== "cpu-fallback") {
      throw new Error("Expected CPU fallback.");
    }
    expect(report.results).toHaveLength(2);
    expect(report.results[0]).toMatchObject({
      fallbackCount: 2,
      failureCount: 0,
      cpuValidation: { valid: true },
    });
  });

  it("creates and disposes persistent resources exactly once", async () => {
    const { device, buffers } = mockDevice();
    const result = await createPersistentFieldBenchmarkContext({
      maxSize: 4,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("Expected ready context.");
    }
    expect(device.createBuffer).toHaveBeenCalledTimes(4);
    disposePersistentFieldBenchmarkContext(result.context);
    disposePersistentFieldBenchmarkContext(result.context);
    for (const buffer of buffers) {
      expect(buffer.destroy).toHaveBeenCalledOnce();
    }
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("marks no-readback samples as timing-only", async () => {
    const { device } = mockDevice();
    const created = await createPersistentFieldBenchmarkContext({
      maxSize: 4,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      }),
    });
    if (created.status !== "ready") {
      throw new Error("Expected ready context.");
    }

    const result = await runPersistentFieldSample(created.context, 4, {
      mode: "no-readback",
    });
    expect(result).toMatchObject({
      status: "success",
      mode: "no-readback",
      validationStatus: "timing-only-unvalidated",
      gpu: null,
      comparison: null,
      timings: {
        copyToReadbackMs: null,
        readbackMapMs: null,
      },
    });
    disposePersistentFieldBenchmarkContext(created.context);
  });

  it("disposes the shared context after a repeated suite", async () => {
    const { device } = mockDevice();
    const report = await runRepeatedPersistentFieldBenchmarkSuite({
      sizes: [4],
      modes: ["no-readback"],
      sampleCount: 2,
      warmupCount: 1,
      requestDevice: async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      }),
    });

    expect(report.status).toBe("success");
    expect(device.createComputePipeline).toHaveBeenCalledOnce();
    expect(device.createBuffer).toHaveBeenCalledTimes(4);
    expect(device.destroy).toHaveBeenCalledOnce();
  });
});
