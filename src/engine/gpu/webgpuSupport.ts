export interface WebGpuBuffer {
  getMappedRange(): ArrayBuffer;
  mapAsync(mode: number): Promise<void>;
  unmap(): void;
  destroy?(): void;
}

export interface WebGpuCommandEncoder {
  beginComputePass(descriptor?: {
    timestampWrites?: {
      querySet: WebGpuQuerySet;
      beginningOfPassWriteIndex: number;
      endOfPassWriteIndex: number;
    };
  }): {
    setPipeline(pipeline: unknown): void;
    setBindGroup(index: number, bindGroup: unknown): void;
    dispatchWorkgroups(count: number): void;
    end(): void;
  };
  copyBufferToBuffer(
    source: WebGpuBuffer,
    sourceOffset: number,
    destination: WebGpuBuffer,
    destinationOffset: number,
    size: number,
  ): void;
  resolveQuerySet?(
    querySet: WebGpuQuerySet,
    firstQuery: number,
    queryCount: number,
    destination: WebGpuBuffer,
    destinationOffset: number,
  ): void;
  finish(): unknown;
}

export interface WebGpuQuerySet {
  destroy?(): void;
}

export interface WebGpuFeatureSet {
  has(feature: string): boolean;
}

export interface WebGpuDevice {
  features?: WebGpuFeatureSet;
  queue: {
    writeBuffer(buffer: WebGpuBuffer, offset: number, data: ArrayBufferView): void;
    submit(commands: unknown[]): void;
    onSubmittedWorkDone?(): Promise<void>;
  };
  createBuffer(descriptor: {
    size: number;
    usage: number;
  }): WebGpuBuffer;
  createShaderModule(descriptor: { code: string }): unknown;
  createComputePipeline(descriptor: {
    layout: "auto";
    compute: { module: unknown; entryPoint: string };
  }): { getBindGroupLayout(index: number): unknown };
  createBindGroup(descriptor: {
    layout: unknown;
    entries: Array<{ binding: number; resource: { buffer: WebGpuBuffer } }>;
  }): unknown;
  createCommandEncoder(): WebGpuCommandEncoder;
  createQuerySet?(descriptor: {
    type: "timestamp";
    count: number;
  }): WebGpuQuerySet;
  destroy?(): void;
}

export interface WebGpuAdapter {
  features?: WebGpuFeatureSet;
  requestDevice(descriptor?: {
    requiredFeatures?: string[];
  }): Promise<WebGpuDevice>;
}

export interface WebGpuProvider {
  requestAdapter(): Promise<WebGpuAdapter | null>;
}

export type WebGpuSupportResult =
  | { status: "available"; gpu: WebGpuProvider }
  | {
      status: "unavailable";
      reason: "navigator-unavailable" | "gpu-unavailable";
    };

export type WebGpuDeviceResult =
  | {
      status: "ready";
      adapter: WebGpuAdapter;
      device: WebGpuDevice;
      enabledFeatures?: string[];
    }
  | {
      status: "unavailable";
      reason:
        | "navigator-unavailable"
        | "gpu-unavailable"
        | "adapter-unavailable";
    }
  | {
      status: "error";
      stage: "adapter" | "device";
      error: unknown;
    };

interface NavigatorLike {
  gpu?: WebGpuProvider;
}

function currentNavigator(): NavigatorLike | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator as NavigatorLike);
}

export function getWebGpuSupport(
  navigatorLike: NavigatorLike | null | undefined = currentNavigator(),
): WebGpuSupportResult {
  if (!navigatorLike) {
    return { status: "unavailable", reason: "navigator-unavailable" };
  }
  if (!navigatorLike.gpu) {
    return { status: "unavailable", reason: "gpu-unavailable" };
  }
  return { status: "available", gpu: navigatorLike.gpu };
}

export async function requestWebGpuDevice(
  navigatorLike: NavigatorLike | null | undefined = currentNavigator(),
  options: { preferredFeatures?: readonly string[] } = {},
): Promise<WebGpuDeviceResult> {
  const support = getWebGpuSupport(navigatorLike);
  if (support.status === "unavailable") {
    return support;
  }

  let adapter: WebGpuAdapter | null;
  try {
    adapter = await support.gpu.requestAdapter();
  } catch (error) {
    return { status: "error", stage: "adapter", error };
  }
  if (!adapter) {
    return { status: "unavailable", reason: "adapter-unavailable" };
  }

  try {
    const enabledFeatures = (options.preferredFeatures ?? []).filter(
      (feature) => adapter.features?.has(feature) === true,
    );
    const device = await adapter.requestDevice(
      enabledFeatures.length > 0
        ? { requiredFeatures: enabledFeatures }
        : undefined,
    );
    return { status: "ready", adapter, device, enabledFeatures };
  } catch (error) {
    return { status: "error", stage: "device", error };
  }
}
