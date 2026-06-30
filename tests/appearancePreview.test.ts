import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Viewport } from "../src/components/Viewport";
import { shouldRunPreviewAnimation } from "../src/engine/previewBackend";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry, rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import type { ProjectState, RenderContext } from "../src/types";

const context: RenderContext = { timeMs: 500, frame: 15 };
const previewSettings = {
  fpsCap: 30 as const,
  pauseWhenHidden: true,
  reducedMotion: false,
  backend: "svg-dom" as const,
  quality: "full" as const,
};

function previewMarkup(state: ProjectState, previewBackend: "svg-dom" | "canvas-2d" = "svg-dom") {
  const geometry = generateRendererGeometry(state, context);
  return renderToStaticMarkup(
    createElement(Viewport, {
      state,
      context,
      geometry,
      textGeometry: null,
      exportDiagnostics: null,
      exportWarnings: [],
      performanceWarnings: [],
      glyphLayoutTimeMs: 0,
      substrateError: null,
      substrateBackendStatus: {
        phase: "idle",
        requestId: 0,
        requestedBackend: "cpu-main",
        activeBackend: "cpu-main",
        workerCapability: null,
        fallbackCode: null,
        fallbackReason: null,
        timing: null,
        activeRequestId: null,
        latestRequestedId: 0,
        pendingRequestCount: 0,
        coalescedRequestCount: 0,
        droppedObsoleteRequestCount: 0,
        skippedObsoleteRequest: false,
      },
      previewDiagnostics: {
        estimatedFps: 30,
        frameTimeMs: 33.3,
        timingValidity: "valid",
        clockState: "running",
      },
      previewBackend,
      previewSettings: { ...previewSettings, backend: previewBackend },
      previewRunning: true,
      canvasSample: null,
      onCanvasSample: () => undefined,
      onCanvasFailure: () => undefined,
      diagnosticsMode: "compact",
    }),
  );
}

describe("artwork preview background separation", () => {
  it("uses an editor-only checker while keeping transparent SVG preview marks visible", () => {
    const opaque = { ...baseState, renderer: "dots" as const, transparentBackground: false, backgroundColor: "#123456" };
    const transparent = { ...opaque, transparentBackground: true };
    const opaqueMarkup = previewMarkup(opaque);
    const transparentMarkup = previewMarkup(transparent);

    expect(opaqueMarkup).toContain('data-preview-artwork-background=""');
    expect(opaqueMarkup).toContain('data-editor-transparent-preview="false"');
    expect(transparentMarkup).not.toContain('data-preview-artwork-background=""');
    expect(transparentMarkup).toContain('class="artboard-backing is-transparent"');
    expect(transparentMarkup).toContain('data-editor-transparent-preview="true"');
    expect(transparentMarkup).toContain('id="generated-artwork"');
    expect(transparentMarkup.match(/<circle/g)?.length).toBe(opaqueMarkup.match(/<circle/g)?.length);
  });

  it("keeps Canvas Flow above the backing without an SVG background covering it", () => {
    const state = { ...baseState, transparentBackground: true };
    const markup = previewMarkup(state, "canvas-2d");
    expect(markup).toContain('class="flow-canvas"');
    expect(markup).toContain('class="artboard-backing is-transparent"');
    expect(markup).not.toContain('data-preview-artwork-background=""');
  });

  it("does not change geometry, mark opacity, or animation state when transparency toggles", () => {
    const opaque = { ...baseState, renderer: "dots" as const, transparentBackground: false };
    const transparent = { ...opaque, transparentBackground: true };
    expect(rendererGeometryStateKey(transparent)).toBe(rendererGeometryStateKey(opaque));
    expect(generateRendererGeometry(transparent, context)).toBe(generateRendererGeometry(opaque, context));
    expect(previewMarkup(transparent).match(/opacity="[^"]+"/g)).toEqual(previewMarkup(opaque).match(/opacity="[^"]+"/g));
    expect(shouldRunPreviewAnimation(true, true, false, false)).toBe(true);
  });

  it("uses primary color for visible marks without background-color opacity coupling", () => {
    const first = { ...baseState, renderer: "dots" as const, primaryColor: "#ff3355", backgroundColor: "#111111" };
    const second = { ...first, backgroundColor: "#eeeeee" };
    expect(previewMarkup(first)).toContain("#ff3355");
    expect(previewMarkup(second).match(/opacity="[^"]+"/g)).toEqual(previewMarkup(first).match(/opacity="[^"]+"/g));
    expect(generateRendererGeometry(second, context)).toBe(generateRendererGeometry(first, context));
  });
});
