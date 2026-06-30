import {
  computeCpuField,
  runWebGpuFieldBenchmark,
  WEBGPU_FIELD_BENCHMARK_SIZES,
  type FieldGrid,
  type WebGpuFieldBenchmarkResult,
  type WebGpuFieldBenchmarkTimings,
} from "./webgpuFieldBenchmark";
import type { WebGpuDeviceResult } from "./webgpuSupport";

export interface TimingStatistics {
  min: number | null;
  median: number | null;
  mean: number | null;
  p95: number | null;
  max: number | null;
  sampleCount: number;
}

export type BenchmarkTimingName = keyof WebGpuFieldBenchmarkTimings;

export interface RepeatedBenchmarkSizeResult {
  size: number;
  samples: WebGpuFieldBenchmarkResult[];
  warmups: WebGpuFieldBenchmarkResult[];
  statistics: Record<BenchmarkTimingName, TimingStatistics>;
  fallbackCount: number;
  failureCount: number;
  warmupFallbackCount: number;
  warmupFailureCount: number;
}

export interface RepeatedWebGpuFieldBenchmarkResult {
  options: {
    sampleCount: number;
    warmupCount: number;
    sizes: number[];
    includeCpuBaselinePerSample: boolean;
  };
  sizes: RepeatedBenchmarkSizeResult[];
}

export interface RepeatedWebGpuFieldBenchmarkOptions {
  sampleCount?: number;
  warmupCount?: number;
  sizes?: readonly number[];
  includeCpuBaselinePerSample?: boolean;
  requestDevice?: () => Promise<WebGpuDeviceResult>;
  runBenchmark?: (
    size: number,
    options: {
      requestDevice?: () => Promise<WebGpuDeviceResult>;
      cpuReference?: FieldGrid;
      measureCpuBaseline?: boolean;
    },
  ) => Promise<WebGpuFieldBenchmarkResult>;
}

const TIMING_NAMES: readonly BenchmarkTimingName[] = [
  "cpuBaselineMs",
  "deviceReadinessMs",
  "pipelineCreationMs",
  "warmupMs",
  "bufferUploadMs",
  "dispatchMs",
  "readbackMs",
  "totalGpuMs",
];

function percentile(sorted: readonly number[], fraction: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

export function summarizeTimingSamples(
  samples: readonly number[],
): TimingStatistics {
  const finite = samples.filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0) {
    return {
      min: null,
      median: null,
      mean: null,
      p95: null,
      max: null,
      sampleCount: 0,
    };
  }

  const middle = Math.floor(finite.length / 2);
  const median =
    finite.length % 2 === 0
      ? (finite[middle - 1] + finite[middle]) / 2
      : finite[middle];
  return {
    min: finite[0],
    median,
    mean: finite.reduce((sum, value) => sum + value, 0) / finite.length,
    p95: percentile(finite, 0.95),
    max: finite[finite.length - 1],
    sampleCount: finite.length,
  };
}

function sampleFailed(result: WebGpuFieldBenchmarkResult): boolean {
  return (
    result.status === "error" ||
    (result.status === "success" &&
      (!result.cpuValidation.valid ||
        !result.gpuValidation.valid ||
        !result.comparison.valid))
  );
}

function countResults(results: readonly WebGpuFieldBenchmarkResult[]): {
  fallbackCount: number;
  failureCount: number;
} {
  return {
    fallbackCount: results.filter(({ status }) => status === "cpu-fallback")
      .length,
    failureCount: results.filter(sampleFailed).length,
  };
}

function timingValues(
  results: readonly WebGpuFieldBenchmarkResult[],
  timing: BenchmarkTimingName,
): number[] {
  const values: number[] = [];
  for (const result of results) {
    const value =
      result.status === "success"
        ? result.timings[timing]
        : timing === "cpuBaselineMs"
          ? result.cpuBaselineMs
          : null;
    if (value !== null && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

export async function runRepeatedWebGpuFieldBenchmarkSuite(
  options: RepeatedWebGpuFieldBenchmarkOptions = {},
): Promise<RepeatedWebGpuFieldBenchmarkResult> {
  const sampleCount = positiveInteger(options.sampleCount ?? 20, "sampleCount");
  const warmupCount = nonNegativeInteger(options.warmupCount ?? 3, "warmupCount");
  const sizes = [...(options.sizes ?? WEBGPU_FIELD_BENCHMARK_SIZES)];
  sizes.forEach((size) => positiveInteger(size, "grid size"));
  const includeCpuBaselinePerSample =
    options.includeCpuBaselinePerSample ?? true;
  const runBenchmark = options.runBenchmark ?? runWebGpuFieldBenchmark;
  const sizeResults: RepeatedBenchmarkSizeResult[] = [];

  for (const size of sizes) {
    const cpuReference = computeCpuField(size, size);
    const invoke = () =>
      runBenchmark(size, {
        requestDevice: options.requestDevice,
        cpuReference,
        measureCpuBaseline: includeCpuBaselinePerSample,
      });

    const warmups: WebGpuFieldBenchmarkResult[] = [];
    for (let index = 0; index < warmupCount; index += 1) {
      warmups.push(await invoke());
    }

    const samples: WebGpuFieldBenchmarkResult[] = [];
    for (let index = 0; index < sampleCount; index += 1) {
      samples.push(await invoke());
    }

    const statistics = Object.fromEntries(
      TIMING_NAMES.map((timing) => [
        timing,
        summarizeTimingSamples(timingValues(samples, timing)),
      ]),
    ) as Record<BenchmarkTimingName, TimingStatistics>;
    const counts = countResults(samples);
    const warmupCounts = countResults(warmups);
    sizeResults.push({
      size,
      samples,
      warmups,
      statistics,
      ...counts,
      warmupFallbackCount: warmupCounts.fallbackCount,
      warmupFailureCount: warmupCounts.failureCount,
    });
  }

  return {
    options: {
      sampleCount,
      warmupCount,
      sizes,
      includeCpuBaselinePerSample,
    },
    sizes: sizeResults,
  };
}

function rounded(value: number | null): number | null {
  return value === null ? null : Number(value.toFixed(3));
}

export function repeatedBenchmarkTableRows(
  report: RepeatedWebGpuFieldBenchmarkResult,
): Array<Record<string, number | string | null>> {
  return report.sizes.flatMap((sizeResult) =>
    TIMING_NAMES.map((timing) => {
      const statistics = sizeResult.statistics[timing];
      return {
        size: sizeResult.size,
        timing,
        samples: statistics.sampleCount,
        min: rounded(statistics.min),
        median: rounded(statistics.median),
        mean: rounded(statistics.mean),
        p95: rounded(statistics.p95),
        max: rounded(statistics.max),
        fallbacks: sizeResult.fallbackCount,
        failures: sizeResult.failureCount,
      };
    }),
  );
}

export function reportRepeatedWebGpuFieldBenchmark(
  report: RepeatedWebGpuFieldBenchmarkResult,
): void {
  console.table(repeatedBenchmarkTableRows(report));
}

export function repeatedBenchmarkToCsv(
  report: RepeatedWebGpuFieldBenchmarkResult,
): string {
  const columns = [
    "size",
    "timing",
    "samples",
    "min",
    "median",
    "mean",
    "p95",
    "max",
    "fallbacks",
    "failures",
  ];
  const rows = repeatedBenchmarkTableRows(report);
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => row[column] ?? "").join(",")),
  ].join("\n");
}
