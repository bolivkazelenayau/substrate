// DEV/PROTOTYPE ONLY — Gate 6 CPU/GPU field parity diagnostics.
//
// This module is a diagnostic instrument. It compares the CPU reference
// evaluation of the Gate 5 app-state field preview (the same mapped field
// the dev GPU heatmap renders) against an explicit GPU readback of the same
// field formula, on a bounded diagnostic grid (64² / 128²).
//
// Invariants:
// - This module never affects schema, project state, presets, typography,
//   renderers, Final Artwork SVG, or SVG export.
// - GPU readback happens ONLY inside `runDevWebGpuFieldParityDiagnostics`.
//   The normal texture-preview / heatmap preview path never imports this
//   module and never performs readback.
// - The CPU reference is the authoritative field source of truth. A parity
//   mismatch means the GPU dev heatmap is untrustworthy; it never changes
//   CPU output.
//
// Gate 5 added a dev-only app-state field preview adapter. This layer lets a
// developer trust the GPU heatmap as a field debug instrument by quantifying
// how close its field matches the CPU reference.
//
// Gate 6.1 surfaces the adapter's mapping diagnostics (`fieldState`,
// `neutralReason`, `approximateReason`, full emitter-row counts) in the parity
// report so the heatmap/parity state is hard to misread — especially the
// single-mode distinction where `project.emitters[]` rows are ignored even
// when they look enabled.

import {
  mapAppFieldSnapshotToTexturePreview,
  type DevWebGpuAppFieldSnapshot,
  type DevWebGpuFieldState,
  type DevWebGpuMappedField,
  type DevWebGpuNeutralReason,
} from "./webgpuAppFieldPreviewAdapter";
import {
  requestWebGpuDevice,
  type WebGpuBuffer,
  type WebGpuDevice,
  type WebGpuDeviceResult,
} from "./webgpuSupport";
import type { TexturePreviewFieldData } from "./webgpuTexturePreview";

export const WEBGPU_FIELD_PARITY_GRID_SIZES = [64, 128] as const;
export const WEBGPU_FIELD_PARITY_DEFAULT_TOLERANCE = 0.02;

/** Maximum number of emitters the texture-preview field supports. */
const MAX_PARITY_EMITTERS = 8;

const BUFFER_USAGE_MAP_READ = 0x0001;
const BUFFER_USAGE_COPY_SRC = 0x0004;
const BUFFER_USAGE_COPY_DST = 0x0008;
const BUFFER_USAGE_STORAGE = 0x0080;
const MAP_MODE_READ = 0x0001;

/**
 * Diagnostic WGSL shader. It computes the SAME raw field formula the
 * texture-preview compute shader uses, but writes float field values
 * (not colors) to a storage buffer for readback. The color grading in the
 * preview shader is intentionally excluded — parity is about the raw field.
 */
const PARITY_COMPUTE_SHADER = `
struct FieldEmitter {
  positionAmplitudeFrequency: vec4<f32>,
  phaseRadiusFalloff: vec4<f32>,
}

@group(0) @binding(0) var<storage, read> parameters: array<f32>;
@group(0) @binding(1) var<storage, read> emitters: array<FieldEmitter>;
@group(0) @binding(2) var<storage, read_write> output: array<f32>;

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
      falloff = (1.0 - t * t * (3.0 - 2.0 * t))
        * select(0.0, 1.0, normalizedDistance < 1.0);
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
  let linearIndex = id.y * width + id.x;
  output[linearIndex] = value;
}
`;

/**
 * CPU evaluation of the texture-preview field formula. This MUST match the
 * texture-preview `fieldValue` implementation and the WGSL
 * `PARITY_COMPUTE_SHADER` formula. Keep these three in sync when the preview
 * field shader changes. It is intentionally re-implemented here (rather than
 * importing the texture-preview private helper) so the diagnostic stays an
 * independent console-time instrument.
 */
export function evaluateTexturePreviewFieldCpu(
  width: number,
  height: number,
  field: TexturePreviewFieldData,
  options: { phaseOffset?: number; frequencyScale?: number } = {},
): Float32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError("Field dimensions must be positive integers.");
  }
  const phaseOffset = options.phaseOffset ?? 0;
  const frequencyScale = options.frequencyScale ?? 1;
  const values = new Float32Array(width * height);
  const emitters = field.emitters.slice(0, MAX_PARITY_EMITTERS);
  for (let row = 0; row < height; row += 1) {
    const y = (row + 0.5) / height;
    for (let column = 0; column < width; column += 1) {
      const x = (column + 0.5) / width;
      let value = 0;
      for (const emitter of emitters) {
        const distance = Math.hypot(x - emitter.x, y - emitter.y);
        const normalizedDistance = distance / Math.max(0.0001, emitter.radius);
        let falloff: number;
        if (emitter.falloffType === 0) {
          const t = Math.max(0, Math.min(1, normalizedDistance));
          falloff = normalizedDistance < 1 ? 1 - t * t * (3 - 2 * t) : 0;
        } else if (emitter.falloffType === 1) {
          falloff =
            normalizedDistance < 1
              ? Math.exp(-4.5 * normalizedDistance * normalizedDistance)
              : 0;
        } else if (emitter.falloffType === 2) {
          falloff = Math.max(0, 1 - normalizedDistance);
        } else {
          falloff = 1 / (1 + emitter.falloffStrength * distance);
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
      values[row * width + column] = value;
    }
  }
  return values;
}

export interface FieldParityValidation {
  dimensionsValid: boolean;
  finite: boolean;
  /** True when every sample is the neutral value (zero active emitters). */
  neutral: boolean;
}

export interface FieldParityComparison {
  valid: boolean;
  maxDifference: number;
  meanDifference: number;
  rmsDifference: number;
  epsilon: number;
  sampleCount: number;
}

export interface FieldParityDiagnosticsOptions {
  gridSizes?: readonly number[];
  phaseOffset?: number;
  frequencyScale?: number;
  tolerance?: number;
  requestDevice?: () => Promise<WebGpuDeviceResult>;
}

export interface FieldParityGridReport {
  gridSize: number;
  status: "pass" | "fail" | "diagnostic-unavailable" | "invalid";
  activeEmitterCount: number;
  skippedEmitterCount: number;
  cpuValidation: FieldParityValidation;
  gpuValidation: FieldParityValidation | null;
  comparison: FieldParityComparison | null;
  tolerance: number;
  reason?: string;
}

export interface FieldParityDiagnosticsResult {
  status: "complete" | "diagnostic-unavailable" | "error";
  snapshotLabel: string;
  emitterMode: DevWebGpuMappedField["emitterMode"];
  mapping: DevWebGpuMappedField;
  activeEmitterCount: number;
  clippedEmitterCount: number;
  usedResolvedAnchorCount: number;
  totalEmitterRowCount: number;
  disabledEmitterCount: number;
  fieldState: DevWebGpuFieldState;
  neutralReason?: DevWebGpuNeutralReason;
  approximateReason?: string;
  singleModeSharedEmitterEnabled: boolean;
  ignoredEmitterRowsCount: number;
  enabledEmitterRowsCount: number;
  disabledEmitterRowsCount: number;
  fallbackAnchorCount: number;
  resultRows: FieldParityGridReport[];
  unsupportedReason?: string;
  reason?: string;
}

export function validateFieldParityGrid(
  values: Float32Array,
  width: number,
  height: number,
): FieldParityValidation {
  const dimensionsValid =
    values.length === width * height && width > 0 && height > 0;
  const finite = dimensionsValid && values.every(Number.isFinite);
  const neutral = dimensionsValid && values.every((value) => value === 0);
  return { dimensionsValid, finite, neutral };
}

export function compareFieldParity(
  cpu: Float32Array,
  gpu: Float32Array,
  tolerance = WEBGPU_FIELD_PARITY_DEFAULT_TOLERANCE,
): FieldParityComparison {
  if (cpu.length !== gpu.length || cpu.length === 0) {
    return {
      valid: false,
      maxDifference: Number.POSITIVE_INFINITY,
      meanDifference: Number.POSITIVE_INFINITY,
      rmsDifference: Number.POSITIVE_INFINITY,
      epsilon: tolerance,
      sampleCount: Math.min(cpu.length, gpu.length),
    };
  }
  let maxDifference = 0;
  let totalDifference = 0;
  let sumSquares = 0;
  for (let index = 0; index < cpu.length; index += 1) {
    const difference = cpu[index] - gpu[index];
    const absolute = Math.abs(difference);
    if (!Number.isFinite(absolute)) {
      return {
        valid: false,
        maxDifference: Number.POSITIVE_INFINITY,
        meanDifference: Number.POSITIVE_INFINITY,
        rmsDifference: Number.POSITIVE_INFINITY,
        epsilon: tolerance,
        sampleCount: cpu.length,
      };
    }
    maxDifference = Math.max(maxDifference, absolute);
    totalDifference += absolute;
    sumSquares += difference * difference;
  }
  const sampleCount = cpu.length;
  return {
    valid: maxDifference <= tolerance,
    maxDifference,
    meanDifference: totalDifference / sampleCount,
    rmsDifference: Math.sqrt(sumSquares / sampleCount),
    epsilon: tolerance,
    sampleCount,
  };
}

function diagnosticEmitterCount(project: DevWebGpuAppFieldSnapshot["project"]): {
  totalRows: number;
  disabledRows: number;
} {
  if (project.emitterMode === "single" || !project.emitter.enabled) {
    return { totalRows: 0, disabledRows: 0 };
  }
  const rows = project.emitters.slice(0, MAX_PARITY_EMITTERS);
  const disabledRows = rows.filter((row) => !row.enabled).length;
  return { totalRows: rows.length, disabledRows };
}

/**
 * Build the report label from the mapping's field-state classification.
 * Distinguishes:
 * - `single/neutral: shared emitter disabled`
 * - `multiple/neutral: no enabled emitter rows`
 * - `single/N-emitter` / `multiple/N-emitter`
 * - `.../N-emitter/approximate` when fallback anchors were used.
 */
function diagnosticSnapshotLabel(mapping: DevWebGpuMappedField): string {
  const mode = mapping.emitterMode;
  const count = mapping.activeEmitterCount;
  if (mapping.fieldState === "neutral") {
    const reason = mapping.neutralReason ?? "no active emitters";
    return `${mode}/neutral: ${reason}`;
  }
  const base = `${mode}/${count}-emitter${count === 1 ? "" : "s"}`;
  return mapping.fieldState === "approximate" ? `${base}/approximate` : base;
}

interface ReadbackBuffers {
  buffers: WebGpuBuffer[];
  outputBuffer: WebGpuBuffer;
  readbackBuffer: WebGpuBuffer;
}

function createReadbackBuffers(
  device: WebGpuDevice,
  outputByteLength: number,
): ReadbackBuffers {
  const buffers: WebGpuBuffer[] = [];
  const outputBuffer = device.createBuffer({
    size: outputByteLength,
    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_SRC,
  });
  buffers.push(outputBuffer);
  const readbackBuffer = device.createBuffer({
    size: outputByteLength,
    usage: BUFFER_USAGE_COPY_DST | BUFFER_USAGE_MAP_READ,
  });
  buffers.push(readbackBuffer);
  return { buffers, outputBuffer, readbackBuffer };
}

function packParityEmitters(field: TexturePreviewFieldData): Float32Array {
  const packed = new Float32Array(MAX_PARITY_EMITTERS * 8);
  field.emitters
    .slice(0, MAX_PARITY_EMITTERS)
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

async function readGpuFieldGrid(
  device: WebGpuDevice,
  size: number,
  field: TexturePreviewFieldData,
  parameters: { phaseOffset: number; frequencyScale: number },
): Promise<Float32Array> {
  const cellCount = size * size;
  const outputByteLength = cellCount * Float32Array.BYTES_PER_ELEMENT;
  const parameterBuffer = device.createBuffer({
    size: Float32Array.BYTES_PER_ELEMENT * 8,
    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
  });
  const emitterBuffer = device.createBuffer({
    size: Float32Array.BYTES_PER_ELEMENT * MAX_PARITY_EMITTERS * 8,
    usage: BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
  });
  const { buffers, outputBuffer, readbackBuffer } = createReadbackBuffers(
    device,
    outputByteLength,
  );

  try {
    const parameterData = new Float32Array([
      size,
      size,
      parameters.phaseOffset,
      parameters.frequencyScale,
      Math.min(field.emitters.length, MAX_PARITY_EMITTERS),
      0,
      0,
      0,
    ]);
    device.queue.writeBuffer(parameterBuffer, 0, parameterData);
    device.queue.writeBuffer(emitterBuffer, 0, packParityEmitters(field));

    const module = device.createShaderModule({ code: PARITY_COMPUTE_SHADER });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module, entryPoint: "main" },
    });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: parameterBuffer } },
        { binding: 1, resource: { buffer: emitterBuffer } },
        { binding: 2, resource: { buffer: outputBuffer } },
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(size / 8), Math.ceil(size / 8));
    pass.end();
    encoder.copyBufferToBuffer(
      outputBuffer,
      0,
      readbackBuffer,
      0,
      outputByteLength,
    );
    device.queue.submit([encoder.finish()]);
    if (device.queue.onSubmittedWorkDone) {
      await device.queue.onSubmittedWorkDone();
    }
    await readbackBuffer.mapAsync(MAP_MODE_READ);
    const mapped = readbackBuffer.getMappedRange();
    const values = new Float32Array(mapped.slice(0));
    readbackBuffer.unmap();
    return values;
  } finally {
    parameterBuffer.destroy?.();
    emitterBuffer.destroy?.();
    for (const buffer of buffers) {
      buffer.destroy?.();
    }
  }
}

function buildResult(
  mapping: DevWebGpuMappedField,
  counts: { totalRows: number; disabledRows: number },
  snapshotLabel: string,
  resultRows: FieldParityGridReport[],
  status: FieldParityDiagnosticsResult["status"],
  extra?: Pick<FieldParityDiagnosticsResult, "unsupportedReason" | "reason">,
): FieldParityDiagnosticsResult {
  return {
    status,
    snapshotLabel,
    emitterMode: mapping.emitterMode,
    mapping,
    activeEmitterCount: mapping.activeEmitterCount,
    clippedEmitterCount: mapping.clippedEmitterCount,
    usedResolvedAnchorCount: mapping.usedResolvedAnchorCount,
    totalEmitterRowCount: counts.totalRows,
    disabledEmitterCount: counts.disabledRows,
    fieldState: mapping.fieldState,
    neutralReason: mapping.neutralReason,
    approximateReason: mapping.approximateReason,
    singleModeSharedEmitterEnabled: mapping.singleModeSharedEmitterEnabled,
    ignoredEmitterRowsCount: mapping.ignoredEmitterRowsCount,
    enabledEmitterRowsCount: mapping.enabledEmitterRowsCount,
    disabledEmitterRowsCount: mapping.disabledEmitterRowsCount,
    fallbackAnchorCount: mapping.fallbackAnchorCount,
    resultRows,
    ...extra,
  };
}

/**
 * Run CPU/GPU field parity diagnostics for an app-state snapshot. This is the
 * dev/manual console entry point. It performs GPU readback; do NOT call it
 * from the normal preview/animation path.
 */
export async function runDevWebGpuFieldParityDiagnostics(
  snapshot: DevWebGpuAppFieldSnapshot,
  options: FieldParityDiagnosticsOptions = {},
): Promise<FieldParityDiagnosticsResult> {
  const gridSizes = options.gridSizes ?? WEBGPU_FIELD_PARITY_GRID_SIZES;
  const phaseOffset = options.phaseOffset ?? 0;
  const frequencyScale = options.frequencyScale ?? 1;
  const tolerance =
    options.tolerance ?? WEBGPU_FIELD_PARITY_DEFAULT_TOLERANCE;
  const mapping = mapAppFieldSnapshotToTexturePreview(snapshot);
  const counts = diagnosticEmitterCount(snapshot.project);
  const resultRows: FieldParityGridReport[] = [];

  const noteReason = (
    report: FieldParityGridReport,
  ): FieldParityGridReport => {
    if (mapping.fieldState === "approximate" && report.status !== "invalid") {
      return { ...report, reason: mapping.approximateReason };
    }
    if (mapping.fieldState === "neutral" && report.comparison === null) {
      return {
        ...report,
        reason: mapping.neutralReason
          ? `neutral: ${mapping.neutralReason}`
          : undefined,
      };
    }
    return report;
  };

  if (!mapping.activeEmitterCount) {
    // Zero active emitters: both references must produce a neutral field.
    for (const size of gridSizes) {
      const cpu = evaluateTexturePreviewFieldCpu(size, size, mapping.field, {
        phaseOffset,
        frequencyScale,
      });
      const cpuValidation = validateFieldParityGrid(cpu, size, size);
      resultRows.push(
        noteReason({
          gridSize: size,
          status: cpuValidation.neutral ? "pass" : "fail",
          activeEmitterCount: 0,
          skippedEmitterCount: 0,
          cpuValidation,
          gpuValidation: null,
          comparison: cpuValidation.neutral
            ? {
                valid: true,
                maxDifference: 0,
                meanDifference: 0,
                rmsDifference: 0,
                epsilon: tolerance,
                sampleCount: size * size,
              }
            : null,
          tolerance,
        }),
      );
    }
    return buildResult(
      mapping,
      counts,
      diagnosticSnapshotLabel(mapping),
      resultRows,
      "complete",
    );
  }

  const deviceResult = await (options.requestDevice ?? requestWebGpuDevice)();
  if (deviceResult.status !== "ready") {
    const unsupportedReason =
      deviceResult.status === "unavailable"
        ? deviceResult.reason
        : `device-${deviceResult.stage}-error`;
    for (const size of gridSizes) {
      const cpu = evaluateTexturePreviewFieldCpu(size, size, mapping.field, {
        phaseOffset,
        frequencyScale,
      });
      const cpuValidation = validateFieldParityGrid(cpu, size, size);
      resultRows.push(
        noteReason({
          gridSize: size,
          status: "diagnostic-unavailable",
          activeEmitterCount: mapping.activeEmitterCount,
          skippedEmitterCount: mapping.clippedEmitterCount,
          cpuValidation,
          gpuValidation: null,
          comparison: null,
          tolerance,
          reason: `GPU readback unavailable: ${unsupportedReason}. CPU reference field remains the source of truth.`,
        }),
      );
    }
    return buildResult(
      mapping,
      counts,
      diagnosticSnapshotLabel(mapping),
      resultRows,
      "diagnostic-unavailable",
      {
        unsupportedReason,
        reason:
          "WebGPU unavailable; only the CPU reference field was computed. Re-run in a WebGPU-capable browser for parity.",
      },
    );
  }

  const device = deviceResult.device;
  try {
    for (const size of gridSizes) {
      const cpu = evaluateTexturePreviewFieldCpu(size, size, mapping.field, {
        phaseOffset,
        frequencyScale,
      });
      const cpuValidation = validateFieldParityGrid(cpu, size, size);
      let gpu: Float32Array;
      try {
        gpu = await readGpuFieldGrid(device, size, mapping.field, {
          phaseOffset,
          frequencyScale,
        });
      } catch (error) {
        resultRows.push(
          noteReason({
            gridSize: size,
            status: "invalid",
            activeEmitterCount: mapping.activeEmitterCount,
            skippedEmitterCount: mapping.clippedEmitterCount,
            cpuValidation,
            gpuValidation: null,
            comparison: null,
            tolerance,
            reason: `GPU readback failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }),
        );
        continue;
      }
      const gpuValidation = validateFieldParityGrid(gpu, size, size);
      const comparison = compareFieldParity(cpu, gpu, tolerance);
      const status: FieldParityGridReport["status"] =
        cpuValidation.dimensionsValid &&
        cpuValidation.finite &&
        gpuValidation.dimensionsValid &&
        gpuValidation.finite &&
        comparison.valid
          ? "pass"
          : "fail";
      resultRows.push(
        noteReason({
          gridSize: size,
          status,
          activeEmitterCount: mapping.activeEmitterCount,
          skippedEmitterCount: mapping.clippedEmitterCount,
          cpuValidation,
          gpuValidation,
          comparison,
          tolerance,
        }),
      );
    }
  } finally {
    device.destroy?.();
  }

  const anyFail = resultRows.some(
    (row) => row.status === "fail" || row.status === "invalid",
  );
  return buildResult(
    mapping,
    counts,
    diagnosticSnapshotLabel(mapping),
    resultRows,
    anyFail ? "error" : "complete",
  );
}

/** Print a compact report/table of a parity diagnostics run. */
export function reportWebGpuFieldParityDiagnostics(
  result: FieldParityDiagnosticsResult,
): string {
  const lines: string[] = [];
  lines.push(
    `WebGPU Field Parity Diagnostics — ${result.snapshotLabel} [${result.status}]`,
  );
  lines.push(
    `emitterMode=${result.emitterMode} fieldState=${result.fieldState} active=${result.activeEmitterCount} disabled=${result.disabledEmitterCount} clipped=${result.clippedEmitterCount} resolvedAnchors=${result.usedResolvedAnchorCount} fallbackAnchors=${result.fallbackAnchorCount}`,
  );
  lines.push(
    `sharedEmitterEnabled=${result.singleModeSharedEmitterEnabled} enabledRows=${result.enabledEmitterRowsCount} disabledRows=${result.disabledEmitterRowsCount} ignoredRows=${result.ignoredEmitterRowsCount} totalRows=${result.totalEmitterRowCount}`,
  );
  if (result.neutralReason) {
    lines.push(`neutralReason=${result.neutralReason}`);
  }
  if (result.approximateReason) {
    lines.push(`approximateReason=${result.approximateReason}`);
  }
  if (result.unsupportedReason) {
    lines.push(`unsupportedReason=${result.unsupportedReason}`);
  }
  if (result.reason) {
    lines.push(`note: ${result.reason}`);
  }
  lines.push("");
  lines.push(
    "grid | status | active | skipped | maxDiff | meanDiff | rmsDiff | samples | tolerance",
  );
  for (const row of result.resultRows) {
    const comparison = row.comparison;
    lines.push(
      [
        `${row.gridSize}x${row.gridSize}`,
        row.status,
        `${row.activeEmitterCount}`,
        `${row.skippedEmitterCount}`,
        comparison ? comparison.maxDifference.toExponential(3) : "—",
        comparison ? comparison.meanDifference.toExponential(3) : "—",
        comparison ? comparison.rmsDifference.toExponential(3) : "—",
        comparison ? `${comparison.sampleCount}` : "—",
        `${row.tolerance}`,
      ].join(" | "),
    );
    if (row.reason) {
      lines.push(`  ↳ ${row.reason}`);
    }
  }
  lines.push("");
  lines.push(
    "CPU finite checks:",
    result.resultRows
      .map(
        (row) =>
          `${row.gridSize}x${row.gridSize}=${row.cpuValidation.finite ? "finite" : "non-finite"}${row.cpuValidation.neutral ? "/neutral" : ""}`,
      )
      .join(" | "),
  );
  const gpuRows = result.resultRows.filter((row) => row.gpuValidation);
  if (gpuRows.length) {
    lines.push(
      "GPU finite checks:",
      gpuRows
        .map(
          (row) =>
            `${row.gridSize}x${row.gridSize}=${row.gpuValidation!.finite ? "finite" : "non-finite"}`,
        )
        .join(" | "),
    );
  }
  return lines.join("\n");
}
