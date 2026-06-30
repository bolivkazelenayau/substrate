import { describe, expect, it } from "vitest";
import {
  repeatedBenchmarkTableRows,
  repeatedBenchmarkToCsv,
  runRepeatedWebGpuFieldBenchmarkSuite,
  summarizeTimingSamples,
} from "../src/engine/gpu/webgpuRepeatedBenchmark";
import type { WebGpuFieldBenchmarkResult } from "../src/engine/gpu/webgpuFieldBenchmark";

describe("repeated WebGPU field benchmark", () => {
  it("summarizes deterministic timing arrays", () => {
    expect(summarizeTimingSamples([5, 1, 3, 2, 4])).toEqual({
      min: 1,
      median: 3,
      mean: 3,
      p95: 5,
      max: 5,
      sampleCount: 5,
    });
    expect(summarizeTimingSamples([1, 2, 3, 4]).median).toBe(2.5);
    expect(summarizeTimingSamples([])).toEqual({
      min: null,
      median: null,
      mean: null,
      p95: null,
      max: null,
      sampleCount: 0,
    });
  });

  it("counts every unavailable sample as an explicit fallback", async () => {
    const report = await runRepeatedWebGpuFieldBenchmarkSuite({
      sizes: [4],
      sampleCount: 3,
      warmupCount: 2,
      includeCpuBaselinePerSample: false,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });
    const size = report.sizes[0];

    expect(size.samples).toHaveLength(3);
    expect(size.warmups).toHaveLength(2);
    expect(size.fallbackCount).toBe(3);
    expect(size.failureCount).toBe(0);
    expect(size.warmupFallbackCount).toBe(2);
    expect(size.statistics.totalGpuMs.sampleCount).toBe(0);
    expect(size.statistics.cpuBaselineMs.sampleCount).toBe(0);
  });

  it("counts failed and invalid samples separately from fallbacks", async () => {
    const fallback: WebGpuFieldBenchmarkResult = {
      status: "cpu-fallback",
      size: 4,
      cpu: {
        width: 4,
        height: 4,
        values: new Float32Array(16),
      },
      cpuValidation: { valid: true, dimensionsValid: true, finite: true },
      cpuBaselineMs: 2,
      gpu: { status: "unavailable", reason: "adapter-unavailable" },
    };
    const failure: WebGpuFieldBenchmarkResult = {
      status: "error",
      size: 4,
      stage: "gpu-benchmark",
      error: new Error("synthetic failure"),
      cpu: fallback.cpu,
      cpuValidation: fallback.cpuValidation,
      cpuBaselineMs: 3,
    };
    const queue = [fallback, failure];
    const report = await runRepeatedWebGpuFieldBenchmarkSuite({
      sizes: [4],
      sampleCount: 2,
      warmupCount: 0,
      runBenchmark: async () => {
        const result = queue.shift();
        if (!result) {
          throw new Error("Unexpected benchmark invocation.");
        }
        return result;
      },
    });
    const size = report.sizes[0];

    expect(size.fallbackCount).toBe(1);
    expect(size.failureCount).toBe(1);
    expect(size.statistics.cpuBaselineMs).toMatchObject({
      min: 2,
      max: 3,
      sampleCount: 2,
    });
  });

  it("formats compact table rows and CSV while retaining raw samples", async () => {
    const report = await runRepeatedWebGpuFieldBenchmarkSuite({
      sizes: [4],
      sampleCount: 1,
      warmupCount: 0,
      requestDevice: async () => ({
        status: "unavailable",
        reason: "gpu-unavailable",
      }),
    });

    expect(report.sizes[0].samples).toHaveLength(1);
    expect(repeatedBenchmarkTableRows(report)).toHaveLength(8);
    const csv = repeatedBenchmarkToCsv(report);
    expect(csv).toContain("size,timing,samples,min,median,mean,p95,max");
    expect(csv).toContain("4,cpuBaselineMs");
  });
});
