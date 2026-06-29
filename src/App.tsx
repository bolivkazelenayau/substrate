import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controls } from "./components/Controls";
import { Viewport } from "./components/Viewport";
import { baseState } from "./engine/presets";
import { createTimedSvg, download } from "./engine/exportSvg";
import { validateProject } from "./engine/projectSchema";
import { loadFontFile, validateLoadedFont, type LoadedFont } from "./engine/fontLoader";
import { layoutGlyphs } from "./engine/glyphLayout";
import { validateTextGeometry } from "./engine/glyphGeometry";
import { getSvgDiagnostics, reportSvgValidation, type SvgDiagnostics } from "./engine/svgValidation";
import { SUBSTRATE_RESOLUTIONS } from "./engine/substrate";
import { getTextBounds, getTextLayout } from "./engine/textLayout";
import { VIEWPORT } from "./engine/constants";
import { useAnimationClock } from "./hooks/useAnimationClock";
import type { PreviewDiagnostics, PreviewSettings, ProjectState, RenderContext } from "./types";
import { emitterGeometryKey, generateRendererGeometry, summarizeGeometry } from "./engine/rendererRuntime";
import { getExportBudgetWarnings } from "./engine/exportBudget";
import { getSubstratePerformanceWarnings, measure } from "./engine/performance";
import { useSubstrateBackend } from "./hooks/useSubstrateBackend";
import { getRenderer } from "./engine/renderers";
import { requestedMarkCount } from "./engine/renderers/types";
import { DEFAULT_PREVIEW_FPS_CAP, selectPreviewBackend, shouldRunPreviewAnimation } from "./engine/previewBackend";
import type { CanvasPreviewSample } from "./components/CanvasFlowPreview";
import { getGlyphEmitterMetadata } from "./engine/field/glyphEmitters";
import { buildCompositeWaveField, createGlyphFieldContext } from "./engine/field/compositeWaveField";

export default function App() {
  const [state, setState] = useState<ProjectState>(baseState);
  const [playing, setPlaying] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [previewSettings, setPreviewSettings] = useState<PreviewSettings>(() => ({
    fpsCap: DEFAULT_PREVIEW_FPS_CAP,
    pauseWhenHidden: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    backend: "auto",
  }));
  const [message, setMessage] = useState("");
  const [loadedFont, setLoadedFont] = useState<LoadedFont | null>(null);
  const [canvasSample, setCanvasSample] = useState<CanvasPreviewSample | null>(null);
  const [canvasFailed, setCanvasFailed] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);
  const [diagnostics, setDiagnostics] = useState<SvgDiagnostics | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const renderer = getRenderer(state.renderer);
  const selectedPreviewBackend = selectPreviewBackend(state.renderer, requestedMarkCount(state), previewSettings.backend, !canvasFailed);
  const canvasFlowActive = selectedPreviewBackend === "canvas-2d";
  const previewAnimationRunning = shouldRunPreviewAnimation(renderer.usesTime, playing, previewSettings.reducedMotion, exporting);
  const clockRunning = previewAnimationRunning && !canvasFlowActive;
  const { context, diagnostics: clockDiagnostics, reset } = useAnimationClock(
    clockRunning,
    previewSettings.fpsCap,
    previewSettings.pauseWhenHidden,
  );
  const textGeometryBuild = useMemo(
    () => measure(() => loadedFont ? layoutGlyphs(state, loadedFont) : null),
    [state.text, state.fontSize, state.tracking, state.precision, state.kerningMode, state.kerningStrength, state.opticalSpacing, state.opticalSpacingStrength, state.textAlign, state.textOffsetY, loadedFont],
  );
  const textGeometry = textGeometryBuild.value;
  const emitterGlyphs = useMemo(() => getGlyphEmitterMetadata(state, textGeometry), [state.text, state.fontSize, state.tracking, textGeometry]);
  const substrateInput = useMemo(() => {
    const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));
    return {
      sourceText: state.text,
      textGeometry,
      fontSize: state.fontSize,
      tracking: state.tracking,
      fontFamily: layout.fontFamily,
      fontWeight: layout.fontWeight,
      baselineY: layout.baselineY,
      textX: layout.x,
      kerningMode: state.kerningMode,
      resolution: SUBSTRATE_RESOLUTIONS[state.substrateQuality],
      bounds: textGeometry?.bounds ?? getTextBounds(state),
    };
  }, [state.text, state.fontSize, state.tracking, state.font, state.substrateQuality, state.kerningMode, state.textAlign, state.textOffsetY, textGeometry]);
  const substrateBuild = useSubstrateBackend(substrateInput);
  const emitterFieldKey = emitterGeometryKey(state, textGeometry);
  useEffect(() => setCanvasFailed(false), [state.renderer, previewSettings.backend]);

  const randomize = useCallback(() => {
    setState((current) => ({ ...current, seed: Math.floor(Math.random() * 1_000_000), preset: "Custom" }));
  }, []);
  const handleCanvasFailure = useCallback(() => setCanvasFailed(true), []);
  const activeClockContext = canvasFlowActive && canvasSample ? canvasSample.context : context;
  const staticRenderContext: RenderContext = useMemo(() => {
    const base: RenderContext = {
      timeMs: 0,
      frame: 0,
      textGeometry,
      substrateData: substrateBuild.data,
      viewport: VIEWPORT,
    };
    return { ...base, ...createGlyphFieldContext(buildCompositeWaveField(state, base)) };
  }, [state.text, state.fontSize, state.tracking, state.font, state.substrateQuality, emitterFieldKey, state.amplitude, state.frequency, textGeometry, substrateBuild.data]);
  const renderContext: RenderContext = useMemo(() => ({
    ...staticRenderContext,
    ...activeClockContext,
    textGeometry,
    substrateData: substrateBuild.data,
    viewport: VIEWPORT,
  }), [activeClockContext, staticRenderContext, textGeometry, substrateBuild.data]);
  const exportContext: RenderContext = state.exportFrameMode === "current"
    ? renderContext
    : { ...renderContext, timeMs: 0, frame: 0 };
  const geometry = useMemo(
    () => generateRendererGeometry(state, renderContext),
    [state, renderContext],
  );
  const exportGeometry = useMemo(
    () => state.exportFrameMode === "current" ? geometry : generateRendererGeometry(state, exportContext),
    [state, exportContext, geometry],
  );
  const geometrySummary = useMemo(() => summarizeGeometry(exportGeometry), [exportGeometry]);
  const exportWarnings = useMemo(() => getExportBudgetWarnings({
    ...geometrySummary,
    substrateType: textGeometry?.hasOutlines ? "glyph-paths" : "native-text",
  }), [geometrySummary, textGeometry]);
  const performanceWarnings = useMemo(
    () => substrateBuild.data
      ? getSubstratePerformanceWarnings(substrateBuild.data.diagnostics.buildTimeMs, state.substrateQuality)
      : [],
    [state.substrateQuality, substrateBuild.data],
  );
  const estimateContext: RenderContext = useMemo(() => ({
    ...renderContext,
    timeMs: 0,
    frame: 0,
  }), [renderContext.substrateData, renderContext.textGeometry, renderContext.viewport]);
  // Compute the estimate geometry through the renderer cache (cheap, identity-stable
  // across debug/preview-only changes); then derive byte-size diagnostics from it.
  // The serialization + DOMParser only run when the cached geometry identity changes.
  const estimateGeometry = useMemo(
    () => generateRendererGeometry(state, estimateContext),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, estimateContext],
  );
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
    const exactWarnings = getExportBudgetWarnings({
      ...geometrySummary,
      substrateType: textGeometry?.hasOutlines ? "glyph-paths" : "native-text",
      exactByteSize: exactDiagnostics.byteSize,
    });
    setMessage(exactWarnings.length > 0
      ? `Exported ${formatBytes(exactDiagnostics.byteSize)} in ${timed.serializationTimeMs.toFixed(1)} ms. ${exactWarnings.join(" ")}`
      : `SVG exported · ${formatBytes(exactDiagnostics.byteSize)} · ${timed.serializationTimeMs.toFixed(1)} ms.`);
      } finally {
        setExporting(false);
      }
    });
  };
  const exportJson = () => download(JSON.stringify(state, null, 2), "substrate-project.json", "application/json");
  const importJson = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const { project, warnings } = validateProject(JSON.parse(await file.text()));
      setState(project);
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
          diagnosticsExpanded={diagnosticsExpanded}
          onDiagnosticsExpandedChange={setDiagnosticsExpanded}
        />
        <section className="viewport-shell">
          <div className="stage-frame">
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
            diagnosticsExpanded={diagnosticsExpanded}
          />
          </div>
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
    </main>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
