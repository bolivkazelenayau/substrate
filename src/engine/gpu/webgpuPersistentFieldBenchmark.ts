import {
  compareFieldGrids,
  computeCpuField,
  createFieldBenchmarkEmitterData,
  FIELD_BENCHMARK_SHADER,
  validateFieldGrid,
  WEBGPU_FIELD_BENCHMARK_SIZES,
  type FieldComparison,
  type FieldGrid,
  type FieldValidation,
} from "./webgpuFieldBenchmark";
import {
  summarizeTimingSamples,
  type TimingStatistics,
} from "./webgpuRepeatedBenchmark";
import {
  requestWebGpuDevice,
  type WebGpuBuffer,
  type WebGpuDevice,
  type WebGpuDeviceResult,
} from "./webgpuSupport";

const BUFFER_USAGE_MAP_READ = 0x0001;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;
const DEFAULT_MAX_SIZE = 512;
const DEFAULT_EPSILON = 0.001;

type Clock = () => number;

export type PersistentFieldBenchmarkMode =
  | "readback-validation"
  | "no-readback";

export interface PersistentFieldSetupTimings {
  deviceReadinessMs: number;
  pipelineCreationMs: number;
  bufferAllocationMs: number;
  totalSetupMs: number;
}

export interface PersistentFieldSampleTimings {
  cpuBaselineMs: number;
  uploadMs: number;
  commandEncodingMs: number;
  dispatchMs: number;
  copyToReadbackMs: number | null;
  readbackMapMs: number | null;
  totalGpuMs: number;
}

export interface PersistentFieldBenchmarkContext {
  readonly device: WebGpuDevice;
  readonly enabledFeatures: ReadonlySet<string>;
  readonly maxSize: number;
  readonly setupTimings: PersistentFieldSetupTimings;
  readonly validatedSizes: Set<number>;
  readonly buffers: {
    dimensions: WebGpuBuffer;
    emitters: WebGpuBuffer;
    output: WebGpuBuffer;
    readback: WebGpuBuffer;
  };
  readonly pipeline: {
    getBindGroupLayout(index: number): unknown;
  };
  readonly bindGroup: unknown;
  disposed: boolean;
}

export type PersistentContextResult =
  | {
      status: "ready";
      context: PersistentFieldBenchmarkContext;
      setupTimings: PersistentFieldSetupTimings;
    }
  | {
      status: "cpu-fallback";
      gpu: Exclude<WebGpuDeviceResult, { status: "ready" }>;
      setupTimings: {
        deviceReadinessMs: number;
        totalSetupMs: number;
      };
    }
  | {
      status: "error";
      stage: "persistent-setup";
      error: unknown;
      setupTimings: {
        deviceReadinessMs: number;
        totalSetupMs: number;
      };
    };

export type PersistentFieldSampleResult =
  | {
      status: "success";
      size: number;
      mode: PersistentFieldBenchmarkMode;
      validationStatus:
        | "validated"
        | "timing-only-validated-formula"
        | "timing-only-unvalidated";
      cpu: FieldGrid;
      cpuValidation: FieldValidation;
      gpu: FieldGrid | null;
      gpuValidation: FieldValidation | null;
      comparison: FieldComparison | null;
      timings: PersistentFieldSampleTimings;
    }
  | {
      status: "error";
      size: number;
      mode: PersistentFieldBenchmarkMode;
      stage: "persistent-sample";
      error: unknown;
    };

export type PersistentTimingName = keyof PersistentFieldSampleTimings;

export interface PersistentSizeModeSummary {
  size: number;
  mode: PersistentFieldBenchmarkMode;
  samples: PersistentFieldSampleResult[];
  warmups: PersistentFieldSampleResult[];
  statistics: Record<PersistentTimingName, TimingStatistics>;
  fallbackCount: number;
  failureCount: number;
}

export type RepeatedPersistentFieldBenchmarkResult =
  | {
      status: "success";
      setupTimings: PersistentFieldSetupTimings;
      sampleCount: number;
      warmupCount: number;
      results: PersistentSizeModeSummary[];
    }
  | {
      status: "cpu-fallback";
      setup: Extract<PersistentContextResult, { status: "cpu-fallback" }>;
      sampleCount: number;
      warmupCount: number;
      results: Array<{
        size: number;
        mode: PersistentFieldBenchmarkMode;
        cpu: FieldGrid;
        cpuValidation: FieldValidation;
        cpuBaselineMs: number;
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

async function waitForQueue(device: WebGpuDevice): Promise<void> {
  await device.queue.onSubmittedWorkDone?.();
}

function createBuffer(
  device: WebGpuDevice,
  size: number,
  usage: number,
): WebGpuBuffer {
  return device.createBuffer({ size, usage });
}

export async function createPersistentFieldBenchmarkContext(
  options: {
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    maxSize?: number;
    clock?: Clock;
  } = {},
): Promise<PersistentContextResult> {
  const clock = options.clock ?? defaultClock;
  const maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  if (!Number.isInteger(maxSize) || maxSize <= 0) {
    throw new RangeError("maxSize must be a positive integer.");
  }

  const totalStarted = clock();
  const readinessStarted = clock();
  const deviceResult = await (options.requestDevice ?? requestWebGpuDevice)();
  const deviceReadinessMs = elapsed(clock, readinessStarted);
  if (deviceResult.status !== "ready") {
    return {
      status: "cpu-fallback",
      gpu: deviceResult,
      setupTimings: {
        deviceReadinessMs,
        totalSetupMs: elapsed(clock, totalStarted),
      },
    };
  }

  const { device } = deviceResult;
  const allocated: WebGpuBuffer[] = [];
  try {
    const pipelineStarted = clock();
    const module = device.createShaderModule({
      code: FIELD_BENCHMARK_SHADER,
    });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const pipelineCreationMs = elapsed(clock, pipelineStarted);

    const allocationStarted = clock();
    const maxOutputBytes =
      maxSize * maxSize * Float32Array.BYTES_PER_ELEMENT;
    const dimensions = createBuffer(
      device,
      Uint32Array.BYTES_PER_ELEMENT * 2,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    );
    const emitterData = createFieldBenchmarkEmitterData();
    const emitters = createBuffer(
      device,
      emitterData.byteLength,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    );
    const output = createBuffer(
      device,
      maxOutputBytes,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC,
    );
    const readback = createBuffer(
      device,
      maxOutputBytes,
      BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ,
    );
    allocated.push(dimensions, emitters, output, readback);
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dimensions } },
        { binding: 1, resource: { buffer: emitters } },
        { binding: 2, resource: { buffer: output } },
      ],
    });
    device.queue.writeBuffer(emitters, 0, emitterData);
    await waitForQueue(device);
    const bufferAllocationMs = elapsed(clock, allocationStarted);
    const setupTimings: PersistentFieldSetupTimings = {
      deviceReadinessMs,
      pipelineCreationMs,
      bufferAllocationMs,
      totalSetupMs: elapsed(clock, totalStarted),
    };
    const context: PersistentFieldBenchmarkContext = {
      device,
      enabledFeatures: new Set(deviceResult.enabledFeatures ?? []),
      maxSize,
      setupTimings,
      validatedSizes: new Set(),
      buffers: { dimensions, emitters, output, readback },
      pipeline,
      bindGroup,
      disposed: false,
    };
    return { status: "ready", context, setupTimings };
  } catch (error) {
    for (const buffer of allocated) {
      buffer.destroy?.();
    }
    device.destroy?.();
    return {
      status: "error",
      stage: "persistent-setup",
      error,
      setupTimings: {
        deviceReadinessMs,
        totalSetupMs: elapsed(clock, totalStarted),
      },
    };
  }
}

export function disposePersistentFieldBenchmarkContext(
  context: PersistentFieldBenchmarkContext,
): void {
  if (context.disposed) {
    return;
  }
  context.disposed = true;
  context.buffers.dimensions.destroy?.();
  context.buffers.emitters.destroy?.();
  context.buffers.output.destroy?.();
  context.buffers.readback.destroy?.();
  context.device.destroy?.();
}

export async function runPersistentFieldSample(
  context: PersistentFieldBenchmarkContext,
  size: number,
  options: {
    mode?: PersistentFieldBenchmarkMode;
    epsilon?: number;
    clock?: Clock;
  } = {},
): Promise<PersistentFieldSampleResult> {
  const mode = options.mode ?? "readback-validation";
  if (context.disposed) {
    return {
      status: "error",
      size,
      mode,
      stage: "persistent-sample",
      error: new Error("Persistent benchmark context is disposed."),
    };
  }
  if (!Number.isInteger(size) || size <= 0 || size > context.maxSize) {
    return {
      status: "error",
      size,
      mode,
      stage: "persistent-sample",
      error: new RangeError(`size must be between 1 and ${context.maxSize}.`),
    };
  }

  const clock = options.clock ?? defaultClock;
  const cpuStarted = clock();
  const cpu = computeCpuField(size, size);
  const cpuBaselineMs = elapsed(clock, cpuStarted);
  const cpuValidation = validateFieldGrid(cpu, size, size);
  const gpuStarted = clock();

  try {
    const dimensions = new Uint32Array([size, size]);
    const uploadStarted = clock();
    context.device.queue.writeBuffer(context.buffers.dimensions, 0, dimensions);
    await waitForQueue(context.device);
    const uploadMs = elapsed(clock, uploadStarted);

    const cellCount = size * size;
    const encodingStarted = clock();
    const encoder = context.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(context.pipeline);
    pass.setBindGroup(0, context.bindGroup);
    pass.dispatchWorkgroups(Math.ceil(cellCount / 64));
    pass.end();
    const dispatchCommand = encoder.finish();
    const commandEncodingMs = elapsed(clock, encodingStarted);

    const dispatchStarted = clock();
    context.device.queue.submit([dispatchCommand]);
    await waitForQueue(context.device);
    const dispatchMs = elapsed(clock, dispatchStarted);

    if (mode === "no-readback") {
      return {
        status: "success",
        size,
        mode,
        validationStatus: context.validatedSizes.has(size)
          ? "timing-only-validated-formula"
          : "timing-only-unvalidated",
        cpu,
        cpuValidation,
        gpu: null,
        gpuValidation: null,
        comparison: null,
        timings: {
          cpuBaselineMs,
          uploadMs,
          commandEncodingMs,
          dispatchMs,
          copyToReadbackMs: null,
          readbackMapMs: null,
          totalGpuMs: elapsed(clock, gpuStarted),
        },
      };
    }

    const outputBytes =
      cellCount * Float32Array.BYTES_PER_ELEMENT;
    const copyStarted = clock();
    const copyEncoder = context.device.createCommandEncoder();
    copyEncoder.copyBufferToBuffer(
      context.buffers.output,
      0,
      context.buffers.readback,
      0,
      outputBytes,
    );
    context.device.queue.submit([copyEncoder.finish()]);
    await waitForQueue(context.device);
    const copyToReadbackMs = elapsed(clock, copyStarted);

    const mapStarted = clock();
    await context.buffers.readback.mapAsync(MAP_MODE_READ);
    const values = new Float32Array(
      context.buffers.readback.getMappedRange().slice(0, outputBytes),
    );
    context.buffers.readback.unmap();
    const readbackMapMs = elapsed(clock, mapStarted);
    const gpu: FieldGrid = { width: size, height: size, values };
    const gpuValidation = validateFieldGrid(gpu, size, size);
    const comparison = compareFieldGrids(
      cpu,
      gpu,
      options.epsilon ?? DEFAULT_EPSILON,
    );
    const validated =
      cpuValidation.valid && gpuValidation.valid && comparison.valid;
    if (validated) {
      context.validatedSizes.add(size);
    }
    return {
      status: "success",
      size,
      mode,
      validationStatus: validated ? "validated" : "timing-only-unvalidated",
      cpu,
      cpuValidation,
      gpu,
      gpuValidation,
      comparison,
      timings: {
        cpuBaselineMs,
        uploadMs,
        commandEncodingMs,
        dispatchMs,
        copyToReadbackMs,
        readbackMapMs,
        totalGpuMs: elapsed(clock, gpuStarted),
      },
    };
  } catch (error) {
    return {
      status: "error",
      size,
      mode,
      stage: "persistent-sample",
      error,
    };
  }
}

const PERSISTENT_TIMING_NAMES: readonly PersistentTimingName[] = [
  "cpuBaselineMs",
  "uploadMs",
  "commandEncodingMs",
  "dispatchMs",
  "copyToReadbackMs",
  "readbackMapMs",
  "totalGpuMs",
];

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

function timingValues(
  samples: readonly PersistentFieldSampleResult[],
  timing: PersistentTimingName,
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

export async function runRepeatedPersistentFieldBenchmarkSuite(
  options: {
    sampleCount?: number;
    warmupCount?: number;
    sizes?: readonly number[];
    modes?: readonly PersistentFieldBenchmarkMode[];
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    createContext?: typeof createPersistentFieldBenchmarkContext;
    runSample?: typeof runPersistentFieldSample;
  } = {},
): Promise<RepeatedPersistentFieldBenchmarkResult> {
  const sampleCount = positiveInteger(options.sampleCount ?? 20, "sampleCount");
  const warmupCount = options.warmupCount ?? 3;
  if (!Number.isInteger(warmupCount) || warmupCount < 0) {
    throw new RangeError("warmupCount must be a non-negative integer.");
  }
  const sizes = [...(options.sizes ?? WEBGPU_FIELD_BENCHMARK_SIZES)];
  sizes.forEach((size) => positiveInteger(size, "grid size"));
  const modes = [
    ...(options.modes ?? ["readback-validation", "no-readback"]),
  ];
  const createContext =
    options.createContext ?? createPersistentFieldBenchmarkContext;
  const contextResult = await createContext({
    requestDevice: options.requestDevice,
    maxSize: Math.max(...sizes),
  });

  if (contextResult.status === "cpu-fallback") {
    return {
      status: "cpu-fallback",
      setup: contextResult,
      sampleCount,
      warmupCount,
      results: sizes.flatMap((size) =>
        modes.map((mode) => {
          const started = defaultClock();
          const cpu = computeCpuField(size, size);
          return {
            size,
            mode,
            cpu,
            cpuValidation: validateFieldGrid(cpu, size, size),
            cpuBaselineMs: elapsed(defaultClock, started),
            fallbackCount: sampleCount,
            failureCount: 0 as const,
          };
        }),
      ),
    };
  }
  if (contextResult.status === "error") {
    return contextResult;
  }

  const runSample = options.runSample ?? runPersistentFieldSample;
  const summaries: PersistentSizeModeSummary[] = [];
  try {
    for (const size of sizes) {
      for (const mode of modes) {
        const invoke = () => runSample(contextResult.context, size, { mode });
        const warmups: PersistentFieldSampleResult[] = [];
        for (let index = 0; index < warmupCount; index += 1) {
          warmups.push(await invoke());
        }
        const samples: PersistentFieldSampleResult[] = [];
        for (let index = 0; index < sampleCount; index += 1) {
          samples.push(await invoke());
        }
        const statistics = Object.fromEntries(
          PERSISTENT_TIMING_NAMES.map((timing) => [
            timing,
            summarizeTimingSamples(timingValues(samples, timing)),
          ]),
        ) as Record<PersistentTimingName, TimingStatistics>;
        summaries.push({
          size,
          mode,
          samples,
          warmups,
          statistics,
          fallbackCount: 0,
          failureCount: samples.filter(
            (sample) =>
              sample.status === "error" ||
              (sample.status === "success" &&
                sample.mode === "readback-validation" &&
                sample.validationStatus !== "validated"),
          ).length,
        });
      }
    }
    return {
      status: "success",
      setupTimings: contextResult.setupTimings,
      sampleCount,
      warmupCount,
      results: summaries,
    };
  } finally {
    disposePersistentFieldBenchmarkContext(contextResult.context);
  }
}

export function persistentBenchmarkTableRows(
  report: Extract<
    RepeatedPersistentFieldBenchmarkResult,
    { status: "success" }
  >,
): Array<Record<string, string | number | null>> {
  return report.results.flatMap((result) =>
    PERSISTENT_TIMING_NAMES.map((timing) => {
      const statistics = result.statistics[timing];
      return {
        size: result.size,
        mode: result.mode,
        timing,
        samples: statistics.sampleCount,
        min: statistics.min,
        median: statistics.median,
        mean: statistics.mean,
        p95: statistics.p95,
        max: statistics.max,
        fallbacks: result.fallbackCount,
        failures: result.failureCount,
      };
    }),
  );
}

export function reportPersistentFieldBenchmark(
  report: RepeatedPersistentFieldBenchmarkResult,
): void {
  if (report.status !== "success") {
    console.table(report);
    return;
  }
  console.table([report.setupTimings]);
  console.table(persistentBenchmarkTableRows(report));
}
