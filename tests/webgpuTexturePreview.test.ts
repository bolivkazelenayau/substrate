import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  mountWebGpuTexturePreview,
  WEBGPU_TEXTURE_PREVIEW_SIZES,
} from "../src/engine/gpu/webgpuTexturePreview";
import type { WebGpuDevice } from "../src/engine/gpu/webgpuSupport";

describe("WebGPU texture preview prototype", () => {
  it("defines the bounded preview sizes", () => {
    expect(WEBGPU_TEXTURE_PREVIEW_SIZES).toEqual([256, 512]);
  });

  it("renders a CPU canvas fallback when WebGPU is unavailable", async () => {
    const putImageData = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((type: string) =>
        type === "2d"
          ? {
              createImageData: (width: number, height: number) => ({
                data: new Uint8ClampedArray(width * height * 4),
              }),
              putImageData,
            }
          : null,
      ),
    };
    const result = await mountWebGpuTexturePreview(canvas, {
      size: 256,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(result.status).toBe("cpu-fallback");
    expect(result).toMatchObject({
      rendered: true,
      gpu: { status: "unavailable", reason: "gpu-unavailable" },
      controller: { backend: "cpu-canvas", size: 256 },
    });
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(putImageData).toHaveBeenCalledOnce();
  });

  it("creates a reusable texture compute and render controller", async () => {
    const computePass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      dispatchWorkgroups: vi.fn(),
      end: vi.fn(),
    };
    const renderPass = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    };
    const parameterBuffer = { destroy: vi.fn() };
    const emitterBuffer = { destroy: vi.fn() };
    const presentationBuffer = { destroy: vi.fn() };
    const buffers = [
      parameterBuffer,
      emitterBuffer,
      presentationBuffer,
    ];
    const fieldTexture = {
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    };
    const queue = {
      writeBuffer: vi.fn(),
      submit: vi.fn(),
      onSubmittedWorkDone: vi.fn(async () => undefined),
    };
    const device = {
      queue,
      createBuffer: vi.fn(() => buffers.shift()!),
      createTexture: vi.fn(() => fieldTexture),
      createShaderModule: vi.fn(() => ({})),
      createComputePipeline: vi.fn(() => ({
        getBindGroupLayout: () => ({}),
      })),
      createRenderPipeline: vi.fn(() => ({
        getBindGroupLayout: () => ({}),
      })),
      createSampler: vi.fn(() => ({})),
      createBindGroup: vi.fn(() => ({})),
      createCommandEncoder: vi.fn(() => ({
        beginComputePass: () => computePass,
        beginRenderPass: () => renderPass,
        finish: () => ({}),
      })),
      destroy: vi.fn(),
    };
    const webgpuContext = {
      configure: vi.fn(),
      getCurrentTexture: vi.fn(() => ({ createView: () => ({}) })),
      unconfigure: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn((type: string) =>
        type === "webgpu" ? webgpuContext : null,
      ),
    };
    const result = await mountWebGpuTexturePreview(canvas, {
      size: 256,
      requestDevice: async () => ({
        status: "ready",
        adapter: {
          requestDevice: async () => device as unknown as WebGpuDevice,
        },
        device: device as unknown as WebGpuDevice,
      }),
    });

    expect(result.status).toBe("ready");
    if (result.status !== "ready") {
      throw new Error("Expected texture preview.");
    }
    expect(result.controller.backend).toBe("webgpu-texture");
    expect(device.createTexture).toHaveBeenCalledOnce();
    expect(queue.submit).toHaveBeenCalledOnce();
    expect(computePass.dispatchWorkgroups).toHaveBeenCalledWith(32, 32);
    expect(renderPass.draw).toHaveBeenCalledWith(3);

    const timing = await result.controller.render(
      { phaseOffset: 0.5, frequencyScale: 1.2 },
      { synchronize: true },
    );
    expect(timing.synchronized).toBe(true);
    expect(queue.writeBuffer).toHaveBeenCalledWith(
      parameterBuffer,
      0,
      new Float32Array([256, 256, 0.5, 1.2, 3, 0, 0, 0]),
    );
    expect(queue.onSubmittedWorkDone).toHaveBeenCalledOnce();

    const computeDispatches = computePass.dispatchWorkgroups.mock.calls.length;
    await result.controller.render({}, { skipCompute: true });
    expect(computePass.dispatchWorkgroups).toHaveBeenCalledTimes(
      computeDispatches,
    );
    expect(renderPass.draw).toHaveBeenCalledTimes(3);

    result.controller.dispose();
    result.controller.dispose();
    expect(parameterBuffer.destroy).toHaveBeenCalledOnce();
    expect(emitterBuffer.destroy).toHaveBeenCalledOnce();
    expect(presentationBuffer.destroy).toHaveBeenCalledOnce();
    expect(fieldTexture.destroy).toHaveBeenCalledOnce();
    expect(device.destroy).toHaveBeenCalledOnce();
  });

  it("remains isolated from renderers, project state, and exporters", () => {
    const source = readFileSync(
      resolve("src/engine/gpu/webgpuTexturePreview.ts"),
      "utf8",
    );

    expect(source).not.toContain("/renderers/");
    expect(source).not.toContain("exportSvg");
    expect(source).not.toContain("projectSchema");
    expect(source).not.toContain("/presets");
    expect(source).not.toContain("../types");
  });
});
