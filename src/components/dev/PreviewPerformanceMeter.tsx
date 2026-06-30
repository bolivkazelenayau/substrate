// DEV ONLY: Gate 7.8A-C live SVG pipeline trace. Never used by export.
import { useCallback, useState } from "react";
import { buildFlowPathPlan, FLOW_PREVIEW_BUCKET_COUNT } from "../../engine/flowPreviewOptimization";
import { computeFrameStats } from "../../engine/previewPerformanceMeter";
import { beginPreviewRuntimeCapture, endPreviewRuntimeCapture } from "../../engine/previewRuntimeDiagnostics";
import { generateRendererGeometry } from "../../engine/rendererRuntime";
import type { SvgTraceConfig } from "../../engine/previewTraceConfig";
import type { LineSegment } from "../../engine/geometry";
import type { ProjectState, RenderContext } from "../../types";

interface Props {
  state: ProjectState;
  context: RenderContext;
  durationMs?: number;
  fpsCap: 24 | 30 | 60;
  onFpsCapChange: (fps: 24 | 30 | 60) => void;
  traceConfig: SvgTraceConfig;
  onTraceConfigChange: (config: SvgTraceConfig) => void;
  onClose: () => void;
}

interface Result {
  label: string;
  traceConfig: SvgTraceConfig;
  targetFps: number;
  observedFps: number;
  medianIntervalMs: number;
  meanIntervalMs: number;
  p95IntervalMs: number;
  lateFrames: number;
  frames: number;
  appRenders: number;
  geometryBuilds: number;
  geometryMs: number;
  groupingMs: number;
  domWriteMs: number;
  changedBuckets: number;
  segments: number;
  dLength: number;
}

const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const TRACE_VARIANTS: Array<{ label: string; config: SvgTraceConfig }> = [
  { label: "baseline-24", config: { mode: "normal", bucketCount: 24 } },
  { label: "temporal-12-of-24", config: { mode: "temporal-12", bucketCount: 24 } },
  { label: "temporal-8-of-24", config: { mode: "temporal-8", bucketCount: 24 } },
  { label: "cadence-20", config: { mode: "cadence-20", bucketCount: 24 } },
  { label: "cadence-15", config: { mode: "cadence-15", bucketCount: 24 } },
  { label: "hybrid-12x2", config: { mode: "hybrid-spatial", bucketCount: 24 } },
];

export function PreviewPerformanceMeter({
  state,
  context,
  durationMs = 5000,
  fpsCap,
  onFpsCapChange,
  traceConfig,
  onTraceConfigChange,
  onClose,
}: Props) {
  const [running, setRunning] = useState(false);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);

  const captureVariant = useCallback(async (
    label: string,
    config: SvgTraceConfig,
    targetFps: 24 | 30 | 60,
  ): Promise<Result> => {
    setCurrentLabel(label);
    onTraceConfigChange(config);
    onFpsCapChange(targetFps);
    await new Promise((resolve) => setTimeout(resolve, 700));
    beginPreviewRuntimeCapture();
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const capture = endPreviewRuntimeCapture();
    const stats = computeFrameStats(capture.frames.map((frame) => frame.timestampMs), targetFps);
    const lines = generateRendererGeometry(state, context).geometries as LineSegment[];
    const plan = buildFlowPathPlan(lines, config.bucketCount);
    return {
      label,
      traceConfig: config,
      targetFps,
      observedFps: stats.observedFps,
      medianIntervalMs: stats.medianIntervalMs,
      meanIntervalMs: stats.meanIntervalMs,
      p95IntervalMs: stats.p95IntervalMs,
      lateFrames: stats.lateFrames,
      frames: capture.frames.length,
      appRenders: capture.appRenderCount,
      geometryBuilds: capture.geometryBuildCount,
      geometryMs: average(capture.frames.map((frame) => frame.geometryBuildMs)),
      groupingMs: average(capture.frames.map((frame) => frame.pathGroupingMs)),
      domWriteMs: average(capture.frames.map((frame) => frame.domWriteMs)),
      changedBuckets: average(capture.frames.map((frame) => frame.changedBuckets)),
      segments: lines.length,
      dLength: Math.round(average(capture.frames.map((frame) => frame.dStringLength)))
        || plan.buckets.reduce((sum, bucket) => sum + bucket.d.length, 0),
    };
  }, [context, durationMs, onFpsCapChange, onTraceConfigChange, state]);

  const runTraceMatrix = useCallback(async () => {
    setRunning(true);
    setResults([]);
    const captured: Result[] = [];
    for (const variant of TRACE_VARIANTS) {
      const result = await captureVariant(variant.label, variant.config, 60);
      captured.push(result);
      setResults([...captured]);
    }
    onTraceConfigChange(traceConfig);
    onFpsCapChange(fpsCap);
    setCurrentLabel(null);
    setRunning(false);
  }, [captureVariant, fpsCap, onFpsCapChange, onTraceConfigChange, traceConfig]);

  const runCurrentZoom = useCallback(async () => {
    setRunning(true);
    const zoomLabel = document.querySelector("[aria-label='Canvas zoom']")?.textContent?.trim() ?? "unknown";
    const config: SvgTraceConfig = { mode: "normal", bucketCount: FLOW_PREVIEW_BUCKET_COUNT };
    const result = await captureVariant(`normal-zoom-${zoomLabel}`, config, 60);
    setResults((current) => [...current, result]);
    onTraceConfigChange(traceConfig);
    onFpsCapChange(fpsCap);
    setCurrentLabel(null);
    setRunning(false);
  }, [captureVariant, fpsCap, onFpsCapChange, onTraceConfigChange, traceConfig]);

  return (
    <div style={{ position: "fixed", right: 16, top: 16, zIndex: 99999, width: 820, maxHeight: "85vh", overflow: "auto", padding: 12, color: "#d7ff00", background: "rgba(8,10,14,.97)", border: "1px solid #d7ff00", font: "11px/1.5 ui-monospace,monospace" }} aria-label="Edge Current FPS meter (dev-only)">
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>GATE 7.8D · SVG PATH REPAINT BUDGET</strong>
        <button onClick={onClose}>Close</button>
      </div>
      <p>DPR={window.devicePixelRatio} · backend=SVG DOM · target=60 · DevTools closed for QA</p>
      <button onClick={runTraceMatrix} disabled={running}>
        {running ? `Tracing ${currentLabel}…` : "Run trace matrix (6 × 5s)"}
      </button>
      <button onClick={runCurrentZoom} disabled={running} style={{ marginLeft: 8 }}>
        Trace current zoom
      </button>
      {results.length > 0 && (
        <>
          <table style={{ width: "100%", marginTop: 10, borderCollapse: "collapse", fontSize: 10 }}>
            <thead><tr>{["variant", "FPS", "median", "mean", "p95", "late", "geo", "group", "DOM", "d chars", "changed", "App", "rebuild", "mask", "K"].map((label) => <th key={label}>{label}</th>)}</tr></thead>
            <tbody>{results.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td><td>{r.observedFps.toFixed(1)}</td><td>{r.medianIntervalMs.toFixed(1)}</td><td>{r.meanIntervalMs.toFixed(1)}</td><td>{r.p95IntervalMs.toFixed(1)}</td><td>{r.lateFrames}</td>
                <td>{r.geometryMs.toFixed(2)}</td><td>{r.groupingMs.toFixed(2)}</td><td>{r.domWriteMs.toFixed(2)}</td><td>{r.dLength.toLocaleString()}</td><td>{r.changedBuckets.toFixed(1)}</td>
                <td>{r.appRenders}</td><td>{r.geometryBuilds}</td><td>{r.traceConfig.mode === "mask-disabled" ? "no" : "yes"}</td><td>{r.traceConfig.bucketCount}</td>
              </tr>
            ))}</tbody>
          </table>
          <p>segments/frame={results[0].segments} · local-clock does not mutate project state · export path untouched</p>
        </>
      )}
    </div>
  );
}
