import { lazy, Suspense, type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Viewport } from "./components/Viewport";
import { createTimedSvg, download } from "./engine/exportSvg";
import { loadFontFile, validateLoadedFont, type LoadedFont } from "./engine/fontLoader";
import { layoutGlyphs } from "./engine/glyphLayout";
import { validateTextGeometry } from "./engine/glyphGeometry";
import { getSvgDiagnostics, reportSvgValidation, type SvgDiagnostics } from "./engine/svgValidation";
import { useAnimationClock } from "./hooks/useAnimationClock";
import type { ArtboardOverflowMode, PreviewDiagnostics, RenderContext } from "./types";
import { emitterGeometryKey } from "./engine/rendererRuntime";
import { getExportBudgetWarnings } from "./engine/exportBudget";
import { getSubstratePerformanceWarnings } from "./engine/performance";
import { getTextArtboardOverflowWarning } from "./engine/contourDomain";
import { NATIVE_TEXT_BOUNDS_WARNING } from "./engine/textBounds";
import { projectArtboard } from "./engine/artboard";
import { AUTO_GROW_ARTBOARD_WARNING } from "./engine/artboardExpansion";
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
import { useAutoGrowArtboard } from "./hooks/useAutoGrowArtboard";

const DevWebGpuFieldOverlay = import.meta.env.DEV
  ? lazy(() => import("./components/dev/WebGpuFieldOverlay").then(({ WebGpuFieldOverlay }) => ({ default: WebGpuFieldOverlay })))
  : null;
const DevPreviewPerformanceMeter = import.meta.env.DEV
  ? lazy(() => import("./components/dev/PreviewPerformanceMeter").then(({ PreviewPerformanceMeter }) => ({ default: PreviewPerformanceMeter })))
  : null;

export default function App() {
  recordPreviewAppRender();
  const { project: state, setProject: setState, importUnknown } = useProjectDocument();
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
  const [artboardOverflowMode, setArtboardOverflowMode] = useState<ArtboardOverflowMode>("clip");
  const [svgTraceConfig, setSvgTraceConfig] = useState<SvgTraceConfig>(DEFAULT_SVG_TRACE_CONFIG);
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const renderer = getRenderer(state.renderer);
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
  const textGeometryBuild = useTypographyGeometry(state, loadedFont);
  const textGeometry = textGeometryBuild.value;
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
      bounds: { x: 0, y: 0, width: state.artboard.width, height: state.artboard.height },
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
  }, [state, textGeometry, emitterGlyphs]);
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
      bounds: { x: 0, y: 0, width: state.artboard.width, height: state.artboard.height },
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
  }, [state, textGeometry, emitterGlyphs]);
  const substrateBuild = useSubstratePipeline(state, textGeometry);
  const emitterFieldKey = emitterGeometryKey(state, textGeometry);
  useEffect(() => setCanvasFailed(false), [state.renderer, previewSettings.backend]);

  const randomize = useCallback(() => {
    setState((current) => ({ ...current, seed: Math.floor(Math.random() * 1_000_000), preset: "Custom" }));
  }, [setState]);
  const handleCanvasFailure = useCallback(() => setCanvasFailed(true), []);
  const activeClockContext = canvasFlowActive && canvasSample ? canvasSample.context : context;
  const staticRenderContext: RenderContext = useMemo(
    () => createStaticRenderContext(state, textGeometry, substrateBuild.data),
    [state, textGeometry, substrateBuild.data]
  );
  const renderContext: RenderContext = useMemo(() => ({
    ...staticRenderContext,
    ...activeClockContext,
    textGeometry,
    substrateData: substrateBuild.data,
    viewport: projectArtboard(state),
  }), [activeClockContext, state, staticRenderContext, textGeometry, substrateBuild.data]);
  const {
    liveGeometry: geometry,
    exportContext,
    exportGeometry,
    estimateContext,
    estimateGeometry,
    geometrySummary,
  } = useRendererRuntime(state, renderContext, staticRenderContext);
  const textOverflowWarning = useMemo(
    () => getTextArtboardOverflowWarning(state, textGeometry),
    [state, textGeometry],
  );
  const autoGrowArtboard = useAutoGrowArtboard({
    mode: artboardOverflowMode,
    project: state,
    textGeometry,
    updateProject: setState,
  });
  const artboardExpansionPlan = autoGrowArtboard.plan;
  const displayedTextOverflowWarning = textOverflowWarning
    ? artboardOverflowMode === "clip"
      ? textOverflowWarning
      : autoGrowArtboard.pending
        ? null
        : autoGrowArtboard.failureReason
          ? AUTO_GROW_ARTBOARD_WARNING
          : null
    : null;
  const expandArtboardToText = useCallback(() => {
    if (!textOverflowWarning || !artboardExpansionPlan.available || !artboardExpansionPlan.changed) return;
    setState(artboardExpansionPlan.nextState);
  }, [artboardExpansionPlan, setState, textOverflowWarning]);
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
  // estimate geometry identity changes.
  const estimateExportKey = [
    state.exportMode,
    state.precision,
    state.overlayMode,
    state.textOverlayOpacity,
    state.edgeErosionAmount,
    state.edgeErosionWidth,
    state.interiorProtection,
    state.diffuserComposition,
    state.outlineWarpAmount,
    state.outlineWarpScale,
    state.outlineWarpSmoothing,
    state.outlineWarpEdgeBias,
    state.outlineWarpMaxDisplacement,
    state.preserveCounters,
  ].join("|");
  useEffect(() => {
    if (!state.debug.costEstimate) {
      setDiagnostics(null);
      return;
    }
    const timer = setTimeout(() => {
      const timed = createTimedSvg(state, estimateContext, textGeometry, estimateGeometry);
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
      setMessage(PREVIEW_ONLY_EXPORT_WARNING);
      return;
    }
    setExporting(true);
    requestAnimationFrame(() => {
      try {
    const filename = (state.text.trim() || "substrate").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-");
    const timed = createTimedSvg(state, exportContext, textGeometry, exportGeometry);
    const svg = timed.svg;
    const validation = reportSvgValidation(
      svg,
      Boolean(textGeometry?.hasOutlines) && state.exportMode === "artwork",
      state.exportMode === "artwork",
    );
    if (!validation.valid) {
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
    setMessage(exactWarnings.length > 0
      ? `Exported ${formatBytes(exactDiagnostics.byteSize)} in ${timed.serializationTimeMs.toFixed(1)} ms. ${exactWarnings.join(" ")}`
      : `SVG exported · ${formatBytes(exactDiagnostics.byteSize)} · ${timed.serializationTimeMs.toFixed(1)} ms.`);
      } catch (error) {
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
          <button className="export" disabled={exporting} onClick={exportSvg}>{exporting ? "Exporting…" : "Export SVG"} <span>↗</span></button>
        </div>
      </header>

      <div className="workspace">
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
          artboardOverflowMode={artboardOverflowMode}
          onArtboardOverflowModeChange={setArtboardOverflowMode}
          webGpuOverlayOpen={webGpuOverlayOpen}
          fpsMeterOpen={fpsMeterOpen}
          onToggleWebGpuOverlay={import.meta.env.DEV ? () => setWebGpuOverlayOpen((open) => !open) : undefined}
          onToggleFpsMeter={import.meta.env.DEV ? () => setFpsMeterOpen((open) => !open) : undefined}
        />
        <section className="viewport-shell">
          <CanvasNavigation>
            <Viewport
            state={state}
            context={renderContext}
            geometry={geometry}
            textGeometry={textGeometry}
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
            artboardExpansionPlan={artboardOverflowMode === "clip" && textOverflowWarning ? artboardExpansionPlan : null}
            onExpandArtboardToText={expandArtboardToText}
            svgTraceConfig={activeSvgTraceConfig}
          />
          </CanvasNavigation>
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
