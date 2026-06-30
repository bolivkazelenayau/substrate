import { describe, expect, it } from "vitest";
import {
  compareFieldParity,
  evaluateTexturePreviewFieldCpu,
  reportWebGpuFieldParityDiagnostics,
  runDevWebGpuFieldParityDiagnostics,
  validateFieldParityGrid,
  WEBGPU_FIELD_PARITY_DEFAULT_TOLERANCE,
  WEBGPU_FIELD_PARITY_GRID_SIZES,
} from "../src/engine/gpu/webgpuFieldParityDiagnostics";
import {
  mapAppFieldSnapshotToTexturePreview,
  type DevWebGpuAppFieldSnapshot,
} from "../src/engine/gpu/webgpuAppFieldPreviewAdapter";
import type { WebGpuDevice, WebGpuDeviceResult } from "../src/engine/gpu/webgpuSupport";
import { baseState } from "../src/engine/presets";
import type { GlyphEmitterInstance, ProjectState } from "../src/types";

function emitter(
  id: string,
  overrides: Partial<GlyphEmitterInstance> = {},
): GlyphEmitterInstance {
  return {
    id,
    glyphId: null,
    enabled: true,
    weight: 1,
    phaseOffset: 0,
    radiusMultiplier: 1,
    label: id,
    ...overrides,
  };
}

function fieldSnapshot(project: ProjectState): DevWebGpuAppFieldSnapshot {
  return {
    project: {
      ...project,
      emitter: { ...project.emitter },
      emitters: project.emitters.map((row) => ({ ...row })),
    },
    bounds: { x: 0, y: 0, width: 1200, height: 720 },
  };
}

/**
 * Minimal JS mock of a WebGPU device. It mirrors the parity compute shader
 * with the same JS field evaluation so readback returns an exact match for
 * the CPU reference, exercising the full pipeline + readback wiring without
 * requiring a physical GPU.
 */
function createMockParityDevice(options: {
  perturbation?: number;
  neutral?: boolean;
}): WebGpuDevice {
  const perturbation = options.perturbation ?? 0;
  interface MockBuffer {
    usage: number;
    data: Float32Array;
    mapped: boolean;
    mappedRange: ArrayBuffer | null;
    mapAsync: (mode: number) => Promise<void>;
    getMappedRange: () => ArrayBuffer;
    unmap: () => void;
    destroy?: () => void;
  }
  const buffers: MockBuffer[] = [];
  let pendingBindGroup: Array<{ buffer: MockBuffer }> = [];

  function createMockBuffer(usage: number, byteLength: number): MockBuffer {
    const mock: MockBuffer = {
      usage,
      data: new Float32Array(Math.ceil(byteLength / 4)),
      mapped: false,
      mappedRange: null,
      mapAsync: async () => {
        mock.mapped = true;
        mock.mappedRange = mock.data.buffer.slice(0);
      },
      getMappedRange: () => {
        if (!mock.mappedRange) {
          mock.mappedRange = mock.data.buffer.slice(0);
        }
        return mock.mappedRange;
      },
      unmap: () => {
        mock.mapped = false;
        mock.mappedRange = null;
      },
      destroy: () => undefined,
    };
    buffers.push(mock);
    return mock;
  }

  return {
    queue: {
      writeBuffer(buffer, _offset, data) {
        const mock = buffer as unknown as MockBuffer;
        const view = data as Float32Array;
        mock.data = new Float32Array(view);
      },
      submit(commands) {
        // Commands are no-ops; compute already ran during pass.end().
        void commands;
      },
      onSubmittedWorkDone: () => Promise.resolve(),
    },
    createBuffer(descriptor) {
      const byteLength = descriptor.size;
      const mock = createMockBuffer(descriptor.usage, byteLength);
      return mock as unknown as never;
    },
    createShaderModule: () => ({}),
    createComputePipeline: () => ({
      getBindGroupLayout: () => ({}),
    }),
    createBindGroup: (descriptor) =>
      ({ entries: descriptor.entries }) as unknown as never,
    createCommandEncoder: () => ({
      beginComputePass: () => ({
        setPipeline: () => undefined,
        setBindGroup: (_index, bindGroup) => {
          const entries = (bindGroup as unknown as {
            entries: Array<{ resource: { buffer: MockBuffer } }>;
          }).entries;
          pendingBindGroup = entries.map((entry) => ({
            buffer: entry.resource.buffer,
          }));
        },
        dispatchWorkgroups: () => undefined,
        end: () => {
          const parameter = pendingBindGroup[0]?.buffer.data;
          const emitters = pendingBindGroup[1]?.buffer.data;
          const output = pendingBindGroup[2]?.buffer;
          if (!parameter || !emitters || !output) {
            return;
          }
          const width = parameter[0];
          const height = parameter[1];
          const phaseOffset = parameter[2];
          const frequencyScale = parameter[3];
          const emitterCount = parameter[4];
          const values = new Float32Array(width * height);
          const useNeutral = options.neutral ?? false;
          for (let row = 0; row < height; row += 1) {
            const y = (row + 0.5) / height;
            for (let column = 0; column < width; column += 1) {
              const x = (column + 0.5) / width;
              let value = 0;
              if (!useNeutral) {
                for (let index = 0; index < emitterCount; index += 1) {
                  const offset = index * 8;
                  const ex = emitters[offset];
                  const ey = emitters[offset + 1];
                  const amplitude = emitters[offset + 2];
                  const frequency = emitters[offset + 3];
                  const phase = emitters[offset + 4];
                  const radius = emitters[offset + 5];
                  const falloffType = emitters[offset + 6];
                  const falloffStrength = emitters[offset + 7];
                  const distance = Math.hypot(x - ex, y - ey);
                  const normalized = distance / Math.max(0.0001, radius);
                  let falloff: number;
                  if (falloffType === 0) {
                    const t = Math.max(0, Math.min(1, normalized));
                    falloff = normalized < 1 ? 1 - t * t * (3 - 2 * t) : 0;
                  } else if (falloffType === 1) {
                    falloff =
                      normalized < 1
                        ? Math.exp(-4.5 * normalized * normalized)
                        : 0;
                  } else if (falloffType === 2) {
                    falloff = Math.max(0, 1 - normalized);
                  } else {
                    falloff = 1 / (1 + falloffStrength * distance);
                  }
                  value +=
                    amplitude *
                    Math.sin(
                      distance * frequency * frequencyScale + phase + phaseOffset,
                    ) *
                    falloff;
                }
              }
              values[row * width + column] = value + perturbation;
            }
          }
          output.data = values;
        },
      }),
      copyBufferToBuffer: (source, _so, destination, _do, size) => {
        const src = source as unknown as MockBuffer;
        const dst = destination as unknown as MockBuffer;
        const count = Math.min(
          Math.floor(size / 4),
          src.data.length,
          dst.data.length,
        );
        for (let i = 0; i < count; i += 1) {
          dst.data[i] = src.data[i];
        }
      },
      finish: () => ({}),
    }),
    destroy: () => undefined,
  } as unknown as WebGpuDevice;
}

function readyDevice(device: WebGpuDevice): WebGpuDeviceResult {
  return {
    status: "ready",
    adapter: { requestDevice: async () => device },
    device,
    enabledFeatures: [],
  };
}

describe("WebGPU field parity diagnostics — CPU helpers", () => {
  it("defines bounded 64 and 128 diagnostic grid sizes", () => {
    expect(WEBGPU_FIELD_PARITY_GRID_SIZES).toEqual([64, 128]);
  });

  it("evaluates a deterministic single-emitter CPU field", () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "single",
      emitter: {
        ...baseState.emitter,
        enabled: true,
        amplitude: 1.5,
        frequency: 0.08,
        phase: 0.3,
        radius: 360,
      },
    };
    const mapping = mapAppFieldSnapshotToTexturePreview(fieldSnapshot(project));
    const first = evaluateTexturePreviewFieldCpu(64, 64, mapping.field, {});
    const second = evaluateTexturePreviewFieldCpu(64, 64, mapping.field, {});
    expect(first).toEqual(second);
    expect(first).toHaveLength(64 * 64);
    expect(validateFieldParityGrid(first, 64, 64).finite).toBe(true);
  });

  it("reports a neutral flat field for zero active emitters", () => {
    const zeroEmittersField = { emitters: [] };
    const values = evaluateTexturePreviewFieldCpu(64, 64, zeroEmittersField);
    expect(values.every((value) => value === 0)).toBe(true);
    expect(validateFieldParityGrid(values, 64, 64)).toEqual({
      dimensionsValid: true,
      finite: true,
      neutral: true,
    });
  });

  it("excludes disabled emitters from the mapped field", () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [
        emitter("a", { weight: 1 }),
        emitter("b", { enabled: false, weight: 1 }),
        emitter("c", { weight: 1 }),
      ],
    };
    const snapshot = fieldSnapshot(project);
    const neutral = evaluateTexturePreviewFieldCpu(
      64,
      64,
      { emitters: [] },
      {},
    );
    const withDisabledExcluded = evaluateTexturePreviewFieldCpu(
      64,
      64,
      // Mirrors the adapter's exclusion of disabled rows.
      { emitters: snapshot.project.emitters
        .filter((row) => row.enabled)
        .map(() => ({ x: 0.5, y: 0.5, amplitude: 1, frequency: 1, phase: 0, radius: 0.5, falloffType: 0 as const, falloffStrength: 1 })) },
      {},
    );
    expect(neutral.every((value) => value === 0)).toBe(true);
    // 2 active emitters produce a non-neutral field; the disabled row is not
    // part of the active set.
    expect(withDisabledExcluded.some((value) => value !== 0)).toBe(true);
  });

  it("maps multiple emitters deterministically for repeated evaluations", () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [
        emitter("a", { weight: 0.6, phaseOffset: 0.5 }),
        emitter("b", { weight: 0.9, radiusMultiplier: 0.7 }),
        emitter("c", { weight: 1.1, phaseOffset: 1.2 }),
      ],
    };
    const snapshot = fieldSnapshot(project);
    const mapping = mapAppFieldSnapshotToTexturePreview(snapshot);
    expect(mapping.activeEmitterCount).toBe(3);
    const first = evaluateTexturePreviewFieldCpu(128, 128, mapping.field);
    const second = evaluateTexturePreviewFieldCpu(128, 128, mapping.field);
    expect(first).toEqual(second);
  });

  it("tolerance helpers flag out-of-tolerance differences", () => {
    const cpu = new Float32Array([0, 0.001, -0.002, 0.5]);
    const same = new Float32Array([0, 0.001, -0.002, 0.5]);
    const close = new Float32Array([0, 0.0015, -0.0025, 0.501]);
    const far = new Float32Array([0, 0.5, -0.5, 2]);
    expect(compareFieldParity(cpu, same, 0.01).valid).toBe(true);
    expect(compareFieldParity(cpu, close, 0.01).valid).toBe(true);
    expect(compareFieldParity(cpu, far, 0.01).valid).toBe(false);
    expect(compareFieldParity(cpu, far).maxDifference).toBeCloseTo(1.5, 6);
  });

  it("reports mean, rms, and sample count for parity comparisons", () => {
    const cpu = new Float32Array([1, -1, 2, -2]);
    const gpu = new Float32Array([1.01, -1.02, 1.99, -2.01]);
    const comparison = compareFieldParity(cpu, gpu, 0.1);
    expect(comparison.sampleCount).toBe(4);
    expect(comparison.maxDifference).toBeCloseTo(0.02, 6);
    expect(comparison.meanDifference).toBeCloseTo(0.0125, 6);
    expect(comparison.rmsDifference).toBeGreaterThan(comparison.meanDifference);
  });

  it("flags mismatched lengths and non-finite values as invalid", () => {
    expect(
      compareFieldParity(new Float32Array([1]), new Float32Array([1, 2])).valid,
    ).toBe(false);
    expect(
      compareFieldParity(
        new Float32Array([Number.NaN]),
        new Float32Array([0]),
      ).valid,
    ).toBe(false);
  });
});

describe("WebGPU field parity diagnostics — full run", () => {
  it("falls back to diagnostic-unavailable when WebGPU is missing", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "single",
      emitter: { ...baseState.emitter, enabled: true, amplitude: 1.5 },
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      {
        gridSizes: [64],
        requestDevice: async () => ({
          status: "unavailable",
          reason: "gpu-unavailable",
        }),
      },
    );
    expect(result.status).toBe("diagnostic-unavailable");
    expect(result.unsupportedReason).toBe("gpu-unavailable");
    expect(result.activeEmitterCount).toBe(1);
    expect(result.resultRows).toHaveLength(1);
    expect(result.resultRows[0].status).toBe("diagnostic-unavailable");
    expect(result.resultRows[0].comparison).toBeNull();
    expect(result.resultRows[0].cpuValidation.finite).toBe(true);
    expect(reportWebGpuFieldParityDiagnostics(result)).toContain(
      "diagnostic-unavailable",
    );
  });

  it("reports a neutral field for zero active emitters without touching GPU", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "single",
      emitter: { ...baseState.emitter, enabled: false },
    };
    const requestDevice = async () => {
      throw new Error("GPU should not be requested for zero emitters.");
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      { gridSizes: [64, 128], requestDevice },
    );
    expect(result.status).toBe("complete");
    expect(result.activeEmitterCount).toBe(0);
    expect(result.resultRows).toHaveLength(2);
    for (const row of result.resultRows) {
      expect(row.status).toBe("pass");
      expect(row.cpuValidation.neutral).toBe(true);
      expect(row.comparison?.maxDifference).toBe(0);
    }
  });

  it("excludes disabled emitters and counts them in the report", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [
        emitter("a", { weight: 1 }),
        emitter("b", { enabled: false, weight: 1 }),
        emitter("c", { weight: 1 }),
      ],
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      {
        gridSizes: [64],
        requestDevice: async () => readyDevice(createMockParityDevice({})),
      },
    );
    expect(result.activeEmitterCount).toBe(2);
    expect(result.disabledEmitterCount).toBe(1);
    expect(result.status).toBe("complete");
    expect(result.resultRows[0].status).toBe("pass");
    expect(result.resultRows[0].comparison?.valid).toBe(true);
    expect(result.resultRows[0].comparison?.maxDifference).toBeLessThan(1e-5);
  });

  it("passes parity for a single emitter with a matching GPU readback", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "single",
      emitter: {
        ...baseState.emitter,
        enabled: true,
        amplitude: 2,
        frequency: 0.1,
        phase: 0.4,
        radius: 360,
      },
    };
    const snapshot = fieldSnapshot(project);
    snapshot.singleAnchor = { x: 300, y: 180 };
    const result = await runDevWebGpuFieldParityDiagnostics(snapshot, {
      gridSizes: [64, 128],
      phaseOffset: 0.2,
      frequencyScale: 1.05,
      requestDevice: async () => readyDevice(createMockParityDevice({})),
    });
    expect(result.activeEmitterCount).toBe(1);
    expect(result.fieldState).toBe("active");
    expect(result.snapshotLabel).toBe("single/1-emitter");
    expect(result.usedResolvedAnchorCount).toBe(1);
    expect(result.fallbackAnchorCount).toBe(0);
    expect(result.resultRows).toHaveLength(2);
    for (const row of result.resultRows) {
      expect(row.status).toBe("pass");
      expect(row.comparison?.valid).toBe(true);
      // The mock device mirrors the JS field formula exactly; only Float32
      // packing introduces a sub-1e-5 residual here (real WebGPU ~5.6e-5).
      expect(row.comparison?.maxDifference).toBeLessThan(1e-5);
    }
  });

  it("fails parity when the GPU readback diverges beyond tolerance", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [
        emitter("a", { weight: 0.8, phaseOffset: 0.5 }),
        emitter("b", { weight: 1.2, radiusMultiplier: 0.6 }),
      ],
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      {
        gridSizes: [64],
        tolerance: 0.05,
        requestDevice: async () =>
          readyDevice(createMockParityDevice({ perturbation: 0.5 })),
      },
    );
    expect(result.status).toBe("error");
    const row = result.resultRows[0];
    expect(row.status).toBe("fail");
    expect(row.comparison?.valid).toBe(false);
    expect(row.comparison?.maxDifference).toBeGreaterThan(0.05);
    expect(row.comparison?.maxDifference).toBeCloseTo(0.5, 5);
  });

  it("notes the reason when the diagnostic mapping uses fallback anchors", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true, sourceMode: "center" },
      emitters: [emitter("a"), emitter("b")],
    };
    const snapshot = fieldSnapshot(project);
    // No resolvedEmitterAnchors supplied → adapter uses fallback anchors.
    const result = await runDevWebGpuFieldParityDiagnostics(snapshot, {
      gridSizes: [64],
      requestDevice: async () => readyDevice(createMockParityDevice({})),
    });
    expect(result.fieldState).toBe("approximate");
    expect(result.fallbackAnchorCount).toBe(2);
    expect(result.approximateReason).toBeTruthy();
    expect(result.snapshotLabel).toBe("multiple/2-emitters/approximate");
    const report = reportWebGpuFieldParityDiagnostics(result);
    expect(report).toContain("approximateReason=");
    expect(result.resultRows[0].reason).toBe(result.approximateReason);
  });

  it("parity report includes the neutral reason for single-mode shared-emitter-disabled", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "single",
      emitter: { ...baseState.emitter, enabled: false },
      emitters: [emitter("a"), emitter("b", { enabled: true })],
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      { gridSizes: [64], requestDevice: async () => {
        throw new Error("GPU should not be requested for zero emitters.");
      } },
    );
    expect(result.fieldState).toBe("neutral");
    expect(result.neutralReason).toBe("shared emitter disabled");
    expect(result.snapshotLabel).toBe("single/neutral: shared emitter disabled");
    expect(result.ignoredEmitterRowsCount).toBe(2);
    const report = reportWebGpuFieldParityDiagnostics(result);
    expect(report).toContain("neutralReason=shared emitter disabled");
    expect(report).toContain("fieldState=neutral");
  });

  it("parity report includes the neutral reason for multiple-mode no enabled rows", async () => {
    const project: ProjectState = {
      ...baseState,
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [emitter("a", { enabled: false }), emitter("b", { enabled: false })],
    };
    const result = await runDevWebGpuFieldParityDiagnostics(
      fieldSnapshot(project),
      { gridSizes: [64], requestDevice: async () => {
        throw new Error("GPU should not be requested for zero emitters.");
      } },
    );
    expect(result.fieldState).toBe("neutral");
    expect(result.neutralReason).toBe("no enabled emitter rows");
    expect(result.snapshotLabel).toBe("multiple/neutral: no enabled emitter rows");
    const report = reportWebGpuFieldParityDiagnostics(result);
    expect(report).toContain("neutralReason=no enabled emitter rows");
  });
});