import { lazy, Profiler, Suspense, type ChangeEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Viewport } from "./components/Viewport";
import { createTimedSvg, createTimedSvgFromSnapshot, download } from "./engine/exportSvg";
import { loadFontFile, validateLoadedFont, type LoadedFont } from "./engine/fontLoader";
import { layoutGlyphs } from "./engine/glyphLayout";
import { validateTextGeometry } from "./engine/glyphGeometry";
import { getSvgDiagnostics, reportSvgValidation, type SvgDiagnostics } from "./engine/svgValidation";
import { useAnimationClock } from "./hooks/useAnimationClock";
import type { PreviewDiagnostics, RenderContext } from "./types";
import { emitterGeometryKey } from "./engine/rendererRuntime";
import { getExportBudgetWarnings } from "./engine/exportBudget";
import { getSubstratePerformanceWarnings } from "./engine/performance";
import { getTextArtboardOverflowWarning } from "./engine/contourDomain";
import { NATIVE_TEXT_BOUNDS_WARNING } from "./engine/textBounds";
import { artboardViewport } from "./engine/artboard";
import { SCENE_SAFETY_LIMIT_WARNING } from "./engine/sceneLayout";
import { getRenderer } from "./engine/renderers";
import { requestedMarkCount } from "./engine/renderers/types";
import { selectPreviewBackend, shouldRunPreviewAnimation } from "./engine/previewBackend";
import type { CanvasPreviewSample } from "./components/CanvasFlowPreview";
import { getGlyphEmitterAnchor, getGlyphEmitterMetadata, resolveEmitterGlyph, resolveGlyphEmitterSources } from "./engine/field/glyphEmitters";
import { createStaticRenderContext } from "./engine/renderContextLifecycle";
import type { DevWebGpuAppFieldSnapshot } from "./engine/gpu/webgpuAppFieldPreviewAdapter";
import { CanvasNavigation } from "./components/CanvasNavigation";
import { PREVIEW_ONLY_EXPORT_WARNING, presetExportKinds } from "./engine/presetExportability";
import { recordPreviewAppRender } from "./engine/previewRuntimeDiagnostics";
import { DEFAULT_SVG_TRACE_CONFIG, traceConfigForPreviewQuality, type SvgTraceConfig } from "./engine/previewTraceConfig";
import { useProjectDocument, serializeProjectDocument } from "./hooks/useProjectDocument";
import { usePreviewSettings } from "./hooks/usePreviewSettings";
import { useDiagnosticsState } from "./hooks/useDiagnosticsState";
import { useTypographyGeometry } from "./hooks/useTypographyGeometry";
import { useSubstratePipeline } from "./hooks/useSubstratePipeline";
import { useExportController } from "./hooks/useExportController";
import { useRendererRuntime } from "./hooks/useRendererRuntime";
import { useSceneLayout } from "./hooks/useSceneLayout";
import { resolveSizeDraftSceneLayout } from "./engine/sizeDraftScene";
import { sizeDisplayFontSize, sizeIsInteracting } from "./engine/sizePresentation";
import { useSizeInteraction } from "./hooks/useSizeInteraction";
import {
  captureExportSnapshot,
  documentKey,
  rendererInputKey,
  resolveExportReadiness,
  resolveFontResolution,
  typographyInputKey,
  typographyOutputKey,
} from "./engine/exportAuthority";
import { APP_VERSION } from "./engine/constants";
import { resolveRendererRequirements } from "./engine/rendererRequirements";
import { staticRenderContextStageKey } from "./engine/pipelineStageKeys";
import { tracePipelineRequirements } from "./engine/pipelineTrace";

import { activeTraceGestureId, interactionTraceEnabled, traceEvent, traceKey, traceStartSpan } from "./dev/interactionTrace";

const DevWebGpuFieldOverlay = import.meta.env.DEV
  ? lazy(() => import("./components/dev/WebGpuFieldOverlay").then(({ WebGpuFieldOverlay }) => ({ default: WebGpuFieldOverlay })))
  : null;
const DevPreviewPerformanceMeter = import.meta.env.DEV
  ? lazy(() => import("./components/dev/PreviewPerformanceMeter").then(({ PreviewPerformanceMeter }) => ({ default: PreviewPerformanceMeter })))
  : null;

function recordReactCommit(
  id: string,
  phase: "mount" | "update" | "nested-update",
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) {
  traceEvent({
    stage: "react.commit",
    phase: "instant",
    gestureId: activeTraceGestureId(),
    durationMs: actualDuration,
    counts: { commit: 1 },
    detail: { profilerId: id, commitPhase: phase, actualDuration, baseDuration, startTime, commitTime },
  });
}

export default function App() {
  recordPreviewAppRender();
  const { project: state, setProject: setState, importUnknown } = useProjectDocument();
  const commitFontSize = useCallback((fontSize: number) => {
    setState((current) => (current.fontSize === fontSize ? current : { ...current, fontSize }));
  }, [setState]);
  const { state: sizeInteraction, handlers: sizeHandlers, completeSettlement } = useSizeInteraction(
    state.fontSize,
    state.renderer,
    commitFontSize,
  );
  const [playing, setPlaying] = useState(true);
  const { exporting, setExporting } = useExportController();
  const [previewSettings, setPreviewSettings] = usePreviewSettings();
  const [message, setMessage] = useState("");
  const [loadedFont, setLoadedFont] = useState<LoadedFont | null>(null);
  const [canvasSample, setCanvasSample] = useState<CanvasPreviewSample | null>(null);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const diagnosticsState = useDiagnosticsState();
  const [diagnostics, setDiagnostics] = useState<SvgDiagnostics | null>(null);
  const [webGpuOverlayOpen, setWebGpuOverlayOpen] = useState(false);
  const [fpsMeterOpen, setFpsMeterOpen] = useState(false);
  const [svgTraceConfig, setSvgTraceConfig] = useState<SvgTraceConfig>(DEFAULT_SVG_TRACE_CONFIG);
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const renderer = getRenderer(state.renderer);
  const pipelineRequirements = useMemo(() => resolveRendererRequirements(state.renderer), [state.renderer]);
  useEffect(() => {
    tracePipelineRequirements(state.renderer, pipelineRequirements);
  }, [pipelineRequirements, state.renderer]);
  const selectedPreviewBackend = selectPreviewBackend(state.renderer, requestedMarkCount(state), previewSettings.backend, !canvasFailed);
  const canvasFlowActive = selectedPreviewBackend === "canvas-2d";
  const previewAnimationRunning = shouldRunPreviewAnimation(renderer.usesTime, playing, previewSettings.reducedMotion, exporting);
  const qualityTraceConfig = traceConfigForPreviewQuality(previewSettings.quality);
  const activeSvgTraceConfig = import.meta.env.DEV && svgTraceConfig.mode !== "normal"
    ? svgTraceConfig
    : qualityTraceConfig;
  const clockRunning = previewAnimationRunning && !canvasFlowActive && activeSvgTraceConfig.mode !== "local-clock";
  const { context, diagnostics: clockDiagnostics, reset } = useAnimationClock(
    clockRunning,
    previewSettings.fpsCap,
    previewSettings.pauseWhenHidden,
  );
  const fontResolution = useMemo(() => resolveFontResolution(state, loadedFont), [state, loadedFont]);
  const activeTypographyInputKey = useMemo(
    () => typographyInputKey(state, fontResolution.resourceKey ?? "font:missing"),
    [state, fontResolution.resourceKey],
  );
  const textGeometryBuild = useTypographyGeometry(state, fontResolution.loadedFont);
  const textGeometry = textGeometryBuild.value;
  // The single production scene authority. Pure: no document writes back.
  // Determines canonical typography placement (authored center + user offset)
  // and the symmetric effective artboard rect (origin-aware). Replaces the
  // previous automatic artboard-growth mutation hook entirely.
  const sceneLayout = useSceneLayout(state, textGeometry);
  const sizeDraftFontSize = sizeInteraction.phase === "dragging" ? sizeInteraction.draftSize : null;
  const sizeDraftSceneLayout = useMemo(() => (
    sizeDraftFontSize === null
      ? null
      : resolveSizeDraftSceneLayout(state, sizeDraftFontSize, textGeometry)
  ), [sizeDraftFontSize, state, textGeometry]);
  const activeTypographyOutputKey = useMemo(
    () => typographyOutputKey(activeTypographyInputKey, fontResolution, textGeometry),
    [activeTypographyInputKey, fontResolution, textGeometry],
  );
  const emitterGlyphs = useMemo(() => getGlyphEmitterMetadata(state, textGeometry), [state, textGeometry]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const multiple = resolveGlyphEmitterSources(state, textGeometry);
    const singleGlyph = resolveEmitterGlyph(emitterGlyphs, state.emitter.glyphId);
    const snapshot: DevWebGpuAppFieldSnapshot = {
      project: {
        ...state,
        emitter: { ...state.emitter },
        emitters: state.emitters.map((emitter) => ({ ...emitter })),
      },
      bounds: { x: sceneLayout.effectiveArtboard.x, y: sceneLayout.effectiveArtboard.y, width: sceneLayout.effectiveArtboard.width, height: sceneLayout.effectiveArtboard.height },
      singleAnchor: singleGlyph
        ? getGlyphEmitterAnchor(singleGlyph, state.emitter.sourceMode, {
            x: state.emitter.customX,
            y: state.emitter.customY,
          })
        : null,
      resolvedEmitterAnchors: multiple.sources.map((source) => ({
        id: source.id,
        x: source.anchor.x,
        y: source.anchor.y,
      })),
    };
    const devGlobal = globalThis as typeof globalThis & {
      __SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__?: () => DevWebGpuAppFieldSnapshot;
    };
    const getter = () => snapshot;
    devGlobal.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__ = getter;
    return () => {
      if (devGlobal.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__ === getter) {
        delete devGlobal.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__;
      }
    };
  }, [state, textGeometry, emitterGlyphs, sceneLayout.effectiveArtboard]);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl/Cmd + Shift + G toggles the dev WebGPU field overlay.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === "g" || event.key === "G")) {
        event.preventDefault();
        setWebGpuOverlayOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setState]);
  const getWebGpuDevSnapshot = useCallback(() => {
    const multiple = resolveGlyphEmitterSources(state, textGeometry);
    const singleGlyph = resolveEmitterGlyph(emitterGlyphs, state.emitter.glyphId);
    const snapshot: DevWebGpuAppFieldSnapshot = {
      project: {
        ...state,
        emitter: { ...state.emitter },
        emitters: state.emitters.map((emitter) => ({ ...emitter })),
      },
      bounds: { x: sceneLayout.effectiveArtboard.x, y: sceneLayout.effectiveArtboard.y, width: sceneLayout.effectiveArtboard.width, height: sceneLayout.effectiveArtboard.height },
      singleAnchor: singleGlyph
        ? getGlyphEmitterAnchor(singleGlyph, state.emitter.sourceMode, {
            x: state.emitter.customX,
            y: state.emitter.customY,
          })
        : null,
      resolvedEmitterAnchors: multiple.sources.map((source) => ({
        id: source.id,
        x: source.anchor.x,
        y: source.anchor.y,
      })),
    };
return snapshot;
  }, [state, textGeometry, emitterGlyphs, sceneLayout.effectiveArtboard]);
  const substrateBuild = useSubstratePipeline(state, textGeometry, activeTypographyOutputKey, sceneLayout.effectiveArtboard);
  const emitterFieldKey = emitterGeometryKey(state, textGeometry);
  useEffect(() => setCanvasFailed(false), [state.renderer, previewSettings.backend]);

  const randomize = useCallback(() => {
    setState((current) => ({ ...current, seed: Math.floor(Math.random() * 1_000_000), preset: "Custom" }));
  }, [setState]);
  const handleCanvasFailure = useCallback(() => setCanvasFailed(true), []);
  const activeClockContext = canvasFlowActive && canvasSample ? canvasSample.context : context;
  const staticContextInputKey = useMemo(
    () => staticRenderContextStageKey(
      state.renderer,
      pipelineRequirements,
      sceneLayout.key,
      activeTypographyOutputKey,
      substrateBuild.outputKey,
    ),
    [activeTypographyOutputKey, pipelineRequirements, sceneLayout.key, state.renderer, substrateBuild.outputKey],
  );
  const staticRenderContext: RenderContext = useMemo(
    () => createStaticRenderContext(
      state,
      textGeometry,
      pipelineRequirements.substrate ? substrateBuild.data : null,
      sceneLayout.effectiveArtboard,
      pipelineRequirements,
      activeTypographyOutputKey,
      pipelineRequirements.substrate ? substrateBuild.outputKey : null,
    ),
    // Static context rebuilds only when focused semantic inputs change.
    // `staticContextInputKey` already covers renderer, scene, typography and
    // substrate identities; `effectiveArtboard` is the remaining spatial input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [staticContextInputKey, sceneLayout.effectiveArtboard],
  );
  const effectiveArtboardViewport = useMemo(
    () => artboardViewport(sceneLayout.effectiveArtboard),
    [sceneLayout.effectiveArtboard],
  );
  const renderContext: RenderContext = useMemo(() => ({
    ...staticRenderContext,
    ...activeClockContext,
    textGeometry,
    substrateData: substrateBuild.data,
    viewport: effectiveArtboardViewport,
  }), [activeClockContext, effectiveArtboardViewport, staticRenderContext, textGeometry, substrateBuild.data]);
  const {
    liveGeometry: geometry,
    estimateContext,
    estimateGeometry,
    geometrySummary,
  } = useRendererRuntime(state, renderContext, staticRenderContext);
  const textOverflowWarning = useMemo(
    () => getTextArtboardOverflowWarning(state, textGeometry),
    [state, textGeometry],
  );
  const capturedExportContext = useMemo(() => state.exportFrameMode === "time-zero"
    ? { mode: "time-zero" as const, timeMs: 0, frame: 0 }
    : { mode: "current" as const, timeMs: activeClockContext.timeMs, frame: activeClockContext.frame },
  [activeClockContext.frame, activeClockContext.timeMs, state.exportFrameMode]);
  const activeRendererInputKey = useMemo(
    () => activeTypographyOutputKey
      ? rendererInputKey(state, activeTypographyOutputKey, substrateBuild.outputKey, capturedExportContext)
      : "renderer-input:typography-pending",
    [activeTypographyOutputKey, capturedExportContext, state, substrateBuild.outputKey],
  );
  useLayoutEffect(() => {
    if (!interactionTraceEnabled) return;
    traceEvent({
      stage: "react.commit",
      phase: "instant",
      gestureId: activeTraceGestureId(),
      counts: { commit: 1 },
      detail: {
        profilerId: "commit-observer",
        commitPhase: "commit",
        actualDuration: null,
        baseDuration: null,
        durationAvailable: false,
      },
    });
  }, [activeRendererInputKey, geometry.id, previewSettings.backend, state.renderer, substrateBuild.outputKey]);
  const rendererGeometryKey = activeTypographyOutputKey && (!renderer.usesSubstrate || substrateBuild.outputKey === substrateBuild.inputKey)
    ? activeRendererInputKey
    : null;
  const baseExportReadiness = useMemo(() => resolveExportReadiness({
    font: fontResolution,
    typographyInputKey: activeTypographyInputKey,
    typographyOutputKey: activeTypographyOutputKey,
    substrateInputKey: substrateBuild.inputKey,
    substrateOutputKey: substrateBuild.outputKey,
    substrateData: substrateBuild.data,
    rendererInputKey: activeRendererInputKey,
    // Renderer generation is synchronous and recreated from the same input in the
    // snapshot. Stale substrate is rejected before this stage can become current.
    rendererGeometryKey,
    sceneSafetyLimitHit: sceneLayout.safetyLimitHit,
    failureReason: substrateBuild.error,
    renderer: state.renderer,
  }), [activeRendererInputKey, activeTypographyInputKey, activeTypographyOutputKey, fontResolution, renderer.usesSubstrate, sceneLayout.safetyLimitHit, state.renderer, substrateBuild.data, substrateBuild.error, substrateBuild.inputKey, substrateBuild.outputKey, rendererGeometryKey]);
  const sizeExactReady = baseExportReadiness.status === "ready" || baseExportReadiness.status === "scene-safety-limit";
  const exportReadiness = useMemo(() => {
    if (sizeIsInteracting(sizeInteraction)) {
      return {
        status: "size-interaction-pending" as const,
        reason: "Preparing export… size interaction active.",
        technicalReason: `Size interaction phase: ${sizeInteraction.phase}.`,
      };
    }
    return baseExportReadiness;
  }, [baseExportReadiness, sizeInteraction]);
  useEffect(() => {
    if (sizeInteraction.phase !== "settling") return;
    if (state.fontSize !== sizeInteraction.committedSize) return;
    // A substrate failure during settling must not leave the UI stuck in
    // "Preparing export…" forever. Drop out of settling so the real failed
    // readiness state becomes visible.
    if (substrateBuild.error) {
      completeSettlement();
      return;
    }
    if (!sizeExactReady) return;
    completeSettlement();
  }, [completeSettlement, sizeExactReady, sizeInteraction, state.fontSize, substrateBuild.error]);
  const previousReadinessRef = useRef<string | null>(null);
  useEffect(() => {
    const marker = [
      exportReadiness.status,
      exportReadiness.technicalReason,
      activeTypographyOutputKey,
      substrateBuild.outputKey,
      activeRendererInputKey,
    ].join("|");
    if (previousReadinessRef.current === marker) return;
    previousReadinessRef.current = marker;
    traceEvent({
      stage: "export.readiness",
      phase: "instant",
      inputKey: activeRendererInputKey,
      outputKey: exportReadiness.status === "ready" ? activeRendererInputKey : undefined,
      detail: {
        status: exportReadiness.status,
        reason: exportReadiness.reason,
        technicalReason: exportReadiness.technicalReason,
      },
    });
    if (exportReadiness.status === "ready") {
      traceEvent({
        stage: "export.exact-visible",
        phase: "instant",
        outputKey: activeRendererInputKey,
        frameKey: geometry.id,
        detail: { status: "ready", exactVisible: true },
      });
      traceEvent({ stage: "export.ready", phase: "instant", outputKey: activeRendererInputKey, detail: { status: "ready" } });
    }
  }, [activeRendererInputKey, activeTypographyOutputKey, exportReadiness.reason, exportReadiness.status, exportReadiness.technicalReason, geometry.id, substrateBuild.outputKey]);
const displayedTextOverflowWarning = textOverflowWarning
    && sceneLayout.safetyLimitHit
      ? SCENE_SAFETY_LIMIT_WARNING
      : null;
  const exportWarnings = useMemo(() => [
    ...getExportBudgetWarnings({
      ...geometrySummary,
      substrateType: textGeometry?.hasOutlines ? "glyph-paths" : "native-text",
    }),
    ...(displayedTextOverflowWarning ? [displayedTextOverflowWarning] : []),
    ...(!textGeometry?.hasOutlines ? [NATIVE_TEXT_BOUNDS_WARNING] : []),
  ], [displayedTextOverflowWarning, geometrySummary, textGeometry]);
  const performanceWarnings = useMemo(
    () => substrateBuild.data
      ? getSubstratePerformanceWarnings(substrateBuild.data.diagnostics.buildTimeMs, state.substrateQuality)
      : [],
    [state.substrateQuality, substrateBuild.data],
  );
  // Serialization + DOMParser only run when the runtime boundary's cached
  // estimate geometry identity changes. Derive the key from the same readiness
  // inputs so it never drifts from the real export gate.
  const estimateExportKey = useMemo(() => rendererInputKey(
    state,
    activeTypographyOutputKey ?? "typography-pending",
    renderer.usesSubstrate ? (substrateBuild.outputKey ?? "substrate-pending") : null,
    estimateContext,
  ), [state, activeTypographyOutputKey, renderer.usesSubstrate, substrateBuild.outputKey, estimateContext]);
  useEffect(() => {
    if (!state.debug.costEstimate) {
      setDiagnostics(null);
      return;
    }
    const timer = setTimeout(() => {
      const timed = createTimedSvg(state, estimateContext, textGeometry, estimateGeometry, undefined, sceneLayout.effectiveArtboard);
      setDiagnostics(getSvgDiagnostics(timed.svg, timed.serializationTimeMs));
    }, 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.debug.costEstimate, estimateGeometry, estimateContext, textGeometry, estimateExportKey]);
  const previewDiagnostics: PreviewDiagnostics = useMemo(() => ({
    estimatedFps: canvasFlowActive && canvasSample ? canvasSample.estimatedFps : clockDiagnostics.estimatedFps,
    frameTimeMs: canvasFlowActive && canvasSample ? canvasSample.frameTimeMs : clockDiagnostics.frameTimeMs,
    timingValidity: canvasFlowActive && canvasSample ? canvasSample.timingValidity : clockDiagnostics.timingValidity,
    clockState: exporting
      ? "exporting"
      : previewSettings.reducedMotion
        ? "reduced-motion"
        : clockDiagnostics.hidden && previewSettings.pauseWhenHidden
          ? "hidden"
          : !renderer.usesTime
            ? "static"
            : playing
              ? "running"
              : "paused",
  }), [canvasFlowActive, canvasSample, clockDiagnostics, exporting, playing, previewSettings.pauseWhenHidden, previewSettings.reducedMotion, renderer.usesTime]);
  const exportSvg = () => {
    if (state.exportMode === "artwork" && presetExportKinds[state.preset] === "preview-only") {
      traceEvent({ stage: "export.request", phase: "instant", detail: { status: "preview-only" } });
      setMessage(PREVIEW_ONLY_EXPORT_WARNING);
      return;
    }
    if (exportReadiness.status !== "ready") {
      traceEvent({ stage: "export.request", phase: "instant", detail: { status: exportReadiness.status, reason: exportReadiness.reason } });
      setMessage(exportReadiness.reason);
      return;
    }
    // Capture every authoritative input before yielding to presentation work.
    // The later serializer receives only this immutable, CPU-generated snapshot.
    let snapshot;
    const snapshotTrace = traceStartSpan("export.snapshot.capture", {
      inputKey: activeRendererInputKey,
      detail: { documentKey: interactionTraceEnabled ? traceKey(state) : null, renderer: state.renderer },
    });
    try {
snapshot = captureExportSnapshot({
        state,
        documentKey: documentKey(state),
        font: fontResolution,
        typographyInputKey: activeTypographyInputKey,
        typographyOutputKey: activeTypographyOutputKey!,
        typographyGeometry: textGeometry,
        substrateInputKey: substrateBuild.inputKey,
        substrateOutputKey: substrateBuild.outputKey,
        substrateData: substrateBuild.data,
        context: capturedExportContext,
        appVersion: APP_VERSION,
        authoredArtboard: sceneLayout.authoredArtboard,
        effectiveArtboard: sceneLayout.effectiveArtboard,
        sceneLayoutKey: sceneLayout.key,
        typographyPlacementKey: sceneLayout.typography.key,
      });
      snapshotTrace({
        outputKey: snapshot.renderer.geometryKey,
        frameKey: snapshot.renderer.geometry.id,
        counts: { geometryNodes: snapshot.renderer.geometry.geometries.length },
        detail: { captured: true },
      });
    } catch (error) {
      snapshotTrace({ detail: { captured: false, error: error instanceof Error ? error.message : String(error) } });
      setMessage(error instanceof Error ? error.message : "Export snapshot could not be captured.");
      return;
    }
    traceEvent({ stage: "export.request", phase: "instant", inputKey: activeRendererInputKey, detail: { status: "ready" } });
    setExporting(true);
    requestAnimationFrame(() => {
      const serializationTrace = traceStartSpan("export.serialize", { inputKey: snapshot.renderer.inputKey });
      try {
    const filename = (state.text.trim() || "substrate").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
    const timed = createTimedSvgFromSnapshot(snapshot);
      const svg = timed.svg;
    const validation = reportSvgValidation(
      svg,
      Boolean(textGeometry?.hasOutlines) && state.exportMode === "artwork",
      state.exportMode === "artwork",
    );
      if (!validation.valid) {
        serializationTrace({ detail: { valid: false, error: validation.errors.join(" ") } });
        setMessage(validation.errors.join(" "));
        return;
      }
    download(svg, `${filename}.svg`, "image/svg+xml");
    const exactDiagnostics = getSvgDiagnostics(svg, timed.serializationTimeMs);
      const exactWarnings = [
      ...getExportBudgetWarnings({
        ...geometrySummary,
        substrateType: textGeometry?.hasOutlines ? "glyph-paths" : "native-text",
        exactByteSize: exactDiagnostics.byteSize,
      }),
      ...(displayedTextOverflowWarning ? [displayedTextOverflowWarning] : []),
      ...(!textGeometry?.hasOutlines ? [NATIVE_TEXT_BOUNDS_WARNING] : []),
      ];
      serializationTrace({ bytes: { svg: exactDiagnostics.byteSize }, detail: { valid: true, exactVisible: true } });
    setMessage(exactWarnings.length > 0
      ? `Exported ${formatBytes(exactDiagnostics.byteSize)} in ${timed.serializationTimeMs.toFixed(1)} ms. ${exactWarnings.join(" ")}`
      : `SVG exported · ${formatBytes(exactDiagnostics.byteSize)} · ${timed.serializationTimeMs.toFixed(1)} ms.`);
      } catch (error) {
        serializationTrace({ detail: { valid: false, error: error instanceof Error ? error.message : String(error) } });
        setMessage(error instanceof Error ? error.message : "SVG export failed.");
      } finally {
        setExporting(false);
      }
    });
  };
  const exportJson = () => download(serializeProjectDocument(state), "substrate-project.json", "application/json");
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { project, warnings } = importUnknown(JSON.parse(await file.text()));
      setLoadedFont(null);
      reset();
      const fontWarning = project.font ? `Re-upload ${project.font.fileName} to restore glyph outlines.` : "";
      setMessage([...warnings, fontWarning].filter(Boolean).join(" "));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That file is not a valid SUBSTRATE project.");
    }
    event.target.value = "";
  };
  const uploadFont = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setMessage("Loading font engineâ€¦");
    try {
      const loaded = await loadFontFile(file);
      if (!validateLoadedFont(loaded)) throw new Error("The parsed font did not pass validation.");
      const geometry = layoutGlyphs({ ...state, font: loaded.metadata }, loaded);
      const validation = state.text ? validateTextGeometry(geometry) : { valid: true };
      if (!validation.valid) throw new Error("The font loaded, but valid glyph outlines could not be produced for the current text.");
      setLoadedFont(loaded);
      setState({ ...state, font: loaded.metadata });
      reset();
      setMessage(`${loaded.metadata.fullName} loaded · ${loaded.font.glyphs.length} glyphs.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The font could not be loaded.");
    }
    event.target.value = "";
  };
  const clearFont = () => {
    setLoadedFont(null);
    setState({ ...state, font: null });
    reset();
    setMessage("Custom font cleared. Native SVG text fallback is active.");
  };

  return (
    <main>
      <header className="header">
        <div className="brand"><span className="brand-mark" aria-hidden="true" /><strong>SUBSTRATE</strong><small>TYPE / FIELD STUDY 001</small></div>
        <div className="header-actions">
          <button className="quiet" onClick={exportJson}>Save project</button>
          <button className="export" disabled={exporting || exportReadiness.status !== "ready"} onClick={exportSvg} title={exportReadiness.reason}>{exporting ? "Exporting…" : exportReadiness.status === "ready" ? "Export SVG" : "Preparing export…"} <span>↗</span></button>
        </div>
      </header>

      <div className="workspace">
        <Profiler id="Size/control pane" onRender={recordReactCommit}>
          <Controls
            state={state}
            setState={setState}
            fileRef={fileRef}
            onImport={importJson}
            fontFileRef={fontFileRef}
            onFontUpload={uploadFont}
            onClearFont={clearFont}
            fontLoaded={Boolean(loadedFont)}
            parsedFontPathsAvailable={Boolean(textGeometry?.hasOutlines)}
            previewSettings={previewSettings}
            onPreviewSettingsChange={setPreviewSettings}
            emitterGlyphs={emitterGlyphs}
            textGeometry={textGeometry}
            diagnosticsMode={diagnosticsState.mode}
            onDiagnosticsModeChange={diagnosticsState.setMode}
            webGpuOverlayOpen={webGpuOverlayOpen}
            fpsMeterOpen={fpsMeterOpen}
            onToggleWebGpuOverlay={import.meta.env.DEV ? () => setWebGpuOverlayOpen((open) => !open) : undefined}
            onToggleFpsMeter={import.meta.env.DEV ? () => setFpsMeterOpen((open) => !open) : undefined}
            sizeDisplayFontSize={sizeDisplayFontSize(sizeInteraction)}
            sizeHandlers={sizeHandlers}
          />
        </Profiler>
        <section className="viewport-shell">
          <Profiler id="artwork/Viewport" onRender={recordReactCommit}>
            <CanvasNavigation>
<Viewport
              state={state}
              context={renderContext}
              geometry={geometry}
              textGeometry={textGeometry}
              sceneLayout={sceneLayout}
              exportDiagnostics={diagnostics}
              exportWarnings={exportWarnings}
              performanceWarnings={performanceWarnings}
              glyphLayoutTimeMs={textGeometryBuild.durationMs}
              substrateError={substrateBuild.error}
              substrateBackendStatus={substrateBuild.status}
              previewDiagnostics={previewDiagnostics}
              previewBackend={selectedPreviewBackend}
              previewSettings={previewSettings}
              previewRunning={previewAnimationRunning}
              canvasSample={canvasSample}
              onCanvasSample={setCanvasSample}
              onCanvasFailure={handleCanvasFailure}
              diagnosticsMode={diagnosticsState.mode}
              svgTraceConfig={activeSvgTraceConfig}
              sizeInteraction={sizeInteraction}
              sizeDraftSceneLayout={sizeDraftSceneLayout}
              sizeExactReady={sizeExactReady}
            />
            </CanvasNavigation>
          </Profiler>
          <div className="transport">
            <button className="play" aria-label={playing ? "Pause animation" : "Play animation"} onClick={() => setPlaying(!playing)}>{playing ? "Ⅱ" : "▶"}</button>
            <button onClick={reset}>Reset</button>
            <button onClick={randomize}>Randomize seed</button>
            <span className="seed">SEED <strong>{String(state.seed).padStart(6, "0")}</strong></span>
            <span className="status"><i /> {previewDiagnostics.clockState.replace("-", " ").toUpperCase()}</span>
          </div>
          {message && <p className="error" role="status">{message}</p>}
        </section>
      </div>
      {import.meta.env.DEV && (
        <>
          {webGpuOverlayOpen && DevWebGpuFieldOverlay && (
            <Suspense fallback={null}><DevWebGpuFieldOverlay
              getSnapshot={getWebGpuDevSnapshot}
              rendererComparison={{
                activeFieldEmitterCount: geometry.diagnostics?.rendererActiveFieldEmitterCount,
                consumedFieldMode: geometry.diagnostics?.consumedFieldMode,
                cacheEmitterKey: emitterFieldKey,
                renderedMarkCountPerEmitter: geometry.diagnostics?.renderedMarkCountPerEmitter,
                normalizationMode: geometry.diagnostics?.fieldNormalizationMode,
                emitterDomains: geometry.diagnostics?.emitterDomainDiagnostics,
                artboardBoundsClipped: geometry.diagnostics?.artboardBoundsClipped,
                maxNodesClipped: geometry.diagnostics?.maxNodesClipped,
                activeContributingEmitterCount: geometry.diagnostics?.activeContributingEmitterCount,
                zeroStrengthEmitterCount: geometry.diagnostics?.zeroStrengthEmitterCount,
              }}
              onClose={() => setWebGpuOverlayOpen(false)}
            /></Suspense>
          )}
          {fpsMeterOpen && DevPreviewPerformanceMeter && (
            <Suspense fallback={null}><DevPreviewPerformanceMeter
              state={state}
              context={renderContext}
              fpsCap={previewSettings.fpsCap}
              onFpsCapChange={(fpsCap) => setPreviewSettings((current) => ({ ...current, fpsCap }))}
              traceConfig={activeSvgTraceConfig}
              onTraceConfigChange={setSvgTraceConfig}
              onClose={() => setFpsMeterOpen(false)}
            /></Suspense>
          )}
        </>
      )}
    </main>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
