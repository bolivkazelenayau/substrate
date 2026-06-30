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

const INPUT = new Uint32Array([1, 2, 3, 4]);
const EXPECTED = new Uint32Array([3, 5, 7, 9]);

const COMPUTE_SHADER = `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(4)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  if (id.x < 4u) {
    output[id.x] = input[id.x] * 2u + 1u;
  }
}
`;

export type WebGpuComputeSpikeResult =
  | { status: "success"; output: number[] }
  | { status: "validation-error"; expected: number[]; actual: number[] }
  | Exclude<WebGpuDeviceResult, { status: "ready" }>
  | { status: "error"; stage: "compute"; error: unknown };

function destroyBuffers(buffers: WebGpuBuffer[]): void {
  for (const buffer of buffers) {
    buffer.destroy?.();
  }
}

function outputMatches(actual: Uint32Array): boolean {
  return (
    actual.length === EXPECTED.length &&
    actual.every((value, index) => value === EXPECTED[index])
  );
}

/**
 * Internal Gate 0 probe. It is intentionally not connected to renderers or UI.
 */
export async function runWebGpuComputeSpike(
  requestDevice: () => Promise<WebGpuDeviceResult> = requestWebGpuDevice,
): Promise<WebGpuComputeSpikeResult> {
  const result = await requestDevice();
  if (result.status !== "ready") {
    return result;
  }

  const buffers: WebGpuBuffer[] = [];
  try {
    const { device } = result;
    const byteLength = INPUT.byteLength;
    const inputBuffer = device.createBuffer({
      size: byteLength,
      usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
    });
    const outputBuffer = device.createBuffer({
      size: byteLength,
      usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC,
    });
    const readbackBuffer = device.createBuffer({
      size: byteLength,
      usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ,
    });
    buffers.push(inputBuffer, outputBuffer, readbackBuffer);

    device.queue.writeBuffer(inputBuffer, 0, INPUT);
    const module = device.createShaderModule({ code: COMPUTE_SHADER });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: inputBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(
      outputBuffer,
      0,
      readbackBuffer,
      0,
      byteLength,
    );
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(MAP_MODE_READ);
    const actual = new Uint32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();

    if (!outputMatches(actual)) {
      return {
        status: "validation-error",
        expected: [...EXPECTED],
        actual: [...actual],
      };
    }
    return { status: "success", output: [...actual] };
  } catch (error) {
    return { status: "error", stage: "compute", error };
  } finally {
    destroyBuffers(buffers);
    result.device.destroy?.();
  }
}
