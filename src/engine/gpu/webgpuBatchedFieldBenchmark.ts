import {
  computeCpuField,
  validateFieldGrid,
  WEBGPU_FIELD_BENCHMARK_SIZES,
  type FieldGrid,
  type FieldValidation,
} from "./webgpuFieldBenchmark";
import {
  createPersistentFieldBenchmarkContext,
  disposePersistentFieldBenchmarkContext,
  runPersistentFieldSample,
  type PersistentContextResult,
  type PersistentFieldBenchmarkContext,
  type PersistentFieldSampleResult,
  type PersistentFieldSetupTimings,
} from "./webgpuPersistentFieldBenchmark";
import {
  summarizeTimingSamples,
  type TimingStatistics,
} from "./webgpuRepeatedBenchmark";
import {
  requestWebGpuDevice,
  type WebGpuBuffer,
  type WebGpuDeviceResult,
  type WebGpuQuerySet,
} from "./webgpuSupport";

export const WEBGPU_BATCH_SIZES = [1, 2, 4, 8, 16, 32] as const;

const BUFFER_USAGE_MAP_READ = 0x0001;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_QUERY_RESOLVE = 0x0200;
const MAP_MODE_READ = 0x0001;
const TIMESTAMP_BYTES = BigUint64Array.BYTES_PER_ELEMENT;

type Clock = () => number;

export type TimestampQueryCapability =
  | {
      status: "available";
      querySet: WebGpuQuerySet;
      resolveBuffer: WebGpuBuffer;
      readbackBuffer: WebGpuBuffer;
      maxSubmissionsPerSync: number;
    }
  | {
      status: "timestamp-unavailable";
      reason:
        | "not-requested"
        | "feature-unsupported"
        | "api-unavailable";
    };

export interface BatchedFieldBenchmarkContext {
  persistent: PersistentFieldBenchmarkContext;
  timestamp: TimestampQueryCapability;
  disposed: boolean;
}

export type BatchedContextResult =
  | {
      status: "ready";
      context: BatchedFieldBenchmarkContext;
      setupTimings: PersistentFieldSetupTimings;
      timestamp: TimestampQueryCapability["status"];
    }
  | Exclude<PersistentContextResult, { status: "ready" }>;

export interface BatchedFieldSampleTimings {
  cpuBaselinePerFieldMs: number;
  uploadMs: number;
  commandEncodingMs: number;
  submissionMs: number;
  queueCompletionMs: number;
  batchTotalMs: number;
  normalizedPerDispatchMs: number;
  totalGpuNoReadbackMs: number;
  gpuTimestampMs: number | null;
  gpuTimestampPerDispatchMs: number | null;
}

export type BatchedFieldSampleResult =
  | {
      status: "success";
      size: number;
      batchSize: number;
      submissionsPerSync: number;
      dispatchCount: number;
      validationStatus:
        | "timing-only-validated-formula"
        | "timing-only-unvalidated";
      timestampStatus: "available" | "timestamp-unavailable";
      timings: BatchedFieldSampleTimings;
    }
  | {
      status: "error";
      size: number;
      batchSize: number;
      submissionsPerSync: number;
      stage: "batched-sample";
      error: unknown;
    };

export type BatchedTimingName = keyof BatchedFieldSampleTimings;

export interface BatchedBenchmarkSummary {
  size: number;
  batchSize: number;
  submissionsPerSync: number;
  samples: BatchedFieldSampleResult[];
  warmups: BatchedFieldSampleResult[];
  statistics: Record<BatchedTimingName, TimingStatistics>;
  fallbackCount: number;
  failureCount: number;
}

export type RepeatedBatchedFieldBenchmarkResult =
  | {
      status: "success";
      setupTimings: PersistentFieldSetupTimings;
      timestampStatus: "available" | "timestamp-unavailable";
      timestampReason?: Extract<
        TimestampQueryCapability,
        { status: "timestamp-unavailable" }
      >["reason"];
      validations: PersistentFieldSampleResult[];
      sampleCount: number;
      warmupCount: number;
      results: BatchedBenchmarkSummary[];
    }
  | {
      status: "cpu-fallback";
      setup: Exclude<PersistentContextResult, { status: "ready" | "error" }>;
      sampleCount: number;
      warmupCount: number;
      results: Array<{
        size: number;
        cpu: FieldGrid;
        cpuValidation: FieldValidation;
        cpuBaselinePerFieldMs: number;
        fallbackCount: number;
        failureCount: 0;
      }>;
    }
  | Extract<PersistentContextResult, { status: "error" }>;

const defaultClock: Clock = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

function elapsed(clock: Clock, started: number): number {
  return Math.max(0, clock() - started);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function createTimestampCapability(
  persistent: PersistentFieldBenchmarkContext,
  enabled: boolean,
  maxSubmissionsPerSync: number,
): TimestampQueryCapability {
  if (!enabled) {
    return { status: "timestamp-unavailable", reason: "not-requested" };
  }
  if (!persistent.enabledFeatures.has("timestamp-query")) {
    return {
      status: "timestamp-unavailable",
      reason: "feature-unsupported",
    };
  }
  if (!persistent.device.createQuerySet) {
    return { status: "timestamp-unavailable", reason: "api-unavailable" };
  }

  const queryCount = maxSubmissionsPerSync * 2;
  const byteLength = queryCount * TIMESTAMP_BYTES;
  const querySet = persistent.device.createQuerySet({
    type: "timestamp",
    count: queryCount,
  });
  const resolveBuffer = persistent.device.createBuffer({
    size: byteLength,
    usage: BUFFER_USAGE_QUERY_RESOLVE | BUFFER_USAGE_COPY_SRC,
  });
  const readbackBuffer = persistent.device.createBuffer({
    size: byteLength,
    usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ,
  });
  return {
    status: "available",
    querySet,
    resolveBuffer,
    readbackBuffer,
    maxSubmissionsPerSync,
  };
}

export async function createBatchedFieldBenchmarkContext(
  options: {
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    maxSize?: number;
    maxSubmissionsPerSync?: number;
    enableTimestampQueries?: boolean;
    createPersistentContext?: typeof createPersistentFieldBenchmarkContext;
  } = {},
): Promise<BatchedContextResult> {
  const maxSubmissionsPerSync = positiveInteger(
    options.maxSubmissionsPerSync ?? 4,
    "maxSubmissionsPerSync",
  );
  const requestDevice =
    options.requestDevice ??
    (() =>
      requestWebGpuDevice(undefined, {
        preferredFeatures: ["timestamp-query"],
      }));
  const createPersistentContext =
    options.createPersistentContext ?? createPersistentFieldBenchmarkContext;
  const persistentResult = await createPersistentContext({
    requestDevice,
    maxSize: options.maxSize,
  });
  if (persistentResult.status !== "ready") {
    return persistentResult;
  }

  try {
    const timestamp = createTimestampCapability(
      persistentResult.context,
      options.enableTimestampQueries ?? true,
      maxSubmissionsPerSync,
    );
    return {
      status: "ready",
      context: {
        persistent: persistentResult.context,
        timestamp,
        disposed: false,
      },
      setupTimings: persistentResult.setupTimings,
      timestamp: timestamp.status,
    };
  } catch {
    return {
      status: "ready",
      context: {
        persistent: persistentResult.context,
        timestamp: {
          status: "timestamp-unavailable",
          reason: "api-unavailable",
        },
        disposed: false,
      },
      setupTimings: persistentResult.setupTimings,
      timestamp: "timestamp-unavailable",
    };
  }
}

export function disposeBatchedFieldBenchmarkContext(
  context: BatchedFieldBenchmarkContext,
): void {
  if (context.disposed) {
    return;
  }
  context.disposed = true;
  if (context.timestamp.status === "available") {
    context.timestamp.querySet.destroy?.();
    context.timestamp.resolveBuffer.destroy?.();
    context.timestamp.readbackBuffer.destroy?.();
  }
  disposePersistentFieldBenchmarkContext(context.persistent);
}

async function readGpuTimestamps(
  timestamp: Extract<TimestampQueryCapability, { status: "available" }>,
  submissionCount: number,
): Promise<number> {
  await timestamp.readbackBuffer.mapAsync(MAP_MODE_READ);
  const values = new BigUint64Array(
    timestamp.readbackBuffer
      .getMappedRange()
      .slice(0, submissionCount * 2 * TIMESTAMP_BYTES),
  );
  let nanoseconds = 0n;
  for (let index = 0; index < submissionCount; index += 1) {
    const started = values[index * 2];
    const ended = values[index * 2 + 1];
    if (ended >= started) {
      nanoseconds += ended - started;
    }
  }
  timestamp.readbackBuffer.unmap();
  return Number(nanoseconds) / 1_000_000;
}

export async function runBatchedDispatchSample(
  context: BatchedFieldBenchmarkContext,
  size: number,
  batchSize: number,
  options: {
    submissionsPerSync?: number;
    clock?: Clock;
  } = {},
): Promise<BatchedFieldSampleResult> {
  const submissionsPerSync = positiveInteger(
    options.submissionsPerSync ?? 2,
    "submissionsPerSync",
  );
  positiveInteger(batchSize, "batchSize");
  const persistent = context.persistent;
  if (
    context.disposed ||
    persistent.disposed ||
    !Number.isInteger(size) ||
    size <= 0 ||
    size > persistent.maxSize
  ) {
    return {
      status: "error",
      size,
      batchSize,
      submissionsPerSync,
      stage: "batched-sample",
      error: new Error("Batched benchmark context or size is invalid."),
    };
  }
  if (
    context.timestamp.status === "available" &&
    submissionsPerSync > context.timestamp.maxSubmissionsPerSync
  ) {
    return {
      status: "error",
      size,
      batchSize,
      submissionsPerSync,
      stage: "batched-sample",
      error: new RangeError("submissionsPerSync exceeds timestamp capacity."),
    };
  }

  const clock = options.clock ?? defaultClock;
  const cpuStarted = clock();
  computeCpuField(size, size);
  const cpuBaselinePerFieldMs = elapsed(clock, cpuStarted);
  const gpuStarted = clock();

  try {
    const uploadStarted = clock();
    persistent.device.queue.writeBuffer(
      persistent.buffers.dimensions,
      0,
      new Uint32Array([size, size]),
    );
    const uploadMs = elapsed(clock, uploadStarted);
    const dispatchCount = batchSize * submissionsPerSync;
    const commandBuffers: unknown[] = [];
    const encodingStarted = clock();

    for (
      let submissionIndex = 0;
      submissionIndex < submissionsPerSync;
      submissionIndex += 1
    ) {
      const encoder = persistent.device.createCommandEncoder();
      const pass = encoder.beginComputePass(
        context.timestamp.status === "available"
          ? {
              timestampWrites: {
                querySet: context.timestamp.querySet,
                beginningOfPassWriteIndex: submissionIndex * 2,
                endOfPassWriteIndex: submissionIndex * 2 + 1,
              },
            }
          : undefined,
      );
      pass.setPipeline(persistent.pipeline);
      pass.setBindGroup(0, persistent.bindGroup);
      for (let dispatchIndex = 0; dispatchIndex < batchSize; dispatchIndex += 1) {
        pass.dispatchWorkgroups(Math.ceil((size * size) / 64));
      }
      pass.end();
      commandBuffers.push(encoder.finish());
    }

    if (context.timestamp.status === "available") {
      const queryCount = submissionsPerSync * 2;
      const queryBytes = queryCount * TIMESTAMP_BYTES;
      const encoder = persistent.device.createCommandEncoder();
      if (!encoder.resolveQuerySet) {
        throw new Error("Timestamp query resolution is unavailable.");
      }
      encoder.resolveQuerySet(
        context.timestamp.querySet,
        0,
        queryCount,
        context.timestamp.resolveBuffer,
        0,
      );
      encoder.copyBufferToBuffer(
        context.timestamp.resolveBuffer,
        0,
        context.timestamp.readbackBuffer,
        0,
        queryBytes,
      );
      commandBuffers.push(encoder.finish());
    }
    const commandEncodingMs = elapsed(clock, encodingStarted);

    const submissionStarted = clock();
    for (const commandBuffer of commandBuffers) {
      persistent.device.queue.submit([commandBuffer]);
    }
    const submissionMs = elapsed(clock, submissionStarted);
    const completionStarted = clock();
    await persistent.device.queue.onSubmittedWorkDone?.();
    const queueCompletionMs = elapsed(clock, completionStarted);
    const batchTotalMs =
      commandEncodingMs + submissionMs + queueCompletionMs;
    const totalGpuNoReadbackMs = elapsed(clock, gpuStarted);
    let gpuTimestampMs: number | null = null;
    if (context.timestamp.status === "available") {
      gpuTimestampMs = await readGpuTimestamps(
        context.timestamp,
        submissionsPerSync,
      );
    }
    return {
      status: "success",
      size,
      batchSize,
      submissionsPerSync,
      dispatchCount,
      validationStatus: persistent.validatedSizes.has(size)
        ? "timing-only-validated-formula"
        : "timing-only-unvalidated",
      timestampStatus: context.timestamp.status,
      timings: {
        cpuBaselinePerFieldMs,
        uploadMs,
        commandEncodingMs,
        submissionMs,
        queueCompletionMs,
        batchTotalMs,
        normalizedPerDispatchMs: batchTotalMs / dispatchCount,
        totalGpuNoReadbackMs,
        gpuTimestampMs,
        gpuTimestampPerDispatchMs:
          gpuTimestampMs === null ? null : gpuTimestampMs / dispatchCount,
      },
    };
  } catch (error) {
    return {
      status: "error",
      size,
      batchSize,
      submissionsPerSync,
      stage: "batched-sample",
      error,
    };
  }
}

const BATCHED_TIMING_NAMES: readonly BatchedTimingName[] = [
  "cpuBaselinePerFieldMs",
  "uploadMs",
  "commandEncodingMs",
  "submissionMs",
  "queueCompletionMs",
  "batchTotalMs",
  "normalizedPerDispatchMs",
  "totalGpuNoReadbackMs",
  "gpuTimestampMs",
  "gpuTimestampPerDispatchMs",
];

function timingValues(
  samples: readonly BatchedFieldSampleResult[],
  timing: BatchedTimingName,
): number[] {
  const values: number[] = [];
  for (const sample of samples) {
    if (sample.status !== "success") {
      continue;
    }
    const value = sample.timings[timing];
    if (value !== null && Number.isFinite(value)) {
      values.push(value);
    }
  }
  return values;
}

export async function runRepeatedBatchedFieldBenchmarkSuite(
  options: {
    sampleCount?: number;
    warmupCount?: number;
    sizes?: readonly number[];
    batchSizes?: readonly number[];
    submissionsPerSync?: number;
    enableTimestampQueries?: boolean;
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    createContext?: typeof createBatchedFieldBenchmarkContext;
    runSample?: typeof runBatchedDispatchSample;
  } = {},
): Promise<RepeatedBatchedFieldBenchmarkResult> {
  const sampleCount = positiveInteger(options.sampleCount ?? 20, "sampleCount");
  const warmupCount = options.warmupCount ?? 3;
  if (!Number.isInteger(warmupCount) || warmupCount < 0) {
    throw new RangeError("warmupCount must be a non-negative integer.");
  }
  const sizes = [...(options.sizes ?? WEBGPU_FIELD_BENCHMARK_SIZES)];
  const batchSizes = [...(options.batchSizes ?? WEBGPU_BATCH_SIZES)];
  sizes.forEach((size) => positiveInteger(size, "grid size"));
  batchSizes.forEach((size) => positiveInteger(size, "batch size"));
  const submissionsPerSync = positiveInteger(
    options.submissionsPerSync ?? 2,
    "submissionsPerSync",
  );
  const createContext = options.createContext ?? createBatchedFieldBenchmarkContext;
  const contextResult = await createContext({
    requestDevice: options.requestDevice,
    maxSize: Math.max(...sizes),
    maxSubmissionsPerSync: submissionsPerSync,
    enableTimestampQueries: options.enableTimestampQueries,
  });

  if (contextResult.status === "cpu-fallback") {
    return {
      status: "cpu-fallback",
      setup: contextResult,
      sampleCount,
      warmupCount,
      results: sizes.map((size) => {
        const started = defaultClock();
        const cpu = computeCpuField(size, size);
        return {
          size,
          cpu,
          cpuValidation: validateFieldGrid(cpu, size, size),
          cpuBaselinePerFieldMs: elapsed(defaultClock, started),
          fallbackCount: sampleCount * batchSizes.length,
          failureCount: 0,
        };
      }),
    };
  }
  if (contextResult.status === "error") {
    return contextResult;
  }

  const context = contextResult.context;
  const validations: PersistentFieldSampleResult[] = [];
  const summaries: BatchedBenchmarkSummary[] = [];
  const runSample = options.runSample ?? runBatchedDispatchSample;
  try {
    for (const size of sizes) {
      validations.push(
        await runPersistentFieldSample(context.persistent, size, {
          mode: "readback-validation",
        }),
      );
      for (const batchSize of batchSizes) {
        const invoke = () =>
          runSample(context, size, batchSize, { submissionsPerSync });
        const warmups: BatchedFieldSampleResult[] = [];
        for (let index = 0; index < warmupCount; index += 1) {
          warmups.push(await invoke());
        }
        const samples: BatchedFieldSampleResult[] = [];
        for (let index = 0; index < sampleCount; index += 1) {
          samples.push(await invoke());
        }
        const statistics = Object.fromEntries(
          BATCHED_TIMING_NAMES.map((timing) => [
            timing,
            summarizeTimingSamples(timingValues(samples, timing)),
          ]),
        ) as Record<BatchedTimingName, TimingStatistics>;
        summaries.push({
          size,
          batchSize,
          submissionsPerSync,
          samples,
          warmups,
          statistics,
          fallbackCount: 0,
          failureCount: samples.filter(
            (sample) =>
              sample.status === "error" ||
              (sample.status === "success" &&
                sample.validationStatus !==
                  "timing-only-validated-formula"),
          ).length,
        });
      }
    }
    return {
      status: "success",
      setupTimings: contextResult.setupTimings,
      timestampStatus: context.timestamp.status,
      timestampReason:
        context.timestamp.status === "timestamp-unavailable"
          ? context.timestamp.reason
          : undefined,
      validations,
      sampleCount,
      warmupCount,
      results: summaries,
    };
  } finally {
    disposeBatchedFieldBenchmarkContext(context);
  }
}

export function batchedBenchmarkTableRows(
  report: Extract<
    RepeatedBatchedFieldBenchmarkResult,
    { status: "success" }
  >,
): Array<Record<string, string | number | null>> {
  return report.results.flatMap((result) =>
    BATCHED_TIMING_NAMES.map((timing) => {
      const statistics = result.statistics[timing];
      return {
        size: result.size,
        batch: result.batchSize,
        submissions: result.submissionsPerSync,
        timing,
        samples: statistics.sampleCount,
        min: statistics.min,
        median: statistics.median,
        mean: statistics.mean,
        p95: statistics.p95,
        max: statistics.max,
        failures: result.failureCount,
      };
    }),
  );
}

export function reportBatchedFieldBenchmark(
  report: RepeatedBatchedFieldBenchmarkResult,
): void {
  if (report.status !== "success") {
    console.table(report);
    return;
  }
  console.table([
    {
      ...report.setupTimings,
      timestampStatus: report.timestampStatus,
      timestampReason: report.timestampReason ?? "",
    },
  ]);
  console.table(batchedBenchmarkTableRows(report));
}
