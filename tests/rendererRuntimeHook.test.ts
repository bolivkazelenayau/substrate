import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStaticRenderContext } from "../src/engine/renderContextLifecycle";
import {
  clearRendererGeometryCache,
  generateRendererGeometry,
} from "../src/engine/rendererRuntime";
import { baseState } from "../src/engine/presets";
import { useRendererRuntime } from "../src/hooks/useRendererRuntime";
import type { ProjectState, RenderContext } from "../src/types";

type RuntimeResult = ReturnType<typeof useRendererRuntime>;

function RuntimeProbe(props: {
  project: ProjectState;
  liveContext: RenderContext;
  staticContext: RenderContext;
  publish: (result: RuntimeResult) => void;
}) {
  props.publish(useRendererRuntime(props.project, props.liveContext, props.staticContext));
  return null;
}

describe("useRendererRuntime ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: RuntimeResult;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    clearRendererGeometryCache();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(
    project: ProjectState,
    liveContext: RenderContext,
    staticContext: RenderContext,
  ) {
    act(() => root.render(createElement(RuntimeProbe, {
      project,
      liveContext,
      staticContext,
      publish: (result: RuntimeResult) => { latest = result; },
    })));
    return latest;
  }

  it("returns the current registry geometry and explicit runtime variants", () => {
    const project = { ...baseState, renderer: "dots" as const, maxNodes: 80 };
    const staticContext = createStaticRenderContext(project, null, null);
    const liveContext = { ...staticContext, timeMs: 120, frame: 7 };
    const expected = generateRendererGeometry(project, liveContext);
    const result = render(project, liveContext, staticContext);

    expect(result.liveGeometry).toBe(expected);
    expect(result.exportGeometry).toBe(result.liveGeometry);
    expect(result.estimateContext).toBe(staticContext);
    expect(result.geometrySummary.elementCount).toBe(result.exportGeometry.geometries.length);
  });

  it("animation ticks preserve static estimate and time-zero export geometry", () => {
    const project = {
      ...baseState,
      renderer: "flow" as const,
      exportFrameMode: "time-zero" as const,
      maxNodes: 80,
    };
    const staticContext = createStaticRenderContext(project, null, null);
    const first = render(project, { ...staticContext, timeMs: 100, frame: 3 }, staticContext);
    const second = render(project, { ...staticContext, timeMs: 900, frame: 27 }, staticContext);

    expect(second.liveGeometry).not.toBe(first.liveGeometry);
    expect(second.estimateGeometry).toBe(first.estimateGeometry);
    expect(second.exportGeometry).toBe(first.exportGeometry);
    expect(second.exportContext).toBe(staticContext);
  });

  it("appearance-only changes retain static renderer geometry", () => {
    const project = { ...baseState, renderer: "dots" as const, maxNodes: 80 };
    const staticContext = createStaticRenderContext(project, null, null);
    const first = render(project, staticContext, staticContext);
    const recolored = {
      ...project,
      primaryColor: "#ff0000",
      backgroundColor: "#001122",
      transparentBackground: !project.transparentBackground,
    };
    const recoloredStaticContext = createStaticRenderContext(recolored, null, null);
    const second = render(recolored, recoloredStaticContext, recoloredStaticContext);

    expect(second.geometryKey).toBe(first.geometryKey);
    expect(second.liveGeometry).toBe(first.liveGeometry);
    expect(second.estimateGeometry).toBe(first.estimateGeometry);
    expect(second.exportGeometry).toBe(first.exportGeometry);
  });

  it("time-dependent live geometry continues to bypass the static cache", () => {
    const project = { ...baseState, renderer: "flow" as const, maxNodes: 80 };
    const staticContext = createStaticRenderContext(project, null, null);
    const first = render(project, { ...staticContext, timeMs: 500, frame: 15 }, staticContext);
    const second = render(project, { ...staticContext, timeMs: 500, frame: 15 }, staticContext);

    expect(second.liveGeometry).not.toBe(first.liveGeometry);
    expect(second.liveGeometry).toEqual(first.liveGeometry);
  });
});
