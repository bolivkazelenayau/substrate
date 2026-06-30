import { VIEWPORT } from "../constants";
import { MAX_EMITTER_ROWS } from "../emitterEditor";
import type {
  GlyphEmitterFalloff,
  ProjectState,
} from "../../types";
import {
  mountWebGpuTexturePreview,
  type TexturePreviewFieldData,
  type TexturePreviewFieldEmitter,
  type TexturePreviewFrameTiming,
  type WebGpuTexturePreviewController,
  type WebGpuTexturePreviewResult,
} from "./webgpuTexturePreview";
import type { WebGpuDeviceResult } from "./webgpuSupport";

export interface DevWebGpuEmitterAnchor {
  id: string;
  x: number;
  y: number;
}

export interface DevWebGpuAppFieldSnapshot {
  project: ProjectState;
  bounds?: { x: number; y: number; width: number; height: number };
  singleAnchor?: { x: number; y: number } | null;
  resolvedEmitterAnchors?: DevWebGpuEmitterAnchor[];
}

export type DevWebGpuFieldState = "active" | "neutral" | "approximate";

/**
 * Reason the mapped field is neutral (zero active emitters). Diagnostics only;
 * this never changes CPU/vector renderer output, schema, or SVG export.
 */
export type DevWebGpuNeutralReason =
  | "shared emitter disabled"
  | "shared emitter has zero strength"
  | "no enabled emitter rows"
  | "no contributing emitter rows";

export interface DevWebGpuMappedField {
  field: TexturePreviewFieldData;
  emitterMode: ProjectState["emitterMode"];
  activeEmitterCount: number;
  clippedEmitterCount: number;
  usedResolvedAnchorCount: number;
  bounds: { x: number; y: number; width: number; height: number };
  /** Active/neutral/approximate classification of the mapped field. */
  fieldState: DevWebGpuFieldState;
  /** Present only when `fieldState === "neutral"`. */
  neutralReason?: DevWebGpuNeutralReason;
  /** Present only when `fieldState === "approximate"`. */
  approximateReason?: string;
  /** `project.emitter.enabled` — the single-mode shared emitter flag. */
  singleModeSharedEmitterEnabled: boolean;
  /**
   * Rows in `project.emitters[]` ignored because single mode uses the shared
   * emitter (`project.emitter`). In multiple mode this is 0.
   */
  ignoredEmitterRowsCount: number;
  /** Count of `project.emitters[]` rows whose `enabled` flag is true. */
  enabledEmitterRowsCount: number;
  /** Count of `project.emitters[]` rows whose `enabled` flag is false. */
  disabledEmitterRowsCount: number;
  /**
   * Count of active mapped emitters that fell back to the deterministic
   * diagnostic anchor layout because no resolved glyph anchor was available.
   */
  fallbackAnchorCount: number;
  zeroStrengthEmitterCount: number;
  activeContributingEmitterCount: number;
  emitterStrengths: Array<{
    id: string;
    effectiveStrength: number;
    contributing: boolean;
  }>;
}

export interface DevWebGpuAppFieldPreviewController {
  readonly backend: WebGpuTexturePreviewController["backend"];
  update(
    snapshot: DevWebGpuAppFieldSnapshot,
  ): Promise<TexturePreviewFrameTiming>;
  start(
    getSnapshot: () => DevWebGpuAppFieldSnapshot,
    options?: { presentationStep?: number },
  ): void;
  stop(): void;
  /**
   * Returns the latest mapped field, including all mapping diagnostics
   * (`fieldState`, `neutralReason`, `approximateReason`, row counts, fallback
   * anchor count). Always returns the current mapping while the controller is
   * alive; never returns `undefined` after mount/start/update.
   */
  getMapping(): DevWebGpuMappedField;
  /** Forwarded for dev overlay device-lost surfacing; dev-only. */
  onDeviceLost(
    listener: (details: { reason?: string; message?: string }) => void,
  ): () => void;
  dispose(): void;
}

export type DevWebGpuAppFieldPreviewResult =
  | {
      status: "ready" | "cpu-fallback";
      controller: DevWebGpuAppFieldPreviewController;
      preview: Exclude<WebGpuTexturePreviewResult, { status: "error" }>;
      mapping: DevWebGpuMappedField;
      initialFrame: TexturePreviewFrameTiming;
    }
  | {
      status: "error";
      preview: Extract<WebGpuTexturePreviewResult, { status: "error" }>;
    };

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function falloffType(falloff: GlyphEmitterFalloff): 0 | 1 | 2 {
  if (falloff === "gaussian") {
    return 1;
  }
  if (falloff === "linear") {
    return 2;
  }
  return 0;
}

function normalizeAnchor(
  anchor: { x: number; y: number },
  bounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  return {
    x: clamp((anchor.x - bounds.x) / bounds.width, 0, 1),
    y: clamp((anchor.y - bounds.y) / bounds.height, 0, 1),
  };
}

function fallbackAnchor(index: number, count: number): {
  x: number;
  y: number;
} {
  if (count <= 1) {
    return { x: 0.5, y: 0.5 };
  }
  return {
    x: (index + 1) / (count + 1),
    y: 0.5 + (index % 2 === 0 ? -0.12 : 0.12),
  };
}

function mappedEmitter(
  project: ProjectState,
  anchor: { x: number; y: number },
  weight: number,
  phaseOffset: number,
  radiusMultiplier: number,
  worldScale: number,
): TexturePreviewFieldEmitter {
  return {
    x: anchor.x,
    y: anchor.y,
    amplitude:
      finite(project.emitter.amplitude, 0) *
      (finite(project.amplitude, 22) / 22) *
      finite(weight, 1),
    frequency:
      finite(project.emitter.frequency, 0.09) *
      (finite(project.frequency, 18) / 18) *
      worldScale,
    phase:
      finite(project.emitter.phase, 0) + finite(phaseOffset, 0),
    radius: clamp(
      (finite(project.emitter.radius, 430) *
        finite(radiusMultiplier, 1)) /
        worldScale,
      0.001,
      4,
    ),
    falloffType: falloffType(project.emitter.falloff),
    falloffStrength: 1,
  };
}

export function mapAppFieldSnapshotToTexturePreview(
  snapshot: DevWebGpuAppFieldSnapshot,
): DevWebGpuMappedField {
  const project = snapshot.project;
  const requestedBounds = snapshot.bounds ?? {
    x: 0,
    y: 0,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
  };
  const bounds = {
    x: finite(requestedBounds.x, 0),
    y: finite(requestedBounds.y, 0),
    width: Math.max(1, finite(requestedBounds.width, VIEWPORT.width)),
    height: Math.max(1, finite(requestedBounds.height, VIEWPORT.height)),
  };
  const worldScale = Math.min(bounds.width, bounds.height);
  const resolved = new Map(
    (snapshot.resolvedEmitterAnchors ?? []).map(({ id, x, y }) => [
      id,
      { x, y },
    ]),
  );
  const emitters: TexturePreviewFieldEmitter[] = [];
  let usedResolvedAnchorCount = 0;
  let fallbackAnchorCount = 0;
  const emitterStrengths: DevWebGpuMappedField["emitterStrengths"] = [];

  const enabledEmitterRowsCount = project.emitters.filter(
    (row) => row.enabled,
  ).length;
  const disabledEmitterRowsCount =
    project.emitters.length - enabledEmitterRowsCount;

  if (project.emitter.enabled) {
    if (project.emitterMode === "single") {
      const effectiveStrength = Math.max(0, finite(project.emitter.amplitude, 0));
      emitterStrengths.push({
        id: project.emitter.id,
        effectiveStrength,
        contributing: effectiveStrength > 0,
      });
      if (effectiveStrength > 0) {
        const rawAnchor =
          project.emitter.sourceMode === "custom"
            ? { x: project.emitter.customX, y: project.emitter.customY }
            : snapshot.singleAnchor;
        if (rawAnchor) {
          usedResolvedAnchorCount += 1;
        } else {
          fallbackAnchorCount += 1;
        }
        const anchor = rawAnchor
          ? normalizeAnchor(rawAnchor, bounds)
          : fallbackAnchor(0, 1);
        emitters.push(
          mappedEmitter(project, anchor, 1, 0, 1, worldScale),
        );
      }
    } else {
      const cappedRows = project.emitters.slice(0, MAX_EMITTER_ROWS);
      const activeRows = cappedRows.filter((row) => row.enabled);
      const contributingRows = activeRows.filter((row) => {
        const effectiveStrength = Math.max(0, finite(project.emitter.amplitude, 0))
          * Math.max(0, finite(row.weight, 0));
        emitterStrengths.push({
          id: row.id,
          effectiveStrength,
          contributing: effectiveStrength > 0,
        });
        return effectiveStrength > 0;
      });
      contributingRows.forEach((row, index) => {
        const rawAnchor =
          project.emitter.sourceMode === "custom"
            ? { x: project.emitter.customX, y: project.emitter.customY }
            : resolved.get(row.id);
        if (rawAnchor) {
          usedResolvedAnchorCount += 1;
        } else {
          fallbackAnchorCount += 1;
        }
        const anchor = rawAnchor
          ? normalizeAnchor(rawAnchor, bounds)
          : fallbackAnchor(index, contributingRows.length);
        emitters.push(
          mappedEmitter(
            project,
            anchor,
            row.weight,
            row.phaseOffset,
            row.radiusMultiplier,
            worldScale,
          ),
        );
      });
    }
  }

  const activeEmitterCount = emitters.length;
  const zeroStrengthEmitterCount = emitterStrengths.filter((entry) => !entry.contributing).length;
  const fieldState: DevWebGpuFieldState =
    activeEmitterCount === 0
      ? "neutral"
      : fallbackAnchorCount > 0
        ? "approximate"
        : "active";
  const neutralReason: DevWebGpuNeutralReason | undefined =
    fieldState === "neutral"
      ? project.emitterMode === "single"
        ? project.emitter.enabled
          ? "shared emitter has zero strength"
          : "shared emitter disabled"
        : enabledEmitterRowsCount > 0
          ? "no contributing emitter rows"
          : "no enabled emitter rows"
      : undefined;
  const approximateReason: string | undefined =
    fieldState === "approximate"
      ? `${usedResolvedAnchorCount} of ${activeEmitterCount} active emitter(s) had resolved glyph anchors; ${fallbackAnchorCount} used the deterministic diagnostic fallback anchor layout. CPU/GPU use the same mapping; this is an approximation only.`
      : undefined;
  const ignoredEmitterRowsCount =
    project.emitterMode === "single" ? project.emitters.length : 0;

  return {
    field: { emitters },
    emitterMode: project.emitterMode,
    activeEmitterCount,
    clippedEmitterCount: Math.max(
      0,
      project.emitters
        .slice(MAX_EMITTER_ROWS)
        .filter((row) => row.enabled).length,
    ),
    usedResolvedAnchorCount,
    bounds,
    fieldState,
    neutralReason,
    approximateReason,
    singleModeSharedEmitterEnabled: project.emitter.enabled,
    ignoredEmitterRowsCount,
    enabledEmitterRowsCount,
    disabledEmitterRowsCount,
    fallbackAnchorCount,
    zeroStrengthEmitterCount,
    activeContributingEmitterCount: activeEmitterCount,
    emitterStrengths,
  };
}

export async function updateDevWebGpuAppFieldPreview(
  controller: DevWebGpuAppFieldPreviewController,
  snapshot: DevWebGpuAppFieldSnapshot,
): Promise<TexturePreviewFrameTiming> {
  return controller.update(snapshot);
}

export async function mountDevWebGpuAppFieldPreview(
  canvas: HTMLCanvasElement,
  snapshot: DevWebGpuAppFieldSnapshot,
  options: {
    size?: 256 | 512;
    canvasFormat?: string;
    requestDevice?: () => Promise<WebGpuDeviceResult>;
    removeCanvasOnDispose?: boolean;
  } = {},
): Promise<DevWebGpuAppFieldPreviewResult> {
  const preview = await mountWebGpuTexturePreview(canvas, options);
  if (preview.status === "error") {
    return { status: "error", preview };
  }
  if (!preview.controller) {
    return {
      status: "error",
      preview: {
        status: "error",
        stage: "texture-preview-setup",
        error: new Error("No WebGPU or CPU fallback controller available."),
      },
    };
  }

  const textureController = preview.controller;
  let mapping = mapAppFieldSnapshotToTexturePreview(snapshot);
  let disposed = false;
  let frameHandle: number | null = null;
  let presentationPhase = 0;
  textureController.updateField(mapping.field);
  const initialFrame = await textureController.render();

  const controller: DevWebGpuAppFieldPreviewController = {
    backend: textureController.backend,
    async update(nextSnapshot) {
      if (disposed) {
        throw new Error("Dev WebGPU app-field preview is disposed.");
      }
      mapping = mapAppFieldSnapshotToTexturePreview(nextSnapshot);
      textureController.updateField(mapping.field);
      return textureController.render(
        {},
        { presentationPhase },
      );
    },
    start(getSnapshot, startOptions = {}) {
      if (disposed || frameHandle !== null) {
        return;
      }
      const step = startOptions.presentationStep ?? 0.025;
      const frame = async () => {
        frameHandle = null;
        if (disposed) {
          return;
        }
        presentationPhase += step;
        await controller.update(getSnapshot());
        if (!disposed) {
          frameHandle = requestAnimationFrame(() => { void frame(); });
        }
      };
      frameHandle = requestAnimationFrame(() => { void frame(); });
    },
    stop() {
      if (frameHandle !== null) {
        cancelAnimationFrame(frameHandle);
        frameHandle = null;
      }
    },
    getMapping: () => mapping,
    onDeviceLost: (listener) => textureController.onDeviceLost(listener),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      controller.stop();
      textureController.dispose();
      if (options.removeCanvasOnDispose ?? true) {
        canvas.remove();
      }
    },
  };

  return {
    status: preview.status,
    controller,
    preview,
    mapping,
    initialFrame,
  };
}
