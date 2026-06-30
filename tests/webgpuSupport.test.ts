import { describe, expect, it, vi } from "vitest";
import {
  getWebGpuSupport,
  requestWebGpuDevice,
  type WebGpuDevice,
} from "../src/engine/gpu/webgpuSupport";
import { runWebGpuComputeSpike } from "../src/engine/gpu/webgpuComputeSpike";

describe("WebGPU capability", () => {
  it("degrades safely without navigator or navigator.gpu", async () => {
    expect(getWebGpuSupport(null)).toEqual({
      status: "unavailable",
      reason: "navigator-unavailable",
    });
    await expect(requestWebGpuDevice({})).resolves.toEqual({
      status: "unavailable",
      reason: "gpu-unavailable",
    });
  });

  it("reports adapter and device failures without throwing", async () => {
    await expect(
      requestWebGpuDevice({ gpu: { requestAdapter: async () => null } }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "adapter-unavailable",
    });

    const error = new Error("device rejected");
    const result = await requestWebGpuDevice({
      gpu: {
        requestAdapter: async () => ({
          requestDevice: async () => {
            throw error;
          },
        }),
      },
    });
    expect(result).toEqual({ status: "error", stage: "device", error });
  });

  it("requests an optional timestamp feature only when supported", async () => {
    const requestDevice = vi.fn(async () => ({} as WebGpuDevice));
    const result = await requestWebGpuDevice(
      {
        gpu: {
          requestAdapter: async () => ({
            features: { has: (feature) => feature === "timestamp-query" },
            requestDevice,
          }),
        },
      },
      { preferredFeatures: ["timestamp-query", "unsupported-feature"] },
    );

    expect(result).toMatchObject({
      status: "ready",
      enabledFeatures: ["timestamp-query"],
    });
    expect(requestDevice).toHaveBeenCalledWith({
      requiredFeatures: ["timestamp-query"],
    });
  });
});

describe("WebGPU compute spike", () => {
  it("passes through unavailable results without touching a GPU", async () => {
    await expect(
      runWebGpuComputeSpike(async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      })),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "gpu-unavailable",
    });
  });

  it("dispatches and validates deterministic readback", async () => {
    const mapped = new Uint32Array([3, 5, 7, 9]).buffer;
    const buffer = {
      getMappedRange: vi.fn(() => mapped),
      mapAsync: vi.fn(async () => undefined),
      unmap: vi.fn(),
      destroy: vi.fn(),
    };
    const pass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      dispatchWorkgroups: vi.fn(),
      end: vi.fn(),
    };
    const encoder = {
      beginComputePass: vi.fn(() => pass),
      copyBufferToBuffer: vi.fn(),
      finish: vi.fn(() => ({})),
    };
    const device = {
      queue: {
        writeBuffer: vi.fn(),
        submit: vi.fn(),
      },
      createBuffer: vi.fn(() => buffer),
      createShaderModule: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({
        getBindGroupLayout: vi.fn(() => ({})),
      })),
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => encoder),
      destroy: vi.fn(),
    } satisfies WebGpuDevice;

    await expect(
      runWebGpuComputeSpike(async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      })),
    ).resolves.toEqual({ status: "success", output: [3, 5, 7, 9] });
    expect(pass.dispatchWorkgroups).toHaveBeenCalledWith(1);
    expect(device.queue.submit).toHaveBeenCalledOnce();
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("reports deterministic-output mismatches explicitly", async () => {
    const mapped = new Uint32Array([0, 0, 0, 0]).buffer;
    const buffer = {
      getMappedRange: () => mapped,
      mapAsync: async () => undefined,
      unmap: () => undefined,
    };
    const device = {
      queue: { writeBuffer: () => undefined, submit: () => undefined },
      createBuffer: () => buffer,
      createShaderModule: () => ({}),
      createComputePipeline: () => ({ getBindGroupLayout: () => ({}) }),
      createBindGroup: () => ({}),
      createCommandEncoder: () => ({
        beginComputePass: () => ({
          setPipeline: () => undefined,
          setBindGroup: () => undefined,
          dispatchWorkgroups: () => undefined,
          end: () => undefined,
        }),
        copyBufferToBuffer: () => undefined,
        finish: () => ({}),
      }),
    } satisfies WebGpuDevice;

    await expect(
      runWebGpuComputeSpike(async () => ({
        status: "ready",
        adapter: { requestDevice: async () => device },
        device,
      })),
    ).resolves.toEqual({
      status: "validation-error",
      expected: [3, 5, 7, 9],
      actual: [0, 0, 0, 0],
    });
  });
});
