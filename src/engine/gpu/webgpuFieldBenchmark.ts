import {
  requestWebGpuDevice,
  type WebGpuBuffer,
  type WebGpuDevice,
  type WebGpuDeviceResult,
} from "./webgpuSupport";

export const WEBGPU_FIELD_BENCHMARK_SIZES = [128, 256, 512] as const;

export interface FieldEmitter {
  x: number;
  y: number;
  amplitude: number;
  frequency: number;
  falloff: number;
  phase: number;
}

export interface FieldGrid {
  width: number;
  height: number;
  values: Float32Array;
}

export interface FieldValidation {
  valid: boolean;
  dimensionsValid: boolean;
  finite: boolean;
}

export interface FieldComparison {
  valid: boolean;
  maxDifference: number;
  meanDifference: number;
  epsilon: number;
}

export interface WebGpuFieldBenchmarkTimings {
  deviceReadinessMs: number;
  pipelineCreationMs: number;
  warmupMs: number;
  bufferUploadMs: number;
  dispatchMs: number;
  readbackMs: number;
  totalGpuMs: number;
  cpuBaselineMs: number | null;
}

export type WebGpuFieldBenchmarkResult =
  | {
      status: "success";
      size: number;
      cpu: FieldGrid;
      gpu: FieldGrid;
      cpuValidation: FieldValidation;
      gpuValidation: FieldValidation;
      comparison: FieldComparison;
      timings: WebGpuFieldBenchmarkTimings;
    }
  | {
      status: "cpu-fallback";
      size: number;
      cpu: FieldGrid;
      cpuValidation: FieldValidation;
      cpuBaselineMs: number | null;
      gpu: Exclude<WebGpuDeviceResult, { status: "ready" }>;
    }
  | {
      status: "error";
      size: number;
      stage: "gpu-benchmark";
      error: unknown;
      cpu: FieldGrid;
      cpuValidation: FieldValidation;
      cpuBaselineMs: number | null;
    };

type Clock = () => number;

const BUFFER_USAGE_MAP_READ = 0x0001;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;
const DEFAULT_EPSILON = 0.001;

export const FIELD_BENCHMARK_EMITTERS: readonly FieldEmitter[] = [
  {
    x: 0.28,
    y: 0.36,
    amplitude: 0.9,
    frequency: 18,
    falloff: 2.4,
    phase: 0.2,
  },
  {
    x: 0.72,
    y: 0.42,
    amplitude: -0.65,
    frequency: 25,
    falloff: 3.2,
    phase: 1.1,
  },
  {
    x: 0.51,
    y: 0.76,
    amplitude: 0.5,
    frequency: 13,
    falloff: 1.8,
    phase: -0.7,
  },
];

export const FIELD_BENCHMARK_SHADER = `
struct Emitter {
  positionAmplitudeFrequency: vec4<f32>,
  falloffPhasePadding: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> dimensions: array<u32>;
@group(0) @binding(1) var<storage, read> emitters: array<Emitter>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = dimensions[0];
  let height = dimensions[1];
  let index = id.x;
  if (index >= width * height) {
    return;
  }

  let column = index % width;
  let row = index / width;
  let point = vec2<f32>(
    (f32(column) + 0.5) / f32(width),
    (f32(row) + 0.5) / f32(height),
  );
  var value = 0.0;
  for (var emitterIndex = 0u; emitterIndex < 3u; emitterIndex += 1u) {
    let emitter = emitters[emitterIndex];
    let distance = length(point - emitter.positionAmplitudeFrequency.xy);
    let amplitude = emitter.positionAmplitudeFrequency.z;
    let frequency = emitter.positionAmplitudeFrequency.w;
    let falloff = emitter.falloffPhasePadding.x;
    let phase = emitter.falloffPhasePadding.y;
    value += amplitude * sin(distance * frequency + phase)
      / (1.0 + falloff * distance);
  }
  output[index] = value;
}
`;

const defaultClock: Clock = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

function elapsed(clock: Clock, started: number): number {
  return Math.max(0, clock() - started);
}

export function createFieldBenchmarkEmitterData(): Float32Array {
  const data = new Float32Array(FIELD_BENCHMARK_EMITTERS.length * 8);
  FIELD_BENCHMARK_EMITTERS.forEach((emitter, index) => {
    const offset = index * 8;
    data.set(
      [
        emitter.x,
        emitter.y,
        emitter.amplitude,
        emitter.frequency,
        emitter.falloff,
        emitter.phase,
        0,
        0,
      ],
      offset,
    );
  });
  return data;
}

export function computeCpuField(
  width: number,
  height: number,
  emitters: readonly FieldEmitter[] = FIELD_BENCHMARK_EMITTERS,
): FieldGrid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Field dimensions must be positive integers.");
  }

  const values = new Float32Array(width * height);
  for (let row = 0; row < height; row += 1) {
    const y = (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const x = (column + 0.5) / width;
      let value = 0;
      for (const emitter of emitters) {
        const distance = Math.hypot(x - emitter.x, y - emitter.y);
        value +=
          (emitter.amplitude *
            Math.sin(distance * emitter.frequency + emitter.phase)) /
          (1 + emitter.falloff * distance);
      }
      values[row * width + column] = value;
    }
  }
  return { width, height, values };
}

export function validateFieldGrid(
  grid: FieldGrid,
  expectedWidth: number,
  expectedHeight: number,
): FieldValidation {
  const dimensionsValid =
    grid.width === expectedWidth &&
    grid.height === expectedHeight &&
    grid.values.length === expectedWidth * expectedHeight;
  const finite = grid.values.every(Number.isFinite);
  return {
    valid: dimensionsValid && finite,
    dimensionsValid,
    finite,
  };
}

export function compareFieldGrids(
  cpu: FieldGrid,
  gpu: FieldGrid,
  epsilon = DEFAULT_EPSILON,
): FieldComparison {
  if (
    cpu.width !== gpu.width ||
    cpu.height !== gpu.height ||
    cpu.values.length !== gpu.values.length ||
    cpu.values.length === 0
  ) {
    return {
      valid: false,
      maxDifference: Number.POSITIVE_INFINITY,
      meanDifference: Number.POSITIVE_INFINITY,
      epsilon,
    };
  }

  let maxDifference = 0;
  let totalDifference = 0;
  for (let index = 0; index < cpu.values.length; index += 1) {
    const difference = Math.abs(cpu.values[index] - gpu.values[index]);
    if (!Number.isFinite(difference)) {
      return {
        valid: false,
        maxDifference: Number.POSITIVE_INFINITY,
        meanDifference: Number.POSITIVE_INFINITY,
        epsilon,
      };
    }
    maxDifference = Math.max(maxDifference, difference);
    totalDifference += difference;
  }
  return {
    valid: maxDifference <= epsilon,
    maxDifference,
    meanDifference: totalDifference / cpu.values.length,
    epsilon,
  };
}

function createStorageBuffer(
  device: WebGpuDevice,
  size: number,
  usage: number,
  buffers: WebGpuBuffer[],
): WebGpuBuffer {
  const buffer = device.createBuffer({ size, usage });
  buffers.push(buffer);
  return buffer;
}

async function waitForQueue(device: WebGpuDevice): Promise<void> {
  await device.queue.onSubmittedWorkDone?.();
}

function encodeDispatch(
  device: WebGpuDevice,
  pipeline: { getBindGroupLayout(index: number): unknown },
  bindGroup: unknown,
  cellCount: number,
): unknown {
  const encoder = device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(Math.ceil(cellCount / 64));
  pass.end();
  return encoder.finish();
}

export async function runWebGpuFieldBenchmark(
  size: number,
  options: {
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    clock?: Clock;
    epsilon?: number;
    cpuReference?: FieldGrid;
    measureCpuBaseline?: boolean;
  } = {},
): Promise<WebGpuFieldBenchmarkResult> {
  const clock = options.clock ?? defaultClock;
  const measureCpuBaseline = options.measureCpuBaseline ?? true;
  const cpuStarted = clock();
  const cpu = measureCpuBaseline
    ? computeCpuField(size, size)
    : (options.cpuReference ?? computeCpuField(size, size));
  const cpuBaselineMs = measureCpuBaseline
    ? elapsed(clock, cpuStarted)
    : null;
  const cpuValidation = validateFieldGrid(cpu, size, size);

  const gpuStarted = clock();
  const readinessStarted = clock();
  const deviceResult = await (options.requestDevice ?? requestWebGpuDevice)();
  const deviceReadinessMs = elapsed(clock, readinessStarted);
  if (deviceResult.status !== "ready") {
    return {
      status: "cpu-fallback",
      size,
      cpu,
      cpuValidation,
      cpuBaselineMs,
      gpu: deviceResult,
    };
  }

  const { device } = deviceResult;
  const buffers: WebGpuBuffer[] = [];
  try {
    const cellCount = size * size;
    const outputByteLength = cellCount * Float32Array.BYTES_PER_ELEMENT;
    const dimensions = new Uint32Array([size, size]);
    const emitterData = createFieldBenchmarkEmitterData();
    const dimensionsBuffer = createStorageBuffer(
      device,
      dimensions.byteLength,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      buffers,
    );
    const emitterBuffer = createStorageBuffer(
      device,
      emitterData.byteLength,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
      buffers,
    );
    const outputBuffer = createStorageBuffer(
      device,
      outputByteLength,
      BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC,
      buffers,
    );
    const readbackBuffer = createStorageBuffer(
      device,
      outputByteLength,
      BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ,
      buffers,
    );

    const pipelineStarted = clock();
    const module = device.createShaderModule({ code: FIELD_BENCHMARK_SHADER });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: dimensionsBuffer } },
        { binding: 1, resource: { buffer: emitterBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });
    const pipelineCreationMs = elapsed(clock, pipelineStarted);

    const uploadStarted = clock();
    device.queue.writeBuffer(dimensionsBuffer, 0, dimensions);
    device.queue.writeBuffer(emitterBuffer, 0, emitterData);
    await waitForQueue(device);
    const bufferUploadMs = elapsed(clock, uploadStarted);

    const warmupStarted = clock();
    device.queue.submit([
      encodeDispatch(device, pipeline, bindGroup, cellCount),
    ]);
    await waitForQueue(device);
    const warmupMs = elapsed(clock, warmupStarted);

    const dispatchStarted = clock();
    device.queue.submit([
      encodeDispatch(device, pipeline, bindGroup, cellCount),
    ]);
    await waitForQueue(device);
    const dispatchMs = elapsed(clock, dispatchStarted);

    const readbackStarted = clock();
    const readbackEncoder = device.createCommandEncoder();
    readbackEncoder.copyBufferToBuffer(
      outputBuffer,
      0,
      readbackBuffer,
      0,
      outputByteLength,
    );
    device.queue.submit([readbackEncoder.finish()]);
    await readbackBuffer.mapAsync(MAP_MODE_READ);
    const values = new Float32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();
    const readbackMs = elapsed(clock, readbackStarted);

    const gpu: FieldGrid = { width: size, height: size, values };
    const gpuValidation = validateFieldGrid(gpu, size, size);
    const comparison = compareFieldGrids(
      cpu,
      gpu,
      options.epsilon ?? DEFAULT_EPSILON,
    );
    return {
      status: "success",
      size,
      cpu,
      gpu,
      cpuValidation,
      gpuValidation,
      comparison,
      timings: {
        deviceReadinessMs,
        pipelineCreationMs,
        warmupMs,
        bufferUploadMs,
        dispatchMs,
        readbackMs,
        totalGpuMs: elapsed(clock, gpuStarted),
        cpuBaselineMs,
      },
    };
  } catch (error) {
    return {
      status: "error",
      size,
      stage: "gpu-benchmark",
      error,
      cpu,
      cpuValidation,
      cpuBaselineMs,
    };
  } finally {
    for (const buffer of buffers) {
      buffer.destroy?.();
    }
    device.destroy?.();
  }
}

export async function runWebGpuFieldBenchmarkSuite(
  sizes: readonly number[] = WEBGPU_FIELD_BENCHMARK_SIZES,
): Promise<WebGpuFieldBenchmarkResult[]> {
  const results: WebGpuFieldBenchmarkResult[] = [];
  for (const size of sizes) {
    results.push(await runWebGpuFieldBenchmark(size));
  }
  return results;
}
