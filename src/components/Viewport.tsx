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

interface ViewportProps {
  state: ProjectState; context: RenderContext; geometry: GeometryGroup; textGeometry: TextGeometry | null;
  exportDiagnostics: SvgDiagnostics | null; exportWarnings: string[]; performanceWarnings: string[];
  glyphLayoutTimeMs: number; substrateError: string | null; substrateBackendStatus: SubstrateBackendStatus;
  previewDiagnostics: PreviewDiagnostics; previewBackend: PreviewBackend; previewSettings: PreviewSettings;
  previewRunning: boolean; canvasSample: CanvasPreviewSample | null;
  onCanvasSample: (sample: CanvasPreviewSample) => void; onCanvasFailure: () => void;
}

export function Viewport({ state, context, geometry, textGeometry, exportDiagnostics, exportWarnings, performanceWarnings, glyphLayoutTimeMs, substrateError, substrateBackendStatus, previewDiagnostics, previewBackend, previewSettings, previewRunning, canvasSample, onCanvasSample, onCanvasFailure }: ViewportProps) {
  const renderer = getRenderer(state.renderer);
  const geometrySummary = useMemo(() => summarizeGeometry(geometry), [geometry]);
  const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));
  const bounds = textGeometry?.bounds ?? getTextBounds(state);
  const hasGlyphPaths = Boolean(textGeometry?.hasOutlines);
  const substrate = context.substrateData ?? null;
  const debugImage = useDeferredDebugImage(substrate, state.debug.substrateMode);
  const waveFieldDebugUrl = useWaveFieldDebugImage(state, context, state.debug.waveField);
  const rendererTiming = getRendererTiming(geometry);
  const previousFrame = useRef({
    geometry,
    substrate,
    debugGenerationId: debugImage.generationId,
  });
  const geometryRegenerated = previousFrame.current.geometry !== geometry;
  const substrateRebuilt = previousFrame.current.substrate !== substrate;
  const debugRegenerated = previousFrame.current.debugGenerationId !== debugImage.generationId;
  previousFrame.current = { geometry, substrate, debugGenerationId: debugImage.generationId };
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
        </defs>
        <g id={SVG_IDS.artwork} mask={(renderer.clipPreviewToText?.(state) ?? true) ? `url(#${SVG_IDS.mask})` : undefined} className="marks">
          {state.renderer === "flow" && previewBackend === "svg-dom"
            ? <FlowPreview geometry={geometry} />
            : state.renderer !== "flow"
              ? geometry.geometries.map((item, index) => <GeometryElement key={index} geometry={item} />)
              : null}
        </g>
        {renderer.showTextOverlay?.(state) && (hasGlyphPaths
          ? <g className="diffuser-text-overlay" opacity={renderer.textOverlayOpacity?.(state) ?? 1}>{textGeometry!.glyphs.map((glyph) => glyph.path.d && <path key={glyph.textIndex} d={glyph.path.d} />)}</g>
          : <text className="diffuser-text-overlay" opacity={renderer.textOverlayOpacity?.(state) ?? 1} {...textAttributes(layout)}>{layout.text}</text>)}
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
        {getBackendDiagnosticItems(substrateBackendStatus).map((item) => <span key={item}>{item}</span>)}
      </div>
      {geometry.diagnostics && (
        <div className={`renderer-diagnostics${geometry.diagnostics.fallback ? " warning" : ""}`}>
          <strong>{renderer.label.toUpperCase()}</strong>
          {geometry.diagnostics.requestedDots !== undefined
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
            : geometry.diagnostics.contourLevelCount !== undefined
            ? <>
                <span>LEVELS {geometry.diagnostics.contourLevelCount}</span>
                <span>FRAG {geometry.diagnostics.extractedFragments}</span>
                <span>POINTS {geometry.diagnostics.totalContourPoints}</span>
                <span>SKIP {geometry.diagnostics.skippedFragments}</span>
                <span>MAX D {geometry.diagnostics.maxPositiveDistance?.toFixed(1)}</span>
                <span>AVG LEN {geometry.diagnostics.averageFragmentLength?.toFixed(1)}</span>
                <span>CLIPPED {geometry.diagnostics.maxNodesClipped ? "YES" : "NO"}</span>
              </>
            : geometry.diagnostics.requestedStreamlines !== undefined
              ? <>
                <span>LINES {geometry.diagnostics.acceptedStreamlines} / {geometry.diagnostics.requestedStreamlines}</span>
                <span>REJECT {geometry.diagnostics.rejectedSeeds}</span>
                <span>POINTS {geometry.diagnostics.totalPolylinePoints}</span>
                <span>AVG PTS {geometry.diagnostics.averagePointsPerStreamline?.toFixed(1)}</span>
                <span>OUT {geometry.diagnostics.stoppedOutsideMask}</span>
                <span>GRAD {geometry.diagnostics.stoppedInvalidGradient}</span>
                <span>OCC {geometry.diagnostics.occupancyRejections}</span>
                </>
              : <>
                <span>A {geometry.diagnostics.acceptedCandidates}</span>
                <span>R {geometry.diagnostics.rejectedCandidates}</span>
                </>}
          <span>AVG D {geometry.diagnostics.averageSampledDistance.toFixed(1)}</span>
          <span>SUBSTRATE {geometry.diagnostics.substrateAvailable ? "YES" : "NO"}</span>
          <span>FALLBACK {geometry.diagnostics.fallback ? "YES" : "NO"}</span>
          {geometry.diagnostics.warning && <span>{geometry.diagnostics.warning}</span>}
        </div>
      )}
      <div className="renderer-diagnostics instrument-diagnostics">
        <strong>{renderer.label.toUpperCase()}</strong>
        <span>TYPE {geometrySummary.geometryType.toUpperCase()}</span>
        <span>EL {geometrySummary.elementCount}</span>
        <span>PTS {geometrySummary.pointCount}</span>
        <span>NODES ~{geometrySummary.estimatedSvgNodes}</span>
        <span>SIZE ~{formatBytes(geometrySummary.estimatedByteSize)}</span>
        {exportDiagnostics && <span>EXACT {formatBytes(exportDiagnostics.byteSize)}</span>}
        {exportDiagnostics && <span>SVG {exportDiagnostics.serializationTimeMs.toFixed(1)}MS</span>}
        <span>GEN {rendererTiming.durationMs.toFixed(1)}MS{rendererTiming.cached ? " CACHED" : ""}</span>
        <span>SUB {substrate?.substrateType ?? "NONE"}</span>
        <span>CLIPPED {geometrySummary.maxNodesClipped ? "YES" : "NO"}</span>
        {geometry.diagnostics?.selectedGlyph && <span>EMITTER {geometry.diagnostics.selectedGlyph}</span>}
        {geometry.diagnostics?.emitterAnchorX !== undefined && <span>ANCHOR {geometry.diagnostics.emitterAnchorX.toFixed(1)}, {geometry.diagnostics.emitterAnchorY?.toFixed(1)}</span>}
        {geometry.diagnostics?.emitterSourceMode && <span>SOURCE {geometry.diagnostics.emitterSourceMode.toUpperCase()}</span>}
        {geometry.diagnostics?.fieldWidth && <span>FIELD {geometry.diagnostics.fieldWidth}×{geometry.diagnostics.fieldHeight}</span>}
        {geometry.diagnostics?.fieldMin !== undefined && <span>RANGE {geometry.diagnostics.fieldMin.toFixed(2)} / {geometry.diagnostics.fieldMax?.toFixed(2)}</span>}
        {geometry.diagnostics?.fieldBuildTimeMs !== undefined && <span>FIELD BUILD {geometry.diagnostics.fieldBuildTimeMs.toFixed(1)}MS</span>}
        {geometry.diagnostics?.contourExtractionTimeMs !== undefined && <span>{state.renderer === "glyph-diffuser" ? "SAMPLE" : "CONTOUR"} {geometry.diagnostics.contourExtractionTimeMs.toFixed(1)}MS</span>}
        {geometry.diagnostics?.fieldMembership && <span>MEMBERSHIP APPROX.</span>}
        {geometry.diagnostics?.waveContourMode && <span>MODE {geometry.diagnostics.waveContourMode.toUpperCase()}</span>}
        {geometry.diagnostics?.waveOutputCount !== undefined && <span>OUTPUT {geometry.diagnostics.waveOutputCount}</span>}
        {geometry.diagnostics?.diffuserDomain && <span>DOMAIN {geometry.diagnostics.diffuserDomain.toUpperCase()}</span>}
        {geometry.diagnostics?.diffuserComposition && <span>COMPOSE {geometry.diagnostics.diffuserComposition.toUpperCase()}</span>}
      </div>
      <div className="renderer-diagnostics animation-diagnostics">
        <strong>ANIMATION</strong>
        <span>{formatFps(previewDiagnostics.frameTimeMs, previewDiagnostics.timingValidity)}</span>
        <span>CAP {previewSettings.fpsCap}</span>
        <span>TARGET {(1000 / previewSettings.fpsCap).toFixed(1)}MS</span>
        <span>DRAW INTERVAL {previewDiagnostics.frameTimeMs.toFixed(1)}MS</span>
        <span>PACING {getFramePacingStatus(previewDiagnostics.frameTimeMs, 1000 / previewSettings.fpsCap, previewDiagnostics.timingValidity).toUpperCase()}</span>
        <span>GEN {rendererTiming.durationMs.toFixed(1)}MS</span>
        <span>EL {geometrySummary.elementCount}</span>
        <span>PTS {geometrySummary.pointCount}</span>
        <span>GEOMETRY {geometryRegenerated ? "YES" : "NO"}</span>
        <span>SUBSTRATE {substrateRebuilt ? "YES" : "NO"}</span>
        <span>DEBUG {debugRegenerated ? "YES" : "NO"}</span>
        <span>CLOCK {previewDiagnostics.clockState.toUpperCase()}</span>
        <span>BACKEND {previewBackend.toUpperCase()}</span>
        <span>CANVAS {previewBackend === "canvas-2d" ? canvasSample?.drawTimeMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>
        <span>DRAW ACTUAL {previewBackend === "canvas-2d" ? canvasSample?.actualDrawIntervalMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>
        <span>DIAG UPDATE {previewBackend === "canvas-2d" ? canvasSample?.diagnosticsUpdateIntervalMs.toFixed(1) ?? "0.0" : "0.0"}MS</span>
        <span>SVG DOM {previewBackend === "svg-dom" ? geometrySummary.elementCount : 0}</span>
        {previewBackend === "svg-dom" && geometrySummary.elementCount >= 500 && <span>SVG DEBUG / SLOW</span>}
        <span>CLIP {previewBackend === "canvas-2d" && canvasSample?.clippingActive ? "ACTIVE" : "SVG"}</span>
        <span>SVG FALLBACK {state.renderer === "flow" && previewBackend === "svg-dom" && previewSettings.backend !== "svg-dom" ? "ACTIVE" : "NO"}</span>
        {previewDiagnostics.timingValidity !== "valid" && <span>TIMING {previewDiagnostics.timingValidity.toUpperCase()}</span>}
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
