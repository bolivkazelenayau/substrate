import type { FlowPreviewUpdateResult } from "./flowPreviewOptimization";

export interface PreviewRuntimeFrame {
  timestampMs: number;
  clockElapsedMs: number;
  jsUpdateMs: number;
  geometryBuildMs: number;
  pathGroupingMs: number;
  domWriteMs: number;
  attributeWrites: number;
  changedBuckets: number;
  segmentCount: number;
  activeBuckets: number;
  dStringLength: number;
}

export interface PreviewRuntimeCapture {
  frames: PreviewRuntimeFrame[];
  appRenderCount: number;
  geometryBuildCount: number;
  startedAtMs: number;
  endedAtMs: number;
}

interface ActiveCapture extends PreviewRuntimeCapture {
  pendingClock: { elapsedMs: number; jsUpdateMs: number } | null;
  pendingGeometryMs: number;
}

let active: ActiveCapture | null = null;

export function beginPreviewRuntimeCapture(): void {
  active = {
    frames: [],
    appRenderCount: 0,
    geometryBuildCount: 0,
    startedAtMs: performance.now(),
    endedAtMs: 0,
    pendingClock: null,
    pendingGeometryMs: 0,
  };
}

export function endPreviewRuntimeCapture(): PreviewRuntimeCapture {
  const capture = active;
  active = null;
  if (!capture) return { frames: [], appRenderCount: 0, geometryBuildCount: 0, startedAtMs: 0, endedAtMs: 0 };
  capture.endedAtMs = performance.now();
  return capture;
}

export function recordPreviewAppRender(): void {
  if (active) active.appRenderCount += 1;
}

export function recordPreviewClockCommit(elapsedMs: number, jsUpdateMs: number): void {
  if (active) active.pendingClock = { elapsedMs, jsUpdateMs };
}

export function recordPreviewGeometryBuild(durationMs: number): void {
  if (!active) return;
  active.geometryBuildCount += 1;
  active.pendingGeometryMs = durationMs;
}

export function recordPreviewPathCommit(input: {
  pathGroupingMs: number;
  domWriteMs: number;
  stats: FlowPreviewUpdateResult;
  segmentCount: number;
  activeBuckets: number;
  dStringLength: number;
}): void {
  if (!active) return;
  const clock = active.pendingClock;
  active.frames.push({
    timestampMs: performance.now(),
    clockElapsedMs: clock?.elapsedMs ?? 0,
    jsUpdateMs: clock?.jsUpdateMs ?? 0,
    geometryBuildMs: active.pendingGeometryMs,
    pathGroupingMs: input.pathGroupingMs,
    domWriteMs: input.domWriteMs,
    attributeWrites: input.stats.attributeWrites,
    changedBuckets: input.stats.dUpdates,
    segmentCount: input.segmentCount,
    activeBuckets: input.activeBuckets,
    dStringLength: input.dStringLength,
  });
  active.pendingClock = null;
  active.pendingGeometryMs = 0;
}
