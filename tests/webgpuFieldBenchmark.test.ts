import { describe, expect, it } from "vitest";
import {
  compareFieldGrids,
  computeCpuField,
  runWebGpuFieldBenchmark,
  validateFieldGrid,
  WEBGPU_FIELD_BENCHMARK_SIZES,
} from "../src/engine/gpu/webgpuFieldBenchmark";

describe("bounded WebGPU field benchmark", () => {
  it("defines the required bounded grid sizes", () => {
    expect(WEBGPU_FIELD_BENCHMARK_SIZES).toEqual([128, 256, 512]);
  });

  it("computes a deterministic CPU baseline", () => {
    const first = computeCpuField(128, 128);
    const second = computeCpuField(128, 128);

    expect(first.values).toEqual(second.values);
    expect(validateFieldGrid(first, 128, 128)).toEqual({
      valid: true,
      dimensionsValid: true,
      finite: true,
    });
  });

  it("returns the CPU result when WebGPU is unavailable", async () => {
    const result = await runWebGpuFieldBenchmark(128, {
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(result.status).toBe("cpu-fallback");
    if (result.status !== "cpu-fallback") {
      throw new Error("Expected CPU fallback.");
    }
    expect(result.gpu).toEqual({
      status: "unavailable",
      reason: "gpu-unavailable",
    });
    expect(result.cpuValidation.valid).toBe(true);
    expect(result.cpu.values).toHaveLength(128 * 128);
  });

  it("validates dimensions and finite values", () => {
    const valid = computeCpuField(4, 4);
    expect(validateFieldGrid(valid, 4, 4).valid).toBe(true);
    expect(validateFieldGrid(valid, 8, 2).dimensionsValid).toBe(false);

    const invalid = {
      width: 1,
      height: 1,
      values: new Float32Array([Number.NaN]),
    };
    expect(validateFieldGrid(invalid, 1, 1)).toEqual({
      valid: false,
      dimensionsValid: true,
      finite: false,
    });
  });

  it("reports mean and maximum numeric differences", () => {
    const cpu = {
      width: 2,
      height: 1,
      values: new Float32Array([0.25, -0.5]),
    };
    const closeGpu = {
      width: 2,
      height: 1,
      values: new Float32Array([0.2505, -0.50025]),
    };
    const comparison = compareFieldGrids(cpu, closeGpu, 0.001);

    expect(comparison.valid).toBe(true);
    expect(comparison.maxDifference).toBeCloseTo(0.0005, 6);
    expect(comparison.meanDifference).toBeCloseTo(0.000375, 6);
    expect(
      compareFieldGrids(cpu, { ...closeGpu, width: 1 }, 0.001).valid,
    ).toBe(false);
  });
});
