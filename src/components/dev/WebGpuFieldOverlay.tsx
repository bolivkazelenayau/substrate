// DEV/PROTOTYPE ONLY — Gate 7 dev-only WebGPU field heatmap overlay.
//
// This is a debug overlay shell for the existing WebGPU field heatmap. It is
// NOT production UI, NOT a renderer integration, and NOT an SVG export path.
// Final Artwork SVG remains CPU/vector-generated and authoritative.
//
// Invariants:
// - The overlay never reads GPU data back. It only mounts the existing
//   `mountDevWebGpuAppFieldPreview` controller, calls `start()` for live field
//   presentation, and reads `controller.getMapping()` (a cached JS object)
//   for the inline legend. The only GPU readback path lives in the separate
//   parity diagnostics module and must never run from this overlay.
// - The overlay is dev/prototype scoped and must not appear in production
//   builds. The parent gates the whole component behind
//   `import.meta.env.DEV`.
// - On close/unmount the controller is disposed, removing its canvas and
//   cancelling its rAF loop. Remount re-creates a fresh controller.

import { useEffect, useRef, useState } from "react";
import {
  mountDevWebGpuAppFieldPreview,
  type DevWebGpuAppFieldPreviewController,
  type DevWebGpuAppFieldSnapshot,
  type DevWebGpuMappedField,
} from "../../engine/gpu/webgpuAppFieldPreviewAdapter";
import type { WebGpuTexturePreviewResult } from "../../engine/gpu/webgpuTexturePreview";
import type { RendererDiagnostics } from "../../engine/geometry";

export interface WebGpuRendererComparison {
  activeFieldEmitterCount: RendererDiagnostics["rendererActiveFieldEmitterCount"];
  consumedFieldMode: RendererDiagnostics["consumedFieldMode"];
  cacheEmitterKey: string | undefined;
  renderedMarkCountPerEmitter: RendererDiagnostics["renderedMarkCountPerEmitter"];
  normalizationMode: RendererDiagnostics["fieldNormalizationMode"];
  emitterDomains: RendererDiagnostics["emitterDomainDiagnostics"];
  artboardBoundsClipped: RendererDiagnostics["artboardBoundsClipped"];
  maxNodesClipped: RendererDiagnostics["maxNodesClipped"];
  activeContributingEmitterCount: RendererDiagnostics["activeContributingEmitterCount"];
  zeroStrengthEmitterCount: RendererDiagnostics["zeroStrengthEmitterCount"];
}

export interface WebGpuFieldOverlayProps {
  /** Snapshot getter. Should clone the current app project state. */
  getSnapshot: () => DevWebGpuAppFieldSnapshot;
  /** Canvas size for the mounted heatmap. */
  size?: 256 | 512;
  rendererComparison?: WebGpuRendererComparison;
  onClose: () => void;
}

type OverlayStatus =
  | { kind: "mounting" }
  | {
      kind: "ready";
      backend: DevWebGpuAppFieldPreviewController["backend"];
      previewStatus: "ready" | "cpu-fallback";
      fallbackReason?: string;
    }
  | { kind: "mount-error"; message: string }
  | { kind: "device-lost"; message: string };

const LEGEND_ROWS: ReadonlyArray<{
  key: keyof DevWebGpuMappedField;
  label: string;
}> = [
  { key: "fieldState", label: "fieldState" },
  { key: "activeEmitterCount", label: "active" },
  { key: "activeContributingEmitterCount", label: "contributing" },
  { key: "zeroStrengthEmitterCount", label: "zero strength" },
  { key: "emitterMode", label: "mode" },
  { key: "singleModeSharedEmitterEnabled", label: "shared emitter" },
  { key: "enabledEmitterRowsCount", label: "enabled rows" },
  { key: "disabledEmitterRowsCount", label: "disabled rows" },
  { key: "ignoredEmitterRowsCount", label: "ignored rows" },
  { key: "usedResolvedAnchorCount", label: "resolved anchors" },
  { key: "fallbackAnchorCount", label: "fallback anchors" },
];

function extractStatusAndController(
  result: Awaited<ReturnType<typeof mountDevWebGpuAppFieldPreview>>,
): { status: OverlayStatus; controller: DevWebGpuAppFieldPreviewController | null } {
  if (result.status === "error") {
    return {
      status: { kind: "mount-error", message: "WebGPU preview mount failed." },
      controller: null,
    };
  }
  const preview = result.preview as WebGpuTexturePreviewResult;
  return {
    status: {
      kind: "ready",
      backend: result.controller.backend,
      previewStatus: result.status,
      fallbackReason:
        preview.status === "cpu-fallback" ? preview.reason : undefined,
    },
    controller: result.controller,
  };
}

export function WebGpuFieldOverlay({
  getSnapshot,
  size = 256,
  rendererComparison,
  onClose,
}: WebGpuFieldOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<OverlayStatus>({ kind: "mounting" });
  const [mapping, setMapping] = useState<DevWebGpuMappedField | null>(null);

  // Hold the latest `getSnapshot` prop in a mutable ref so the one-shot mount
  // effect (which captures this ref, not the prop) always reads the freshest
  // snapshot getter. This is the Gate 7.1 fix: without it the mount effect
  // captured the first-render `getSnapshot` closure, and `controller.start()`
  // kept calling that stale getter — so the heatmap + legend never updated
  // until the overlay was closed and reopened. The ref is updated on every
  // render (before any effect fires), so the controller's rAF loop sees the
  // current app state each frame without remounting the WebGPU controller.
  const getSnapshotRef = useRef(getSnapshot);
  getSnapshotRef.current = getSnapshot;

  useEffect(() => {
    let disposed = false;
    let controller: DevWebGpuAppFieldPreviewController | null = null;
    let legendHandle: number | null = null;

    async function mount() {
      const host = hostRef.current;
      if (!host) return;
      const canvas = document.createElement("canvas");
      canvas.dataset.devWebGpuHeatmap = "true";
      canvas.style.cssText = "width:100%;height:100%;display:block;";
      host.append(canvas);
      try {
        const result = await mountDevWebGpuAppFieldPreview(
          canvas,
          getSnapshotRef.current(),
          {
            size,
            removeCanvasOnDispose: true,
          },
        );
        if (disposed) {
          if (result.status !== "error") {
            result.controller.dispose();
          }
          return;
        }
        const extracted = extractStatusAndController(result);
        controller = extracted.controller;
        setStatus(extracted.status);
        if (!controller) return;
        controller.onDeviceLost((details) => {
          if (disposed) return;
          setStatus({
            kind: "device-lost",
            message: details?.message ?? "WebGPU device was lost.",
          });
        });
        // Read through the ref each frame so live app-state changes flow into
        // the controller's update/render loop without remounting it.
        controller.start(() => getSnapshotRef.current());
        // Poll the cached mapping at a low rate for the legend. This reads a JS
        // object only — it never triggers GPU readback.
        const poll = () => {
          legendHandle = null;
          if (disposed || !controller) return;
          setMapping(controller.getMapping());
          legendHandle = requestAnimationFrame(poll);
        };
        legendHandle = requestAnimationFrame(poll);
      } catch (error) {
        if (disposed) return;
        setStatus({
          kind: "mount-error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    void mount();

    return () => {
      disposed = true;
      if (legendHandle !== null) {
        cancelAnimationFrame(legendHandle);
        legendHandle = null;
      }
      if (controller) {
        controller.stop();
        controller.dispose();
        controller = null;
      }
    };
    // Mount once. The ref lets `getSnapshot` stay fresh across app-state
    // changes without re-running this effect or recreating the controller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isReady = status.kind === "ready";
  const isFallback = isReady && status.previewStatus === "cpu-fallback";
  const backendLabel = isReady ? status.backend : "—";
  const legendEntries =
    mapping ? LEGEND_ROWS.map(({ key, label }) => ({ label, value: String(mapping[key]) })) : [];

  return (
    <div
      data-dev-web-gpu-overlay="true"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 99999,
        width: size + 8,
        background: "rgba(8, 10, 14, 0.9)",
        color: "#d7ff00",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        border: "1px solid #d7ff00",
        padding: 4,
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>GPU FIELD DEBUG — NOT EXPORT</strong>
        <button
          onClick={onClose}
          aria-label="Close WebGPU field debug overlay"
          style={{ color: "#d7ff00", background: "transparent", border: "1px solid #d7ff00", cursor: "pointer" }}
        >
          ✕
        </button>
      </div>
      <div>backend: {backendLabel}{isFallback ? " (fallback)" : ""}</div>
      {status.kind === "ready" && status.fallbackReason && (
        <div>fallback reason: {status.fallbackReason}</div>
      )}
      {status.kind === "mounting" && <div>mounting heatmap…</div>}
      {status.kind === "mount-error" && (
        <div style={{ color: "#ff6b6b" }}>mount error: {status.message}</div>
      )}
      {status.kind === "device-lost" && (
        <div style={{ color: "#ff6b6b" }}>device lost: {status.message}</div>
      )}
      <div
        ref={hostRef}
        style={{ width: size, height: size, background: "#000" }}
      />
      <div style={{ borderTop: "1px solid #3a4a1a", paddingTop: 4 }}>
        <div style={{ fontWeight: "bold", marginBottom: 2 }}>legend</div>
        {legendEntries.length > 0 ? (
          <>
            {legendEntries.map(({ label, value }) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{label}</span>
                <span>{value}</span>
              </div>
            ))}
            {mapping?.fieldState === "neutral" && mapping.neutralReason && (
              <div style={{ color: "#ffcc66" }}>neutral: {mapping.neutralReason}</div>
            )}
            {mapping?.fieldState === "approximate" && mapping.approximateReason && (
              <div style={{ color: "#ffcc66" }}>approximate: {mapping.approximateReason}</div>
            )}
            <div style={{ color: "#aebf75", marginTop: 3 }}>
              active = field emitters, not rendered mark clusters
            </div>
          </>
        ) : (
          <div>legend: no mapping yet</div>
        )}
      </div>
      <div style={{ borderTop: "1px solid #3a4a1a", paddingTop: 4 }}>
        <div style={{ fontWeight: "bold", marginBottom: 2 }}>renderer comparison</div>
        <div>overlay active: {mapping?.activeEmitterCount ?? "—"}</div>
        <div>runtime active: {rendererComparison?.activeFieldEmitterCount ?? "n/a"}</div>
        <div>runtime contributing: {rendererComparison?.activeContributingEmitterCount ?? "n/a"}</div>
        <div>runtime zero strength: {rendererComparison?.zeroStrengthEmitterCount ?? "n/a"}</div>
        <div>consumed mode: {rendererComparison?.consumedFieldMode ?? "n/a"}</div>
        <div>normalization: {rendererComparison?.normalizationMode ?? "n/a"}</div>
        <div>
          artboard clipped: {rendererComparison?.activeFieldEmitterCount === undefined
            ? "n/a"
            : rendererComparison.artboardBoundsClipped ? "yes · edge feathered" : "no"}
        </div>
        <div>
          marks cap: {rendererComparison?.activeFieldEmitterCount === undefined
            ? "n/a"
            : rendererComparison.maxNodesClipped ? "clipped" : "not reached"}
        </div>
        <div style={{ overflowWrap: "anywhere" }}>
          cache emitters: {rendererComparison?.cacheEmitterKey ?? "n/a"}
        </div>
        <div style={{ overflowWrap: "anywhere" }}>
          marks/emitter: {rendererComparison?.renderedMarkCountPerEmitter
            ? JSON.stringify(rendererComparison.renderedMarkCountPerEmitter)
            : "n/a"}
        </div>
        {mapping?.emitterStrengths.length ? (
          <div style={{ overflowWrap: "anywhere" }}>
            effective strength: {mapping.emitterStrengths
              .map((entry) => `${entry.id}=${entry.effectiveStrength}`)
              .join(", ")}
          </div>
        ) : null}
        {rendererComparison?.emitterDomains?.map((emitter) => (
          <div key={emitter.id} style={{ borderTop: "1px dotted #3a4a1a", marginTop: 3, paddingTop: 3 }}>
            <div>{emitter.id}: anchor {emitter.anchorX.toFixed(1)}, {emitter.anchorY.toFixed(1)}</div>
            <div>weight {emitter.weight} · radius ×{emitter.radiusMultiplier}</div>
            <div>effective strength {emitter.effectiveStrength}</div>
            <div>effective {emitter.effectiveRadius.toFixed(1)} · sample {emitter.samplingRadius.toFixed(1)}</div>
            <div>
              bounds {emitter.bounds.minX.toFixed(0)},{emitter.bounds.minY.toFixed(0)}
              –{emitter.bounds.maxX.toFixed(0)},{emitter.bounds.maxY.toFixed(0)}
            </div>
            <div>samples {emitter.sampleCount} · marks {emitter.renderedMarkCount}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
