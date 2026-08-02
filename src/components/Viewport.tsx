import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { SVG_IDS } from "../engine/constants";
import { vectorGeometryBounds, type GeometryGroup, type VectorGeometry } from "../engine/geometry";
import { getRenderer } from "../engine/renderers";
import { getTextLayout, layoutUsesMultiLineTspans, textAttributes } from "../engine/textLayout";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { SvgDiagnostics } from "../engine/svgValidation";
import { sampleDistanceGradient } from "../engine/substrate";
import type { DiagnosticsMode, PreviewDiagnostics, PreviewSettings, ProjectState, RenderContext } from "../types";
import { summarizeGeometry } from "../engine/rendererRuntime";
import { getRendererTiming } from "../engine/rendererRuntime";
import type { SubstrateBackendStatus } from "../engine/substrate";
import { getBackendDiagnosticItems } from "../engine/substrate";
import { useDeferredDebugImage } from "../hooks/useDeferredDebugImage";
import { FLOW_PREVIEW_BUCKET_COUNT, type FlowPreviewUpdateResult } from "../engine/flowPreviewOptimization";
import { FlowPreview } from "./FlowPreview";
import { CanvasFlowPreview, type CanvasPreviewSample } from "./CanvasFlowPreview";
import { CanvasStaticPreview } from "./CanvasStaticPreview";
import type { PreviewBackend } from "../engine/previewBackend";
import { formatFps, getFramePacingStatus } from "../engine/animationTiming";
import { useWaveFieldDebugImage } from "../hooks/useWaveFieldDebugImage";
import { recordViewportRender } from "../dev/viewportNavigationInstrumentation";
import { generateEdgeErosionMarks } from "../engine/edgeErosion";
import { generateWarpedOutline, getFinalOutlineGeometry, outlineWarpCacheKey } from "../engine/outlineWarp";
import { getControlActivity } from "../engine/controlOwnership";
import { DEFAULT_SVG_TRACE_CONFIG, type SvgTraceConfig } from "../engine/previewTraceConfig";
import { useViewportHudHost } from "./viewportHudContext";
import { buildGlyphSamplingDiagnostics } from "../engine/rendererSampling";
import { resolveTextBoundsModel } from "../engine/textBounds";
import { contextArtboard } from "../engine/artboard";
import { buildRendererAwareSizeDraftGeometry } from "../engine/sizeDraftRenderer";
import { buildSizeDraftPresentationGeometry } from "../engine/sizeDraftPreview";
import { resolveSizePresentation } from "../engine/sizePresentation";
import { resolveSizeSceneTransform } from "../engine/sizeSceneTransform";
import { artboardBottom, artboardLeft, artboardRight, artboardTop, type ResolvedSceneLayout } from "../engine/sceneLayout";
import type { SizeInteractionState } from "../hooks/useSizeInteraction";
import type { DisplacedTypographyGeometry } from "../engine/glyphDisplacement";
import type { GlyphMicroWarpGeometry } from "../engine/glyphMicroWarp";
import { emitterDisplayGeometryKey } from "../engine/field/emitterDisplayResponse";
import { emitterMicroResponseGeometryKey } from "../engine/field/emitterMicroResponse";
import { LEGACY_PREVIEW_STROKE_WIDTH } from "../engine/contourStroke";
import { planDiagnosticSamples } from "../engine/safetyBudget";
import { traceEvent } from "../dev/interactionTrace";
import { resolvePreviewStageScale } from "../engine/previewStageScale";

interface ViewportProps {
  state: ProjectState; context: RenderContext; geometry: GeometryGroup; textGeometry: TextGeometry | null;
  glyphMicroWarp?: GlyphMicroWarpGeometry;
  displacedTypography?: DisplacedTypographyGeometry;
  rendererSemanticKey?: string;
  sceneLayout: ResolvedSceneLayout;
  exportDiagnostics: SvgDiagnostics | null; exportWarnings: string[]; performanceWarnings: string[];
  glyphLayoutTimeMs: number; substrateError: string | null; substrateBackendStatus: SubstrateBackendStatus;
  previewDiagnostics: PreviewDiagnostics; previewBackend: PreviewBackend; previewSettings: PreviewSettings;
  previewRunning: boolean; canvasSample: CanvasPreviewSample | null;
  onCanvasSample: (sample: CanvasPreviewSample) => void; onCanvasFailure: () => void;
  diagnosticsMode: DiagnosticsMode;
  svgTraceConfig?: SvgTraceConfig;
  sizeInteraction: SizeInteractionState;
  sizeDraftSceneLayout: ResolvedSceneLayout | null;
  sizeExactReady: boolean;
}

export function Viewport({ state, context, geometry, textGeometry, glyphMicroWarp, displacedTypography, rendererSemanticKey, sceneLayout, exportDiagnostics, exportWarnings, performanceWarnings, glyphLayoutTimeMs, substrateError, substrateBackendStatus, previewDiagnostics, previewBackend, previewSettings, previewRunning, canvasSample, onCanvasSample, onCanvasFailure, diagnosticsMode, svgTraceConfig = DEFAULT_SVG_TRACE_CONFIG, sizeInteraction, sizeDraftSceneLayout, sizeExactReady }: ViewportProps) {
  recordViewportRender();
  const hudHost = useViewportHudHost();
  const diagnosticsVisible = diagnosticsMode !== "off";
  const diagnosticsExpanded = diagnosticsMode === "full";
  const renderer = getRenderer(state.renderer);
  const svgRef = useRef<SVGSVGElement>(null);
  // The viewport reads the EFFECTIVE scene rect (resolved by the production
  // scene authority), never `projectArtboard(state)`. The authored minimum is
  // surfaced separately through `sceneLayout.authoredArtboard` for diagnostics.
  const artboard = contextArtboard(context);
  const effectiveRect = sceneLayout.effectiveArtboard;
  const authoredArtboard = sceneLayout.authoredArtboard;
  const previewStageScale = useMemo(
    () => resolvePreviewStageScale(authoredArtboard, effectiveRect),
    [authoredArtboard, effectiveRect],
  );
  const geometrySummary = useMemo(() => summarizeGeometry(geometry), [geometry]);
  const rendererOutputBounds = useMemo(() => vectorGeometryBounds(geometry), [geometry]);
  const displayDislocationActive = Boolean(geometry.diagnostics?.displayDislocationMode);
  const resolvedDisplacedTypography: DisplacedTypographyGeometry = displacedTypography ?? {
    sourceTypographyKey: context.textGeometryKey ?? "none",
    displacementKey: "glyph-displacement:disabled",
    geometryKey: context.textGeometryKey ?? "none",
    geometry: textGeometry,
    layoutBounds: textGeometry?.layoutBounds ?? textGeometry?.bounds ?? null,
    inkBounds: textGeometry?.bounds ?? null,
    fragmentBounds: [],
    fragments: [],
    active: false,
    exact: Boolean(textGeometry?.hasOutlines),
    diagnostics: {
      sourceContourPoints: 0,
      fragmentCount: 0,
      clippingOperations: 0,
      buildDurationMs: 0,
      peakTemporaryArrays: 0,
      clippingStatus: "complete",
      effectiveRegionSize: 0,
      anchorCount: 0,
      inactiveReason: "disabled",
    },
  };
  const displacementMetrics = useMemo(() => {
    const fragments = resolvedDisplacedTypography.fragments;
    const distinctTransforms = new Set(fragments.map(({ transform }) => [
      transform.a, transform.b, transform.c, transform.d, transform.e, transform.f,
    ].map((value) => value.toFixed(4)).join(","))).size;
    const ordered = [...fragments].sort((a, b) => a.responseWeight - b.responseWeight);
    const sampled = ordered.length <= 64 ? ordered : [...ordered.slice(0, 32), ...ordered.slice(-32)];
    return {
      distinctTransforms,
      minResponse: ordered[0]?.responseWeight ?? 0,
      maxResponse: ordered[ordered.length - 1]?.responseWeight ?? 0,
      sample: sampled.map(({ id, translation, responseWeight, sourceBounds, bounds }) => {
        return {
          id,
          dx: translation.x,
          dy: translation.y,
          responseWeight,
          sourceBounds,
          bounds,
        };
      }),
    };
  }, [resolvedDisplacedTypography.fragments]);
  const sizePresentation = useMemo(
    () => resolveSizePresentation(sizeInteraction, sizeExactReady),
    [sizeExactReady, sizeInteraction],
  );
  const presentationGeometry = useMemo(() => {
    if (sizePresentation.kind === "exact" || sizePresentation.kind === "retained") return geometry;
    if (sizePresentation.policy === "renderer-aware" && sizeDraftSceneLayout && sizeInteraction.phase === "dragging") {
      return buildRendererAwareSizeDraftGeometry(
        state,
        sizeInteraction.draftSize,
        sizeDraftSceneLayout,
        textGeometry,
        { timeMs: context.timeMs, frame: context.frame },
      );
    }
    if (sizeDraftSceneLayout && sizeInteraction.phase === "dragging") {
      return buildSizeDraftPresentationGeometry(
        geometry,
        sceneLayout,
        sizeInteraction.baseSize,
        sizeDraftSceneLayout,
        sizeInteraction.draftSize,
      );
    }
    return geometry;
  }, [
    context.frame,
    context.timeMs,
    geometry,
    sceneLayout,
    sizeDraftSceneLayout,
    sizeInteraction,
    sizePresentation,
    state,
    textGeometry,
  ]);
  const canvasSceneTransform = useMemo(() => {
    if (sizePresentation.kind !== "draft" || sizePresentation.policy === "renderer-aware") return null;
    if (!sizeDraftSceneLayout || sizeInteraction.phase !== "dragging") return null;
    return resolveSizeSceneTransform(
      sceneLayout,
      sizeInteraction.baseSize,
      sizeDraftSceneLayout,
      sizeInteraction.draftSize,
    );
  }, [sceneLayout, sizeDraftSceneLayout, sizeInteraction, sizePresentation]);
  const samplingDiagnostics = useMemo(() => {
    if (!diagnosticsExpanded || !textGeometry?.hasOutlines) return [];
    const origins = geometry.geometries.flatMap((item) => {
      if (item.type === "circle") return [item.center];
      if (item.type === "line") return [item.start];
      if (item.type === "polyline" && item.points.length > 0) return [item.points[0]];
      return [];
    });
    return buildGlyphSamplingDiagnostics(context, [], origins);
  }, [context, diagnosticsExpanded, geometry, textGeometry?.hasOutlines]);
  // Gate 7.8 — flow preview instrumentation. Held in a ref so per-frame
  // `FlowPreview` update summaries surface in the diagnostic surface without
  // committing additional React state during the animation loop. The callback
  // identity is stabilized (`useCallback`) so paint-only Viewport re-renders
  // (e.g. dragging the color picker) cannot invalidate FlowPreview's effect
  // deps and force matching-bucket SVG DOM writes that would not otherwise run.
  const flowPreviewStatsRef = useRef<FlowPreviewUpdateResult | null>(null);
  const handleFlowPreviewUpdate = useCallback((stats: FlowPreviewUpdateResult) => {
    flowPreviewStatsRef.current = stats;
  }, []);
  const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));
  const nativeTextContent = layoutUsesMultiLineTspans(layout)
    ? layout.lines.map((line) => (
        <tspan key={line.lineIndex} x={line.x} y={line.baselineY}>{line.text}</tspan>
      ))
    : layout.text;
  const textBounds = resolveTextBoundsModel(state, textGeometry);
  const bounds = textBounds.inkBounds;
  const hasGlyphPaths = Boolean(textGeometry?.hasOutlines);
  const controlActivity = getControlActivity(state, hasGlyphPaths);
  const substrate = context.substrateData ?? null;
  const debugImage = useDeferredDebugImage(substrate, state.debug.substrateMode);
  const waveFieldDebugUrl = useWaveFieldDebugImage(state, context, state.debug.waveField);
  const rendererTiming = getRendererTiming(geometry);
  const showOverlay = renderer.showTextOverlay?.(state) ?? false;
  const erodeOverlay = showOverlay && state.diffuserComposition === "edge-eroded" && state.edgeErosionAmount > 0 && state.edgeErosionWidth > 0;
  const overlayFill = state.overlayMode === "knockout" ? state.backgroundColor : state.primaryColor;
  // Regular Outline renderings use the dedicated `outlineStrokeWidth` control,
  // NOT the erosion-width setting (which defaults to 16 and visually collapses
  // glyph fills).  The mask/erosion path stays fully disabled for outline.
  const outlineStrokeWidth = Number.isFinite(state.outlineStrokeWidth) ? Math.max(0.25, state.outlineStrokeWidth) : 1.5;
  const erosionMarks = useMemo(() => generateEdgeErosionMarks(state, context), [state, context]);
  const warpCacheKey = outlineWarpCacheKey(state);
  const warpedOutline = useMemo(
    () => generateWarpedOutline(state, context),
    // Warp output is isolated from debug/preview-only state. Field, substrate, and
    // parsed path identities cover emitter/text changes; the packed key covers controls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [warpCacheKey, context.glyphField, context.substrateData, context.textGeometry],
  );
  const hasWarpedOutline = state.overlayMode === "warped-outline" && warpedOutline.paths.length > 0;
  const finalOutline = useMemo(
    () => getFinalOutlineGeometry(textGeometry, warpedOutline, hasWarpedOutline),
    [textGeometry, warpedOutline, hasWarpedOutline],
  );
  const previousFrame = useRef({
    geometry,
    warpedOutline,
    warpCacheKey,
    substrate,
    debugGenerationId: debugImage.generationId,
  });
  const geometryRegenerated = previousFrame.current.geometry !== geometry;
  const warpRegenerated = previousFrame.current.warpedOutline !== warpedOutline;
  const substrateRebuilt = previousFrame.current.substrate !== substrate;
  const debugRegenerated = previousFrame.current.debugGenerationId !== debugImage.generationId;
  useEffect(() => {
    previousFrame.current = { geometry, warpedOutline, warpCacheKey, substrate, debugGenerationId: debugImage.generationId };
  }, [geometry, warpedOutline, warpCacheKey, substrate, debugImage.generationId]);
const gradientVectors = useMemo(() => {
    if (!substrate || state.debug.substrateMode !== "gradient") return [];
    const vectors: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    // Sample within the effective scene rect (origin-aware). The previous loop
    // iterated `[0, artboard.width] × [0, artboard.height]`, assuming a
    // zero-origin rect; the new effective rect may have non-zero origin.
    const left = artboardLeft(effectiveRect);
    const top = artboardTop(effectiveRect);
    const right = artboardRight(effectiveRect);
    const bottom = artboardBottom(effectiveRect);
    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    const requested = Math.ceil(width / 45) * Math.ceil(height / 45);
    const budget = planDiagnosticSamples(requested);
    const stride = budget.reduced ? 45 * Math.ceil(Math.sqrt(requested / budget.emitted)) : 45;
    for (let y = top + stride; y < bottom && vectors.length < budget.emitted; y += stride) {
      for (let x = left + stride; x < right && vectors.length < budget.emitted; x += stride) {
        const gradient = sampleDistanceGradient(substrate, x, y);
        if (gradient.magnitude < 0.01) continue;
        const length = 14;
        vectors.push({
          x1: x,
          y1: y,
          x2: x + gradient.x / gradient.magnitude * length,
          y2: y + gradient.y / gradient.magnitude * length,
        });
      }
    }
    return vectors;
  }, [effectiveRect, substrate, state.debug.substrateMode]);

  useEffect(() => {
    traceEvent({ stage: "viewport.lifecycle", phase: "start", detail: { renderer: state.renderer } });
    return () => { traceEvent({ stage: "viewport.lifecycle", phase: "end", detail: { reason: "effect-cleanup" } }); };
  }, [state.renderer]);

  useEffect(() => {
    traceEvent({
      stage: "preview.backend",
      phase: "instant",
      frameKey: geometry.id,
      detail: { backend: previewBackend, canvasVisible: previewBackend === "canvas-2d", svgVisible: true },
    });
  }, [geometry.id, previewBackend]);

  useLayoutEffect(() => {
    if (sizePresentation.kind === "draft") {
      traceEvent({
        stage: "presentation.draft",
        phase: "instant",
        gestureId: sizePresentation.gestureId,
        frameKey: geometry.id,
        outputKey: presentationGeometry.id,
        detail: {
          kind: sizePresentation.kind,
          policy: sizePresentation.policy,
          draftFontSize: sizeInteraction.phase === "dragging" ? sizeInteraction.draftSize : state.fontSize,
        },
      });
      traceEvent({
        stage: "size.draft.present",
        phase: "instant",
        gestureId: sizePresentation.gestureId,
        frameKey: geometry.id,
        outputKey: presentationGeometry.id,
        detail: { policy: sizePresentation.policy },
      });
    }
  }, [geometry.id, presentationGeometry.id, sizeInteraction, sizePresentation, state.fontSize]);

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    traceEvent({
      stage: "svg.presentation",
      phase: "instant",
      frameKey: geometry.id,
      outputKey: sizePresentation.kind === "exact" ? geometry.id : presentationGeometry.id,
      counts: {
        svgElements: svg.querySelectorAll("*").length,
        paths: svg.querySelectorAll("path").length,
        geometryNodes: geometry.geometries.length,
      },
      detail: {
        viewBox: svg.getAttribute("viewBox"),
        presented: true,
        backend: "svg-dom",
        sizeDraft: sizePresentation.kind !== "exact",
        presentationKind: sizePresentation.kind,
      },
    });
}, [effectiveRect.height, effectiveRect.width, geometry, presentationGeometry.id, previewBackend, sizePresentation.kind, state.renderer, textGeometry]);

  return (
    <div
      className="stage-scale-host"
      data-testid="viewport-stage-host"
      style={{ aspectRatio: `${authoredArtboard.width} / ${authoredArtboard.height}` }}
    >
    <div
      className={`stage diagnostics-${diagnosticsMode}`}
      data-testid="viewport-stage"
      data-preview-backend={previewBackend}
      data-viewport-space="artwork"
      data-artboard-authored-width={authoredArtboard.width}
      data-artboard-authored-height={authoredArtboard.height}
      data-artboard-effective-x={effectiveRect.x}
      data-artboard-effective-y={effectiveRect.y}
      data-artboard-effective-width={effectiveRect.width}
      data-artboard-effective-height={effectiveRect.height}
      data-scene-layout-key={sceneLayout.key}
      data-text-geometry-key={context.textGeometryKey ?? "none"}
      data-renderer-key={rendererSemanticKey ?? geometry.id}
      data-renderer-output-bounds={JSON.stringify(rendererOutputBounds)}
      data-glyph-source-key={resolvedDisplacedTypography.sourceTypographyKey}
      data-glyph-micro-warp-active={glyphMicroWarp?.active ? "true" : "false"}
      data-glyph-micro-warp-key={glyphMicroWarp?.warpKey ?? "glyph-micro-warp:disabled"}
      data-glyph-micro-warp-geometry-key={glyphMicroWarp?.geometryKey ?? resolvedDisplacedTypography.sourceTypographyKey}
      data-glyph-micro-warp-source-points={glyphMicroWarp?.diagnostics.sourcePointCount ?? 0}
      data-glyph-micro-warp-points={glyphMicroWarp?.diagnostics.warpedPointCount ?? 0}
      data-glyph-micro-warp-affected={glyphMicroWarp?.diagnostics.affectedPointCount ?? 0}
      data-glyph-micro-warp-emitters={glyphMicroWarp?.diagnostics.emitterCount ?? 0}
      data-glyph-micro-warp-max-displacement={glyphMicroWarp?.diagnostics.maxDisplacement ?? 0}
      data-glyph-micro-warp-safety={glyphMicroWarp?.diagnostics.safetyStatus ?? "complete"}
      data-glyph-micro-warp-build-ms={glyphMicroWarp?.diagnostics.buildDurationMs ?? 0}
      data-glyph-micro-warp-affected-bounds={JSON.stringify(glyphMicroWarp?.diagnostics.affectedBounds ?? null)}
      data-glyph-displacement-key={resolvedDisplacedTypography.active ? resolvedDisplacedTypography.displacementKey : "disabled"}
      data-glyph-domain-key={resolvedDisplacedTypography.geometryKey}
      data-glyph-displacement-mode={resolvedDisplacedTypography.active ? state.glyphDisplacement.mode : "disabled"}
      data-glyph-fragment-count={resolvedDisplacedTypography.fragments.length}
      data-glyph-distinct-transform-count={displacementMetrics.distinctTransforms}
      data-glyph-min-response={displacementMetrics.minResponse}
      data-glyph-max-response={displacementMetrics.maxResponse}
      data-glyph-fragment-sample={JSON.stringify(displacementMetrics.sample)}
      data-glyph-ink-bounds={JSON.stringify(resolvedDisplacedTypography.inkBounds)}
      data-glyph-source-contour-points={resolvedDisplacedTypography.diagnostics.sourceContourPoints}
      data-glyph-clipping-operations={resolvedDisplacedTypography.diagnostics.clippingOperations}
      data-glyph-peak-temporary-arrays={resolvedDisplacedTypography.diagnostics.peakTemporaryArrays}
      data-glyph-build-ms={resolvedDisplacedTypography.diagnostics.buildDurationMs}
      data-glyph-clipping-status={resolvedDisplacedTypography.diagnostics.clippingStatus}
      data-dot-grid-regular={geometry.diagnostics?.dotGridRegular ? "true" : "false"}
      data-dot-grid-spacing={geometry.diagnostics?.dotGridSpacing ?? "none"}
      data-dot-grid-origin={`${geometry.diagnostics?.dotGridOriginX ?? "none"},${geometry.diagnostics?.dotGridOriginY ?? "none"}`}
      data-display-dislocation-active={geometry.diagnostics?.displayDislocationMode ? "true" : "false"}
      data-display-dislocation-mode={geometry.diagnostics?.displayDislocationMode ?? "disabled"}
      data-display-dislocation-candidates={geometry.diagnostics?.displayDislocationCandidateCount ?? 0}
      data-display-dislocation-affected={geometry.diagnostics?.displayDislocationAffectedCandidates ?? 0}
      data-display-dislocation-accepted={geometry.diagnostics?.displayDislocationAcceptedCandidates ?? 0}
      data-display-dislocation-regions={geometry.diagnostics?.displayDislocationRegionCount ?? 0}
      data-display-dislocation-gap-rejections={geometry.diagnostics?.displayDislocationGapRejections ?? 0}
      data-display-dislocation-max-offset={geometry.diagnostics?.displayDislocationMaxDisplacement ?? 0}
      data-display-dislocation-build-ms={geometry.diagnostics?.displayDislocationBuildTimeMs ?? 0}
      data-display-dislocation-clipping={geometry.diagnostics?.displayDislocationClippingState ?? "none"}
      data-emitter-display-mode={state.emitterDisplay.mode}
      data-emitter-display-key={emitterDisplayGeometryKey(state)}
      data-emitter-display-samples={geometry.diagnostics?.emitterDisplaySamples ?? 0}
      data-emitter-display-average-displacement={geometry.diagnostics?.emitterDisplayAverageDisplacement ?? 0}
      data-emitter-anchor-x={geometry.diagnostics?.emitterAnchorX ?? ""}
      data-emitter-anchor-y={geometry.diagnostics?.emitterAnchorY ?? ""}
      data-emitter-micro-mode={geometry.diagnostics?.emitterMicroResponseMode ?? "disabled"}
      data-emitter-micro-key={emitterMicroResponseGeometryKey(state, context)}
      data-emitter-micro-candidates={geometry.diagnostics?.emitterMicroCandidateCount ?? 0}
      data-emitter-micro-affected={geometry.diagnostics?.emitterMicroAffectedCount ?? 0}
      data-emitter-micro-adjusted={geometry.diagnostics?.emitterMicroAdjustedCount ?? 0}
      data-emitter-micro-interior={geometry.diagnostics?.emitterMicroInteriorCount ?? 0}
      data-emitter-micro-footprint-invalid={geometry.diagnostics?.emitterMicroFootprintInvalidCount ?? 0}
      data-emitter-micro-relocated={geometry.diagnostics?.emitterMicroRelocatedCount ?? 0}
      data-emitter-micro-rejected={geometry.diagnostics?.emitterMicroRejectedCount ?? 0}
      data-emitter-micro-final-exterior={geometry.diagnostics?.emitterMicroFinalExteriorCount ?? 0}
      data-emitter-micro-final-footprint-violations={geometry.diagnostics?.emitterMicroFinalFootprintViolations ?? 0}
      data-emitter-micro-occupancy-domain={state.emitterMicroResponse.occupancy === "legacy"
        ? "legacy-glyph-ink"
        : "sealed-glyph-silhouette"}
      data-emitter-micro-sealed-counter-pixels={geometry.diagnostics?.emitterMicroSealedCounterPixels ?? 0}
      data-emitter-micro-sdf-reads={geometry.diagnostics?.emitterMicroSdfReadCount ?? 0}
      data-emitter-micro-build-ms={geometry.diagnostics?.emitterMicroBuildTimeMs ?? 0}
      data-substrate-key={context.substrateKey ?? "none"}
      data-substrate-phase={substrateBackendStatus.phase}
      data-renderer-element-count={geometry.geometries.length}
      data-size-interaction-phase={sizeInteraction.phase}
      data-size-presentation-kind={sizePresentation.kind}
      data-size-draft-active={sizePresentation.kind !== "exact" ? "true" : "false"}
      style={{
        // Authored host establishes stable px/world scale; stage is (effective/authored)
        // of that host so line-height growth adds height without shrinking glyphs.
        width: `${previewStageScale.widthRatio * 100}%`,
        aspectRatio: `${effectiveRect.width} / ${effectiveRect.height}`,
      }}
    >
      <div
        className={`artboard-backing${state.transparentBackground ? " is-transparent" : ""}`}
        data-editor-transparent-preview={state.transparentBackground ? "true" : "false"}
        style={state.transparentBackground ? undefined : { backgroundColor: state.backgroundColor }}
        aria-hidden="true"
      />
      {previewBackend === "canvas-2d" && (
        state.renderer === "flow" ? (
          <CanvasFlowPreview
            state={state}
            textGeometry={textGeometry}
            artboard={{ x: effectiveRect.x, y: effectiveRect.y, width: effectiveRect.width, height: effectiveRect.height }}
            frameKey={geometry.id}
            running={previewRunning}
            fpsCap={previewSettings.fpsCap}
            pauseWhenHidden={previewSettings.pauseWhenHidden}
            onSample={onCanvasSample}
            onFailure={onCanvasFailure}
            sceneTransform={canvasSceneTransform}
          />
        ) : (
          <CanvasStaticPreview
            state={state}
            geometry={presentationGeometry}
            textGeometry={textGeometry}
            artboard={{ x: effectiveRect.x, y: effectiveRect.y, width: effectiveRect.width, height: effectiveRect.height }}
            frameKey={geometry.id}
            sceneTransform={canvasSceneTransform}
            onSample={onCanvasSample}
            onFailure={onCanvasFailure}
          />
        )
      )}
      <svg ref={svgRef} className="artboard" data-testid="artwork-svg" viewBox={`${effectiveRect.x} ${effectiveRect.y} ${effectiveRect.width} ${effectiveRect.height}`} aria-label={`Generative preview of ${state.text}`}>
        {previewBackend !== "canvas-2d" && !state.transparentBackground && (
          <rect data-preview-artwork-background="" x={effectiveRect.x} y={effectiveRect.y} width={effectiveRect.width} height={effectiveRect.height} fill={state.backgroundColor} />
        )}
        <defs>
          <mask id={SVG_IDS.mask}>
            <g id={SVG_IDS.substrateMask}>
              <rect x={effectiveRect.x} y={effectiveRect.y} width={effectiveRect.width} height={effectiveRect.height} fill="black" />
              {hasGlyphPaths
                ? textGeometry!.glyphs.map((glyph) => glyph.path.d && (
                    <path
                      key={glyph.textIndex}
                      data-character-index={glyph.textIndex}
                      data-glyph-index={glyph.glyphIndex}
                      d={glyph.path.d}
                      fill="white"
                    />
                  ))
                : <text {...textAttributes(layout)} fill="white">{nativeTextContent}</text>}
            </g>
          </mask>
          {erodeOverlay && (
            <mask id="diffuser-overlay-mask">
              <rect x={effectiveRect.x} y={effectiveRect.y} width={effectiveRect.width} height={effectiveRect.height} fill="black" />
              {hasGlyphPaths
                ? <>
                    <g fill="white" stroke="none" fillRule="evenodd">
                      {finalOutline.paths.map((path) => <path key={`overlay-mask-${path.textIndex}`} d={path.d} />)}
                    </g>
                  </>
                : <>
                    <text {...textAttributes(layout)} fill="white" stroke="none">{nativeTextContent}</text>
                  </>}
              <g id="diffuser-erosion-marks" fill="black" stroke="none">
                {erosionMarks.map((mark, index) => <circle key={index} cx={mark.x} cy={mark.y} r={mark.radius} opacity={mark.opacity} />)}
              </g>
            </mask>
          )}
        </defs>
        <g id={SVG_IDS.artwork} mask={svgTraceConfig.mode !== "mask-disabled" && (renderer.clipPreviewToText?.(state) ?? true) ? `url(#${SVG_IDS.mask})` : undefined} className="marks" style={{ fill: state.primaryColor, stroke: state.primaryColor }} strokeWidth={renderer.strokeWidth?.(state) ?? LEGACY_PREVIEW_STROKE_WIDTH}>
          {previewBackend === "canvas-2d"
            ? null
            : state.renderer === "flow"
              ? <FlowPreview
                  geometry={presentationGeometry}
                  onUpdate={handleFlowPreviewUpdate}
                  bucketCount={svgTraceConfig.bucketCount}
                  traceMode={svgTraceConfig.mode}
                  state={state}
                  context={context}
                  running={previewRunning}
                  fpsCap={previewSettings.fpsCap}
                />
              : presentationGeometry.geometries.map((item, index) => <GeometryElement key={index} geometry={item} />)}
        </g>
        {showOverlay && <g className="diffuser-text-overlay" opacity={renderer.textOverlayOpacity?.(state) ?? 1}>
          {hasGlyphPaths
            ? <g style={{ fill: state.overlayMode === "outline" ? "none" : overlayFill, stroke: state.overlayMode === "outline" ? state.outlineColor : "none" }} fillRule="evenodd" strokeWidth={state.overlayMode === "outline" ? outlineStrokeWidth : undefined} strokeLinejoin="round" strokeLinecap="round" mask={erodeOverlay && state.overlayMode !== "outline" ? "url(#diffuser-overlay-mask)" : undefined}>
                {finalOutline.paths.map((path) => <path key={`overlay-${path.textIndex}`} d={path.d} data-warped-glyph={hasWarpedOutline ? path.glyphIndex : undefined} />)}
              </g>
            : <text style={{ fill: state.overlayMode === "outline" ? "none" : overlayFill, stroke: state.overlayMode === "outline" ? state.outlineColor : "none" }} strokeWidth={state.overlayMode === "outline" ? outlineStrokeWidth : undefined} mask={erodeOverlay && state.overlayMode !== "outline" ? "url(#diffuser-overlay-mask)" : undefined} {...textAttributes(layout)}>{nativeTextContent}</text>}
        </g>}
        {!displayDislocationActive && (hasGlyphPaths
          ? <g className="ghost-text glyph-ghost">{textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} />)}</g>
          : <text className="ghost-text" {...textAttributes(layout)}>{nativeTextContent}</text>)}
        {debugImage.url && <image className="debug-raster" href={debugImage.url} x={substrate?.domainBounds?.x ?? effectiveRect.x} y={substrate?.domainBounds?.y ?? effectiveRect.y} width={substrate?.domainBounds?.width ?? effectiveRect.width} height={substrate?.domainBounds?.height ?? effectiveRect.height} preserveAspectRatio="none" />}
        {waveFieldDebugUrl && <image className="debug-raster" href={waveFieldDebugUrl} x={context.glyphField?.worldBounds.x ?? effectiveRect.x} y={context.glyphField?.worldBounds.y ?? effectiveRect.y} width={context.glyphField?.worldBounds.width ?? effectiveRect.width} height={context.glyphField?.worldBounds.height ?? effectiveRect.height} preserveAspectRatio="none" />}
        {state.debug.substrateMode === "gradient" && (
          <g className="debug-gradient">
            {gradientVectors.map((vector, index) => <line key={index} {...vector} />)}
          </g>
        )}
        {(state.debug.substrateMode === "glyph-outlines" || state.debug.glyphOutlines) && hasGlyphPaths && (
          <g className="debug-glyph-outlines">
            {textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} />)}
          </g>
        )}
        {state.debug.glyphBounds && hasGlyphPaths && (
          <g className="debug-line">
            {textGeometry!.glyphs.map((glyph) => glyph.path.bounds && (
              <rect key={glyph.textIndex} x={glyph.path.bounds.x} y={glyph.path.bounds.y} width={glyph.path.bounds.width} height={glyph.path.bounds.height} />
            ))}
          </g>
        )}
        {state.debug.maskBounds && diagnosticsExpanded && <rect className="debug-layout-bounds" x={textBounds.layoutBounds.x} y={textBounds.layoutBounds.y} width={textBounds.layoutBounds.width} height={textBounds.layoutBounds.height} />}
        {state.debug.maskBounds && <rect className="debug-line" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />}
        {state.debug.baseline && layout.lines.map((line) => (
          <line key={line.lineIndex} className="debug-baseline" x1={effectiveRect.x} y1={line.baselineY} x2={effectiveRect.x + effectiveRect.width} y2={line.baselineY} />
        ))}
        {state.debug.glyphOrigins && hasGlyphPaths && (
          <g className="debug-glyph-origins">
            {textGeometry!.glyphs.map((glyph) => <circle key={glyph.textIndex} cx={glyph.x} cy={glyph.y} r="3" />)}
          </g>
        )}
        {state.debug.markOrigins && (
          <g className="debug-origins">
            {geometry.geometries.map((item, index) => {
              const origin = item.type === "line" ? item.start : item.type === "circle" ? item.center : item.type === "polyline" ? item.points[0] : null;
              return origin ? <circle key={index} cx={origin.x} cy={origin.y} r="1.8" /> : null;
            })}
          </g>
        )}
        {state.debug.emitter && (
          <g className="debug-emitter">
            <circle cx={geometry.diagnostics?.emitterAnchorX ?? artboard.centerX} cy={geometry.diagnostics?.emitterAnchorY ?? artboard.centerY} r="12" />
            {geometry.diagnostics?.emitterAnchorX !== undefined && geometry.diagnostics?.emitterAnchorY !== undefined && (
              <>
                <circle cx={geometry.diagnostics.emitterAnchorX} cy={geometry.diagnostics.emitterAnchorY} r={state.emitter.radius} />
                <path d={`M${geometry.diagnostics.emitterAnchorX - 18} ${geometry.diagnostics.emitterAnchorY}H${geometry.diagnostics.emitterAnchorX + 18}M${geometry.diagnostics.emitterAnchorX} ${geometry.diagnostics.emitterAnchorY - 18}V${geometry.diagnostics.emitterAnchorY + 18}`} />
              </>
            )}
          </g>
        )}
      </svg>
      {hudHost && createPortal(<div className={`viewport-hud-content diagnostics-${diagnosticsMode}`} data-viewport-space="screen" style={{ aspectRatio: `${effectiveRect.width} / ${effectiveRect.height}` }}>
        <div className="stage-meta top"><span>FIELD / {state.renderer.toUpperCase()}</span><span>{effectiveRect.width} × {effectiveRect.height} ({sceneLayout.authoredArtboard.width}×{sceneLayout.authoredArtboard.height} authored)</span></div>
        <div className="coordinates">
        <span>{effectiveRect.x},{effectiveRect.y}</span>
        <span>
          {state.debug.markCount && `${geometry.geometries.length} MARKS`}
          {state.debug.frameTime && ` · F${context.frame} / ${Math.round(context.timeMs)}MS`}
          {state.debug.costEstimate && exportDiagnostics && ` · ${exportDiagnostics.glyphPaths} GLYPHS · ${exportDiagnostics.generatedMarks} MARKS · ${exportDiagnostics.elementCount} EL · ${formatBytes(exportDiagnostics.byteSize)} · ${exportDiagnostics.substrateType.toUpperCase()}`}
        </span>
        <span>{effectiveRect.x + effectiveRect.width},{effectiveRect.y + effectiveRect.height}</span>
        </div>
      {substrate && state.debug.substrateMode !== "none" && (
        <div className="substrate-diagnostics">
          <strong>{substrate.substrateType}</strong>
          <span>{substrate.width} × {substrate.height}</span>
          <span>MASK {(substrate.diagnostics.maskCoverage * 100).toFixed(2)}%</span>
          <span>EDGE {substrate.diagnostics.edgePixelCount}</span>
          <span>D {substrate.diagnostics.minDistance.toFixed(1)} / +{substrate.diagnostics.maxDistance.toFixed(1)}</span>
          <span>GLYPH {glyphLayoutTimeMs.toFixed(1)}MS</span>
          <span>RASTER {substrate.diagnostics.rasterizeTimeMs.toFixed(1)}MS</span>
          <span>EDGE {substrate.diagnostics.edgeMapTimeMs.toFixed(1)}MS</span>
          <span>SDF {substrate.diagnostics.distanceFieldTimeMs.toFixed(1)}MS</span>
          <span>BUILD {substrate.diagnostics.buildTimeMs.toFixed(1)}MS</span>
          {substrate.diagnostics.rasterPlan?.reduced && <span className="warning">RASTER SAFETY {substrate.width}×{substrate.height} · {substrate.diagnostics.rasterPlan.reason}</span>}
          <span>DEBUG {debugImage.pending ? "PENDING" : `${debugImage.durationMs.toFixed(1)}MS`}</span>
        </div>
      )}
      {(diagnosticsVisible || substrateBackendStatus.phase !== "ready") && <div className={`backend-diagnostics ${substrateBackendStatus.phase}`}>
        <strong>BACKEND</strong>
        {(diagnosticsExpanded || substrateBackendStatus.phase !== "ready") && getBackendDiagnosticItems(substrateBackendStatus).map((item) => <span key={item}>{item}</span>)}
      </div>}
      {geometry.diagnostics && (diagnosticsVisible || geometry.diagnostics.fallback) && (
        <div className={`renderer-diagnostics${geometry.diagnostics.fallback ? " warning" : ""}`}>
          <strong>{renderer.label.toUpperCase()}</strong>
          {!diagnosticsExpanded && <span>MARKS {geometrySummary.elementCount}</span>}
          {!diagnosticsExpanded && <span>GLYPHS {textGeometry?.glyphs.length ?? 0}</span>}
          {diagnosticsExpanded && geometry.diagnostics.requestedDots !== undefined
            ? <>
                <span>DOTS {geometry.diagnostics.acceptedDots} / {geometry.diagnostics.requestedDots}</span>
                {geometry.diagnostics.preCapAcceptedCount !== undefined && <span>ACCEPTED RAW {geometry.diagnostics.preCapAcceptedCount}</span>}
                {geometry.diagnostics.cappedCount !== undefined && <span>CAPPED {geometry.diagnostics.cappedCount}</span>}
                {geometry.diagnostics.effectiveDensity !== undefined && <span>EFFECTIVE DENSITY {(geometry.diagnostics.effectiveDensity * 100).toFixed(2)}%</span>}
                <span>OUT {geometry.diagnostics.rejectedOutsideMask}</span>
                <span>SPACE {geometry.diagnostics.rejectedBySpacing}</span>
                {geometry.diagnostics.rejectedByInfluence !== undefined && <span>FIELD REJECT {geometry.diagnostics.rejectedByInfluence}</span>}
                <span>R AVG {geometry.diagnostics.averageRadius?.toFixed(2)}</span>
                {geometry.diagnostics.averageOpacity !== undefined && <span>OP AVG {geometry.diagnostics.averageOpacity.toFixed(2)}</span>}
                <span>R MIN/MAX {geometry.diagnostics.minRadius?.toFixed(2)} / {geometry.diagnostics.maxRadius?.toFixed(2)}</span>
                <span>CLIPPED {geometry.diagnostics.maxNodesClipped ? "YES" : "NO"}</span>
              </>
            : diagnosticsExpanded && geometry.diagnostics.contourLevelCount !== undefined
            ? <>
                <span>LEVELS {geometry.diagnostics.contourLevelCount}</span>
                <span>FRAG {geometry.diagnostics.extractedFragments}</span>
                <span>POINTS {geometry.diagnostics.totalContourPoints}</span>
                <span>SKIP {geometry.diagnostics.skippedFragments}</span>
                <span>MAX D {geometry.diagnostics.maxPositiveDistance?.toFixed(1)}</span>
                <span>AVG LEN {geometry.diagnostics.averageFragmentLength?.toFixed(1)}</span>
                <span>CLIPPED {geometry.diagnostics.maxNodesClipped ? "YES" : "NO"}</span>
              </>
            : diagnosticsExpanded && geometry.diagnostics.requestedStreamlines !== undefined
              ? <>
                <span>LINES {geometry.diagnostics.acceptedStreamlines} / {geometry.diagnostics.requestedStreamlines}</span>
                <span>REJECT {geometry.diagnostics.rejectedSeeds}</span>
                <span>POINTS {geometry.diagnostics.totalPolylinePoints}</span>
                <span>AVG PTS {geometry.diagnostics.averagePointsPerStreamline?.toFixed(1)}</span>
                <span>OUT {geometry.diagnostics.stoppedOutsideMask}</span>
                <span>GRAD {geometry.diagnostics.stoppedInvalidGradient}</span>
                <span>OCC {geometry.diagnostics.occupancyRejections}</span>
                </>
              : diagnosticsExpanded
                ? <>
                  <span>A {geometry.diagnostics.acceptedCandidates}</span>
                  <span>R {geometry.diagnostics.rejectedCandidates}</span>
                  </>
                : null}
          {!diagnosticsExpanded && <span>CLIPPED {geometry.diagnostics.maxNodesClipped ? "YES" : "NO"}</span>}
          {diagnosticsExpanded && <span>AVG D {geometry.diagnostics.averageSampledDistance.toFixed(1)}</span>}
          {diagnosticsExpanded && <span>SUBSTRATE {geometry.diagnostics.substrateAvailable ? "YES" : "NO"}</span>}
          {(diagnosticsExpanded || geometry.diagnostics.fallback) && <span>FALLBACK {geometry.diagnostics.fallback ? "YES" : "NO"}</span>}
          {(diagnosticsExpanded || geometry.diagnostics.warning) && geometry.diagnostics.warning && <span>{geometry.diagnostics.warning}</span>}
        </div>
      )}
      {diagnosticsExpanded && (
        <div className="sampling-diagnostics">
          <strong>SAMPLING</strong>
          {geometry.diagnostics ? (
            <>
              <span>CANDIDATES {geometry.diagnostics.acceptedCandidates + geometry.diagnostics.rejectedCandidates}</span>
              <span>RETAINED {geometry.diagnostics.acceptedCandidates}</span>
              <span>DROPPED {geometry.diagnostics.rejectedCandidates}</span>
              <span>MAX NODES {state.maxNodes}</span>
              <span>BUDGET {geometry.diagnostics.maxNodesClipped ? "CLIPPED" : "OK"}</span>
              <span>ARTBOARD 0,0 {textBounds.artboardBounds.width}×{textBounds.artboardBounds.height}</span>
              <span>LAYOUT {textBounds.layoutBounds.x.toFixed(0)},{textBounds.layoutBounds.y.toFixed(0)} {textBounds.layoutBounds.width.toFixed(0)}×{textBounds.layoutBounds.height.toFixed(0)}</span>
              <span>INK {textBounds.inkBounds.x.toFixed(0)},{textBounds.inkBounds.y.toFixed(0)} {textBounds.inkBounds.width.toFixed(0)}×{textBounds.inkBounds.height.toFixed(0)} · {textBounds.inkBoundsSource === "parsed-glyph-union" ? "EXACT" : "APPROX"}</span>
              {substrate?.domainBounds && <span>DOMAIN {substrate.domainBounds.x.toFixed(0)},{substrate.domainBounds.y.toFixed(0)} {substrate.domainBounds.width.toFixed(0)}×{substrate.domainBounds.height.toFixed(0)}</span>}
            </>
          ) : <span>Renderer sampling diagnostics unavailable</span>}
          {!textGeometry?.hasOutlines
            ? <span>Sampling diagnostics unavailable: native-text fallback</span>
            : samplingDiagnostics.map((glyph) => (
                <span key={`${glyph.textIndex}-${glyph.glyphIndex}`}>
                  G{glyph.textIndex + 1} {glyph.character || "?"} · {glyph.visibility.toUpperCase()} · MARKS {glyph.generatedMarkCount} · AREA {glyph.visibleArea.toFixed(0)} · DENSITY {glyph.retainedDensity.toFixed(4)}
                </span>
              ))}
        </div>
      )}
      {diagnosticsVisible && <div className="renderer-diagnostics instrument-diagnostics">
        <strong>INSTRUMENTS</strong>
        {diagnosticsExpanded && <span>TYPE {geometrySummary.geometryType.toUpperCase()}</span>}
        <span>EL {geometrySummary.elementCount}</span>
        {diagnosticsExpanded && <span>PTS {geometrySummary.pointCount}</span>}
        {diagnosticsExpanded && <span>NODES ~{geometrySummary.estimatedSvgNodes}</span>}
        {diagnosticsExpanded && <span>SIZE ~{formatBytes(geometrySummary.estimatedByteSize)}</span>}
        {exportDiagnostics && <span>EXACT {formatBytes(exportDiagnostics.byteSize)}</span>}
        {exportDiagnostics && diagnosticsExpanded && <span>SVG {exportDiagnostics.serializationTimeMs.toFixed(1)}MS</span>}
        {diagnosticsExpanded && <span>GEN {rendererTiming.durationMs.toFixed(1)}MS{rendererTiming.cached ? " CACHED" : ""}</span>}
        {diagnosticsExpanded && <span>SUB {substrate?.substrateType ?? "NONE"}</span>}
        {(diagnosticsExpanded || geometrySummary.maxNodesClipped) && <span>CLIPPED {geometrySummary.maxNodesClipped ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.selectedGlyph && <span>EMITTER {geometry.diagnostics.selectedGlyph}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.emitterAnchorX !== undefined && <span>ANCHOR {geometry.diagnostics.emitterAnchorX.toFixed(1)}, {geometry.diagnostics.emitterAnchorY?.toFixed(1)}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.emitterSourceMode && <span>SOURCE {geometry.diagnostics.emitterSourceMode.toUpperCase()}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.fieldWidth && <span>FIELD {geometry.diagnostics.fieldWidth}×{geometry.diagnostics.fieldHeight}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.fieldMin !== undefined && <span>RANGE {geometry.diagnostics.fieldMin.toFixed(2)} / {geometry.diagnostics.fieldMax?.toFixed(2)}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.fieldBuildTimeMs !== undefined && <span>FIELD BUILD {geometry.diagnostics.fieldBuildTimeMs.toFixed(1)}MS</span>}
        {diagnosticsExpanded && geometry.diagnostics?.contourExtractionTimeMs !== undefined && <span>{state.renderer === "glyph-diffuser" ? "SAMPLE" : "CONTOUR"} {geometry.diagnostics.contourExtractionTimeMs.toFixed(1)}MS</span>}
        {diagnosticsExpanded && geometry.diagnostics?.fieldMembership && <span>MEMBERSHIP APPROX.</span>}
        {diagnosticsExpanded && geometry.diagnostics?.waveContourMode && <span>MODE {geometry.diagnostics.waveContourMode.toUpperCase()}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.waveOutputCount !== undefined && <span>OUTPUT {geometry.diagnostics.waveOutputCount}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.diffuserDomain && <span>DOMAIN {geometry.diagnostics.diffuserDomain.toUpperCase()}</span>}
        {diagnosticsExpanded && geometry.diagnostics?.diffuserComposition && <span>COMPOSE {geometry.diagnostics.diffuserComposition.toUpperCase()}</span>}
        {diagnosticsExpanded && hasGlyphPaths && <span>OUTLINE PATHS {finalOutline.diagnostics.pathCount}</span>}
        {diagnosticsExpanded && hasGlyphPaths && <span>SUBPATHS {finalOutline.diagnostics.subpathCount}</span>}
        {diagnosticsExpanded && hasGlyphPaths && <span>OPEN CONTOURS {finalOutline.diagnostics.openContourCount}</span>}
        {diagnosticsExpanded && hasGlyphPaths && <span>SIMPLIFIED {finalOutline.diagnostics.simplificationApplied ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && hasGlyphPaths && <span>OUTLINE CLIPPED {finalOutline.diagnostics.clippingApplied ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>OVERLAY WARPED-OUTLINE</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>REQUESTED {warpedOutline.diagnostics.requestedOverlay.toUpperCase()}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>EFFECTIVE {warpedOutline.diagnostics.effectiveOverlay.toUpperCase()}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP ACTIVE {warpedOutline.diagnostics.active ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>PATH SOURCE {warpedOutline.diagnostics.glyphPathSource.replace("-", " ").toUpperCase()}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP GLYPHS {warpedOutline.diagnostics.warpedGlyphCount}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP PTS {warpedOutline.diagnostics.sampledOutlinePoints}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP AVG {warpedOutline.diagnostics.averageDisplacement.toFixed(2)}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP MAX {warpedOutline.diagnostics.maxDisplacement.toFixed(2)}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>CLAMPED {warpedOutline.diagnostics.clampedPoints}</span>}
        {diagnosticsExpanded && warpedOutline.diagnostics.activeEmitterGlyph && <span>WARP EMITTER {warpedOutline.diagnostics.activeEmitterGlyph}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP STRENGTH {warpedOutline.diagnostics.effectiveWarpStrength.toFixed(2)}</span>}
        {diagnosticsExpanded && state.overlayMode === "warped-outline" && <span>WARP CACHE {warpRegenerated ? "MISS" : "HIT"}</span>}
        {(diagnosticsExpanded || warpedOutline.diagnostics.warning) && warpedOutline.diagnostics.warning && <span>WARP WARNING</span>}
        {(diagnosticsExpanded || warpedOutline.diagnostics.inactiveReason) && warpedOutline.diagnostics.inactiveReason && <span>REASON {warpedOutline.diagnostics.inactiveReason.toUpperCase()}</span>}
      </div>}
      {diagnosticsVisible && <div className="renderer-diagnostics control-diagnostics">
        <strong>ACTIVE CONTROLS</strong>
        {diagnosticsExpanded && <span>RENDERER {controlActivity.renderer.toUpperCase()}</span>}
        <span>OVERLAY {controlActivity.overlayMode.toUpperCase()}</span>
        {diagnosticsExpanded && <span>PARSED PATHS {controlActivity.parsedFontPaths ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && <span>DIFFUSER {controlActivity.diffuser ? "ACTIVE" : "N/A"}</span>}
        {diagnosticsExpanded && <span>OVERLAY CONTROLS {controlActivity.overlay ? "ACTIVE" : "N/A"}</span>}
        {diagnosticsExpanded && <span>OVERLAY SOURCE {controlActivity.overlaySource === "none" ? "N/A" : controlActivity.overlaySource.replace("-", " ").toUpperCase()}</span>}
        {diagnosticsExpanded && <span>GLYPH MODULATION {controlActivity.glyphModulation ? "ACTIVE" : "N/A"}</span>}
        {diagnosticsExpanded && <span>EFFECTIVE OVERLAY {controlActivity.effectiveOverlay.toUpperCase()}</span>}
        {diagnosticsExpanded && <span>OUTLINE Active {controlActivity.outlineActive ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && <span>WARP {controlActivity.warp ? "ENABLED" : "DISABLED"}</span>}
        {diagnosticsExpanded && <span>EROSION {controlActivity.edgeErosion ? "ACTIVE" : "INACTIVE"}</span>}
        {diagnosticsExpanded && <span>OUTLINE WIDTH {controlActivity.outlineStrokeWidth.toFixed(2)}</span>}
        {diagnosticsExpanded && <span>AFFECTING {controlActivity.affectingOutput.length ? controlActivity.affectingOutput.join(", ").toUpperCase() : "NONE"}</span>}
        {(diagnosticsExpanded || controlActivity.disabledReason) && controlActivity.disabledReason && <span>REASON {controlActivity.disabledReason.toUpperCase()}</span>}
        {diagnosticsExpanded && state.overlayMode === "outline" && state.diffuserComposition === "edge-eroded" && <span>NOTE EROSION IGNORED FOR OUTLINE</span>}
        {(diagnosticsExpanded || (!controlActivity.parsedFontPaths && controlActivity.outlineActive)) && controlActivity.outlineActive && !controlActivity.parsedFontPaths && <span>FALLBACK NATIVE TEXT OUTLINE</span>}
      </div>}
      {diagnosticsVisible && <div className="renderer-diagnostics animation-diagnostics">
        <strong>ANIMATION</strong>
        <span>{formatFps(previewDiagnostics.frameTimeMs, previewDiagnostics.timingValidity)}</span>
        {diagnosticsExpanded && <span>CAP {previewSettings.fpsCap}</span>}
        {diagnosticsExpanded && <span>TARGET {(1000 / previewSettings.fpsCap).toFixed(1)}MS</span>}
        {diagnosticsExpanded && <span>DRAW INTERVAL {previewDiagnostics.frameTimeMs.toFixed(1)}MS</span>}
        {diagnosticsExpanded && <span>PACING {getFramePacingStatus(previewDiagnostics.frameTimeMs, 1000 / previewSettings.fpsCap, previewDiagnostics.timingValidity).toUpperCase()}</span>}
        {diagnosticsExpanded && <span>GEN {rendererTiming.durationMs.toFixed(1)}MS</span>}
        {diagnosticsExpanded && <span>EL {geometrySummary.elementCount}</span>}
        {diagnosticsExpanded && <span>PTS {geometrySummary.pointCount}</span>}
        {diagnosticsExpanded && <span>GEOMETRY {geometryRegenerated ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && <span>SUBSTRATE {substrateRebuilt ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && <span>DEBUG {debugRegenerated ? "YES" : "NO"}</span>}
        {diagnosticsExpanded && <span>CLOCK {previewDiagnostics.clockState.toUpperCase()}</span>}
        {diagnosticsExpanded && <span>BACKEND {previewBackend.toUpperCase()}</span>}
        {diagnosticsExpanded && <span>CANVAS {previewBackend === "canvas-2d" ? canvasSample?.drawTimeMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>}
        {diagnosticsExpanded && <span>DRAW ACTUAL {previewBackend === "canvas-2d" ? canvasSample?.actualDrawIntervalMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>}
        {diagnosticsExpanded && <span>DIAG UPDATE {previewBackend === "canvas-2d" ? canvasSample?.diagnosticsUpdateIntervalMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>}
        {diagnosticsExpanded && <span>SVG DOM {previewBackend === "svg-dom" ? geometrySummary.elementCount : 0}</span>}
        {diagnosticsExpanded && state.renderer === "flow" && previewBackend === "svg-dom" && (
          <span>FLOW PATHS {FLOW_PREVIEW_BUCKET_COUNT} / UPD {flowPreviewStatsRef.current?.attributeWrites ?? 0}</span>
        )}
        {(diagnosticsExpanded || (previewBackend === "svg-dom" && geometrySummary.elementCount >= 500)) && previewBackend === "svg-dom" && geometrySummary.elementCount >= 500 && <span>SVG DEBUG / SLOW</span>}
        {diagnosticsExpanded && <span>CLIP {previewBackend === "canvas-2d" && canvasSample?.clippingActive ? "ACTIVE" : "SVG"}</span>}
        {(diagnosticsExpanded || (state.renderer === "flow" && previewBackend === "svg-dom" && previewSettings.backend !== "svg-dom")) && <span>SVG FALLBACK {state.renderer === "flow" && previewBackend === "svg-dom" && previewSettings.backend !== "svg-dom" ? "ACTIVE" : "NO"}</span>}
        {(diagnosticsExpanded || previewDiagnostics.timingValidity !== "valid") && previewDiagnostics.timingValidity !== "valid" && <span>TIMING {previewDiagnostics.timingValidity.toUpperCase()}</span>}
      </div>}
        {exportWarnings.length > 0 && <div className="export-warnings">
          <strong>EXPORT CHECK</strong>
          <span>{exportWarnings.join(" ")}</span>
        </div>}
      {performanceWarnings.length > 0 && <div className="performance-warnings"><strong>PERFORMANCE</strong> {performanceWarnings.join(" ")}</div>}
        {(substrateError || debugImage.error) && <div className="substrate-error">{substrateError ?? debugImage.error}</div>}
      </div>, hudHost)}
    </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function GeometryElement({ geometry }: { geometry: VectorGeometry }) {
  if (geometry.type === "circle") return <circle cx={geometry.center.x} cy={geometry.center.y} r={geometry.radius} opacity={geometry.opacity} />;
  if (geometry.type === "line") return <line x1={geometry.start.x} y1={geometry.start.y} x2={geometry.end.x} y2={geometry.end.y} opacity={geometry.opacity} />;
  if (geometry.type === "polyline") return <polyline fill="none" points={geometry.points.map((point) => `${point.x},${point.y}`).join(" ")} opacity={geometry.opacity} />;
  return <path d={geometry.d} opacity={geometry.opacity} />;
}
