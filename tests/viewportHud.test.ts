import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasNavigation } from "../src/components/CanvasNavigation";
import { Viewport } from "../src/components/Viewport";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import type { DiagnosticsMode, RenderContext } from "../src/types";
import { planArtboardExpansionToText } from "../src/engine/artboardExpansion";

const context: RenderContext = { timeMs: 500, frame: 15 };

function viewport(mode: DiagnosticsMode) {
  return createElement(Viewport, {
    state: baseState,
    context,
    geometry: generateRendererGeometry(baseState, context),
    textGeometry: null,
    exportDiagnostics: null,
    exportWarnings: ["Export warning"],
    performanceWarnings: [],
    glyphLayoutTimeMs: 0,
    substrateError: null,
    substrateBackendStatus: {
      phase: "ready" as const,
      requestId: 1,
      requestedBackend: "cpu-main" as const,
      activeBackend: "cpu-main" as const,
      workerCapability: null,
      fallbackCode: null,
      fallbackReason: null,
      timing: null,
      activeRequestId: null,
      latestRequestedId: 1,
      pendingRequestCount: 0,
      coalescedRequestCount: 0,
      droppedObsoleteRequestCount: 0,
      skippedObsoleteRequest: false,
    },
    previewDiagnostics: {
      estimatedFps: 30,
      frameTimeMs: 33.3,
      timingValidity: "valid" as const,
      clockState: "running" as const,
    },
    previewBackend: "svg-dom" as const,
    previewSettings: {
      fpsCap: 30 as const,
      pauseWhenHidden: true,
      reducedMotion: false,
      backend: "svg-dom" as const,
      quality: "full" as const,
    },
    previewRunning: true,
    canvasSample: null,
    onCanvasSample: () => undefined,
    onCanvasFailure: () => undefined,
    diagnosticsMode: mode,
  });
}

describe("viewport space separation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function renderMode(mode: DiagnosticsMode) {
    act(() => root.render(createElement(CanvasNavigation, null, viewport(mode))));
  }

  it("keeps artwork and artwork debug geometry inside the zoom transform", () => {
    renderMode("full");
    const transform = container.querySelector(".canvas-navigation-transform")!;
    expect(transform.contains(container.querySelector("[data-viewport-space='artwork']"))).toBe(true);
    expect(transform.contains(container.querySelector(".artboard"))).toBe(true);
    expect(transform.contains(container.querySelector(".ghost-text"))).toBe(true);
  });

  it("portals HUD diagnostics and warnings outside the zoom transform", () => {
    renderMode("full");
    const transform = container.querySelector(".canvas-navigation-transform")!;
    const hud = container.querySelector("[data-viewport-space='screen']")!;
    expect(container.querySelector(".viewport-hud-layer")?.contains(hud)).toBe(true);
    expect(transform.contains(hud)).toBe(false);
    expect(transform.contains(container.querySelector(".backend-diagnostics"))).toBe(false);
    expect(transform.contains(container.querySelector(".export-warnings"))).toBe(false);
  });

  it("preserves off, compact, and full diagnostics semantics", () => {
    renderMode("off");
    expect(container.querySelector(".backend-diagnostics")).toBeNull();
    expect(container.querySelector(".instrument-diagnostics")).toBeNull();
    expect(container.querySelector(".sampling-diagnostics")).toBeNull();
    expect(container.querySelector(".export-warnings")).not.toBeNull();

    renderMode("compact");
    expect(container.querySelector(".backend-diagnostics")).not.toBeNull();
    expect(container.querySelector(".instrument-diagnostics")).not.toBeNull();
    expect(container.querySelector(".sampling-diagnostics")).toBeNull();
    expect(container.querySelector(".renderer-diagnostics")?.textContent).toContain("MARKS");
    expect(container.querySelector(".renderer-diagnostics")?.textContent).toContain("GLYPHS");
    expect(container.textContent).not.toContain("TYPE LINE");

    renderMode("full");
    expect(container.textContent).toContain("TYPE LINE");
    expect(container.querySelector(".sampling-diagnostics")?.textContent).toContain("CANDIDATES");
    expect(container.querySelector(".sampling-diagnostics")?.textContent).toContain("Sampling diagnostics unavailable: native-text fallback");
    expect(container.querySelector(".canvas-navigation-transform")?.contains(container.querySelector(".sampling-diagnostics"))).toBe(false);
  });

  it("updates only the artwork transform while HUD controls remain clickable", () => {
    renderMode("compact");
    const transform = container.querySelector<HTMLElement>(".canvas-navigation-transform")!;
    const hud = container.querySelector<HTMLElement>(".viewport-hud-layer")!;
    const initialHudStyle = hud.getAttribute("style");
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")!.click());
    expect(transform.style.transform).toBe("translate(0px, 0px) scale(1.25)");
    expect(hud.getAttribute("style")).toBe(initialHudStyle);
    expect(container.querySelector("[aria-label='Canvas zoom']")?.textContent).toBe("125%");
  });

  it("renders the explicit artboard expansion action in the screen-space warning HUD", () => {
    const state = { ...baseState, text: "SUBSTRATE", fontSize: 560 };
    const plan = planArtboardExpansionToText(state, null);
    let expanded = false;
    const baseViewport = viewport("off");
    act(() => root.render(createElement(CanvasNavigation, null, createElement(Viewport, {
      ...baseViewport.props,
      state,
      exportWarnings: ["Text bounds exceed the artboard. Export will be clipped to the artboard viewBox."],
      artboardExpansionPlan: plan,
      onExpandArtboardToText: () => { expanded = true; },
    }))));
    const button = container.querySelector<HTMLButtonElement>(".expand-artboard-action")!;
    expect(button).not.toBeNull();
    expect(container.querySelector(".viewport-hud-layer")?.contains(button)).toBe(true);
    expect(container.querySelector(".canvas-navigation-transform")?.contains(button)).toBe(false);
    act(() => button.click());
    expect(expanded).toBe(true);
  });

  it("uses configured contour thickness in the SVG preview", () => {
    const state = {
      ...baseState,
      renderer: "sdf-contours" as const,
      contourStrokeWidth: 3.25,
    };
    const baseViewport = viewport("off");
    act(() => root.render(createElement(CanvasNavigation, null, createElement(Viewport, {
      ...baseViewport.props,
      state,
      geometry: {
        id: "preview-contour",
        geometries: [{
          type: "polyline" as const,
          points: [{ x: 10, y: 10 }, { x: 40, y: 40 }, { x: 80, y: 10 }],
          opacity: 1,
        }],
      },
    }))));
    expect(container.querySelector("#generated-artwork")?.getAttribute("stroke-width")).toBe("3.25");
  });
});
