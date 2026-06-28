import { useMemo, useRef } from "react";
import { COLORS, SVG_IDS, VIEWPORT } from "../engine/constants";
import type { GeometryGroup, VectorGeometry } from "../engine/geometry";
import { getRenderer } from "../engine/renderers";
import { getTextBounds, getTextLayout, textAttributes } from "../engine/textLayout";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { SvgDiagnostics } from "../engine/svgValidation";
import { sampleDistanceGradient } from "../engine/substrate";
import type { PreviewDiagnostics, PreviewSettings, ProjectState, RenderContext } from "../types";
import { summarizeGeometry } from "../engine/rendererRuntime";
import { getRendererTiming } from "../engine/rendererRuntime";
import type { SubstrateBackendStatus } from "../engine/substrate";
import { getBackendDiagnosticItems } from "../engine/substrate";
import { useDeferredDebugImage } from "../hooks/useDeferredDebugImage";
import { FlowPreview } from "./FlowPreview";
import { CanvasFlowPreview, type CanvasPreviewSample } from "./CanvasFlowPreview";
import type { PreviewBackend } from "../engine/previewBackend";
import { formatFps, getFramePacingStatus } from "../engine/animationTiming";
import { useWaveFieldDebugImage } from "../hooks/useWaveFieldDebugImage";
import { generateEdgeErosionMarks } from "../engine/edgeErosion";
import { generateWarpedOutline, outlineWarpCacheKey } from "../engine/outlineWarp";
import { getControlActivity } from "../engine/controlOwnership";

interface ViewportProps {
  state: ProjectState; context: RenderContext; geometry: GeometryGroup; textGeometry: TextGeometry | null;
  exportDiagnostics: SvgDiagnostics | null; exportWarnings: string[]; performanceWarnings: string[];
  glyphLayoutTimeMs: number; substrateError: string | null; substrateBackendStatus: SubstrateBackendStatus;
  previewDiagnostics: PreviewDiagnostics; previewBackend: PreviewBackend; previewSettings: PreviewSettings;
  previewRunning: boolean; canvasSample: CanvasPreviewSample | null;
  onCanvasSample: (sample: CanvasPreviewSample) => void; onCanvasFailure: () => void;
  diagnosticsExpanded: boolean;
}

export function Viewport({ state, context, geometry, textGeometry, exportDiagnostics, exportWarnings, performanceWarnings, glyphLayoutTimeMs, substrateError, substrateBackendStatus, previewDiagnostics, previewBackend, previewSettings, previewRunning, canvasSample, onCanvasSample, onCanvasFailure, diagnosticsExpanded }: ViewportProps) {
  const renderer = getRenderer(state.renderer);
  const geometrySummary = useMemo(() => summarizeGeometry(geometry), [geometry]);
  const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));
  const bounds = textGeometry?.bounds ?? getTextBounds(state);
  const hasGlyphPaths = Boolean(textGeometry?.hasOutlines);
  const controlActivity = getControlActivity(state, hasGlyphPaths);
  const substrate = context.substrateData ?? null;
  const debugImage = useDeferredDebugImage(substrate, state.debug.substrateMode);
  const waveFieldDebugUrl = useWaveFieldDebugImage(state, context, state.debug.waveField);
  const rendererTiming = getRendererTiming(geometry);
  const showOverlay = renderer.showTextOverlay?.(state) ?? false;
  const erodeOverlay = showOverlay && state.diffuserComposition === "edge-eroded" && state.edgeErosionAmount > 0 && state.edgeErosionWidth > 0;
  const overlayFill = state.overlayMode === "knockout" ? COLORS.background : COLORS.artwork;
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
  previousFrame.current = { geometry, warpedOutline, warpCacheKey, substrate, debugGenerationId: debugImage.generationId };
  const gradientVectors = useMemo(() => {
    if (!substrate || state.debug.substrateMode !== "gradient") return [];
    const vectors: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (let y = 45; y < VIEWPORT.height; y += 45) {
      for (let x = 45; x < VIEWPORT.width; x += 45) {
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
  }, [substrate, state.debug.substrateMode]);

  return (
    <div className="stage">
      <div className="stage-meta top"><span>FIELD / {state.renderer.toUpperCase()}</span><span>{VIEWPORT.width} × {VIEWPORT.height}</span></div>
      {previewBackend === "canvas-2d" && (
        <CanvasFlowPreview
          state={state}
          textGeometry={textGeometry}
          running={previewRunning}
          fpsCap={previewSettings.fpsCap}
          pauseWhenHidden={previewSettings.pauseWhenHidden}
          onSample={onCanvasSample}
          onFailure={onCanvasFailure}
        />
      )}
      <svg className="artboard" viewBox={`0 0 ${VIEWPORT.width} ${VIEWPORT.height}`} aria-label={`Generative preview of ${state.text}`}>
        <defs>
          <mask id={SVG_IDS.mask}>
            <g id={SVG_IDS.substrateMask}>
              <rect width={VIEWPORT.width} height={VIEWPORT.height} fill="black" />
              {hasGlyphPaths
                ? textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} fill="white" />)
                : <text {...textAttributes(layout)} fill="white">{layout.text}</text>}
            </g>
          </mask>
          {erodeOverlay && (
            <mask id="diffuser-overlay-mask">
              <rect width={VIEWPORT.width} height={VIEWPORT.height} fill="black" />
              {hasGlyphPaths
                ? <>
                    <g fill="white" stroke="none" fillRule="evenodd">{hasWarpedOutline
                      ? warpedOutline.paths.map((path) => <path key={`warp-mask-${path.textIndex}`} d={path.d} />)
                      : textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={`fill-${glyph.textIndex}`} d={glyph.path.d} />)}</g>
                  </>
                : <>
                    <text {...textAttributes(layout)} fill="white" stroke="none">{layout.text}</text>
                  </>}
              <g id="diffuser-erosion-marks" fill="black" stroke="none">
                {erosionMarks.map((mark, index) => <circle key={index} cx={mark.x} cy={mark.y} r={mark.radius} opacity={mark.opacity} />)}
              </g>
            </mask>
          )}
        </defs>
        <g id={SVG_IDS.artwork} mask={(renderer.clipPreviewToText?.(state) ?? true) ? `url(#${SVG_IDS.mask})` : undefined} className="marks">
          {state.renderer === "flow" && previewBackend === "svg-dom"
            ? <FlowPreview geometry={geometry} />
            : state.renderer !== "flow"
              ? geometry.geometries.map((item, index) => <GeometryElement key={index} geometry={item} />)
              : null}
        </g>
        {showOverlay && <g className="diffuser-text-overlay" opacity={renderer.textOverlayOpacity?.(state) ?? 1}>
          {hasGlyphPaths
            ? <g style={{ fill: state.overlayMode === "outline" ? "none" : overlayFill, stroke: state.overlayMode === "outline" ? COLORS.artwork : "none" }} fillRule={hasWarpedOutline ? "evenodd" : undefined} strokeWidth={state.overlayMode === "outline" ? outlineStrokeWidth : undefined} mask={erodeOverlay && state.overlayMode !== "outline" ? "url(#diffuser-overlay-mask)" : undefined}>{hasWarpedOutline
                ? warpedOutline.paths.map((path) => <path key={`warp-${path.textIndex}`} d={path.d} data-warped-glyph={path.glyphIndex} />)
                : textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} />)}</g>
            : <text style={{ fill: state.overlayMode === "outline" ? "none" : overlayFill, stroke: state.overlayMode === "outline" ? COLORS.artwork : "none" }} strokeWidth={state.overlayMode === "outline" ? outlineStrokeWidth : undefined} mask={erodeOverlay && state.overlayMode !== "outline" ? "url(#diffuser-overlay-mask)" : undefined} {...textAttributes(layout)}>{layout.text}</text>}
        </g>}
        {hasGlyphPaths
          ? <g className="ghost-text glyph-ghost">{textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} />)}</g>
          : <text className="ghost-text" {...textAttributes(layout)}>{layout.text}</text>}
        {debugImage.url && <image className="debug-raster" href={debugImage.url} x="0" y="0" width={VIEWPORT.width} height={VIEWPORT.height} preserveAspectRatio="none" />}
        {waveFieldDebugUrl && <image className="debug-raster" href={waveFieldDebugUrl} x="0" y="0" width={VIEWPORT.width} height={VIEWPORT.height} preserveAspectRatio="none" />}
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
        {state.debug.maskBounds && <rect className="debug-line" x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} />}
        {state.debug.baseline && <line className="debug-baseline" x1="0" y1={layout.baselineY} x2={VIEWPORT.width} y2={layout.baselineY} />}
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
            <circle cx={geometry.diagnostics?.emitterAnchorX ?? VIEWPORT.centerX} cy={geometry.diagnostics?.emitterAnchorY ?? VIEWPORT.centerY} r="12" />
            {geometry.diagnostics?.emitterAnchorX !== undefined && geometry.diagnostics?.emitterAnchorY !== undefined && (
              <>
                <circle cx={geometry.diagnostics.emitterAnchorX} cy={geometry.diagnostics.emitterAnchorY} r={state.emitter.radius} />
                <path d={`M${geometry.diagnostics.emitterAnchorX - 18} ${geometry.diagnostics.emitterAnchorY}H${geometry.diagnostics.emitterAnchorX + 18}M${geometry.diagnostics.emitterAnchorX} ${geometry.diagnostics.emitterAnchorY - 18}V${geometry.diagnostics.emitterAnchorY + 18}`} />
              </>
            )}
          </g>
        )}
      </svg>
      <div className="coordinates">
        <span>0,0</span>
        <span>
          {state.debug.markCount && `${geometry.geometries.length} MARKS`}
          {state.debug.frameTime && ` · F${context.frame} / ${Math.round(context.timeMs)}MS`}
          {state.debug.costEstimate && exportDiagnostics && ` · ${exportDiagnostics.glyphPaths} GLYPHS · ${exportDiagnostics.generatedMarks} MARKS · ${exportDiagnostics.elementCount} EL · ${formatBytes(exportDiagnostics.byteSize)} · ${exportDiagnostics.substrateType.toUpperCase()}`}
        </span>
        <span>{VIEWPORT.width},{VIEWPORT.height}</span>
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
          <span>DEBUG {debugImage.pending ? "PENDING" : `${debugImage.durationMs.toFixed(1)}MS`}</span>
        </div>
      )}
      <div className={`backend-diagnostics ${substrateBackendStatus.phase}`}>
        <strong>BACKEND</strong>
        {(diagnosticsExpanded || substrateBackendStatus.phase !== "ready") && getBackendDiagnosticItems(substrateBackendStatus).map((item) => <span key={item}>{item}</span>)}
      </div>
      {geometry.diagnostics && (
        <div className={`renderer-diagnostics${geometry.diagnostics.fallback ? " warning" : ""}`}>
          <strong>{renderer.label.toUpperCase()}</strong>
          {diagnosticsExpanded && geometry.diagnostics.requestedDots !== undefined
            ? <>
                <span>DOTS {geometry.diagnostics.acceptedDots} / {geometry.diagnostics.requestedDots}</span>
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
          {!diagnosticsExpanded && geometry.diagnostics.maxNodesClipped && <span>CLIPPED YES</span>}
          {diagnosticsExpanded && <span>AVG D {geometry.diagnostics.averageSampledDistance.toFixed(1)}</span>}
          {diagnosticsExpanded && <span>SUBSTRATE {geometry.diagnostics.substrateAvailable ? "YES" : "NO"}</span>}
          {(diagnosticsExpanded || geometry.diagnostics.fallback) && <span>FALLBACK {geometry.diagnostics.fallback ? "YES" : "NO"}</span>}
          {(diagnosticsExpanded || geometry.diagnostics.warning) && geometry.diagnostics.warning && <span>{geometry.diagnostics.warning}</span>}
        </div>
      )}
      <div className="renderer-diagnostics instrument-diagnostics">
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
      </div>
      <div className="renderer-diagnostics control-diagnostics">
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
      </div>
      <div className="renderer-diagnostics animation-diagnostics">
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
        {(diagnosticsExpanded || (previewBackend === "svg-dom" && geometrySummary.elementCount >= 500)) && previewBackend === "svg-dom" && geometrySummary.elementCount >= 500 && <span>SVG DEBUG / SLOW</span>}
        {diagnosticsExpanded && <span>CLIP {previewBackend === "canvas-2d" && canvasSample?.clippingActive ? "ACTIVE" : "SVG"}</span>}
        {(diagnosticsExpanded || (state.renderer === "flow" && previewBackend === "svg-dom" && previewSettings.backend !== "svg-dom")) && <span>SVG FALLBACK {state.renderer === "flow" && previewBackend === "svg-dom" && previewSettings.backend !== "svg-dom" ? "ACTIVE" : "NO"}</span>}
        {(diagnosticsExpanded || previewDiagnostics.timingValidity !== "valid") && previewDiagnostics.timingValidity !== "valid" && <span>TIMING {previewDiagnostics.timingValidity.toUpperCase()}</span>}
      </div>
      {exportWarnings.length > 0 && <div className="export-warnings"><strong>EXPORT CHECK</strong> {exportWarnings.join(" ")}</div>}
      {performanceWarnings.length > 0 && <div className="performance-warnings"><strong>PERFORMANCE</strong> {performanceWarnings.join(" ")}</div>}
      {(substrateError || debugImage.error) && <div className="substrate-error">{substrateError ?? debugImage.error}</div>}
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
