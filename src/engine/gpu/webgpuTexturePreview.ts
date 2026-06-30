import {
  computeCpuField,
  FIELD_BENCHMARK_EMITTERS,
} from "./webgpuFieldBenchmark";
import {
  requestWebGpuDevice,
  type WebGpuDeviceResult,
} from "./webgpuSupport";

export const WEBGPU_TEXTURE_PREVIEW_SIZES = [256, 512] as const;

const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_STORAGE = 0x0080;
const TEXTURE_USAGE_TEXTURE_BINDING = 0x04;
const TEXTURE_USAGE_STORAGE_BINDING = 0x08;
const MAX_TEXTURE_PREVIEW_EMITTERS = 8;

type Clock = () => number;

interface TexturePreviewCanvas {
  width: number;
  height: number;
  getContext(type: string): unknown;
}

interface TexturePreviewTexture {
  createView(): unknown;
  destroy?(): void;
}

interface TexturePreviewBuffer {
  destroy?(): void;
}

interface TexturePreviewCanvasContext {
  configure(descriptor: {
    device: unknown;
    format: string;
    alphaMode: "opaque";
  }): void;
  getCurrentTexture(): { createView(): unknown };
  unconfigure?(): void;
}

interface TexturePreviewDevice {
  lost?: Promise<{ reason?: string; message?: string }>;
  queue: {
    writeBuffer(
      buffer: TexturePreviewBuffer,
      offset: number,
      data: ArrayBufferView,
    ): void;
    submit(commands: unknown[]): void;
    onSubmittedWorkDone?(): Promise<void>;
  };
  createBuffer(descriptor: {
    size: number;
    usage: number;
  }): TexturePreviewBuffer;
  createTexture(descriptor: {
    size: { width: number; height: number };
    format: string;
    usage: number;
  }): TexturePreviewTexture;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: {
    layout: "auto";
    compute: { module: unknown; entryPoint: string };
  }): { getBindGroupLayout(index: number): unknown };
  createRenderPipeline(descriptor: {
    layout: "auto";
    vertex: { module: unknown; entryPoint: string };
    fragment: {
      module: unknown;
      entryPoint: string;
      targets: Array<{ format: string }>;
    };
    primitive: { topology: "triangle-list" };
  }): { getBindGroupLayout(index: number): unknown };
  createSampler(descriptor: {
    magFilter: "linear";
    minFilter: "linear";
  }): unknown;
  createBindGroup(descriptor: {
    layout: unknown;
    entries: Array<{ binding: number; resource: unknown }>;
  }): unknown;
  createCommandEncoder(): {
    beginComputePass(): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, bindGroup: unknown): void;
      dispatchWorkgroups(x: number, y: number): void;
      end(): void;
    };
    beginRenderPass(descriptor: {
      colorAttachments: Array<{
        view: unknown;
        clearValue: { r: number; g: number; b: number; a: number };
        loadOp: "clear";
        storeOp: "store";
      }>;
    }): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, bindGroup: unknown): void;
      draw(vertexCount: number): void;
      end(): void;
    };
    finish(): unknown;
  };
  destroy?(): void;
}

interface CpuDrawingContext {
  createImageData(
    width: number,
    height: number,
  ): { data: Uint8ClampedArray };
  putImageData(image: { data: Uint8ClampedArray }, x: number, y: number): void;
}

export interface TexturePreviewParameters {
  phaseOffset?: number;
  frequencyScale?: number;
}

export interface TexturePreviewFieldEmitter {
  x: number;
  y: number;
  amplitude: number;
  frequency: number;
  phase: number;
  radius: number;
  falloffType: 0 | 1 | 2 | 3;
  falloffStrength: number;
}

export interface TexturePreviewFieldData {
  emitters: TexturePreviewFieldEmitter[];
}

export interface TexturePreviewFrameTiming {
  frameEnqueueMs: number;
  queueCompletionMs: number | null;
  synchronized: boolean;
  cpuFallbackMs: number | null;
  skippedReason?: "device-lost" | "disposed";
}

export type TexturePreviewControllerState = "active" | "lost" | "disposed";

export interface WebGpuTexturePreviewController {
  readonly size: 256 | 512;
  readonly backend: "webgpu-texture" | "cpu-canvas";
  render(
    parameters?: TexturePreviewParameters,
    options?: {
      synchronize?: boolean;
      skipCompute?: boolean;
      presentationPhase?: number;
    },
  ): Promise<TexturePreviewFrameTiming>;
  getState(): TexturePreviewControllerState;
  onDeviceLost(
    listener: (details: { reason?: string; message?: string }) => void,
  ): () => void;
  updateField(field: TexturePreviewFieldData): void;
  dispose(): void;
}

export type WebGpuTexturePreviewResult =
  | {
      status: "ready";
      controller: WebGpuTexturePreviewController;
      setupMs: number;
      cpuBaselineMs: number;
      initialFrame: TexturePreviewFrameTiming;
    }
  | {
      status: "cpu-fallback";
      controller: WebGpuTexturePreviewController | null;
      gpu: WebGpuDeviceResult;
      setupMs: number;
      rendered: boolean;
      initialFrame: TexturePreviewFrameTiming | null;
      reason?:
        | "canvas-webgpu-context-unavailable"
        | "canvas-2d-unavailable";
    }
  | {
      status: "error";
      stage: "texture-preview-setup";
      error: unknown;
    };

const COMPUTE_SHADER = `
@group(0) @binding(0) var<storage, read> parameters: array<f32>;
@group(0) @binding(1) var outputTexture: texture_storage_2d<rgba8unorm, write>;
struct FieldEmitter {
  positionAmplitudeFrequency: vec4<f32>,
  phaseRadiusFalloff: vec4<f32>,
}
@group(0) @binding(2) var<storage, read> emitters: array<FieldEmitter>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let width = u32(parameters[0]);
  let height = u32(parameters[1]);
  if (id.x >= width || id.y >= height) {
    return;
  }
  let point = vec2<f32>(
    (f32(id.x) + 0.5) / f32(width),
    (f32(id.y) + 0.5) / f32(height)
  );
  let phaseOffset = parameters[2];
  let frequencyScale = parameters[3];
  let emitterCount = u32(parameters[4]);
  var value = 0.0;
  for (var index = 0u; index < emitterCount; index += 1u) {
    let data = emitters[index];
    let distance = length(point - data.positionAmplitudeFrequency.xy);
    let radius = max(0.0001, data.phaseRadiusFalloff.y);
    let normalizedDistance = distance / radius;
    let falloffType = data.phaseRadiusFalloff.z;
    var falloff = 0.0;
    if (falloffType < 0.5) {
      let t = clamp(normalizedDistance, 0.0, 1.0);
      falloff = (1.0 - t * t * (3.0 - 2.0 * t)) * select(0.0, 1.0, normalizedDistance < 1.0);
    } else if (falloffType < 1.5) {
      falloff = exp(-4.5 * normalizedDistance * normalizedDistance)
        * select(0.0, 1.0, normalizedDistance < 1.0);
    } else if (falloffType < 2.5) {
      falloff = max(0.0, 1.0 - normalizedDistance);
    } else {
      falloff = 1.0 / (1.0 + data.phaseRadiusFalloff.w * distance);
    }
    value += data.positionAmplitudeFrequency.z
      * sin(
        distance * data.positionAmplitudeFrequency.w * frequencyScale
        + data.phaseRadiusFalloff.x
        + phaseOffset
      )
      * falloff;
  }
  let normalized = clamp(value * 0.42 + 0.5, 0.0, 1.0);
  let color = vec3<f32>(
    normalized,
    0.5 + 0.5 * sin(value * 2.2),
    1.0 - normalized
  );
  textureStore(outputTexture, vec2<i32>(id.xy), vec4<f32>(color, 1.0));
}
`;

const RENDER_SHADER = `
@group(0) @binding(0) var previewSampler: sampler;
@group(0) @binding(1) var previewTexture: texture_2d<f32>;
@group(0) @binding(2) var<storage, read> presentation: array<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  let uvs = array<vec2<f32>, 3>(
    vec2<f32>(0.0, 1.0),
    vec2<f32>(2.0, 1.0),
    vec2<f32>(0.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = uvs[index];
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let base = textureSample(previewTexture, previewSampler, input.uv);
  let blend = 0.5 + 0.5 * sin(presentation[0]);
  return vec4<f32>(mix(base.rgb, base.brg, blend * 0.18), base.a);
}
`;

const defaultClock: Clock = () =>
  typeof performance === "undefined" ? Date.now() : performance.now();

function elapsed(clock: Clock, started: number): number {
  return Math.max(0, clock() - started);
}

function previewSize(value: number | undefined): 256 | 512 {
  const size = value ?? 256;
  if (size !== 256 && size !== 512) {
    throw new RangeError("Texture preview size must be 256 or 512.");
  }
  return size;
}

function fieldValue(
  x: number,
  y: number,
  phaseOffset: number,
  frequencyScale: number,
  field: TexturePreviewFieldData,
): number {
  let value = 0;
  for (const emitter of field.emitters.slice(0, MAX_TEXTURE_PREVIEW_EMITTERS)) {
    const distance = Math.hypot(x - emitter.x, y - emitter.y);
    const normalizedDistance = distance / Math.max(0.0001, emitter.radius);
    let falloff: number;
    if (emitter.falloffType === 0) {
      const t = Math.max(0, Math.min(1, normalizedDistance));
      falloff =
        normalizedDistance < 1 ? 1 - t * t * (3 - 2 * t) : 0;
    } else if (emitter.falloffType === 1) {
      falloff =
        normalizedDistance < 1
          ? Math.exp(-4.5 * normalizedDistance * normalizedDistance)
          : 0;
    } else if (emitter.falloffType === 2) {
      falloff = Math.max(0, 1 - normalizedDistance);
    } else {
      falloff =
        1 / (1 + emitter.falloffStrength * distance);
    }
    value +=
      (emitter.amplitude *
        Math.sin(
          distance * emitter.frequency * frequencyScale +
            emitter.phase +
            phaseOffset,
        )) *
      falloff;
  }
  return value;
}

function defaultTexturePreviewField(): TexturePreviewFieldData {
  return {
    emitters: FIELD_BENCHMARK_EMITTERS.map((emitter) => ({
      x: emitter.x,
      y: emitter.y,
      amplitude: emitter.amplitude,
      frequency: emitter.frequency,
      phase: emitter.phase,
      radius: 2,
      falloffType: 3 as const,
      falloffStrength: emitter.falloff,
    })),
  };
}

function packTexturePreviewEmitters(
  field: TexturePreviewFieldData,
): Float32Array {
  const packed = new Float32Array(MAX_TEXTURE_PREVIEW_EMITTERS * 8);
  field.emitters
    .slice(0, MAX_TEXTURE_PREVIEW_EMITTERS)
    .forEach((emitter, index) => {
      packed.set(
        [
          emitter.x,
          emitter.y,
          emitter.amplitude,
          emitter.frequency,
          emitter.phase,
          emitter.radius,
          emitter.falloffType,
          emitter.falloffStrength,
        ],
        index * 8,
      );
    });
  return packed;
}

function drawCpuFallback(
  context: CpuDrawingContext,
  size: number,
  parameters: TexturePreviewParameters,
  clock: Clock,
  field: TexturePreviewFieldData,
): TexturePreviewFrameTiming {
  const started = clock();
  const phaseOffset = parameters.phaseOffset ?? 0;
  const frequencyScale = parameters.frequencyScale ?? 1;
  const image = context.createImageData(size, size);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = fieldValue(
        (column + 0.5) / size,
        (row + 0.5) / size,
        phaseOffset,
        frequencyScale,
        field,
      );
      const normalized = Math.max(0, Math.min(1, value * 0.42 + 0.5));
      const offset = (row * size + column) * 4;
      image.data[offset] = Math.round(normalized * 255);
      image.data[offset + 1] = Math.round(
        (0.5 + 0.5 * Math.sin(value * 2.2)) * 255,
      );
      image.data[offset + 2] = Math.round((1 - normalized) * 255);
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const cpuFallbackMs = elapsed(clock, started);
  return {
    frameEnqueueMs: cpuFallbackMs,
    queueCompletionMs: null,
    synchronized: true,
    cpuFallbackMs,
  };
}

function createCpuFallbackController(
  canvas: TexturePreviewCanvas,
  size: 256 | 512,
  clock: Clock,
): WebGpuTexturePreviewController | null {
  const drawing = canvas.getContext("2d") as CpuDrawingContext | null;
  if (!drawing?.createImageData || !drawing.putImageData) {
    return null;
  }
  let state: TexturePreviewControllerState = "active";
  let field = defaultTexturePreviewField();
  return {
    size,
    backend: "cpu-canvas",
    async render(parameters = {}) {
      if (state === "disposed") {
        return {
          frameEnqueueMs: 0,
          queueCompletionMs: null,
          synchronized: false,
          cpuFallbackMs: null,
          skippedReason: "disposed",
        };
      }
      return drawCpuFallback(drawing, size, parameters, clock, field);
    },
    getState: () => state,
    onDeviceLost: () => () => undefined,
    updateField(nextField) {
      field = {
        emitters: nextField.emitters.slice(0, MAX_TEXTURE_PREVIEW_EMITTERS),
      };
    },
    dispose() {
      state = "disposed";
    },
  };
}

export async function mountWebGpuTexturePreview(
  canvas: TexturePreviewCanvas,
  options: {
    size?: 256 | 512;
    canvasFormat?: string;
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    clock?: Clock;
  } = {},
): Promise<WebGpuTexturePreviewResult> {
  const clock = options.clock ?? defaultClock;
  const setupStarted = clock();
  let size: 256 | 512;
  try {
    size = previewSize(options.size);
  } catch (error) {
    return { status: "error", stage: "texture-preview-setup", error };
  }
  canvas.width = size;
  canvas.height = size;

  const deviceResult = await (options.requestDevice ?? requestWebGpuDevice)();
  if (deviceResult.status !== "ready") {
    const controller = createCpuFallbackController(canvas, size, clock);
    const initialFrame = controller ? await controller.render() : null;
    return {
      status: "cpu-fallback",
      controller,
      gpu: deviceResult,
      setupMs: elapsed(clock, setupStarted),
      rendered: initialFrame !== null,
      initialFrame,
      reason: controller ? undefined : "canvas-2d-unavailable",
    };
  }

  const device = deviceResult.device as unknown as TexturePreviewDevice;
  const canvasContext = canvas.getContext(
    "webgpu",
  ) as TexturePreviewCanvasContext | null;
  if (!canvasContext?.configure || !canvasContext.getCurrentTexture) {
    device.destroy?.();
    const controller = createCpuFallbackController(canvas, size, clock);
    const initialFrame = controller ? await controller.render() : null;
    return {
      status: "cpu-fallback",
      controller,
      gpu: deviceResult,
      setupMs: elapsed(clock, setupStarted),
      rendered: initialFrame !== null,
      initialFrame,
      reason: controller
        ? "canvas-webgpu-context-unavailable"
        : "canvas-2d-unavailable",
    };
  }

  try {
    const canvasFormat = options.canvasFormat ?? "bgra8unorm";
    canvasContext.configure({
      device,
      format: canvasFormat,
      alphaMode: "opaque",
    });
    const parameterBuffer = device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT * 8,
      usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    });
    const emitterBuffer = device.createBuffer({
      size:
        Float32Array.BYTES_PER_ELEMENT *
        MAX_TEXTURE_PREVIEW_EMITTERS *
        8,
      usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    });
    let currentField = defaultTexturePreviewField();
    device.queue.writeBuffer(
      emitterBuffer,
      0,
      packTexturePreviewEmitters(currentField),
    );
    const fieldTexture = device.createTexture({
      size: { width: size, height: size },
      format: "rgba8unorm",
      usage: TEXTURE_USAGE_STORAGE_BINDING | TEXTURE_USAGE_TEXTURE_BINDING,
    });
    const fieldView = fieldTexture.createView();
    const computeModule = device.createShaderModule({ code: COMPUTE_SHADER });
    const computePipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: computeModule, entryPoint: "main" },
    });
    const computeBindGroup = device.createBindGroup({
      layout: computePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: parameterBuffer } },
        { binding: 1, resource: fieldView },
        { binding: 2, resource: { buffer: emitterBuffer } },
      ],
    });
    const renderModule = device.createShaderModule({ code: RENDER_SHADER });
    const presentationBuffer = device.createBuffer({
      size: Float32Array.BYTES_PER_ELEMENT,
      usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    });
    const renderPipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: renderModule, entryPoint: "vertexMain" },
      fragment: {
        module: renderModule,
        entryPoint: "fragmentMain",
        targets: [{ format: canvasFormat }],
      },
      primitive: { topology: "triangle-list" },
    });
    const sampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    const renderBindGroup = device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: sampler },
        { binding: 1, resource: fieldView },
        { binding: 2, resource: { buffer: presentationBuffer } },
      ],
    });
    let state: TexturePreviewControllerState = "active";
    const lossListeners = new Set<
      (details: { reason?: string; message?: string }) => void
    >();
    const controller: WebGpuTexturePreviewController = {
      size,
      backend: "webgpu-texture",
      async render(parameters = {}, frameOptions = {}) {
        if (state !== "active") {
          return {
            frameEnqueueMs: 0,
            queueCompletionMs: null,
            synchronized: false,
            cpuFallbackMs: null,
            skippedReason:
              state === "lost" ? "device-lost" : "disposed",
          };
        }
        const frameStarted = clock();
        device.queue.writeBuffer(
          parameterBuffer,
          0,
          new Float32Array([
            size,
            size,
            parameters.phaseOffset ?? 0,
            parameters.frequencyScale ?? 1,
            currentField.emitters.length,
            0,
            0,
            0,
          ]),
        );
        device.queue.writeBuffer(
          presentationBuffer,
          0,
          new Float32Array([frameOptions.presentationPhase ?? 0]),
        );
        const encoder = device.createCommandEncoder();
        if (!frameOptions.skipCompute) {
          const computePass = encoder.beginComputePass();
          computePass.setPipeline(computePipeline);
          computePass.setBindGroup(0, computeBindGroup);
          computePass.dispatchWorkgroups(
            Math.ceil(size / 8),
            Math.ceil(size / 8),
          );
          computePass.end();
        }
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: canvasContext.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(0, renderBindGroup);
        renderPass.draw(3);
        renderPass.end();
        device.queue.submit([encoder.finish()]);
        const frameEnqueueMs = elapsed(clock, frameStarted);
        let queueCompletionMs: number | null = null;
        if (frameOptions.synchronize) {
          const completionStarted = clock();
          await device.queue.onSubmittedWorkDone?.();
          queueCompletionMs = elapsed(clock, completionStarted);
        }
        return {
          frameEnqueueMs,
          queueCompletionMs,
          synchronized: frameOptions.synchronize === true,
          cpuFallbackMs: null,
        };
      },
      getState: () => state,
      onDeviceLost(listener) {
        lossListeners.add(listener);
        return () => lossListeners.delete(listener);
      },
      updateField(field) {
        currentField = {
          emitters: field.emitters.slice(0, MAX_TEXTURE_PREVIEW_EMITTERS),
        };
        device.queue.writeBuffer(
          emitterBuffer,
          0,
          packTexturePreviewEmitters(currentField),
        );
      },
      dispose() {
        if (state === "disposed") {
          return;
        }
        state = "disposed";
        lossListeners.clear();
        parameterBuffer.destroy?.();
        emitterBuffer.destroy?.();
        presentationBuffer.destroy?.();
        fieldTexture.destroy?.();
        canvasContext.unconfigure?.();
        device.destroy?.();
      },
    };
    device.lost
      ?.then((details) => {
        if (state !== "active") {
          return;
        }
        state = "lost";
        for (const listener of lossListeners) {
          listener(details);
        }
      })
      .catch(() => {
        if (state === "active") {
          state = "lost";
          for (const listener of lossListeners) {
            listener({ message: "WebGPU device lost." });
          }
        }
      });
    const cpuStarted = clock();
    computeCpuField(size, size);
    const cpuBaselineMs = elapsed(clock, cpuStarted);
    const initialFrame = await controller.render();
    return {
      status: "ready",
      controller,
      setupMs: elapsed(clock, setupStarted),
      cpuBaselineMs,
      initialFrame,
    };
  } catch (error) {
    device.destroy?.();
    return { status: "error", stage: "texture-preview-setup", error };
  }
}
