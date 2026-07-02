import { memo, useEffect, useRef } from "react";
import { consumeFrameBudget, updateTimingAverage } from "../engine/animationTiming";
import { batchFlowLinesForCanvas, createFlowPreviewFrame } from "../engine/flowPreviewFrame";
import type { TextGeometry } from "../engine/glyphGeometry";
import { getTextLayout } from "../engine/textLayout";
import type { PreviewFpsCap, ProjectState, RenderContext } from "../types";
import { projectArtboard } from "../engine/artboard";

export interface CanvasPreviewSample {
  context: RenderContext;
  drawTimeMs: number;
  frameTimeMs: number;
  estimatedFps: number;
  timingValidity: "valid" | "unstable" | "invalid";
  clippingActive: boolean;
  targetIntervalMs: number;
  actualDrawIntervalMs: number;
  diagnosticsUpdateIntervalMs: number;
}

interface Props {
  state: ProjectState;
  textGeometry: TextGeometry | null;
  running: boolean;
  fpsCap: PreviewFpsCap;
  pauseWhenHidden: boolean;
  onSample: (sample: CanvasPreviewSample) => void;
  onFailure: () => void;
}

export const CanvasFlowPreview = memo(function CanvasFlowPreview(props: Props) {
  const { state, textGeometry, running, fpsCap, pauseWhenHidden, onSample, onFailure } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context2d = canvas?.getContext("2d");
    if (!canvas || !context2d) {
      onFailure();
      return;
    }
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const artboard = projectArtboard(state);
    canvas.width = Math.round(artboard.width * ratio);
    canvas.height = Math.round(artboard.height * ratio);
    let glyphClip: Path2D | null = null;
    if (textGeometry?.hasOutlines && typeof Path2D !== "undefined") {
      try {
        glyphClip = new Path2D();
        textGeometry.glyphs.forEach((glyph) => glyph.path.d && glyphClip!.addPath(new Path2D(glyph.path.d)));
      } catch {
        glyphClip = null;
      }
    }
    let animationFrame = 0;
    let lastRaf = 0;
    let lastDraw = 0;
    let accumulatorMs = 0;
    let elapsedTime = 0;
    let frame = 0;
    let averageFrameMs = 0;
    let lastReport = 0;
    const minimumFrameMs = 1000 / fpsCap;
    const layout = getTextLayout(state, Boolean(textGeometry?.hasOutlines));

    const draw = (timeMs: number, frameNumber: number) => {
      const started = performance.now();
      const renderContext: RenderContext = { timeMs, frame: frameNumber, textGeometry, viewport: artboard };
      const previewFrame = createFlowPreviewFrame(state, renderContext);
      context2d.setTransform(ratio, 0, 0, ratio, 0, 0);
      context2d.clearRect(0, 0, artboard.width, artboard.height);
      if (!previewFrame.appearance.transparentBackground) {
        context2d.fillStyle = previewFrame.appearance.backgroundColor;
        context2d.fillRect(0, 0, artboard.width, artboard.height);
      }
      context2d.save();
      if (glyphClip) context2d.clip(glyphClip);
      context2d.strokeStyle = previewFrame.appearance.primaryColor;
      context2d.lineWidth = previewFrame.appearance.strokeWidth;
      context2d.lineCap = "round";
      for (const batch of batchFlowLinesForCanvas(previewFrame.lines)) {
        if (batch.lines.length === 0) continue;
        context2d.globalAlpha = batch.opacity;
        context2d.beginPath();
        for (const line of batch.lines) {
          context2d.moveTo(line.start.x, line.start.y);
          context2d.lineTo(line.end.x, line.end.y);
        }
        context2d.stroke();
      }
      if (!glyphClip) {
        context2d.globalCompositeOperation = "destination-in";
        context2d.globalAlpha = 1;
        context2d.fillStyle = "#fff";
        context2d.font = `${layout.fontWeight} ${layout.fontSize}px ${layout.fontFamily}`;
        context2d.textAlign = "center";
        context2d.fillText(layout.text, layout.x, layout.baselineY);
      }
      context2d.restore();
      return { renderContext, drawTimeMs: Math.max(0, performance.now() - started) };
    };

    const report = (result: ReturnType<typeof draw>, timing: ReturnType<typeof updateTimingAverage>, actualDrawIntervalMs: number, diagnosticsUpdateIntervalMs: number) => onSample({
      context: result.renderContext,
      drawTimeMs: result.drawTimeMs,
      frameTimeMs: timing.averageFrameMs,
      estimatedFps: timing.fps,
      timingValidity: timing.validity,
      clippingActive: true,
      targetIntervalMs: minimumFrameMs,
      actualDrawIntervalMs,
      diagnosticsUpdateIntervalMs,
    });

    if (!running) {
      const result = draw(0, 0);
      onSample({
        context: result.renderContext,
        drawTimeMs: result.drawTimeMs,
        frameTimeMs: 0,
        estimatedFps: 0,
        timingValidity: "valid",
        clippingActive: true,
        targetIntervalMs: minimumFrameMs,
        actualDrawIntervalMs: 0,
        diagnosticsUpdateIntervalMs: 0,
      });
      return;
    }
    const tick = (now: number) => {
      if (pauseWhenHidden && document.hidden) {
        lastRaf = 0;
        lastDraw = 0;
        accumulatorMs = 0;
      } else if (lastRaf === 0) {
        lastRaf = now;
      } else {
        const rafDelta = now - lastRaf;
        lastRaf = now;
        if (Number.isFinite(rafDelta) && rafDelta > 0) {
          accumulatorMs += Math.min(rafDelta, 1000);
          const budget = consumeFrameBudget(accumulatorMs, minimumFrameMs);
          if (budget.draw) {
          accumulatorMs = budget.remainderMs;
          const actualDrawInterval = lastDraw > 0 ? now - lastDraw : minimumFrameMs;
          lastDraw = now;
          elapsedTime += Math.min(actualDrawInterval, 1000);
          frame += 1;
          const timing = updateTimingAverage(averageFrameMs, actualDrawInterval);
          averageFrameMs = timing.averageFrameMs;
          const result = draw(elapsedTime, frame);
          if (now - lastReport >= 300) {
            const diagnosticsUpdateInterval = lastReport > 0 ? now - lastReport : 0;
            lastReport = now;
            report(result, timing, actualDrawInterval, diagnosticsUpdateInterval);
          }
          }
        } else {
          accumulatorMs = 0;
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [fpsCap, onFailure, onSample, pauseWhenHidden, running, state, textGeometry]);

  return <canvas ref={canvasRef} className="flow-canvas" aria-hidden="true" />;
});
