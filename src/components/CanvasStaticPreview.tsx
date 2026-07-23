import { memo, useEffect, useMemo, useRef } from "react";
import { getRenderer } from "../engine/renderers";
import { getTextLayout } from "../engine/textLayout";
import { LEGACY_PREVIEW_STROKE_WIDTH } from "../engine/contourStroke";
import { planCanvasBackingStore } from "../engine/safetyBudget";
import { sizeSceneTransformToCanvas, type SizeSceneTransform } from "../engine/sizeSceneTransform";
import type { GeometryGroup } from "../engine/geometry";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ProjectState } from "../types";
import { canvasWorldTransform, type CanvasWorldTransformArtboard } from "./canvasWorldTransform";
import type { CanvasPreviewSample } from "./CanvasFlowPreview";
import { interactionTraceEnabled, traceEvent, traceStartSpan } from "../dev/interactionTrace";

type ArtboardRect = CanvasWorldTransformArtboard;

interface Props {
  state: ProjectState;
  /** Presentation geometry (may be a size-draft variant); drawn once per identity. */
  geometry: GeometryGroup;
  textGeometry: TextGeometry | null;
  artboard: ArtboardRect;
  frameKey: string;
  sceneTransform?: SizeSceneTransform | null;
  onSample: (sample: CanvasPreviewSample) => void;
  onFailure: () => void;
}

// Opacity is quantized to 0.005 steps so thousands of per-mark opacities collapse
// into a handful of fill/stroke passes. The deviation is far below one display
// step and matches the flow preview's opacity-bucket approach.
const OPACITY_STEPS = 200;

/**
 * Bitmap preview for static (non-animated) renderers. The geometry group is
 * painted into a single canvas once per geometry/scene identity instead of one
 * SVG DOM node per mark. This keeps zoom/pan and slider edits off the SVG
 * repaint path for heavy scenes (halftone, contours, diffuser). Export is
 * unaffected: it serializes the authoritative geometry, not this preview.
 */
export const CanvasStaticPreview = memo(function CanvasStaticPreview(props: Props) {
  const {
    state,
    geometry,
    textGeometry,
    artboard: artboardRect,
    frameKey,
    sceneTransform = null,
    onSample,
    onFailure,
  } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stableArtboardRect = useMemo(
    () => ({
      x: artboardRect.x,
      y: artboardRect.y,
      width: artboardRect.width,
      height: artboardRect.height,
    }),
    [artboardRect.x, artboardRect.y, artboardRect.width, artboardRect.height],
  );

  const renderer = getRenderer(state.renderer);
  const strokeWidth = renderer.strokeWidth?.(state) ?? LEGACY_PREVIEW_STROKE_WIDTH;
  const clipToText = renderer.clipPreviewToText?.(state) ?? true;

  useEffect(() => {
    traceEvent({ stage: "canvas.lifecycle", phase: "start", frameKey, detail: { renderer: state.renderer, staticPreview: true } });
    let drawCount = 0;
    try {
      const canvas = canvasRef.current;
      const context2d = canvas?.getContext("2d");
      if (!canvas || !context2d) {
        traceEvent({ stage: "canvas.failure", phase: "instant", frameKey, detail: { reason: "2d-context-unavailable" } });
        onFailure();
        return;
      }
      const artboard = {
        ...stableArtboardRect,
        centerX: stableArtboardRect.x + stableArtboardRect.width / 2,
        centerY: stableArtboardRect.y + stableArtboardRect.height / 2,
      };
      // Backing storage follows the displayed preview, never the unbounded world artboard.
      const rect = canvas.getBoundingClientRect();
      const canvasPlan = planCanvasBackingStore({
        cssWidth: rect.width || canvas.clientWidth || artboard.width,
        cssHeight: rect.height || canvas.clientHeight || artboard.height,
        dpr: window.devicePixelRatio || 1,
      });
      canvas.width = canvasPlan.width;
      canvas.height = canvasPlan.height;
      traceEvent({
        stage: "canvas.resize",
        phase: "instant",
        frameKey,
        counts: { width: canvasPlan.width, height: canvasPlan.height },
        detail: { cssWidth: rect.width || canvas.clientWidth || artboard.width, cssHeight: rect.height || canvas.clientHeight || artboard.height },
      });
      const worldTransform = canvasWorldTransform(canvasPlan.width, canvasPlan.height, artboard);
      let glyphClip: Path2D | null = null;
      if (clipToText && textGeometry?.hasOutlines && typeof Path2D !== "undefined") {
        try {
          const combinedGlyphPath = textGeometry.glyphs.map((glyph) => glyph.path.d).filter(Boolean).join(" ");
          glyphClip = combinedGlyphPath ? new Path2D(combinedGlyphPath) : null;
        } catch {
          glyphClip = null;
        }
      }

      const drawTrace = traceStartSpan("canvas.draw", {
        frameKey,
        detail: { staticPreview: true, elements: geometry.geometries.length },
      });
      const started = performance.now();
      context2d.setTransform(1, 0, 0, 1, 0, 0);
      context2d.clearRect(0, 0, canvasPlan.width, canvasPlan.height);
      if (!state.transparentBackground) {
        context2d.fillStyle = state.backgroundColor;
        context2d.fillRect(0, 0, canvasPlan.width, canvasPlan.height);
      }
      context2d.setTransform(worldTransform.a, worldTransform.b, worldTransform.c, worldTransform.d, worldTransform.e, worldTransform.f);
      if (sceneTransform) {
        sizeSceneTransformToCanvas(context2d, sceneTransform);
      }
      context2d.save();
      if (glyphClip) context2d.clip(glyphClip);
      context2d.fillStyle = state.primaryColor;
      context2d.strokeStyle = state.primaryColor;
      context2d.lineWidth = strokeWidth;
      context2d.lineCap = "round";

      // Bucket marks by quantized opacity: one fill pass per bucket for circles,
      // one stroke pass per bucket for lines/polylines. Path geometries are few
      // and keep per-item alpha.
      const circleBuckets = new Map<number, Array<{ x: number; y: number; radius: number }>>();
      const strokeBuckets = new Map<number, typeof geometry.geometries>();
      for (const item of geometry.geometries) {
        const key = Math.max(0, Math.min(OPACITY_STEPS, Math.round(item.opacity * OPACITY_STEPS)));
        if (item.type === "circle") {
          const bucket = circleBuckets.get(key);
          if (bucket) bucket.push({ x: item.center.x, y: item.center.y, radius: item.radius });
          else circleBuckets.set(key, [{ x: item.center.x, y: item.center.y, radius: item.radius }]);
        } else if (item.type === "path") {
          context2d.globalAlpha = Math.max(0, Math.min(1, item.opacity));
          context2d.fill(new Path2D(item.d));
        } else {
          const bucket = strokeBuckets.get(key);
          if (bucket) bucket.push(item);
          else strokeBuckets.set(key, [item]);
        }
      }
      for (const [key, circles] of circleBuckets) {
        context2d.globalAlpha = key / OPACITY_STEPS;
        context2d.beginPath();
        for (const circle of circles) {
          context2d.moveTo(circle.x + circle.radius, circle.y);
          context2d.arc(circle.x, circle.y, circle.radius, 0, Math.PI * 2);
        }
        context2d.fill();
      }
      for (const [key, items] of strokeBuckets) {
        context2d.globalAlpha = key / OPACITY_STEPS;
        context2d.beginPath();
        for (const item of items) {
          if (item.type === "line") {
            context2d.moveTo(item.start.x, item.start.y);
            context2d.lineTo(item.end.x, item.end.y);
          } else if (item.type === "polyline" && item.points.length > 1) {
            context2d.moveTo(item.points[0].x, item.points[0].y);
            for (let index = 1; index < item.points.length; index += 1) {
              context2d.lineTo(item.points[index].x, item.points[index].y);
            }
          }
        }
        context2d.stroke();
      }
      if (clipToText && !glyphClip) {
        // Native-text fallback: knock the artwork down to the glyph mask, mirroring
        // the flow canvas path (the artboard backing layer below stays visible).
        const layout = getTextLayout(state, false);
        context2d.globalCompositeOperation = "destination-in";
        context2d.globalAlpha = 1;
        context2d.fillStyle = "#fff";
        context2d.font = `${layout.fontWeight} ${layout.fontSize}px ${layout.fontFamily}`;
        context2d.textAlign = "center";
        layout.lines.forEach((line) => context2d.fillText(line.text, line.x, line.baselineY));
      }
      context2d.restore();
      drawCount += 1;
      if (interactionTraceEnabled) {
        (canvas as HTMLCanvasElement & { __SUBSTRATE_CANVAS_DRAW_COUNT__?: number }).__SUBSTRATE_CANVAS_DRAW_COUNT__ = drawCount;
      }
      const drawTimeMs = Math.max(0, performance.now() - started);
      drawTrace({
        outputKey: frameKey,
        counts: { width: canvasPlan.width, height: canvasPlan.height, elements: geometry.geometries.length },
        detail: { drawCount, staticPreview: true },
      });
      traceEvent({ stage: "canvas.present", phase: "instant", frameKey, outputKey: frameKey, detail: { drawCount, backend: "canvas-2d", staticPreview: true } });
      onSample({
        context: { timeMs: 0, frame: 0 },
        drawTimeMs,
        frameTimeMs: 0,
        estimatedFps: 0,
        timingValidity: "valid",
        clippingActive: clipToText,
        targetIntervalMs: 0,
        actualDrawIntervalMs: 0,
        diagnosticsUpdateIntervalMs: 0,
      });
    } catch (error) {
      traceEvent({ stage: "canvas.failure", phase: "instant", frameKey, detail: { reason: error instanceof Error ? error.message : String(error) } });
      onFailure();
      return;
    }
    return () => {
      traceEvent({ stage: "canvas.lifecycle", phase: "end", frameKey, detail: { reason: "effect-cleanup" } });
    };
    // The scene is redrawn only when geometry/scene/appearance identities move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geometry, stableArtboardRect, sceneTransform, frameKey, onSample, onFailure, state.primaryColor, state.backgroundColor, state.transparentBackground, state.renderer, strokeWidth, clipToText, textGeometry]);

  return <canvas ref={canvasRef} className="flow-canvas" data-testid="artwork-canvas" aria-hidden="true" />;
});
