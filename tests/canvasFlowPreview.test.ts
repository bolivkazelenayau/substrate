import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CanvasFlowPreview } from "../src/components/CanvasFlowPreview";
import { baseState } from "../src/engine/presets";

describe("CanvasFlowPreview lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let nextFrameId: number;
  let requested: number[];
  let cancelled: number[];

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    nextFrameId = 1;
    requested = [];
    cancelled = [];

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      save: vi.fn(),
      clip: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineCap: "butt",
      font: "",
      textAlign: "start",
    } as unknown as CanvasRenderingContext2D);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => {
      const id = nextFrameId++;
      requested.push(id);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => cancelled.push(id)));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("owns one rAF loop and cleans it up across preset/backend remounts", () => {
    const onSample = vi.fn();
    const onFailure = vi.fn();
    const render = (state = baseState) => createElement(CanvasFlowPreview, {
      state,
      textGeometry: null,
      running: true,
      fpsCap: 60 as const,
      pauseWhenHidden: true,
      onSample,
      onFailure,
    });

    act(() => root.render(render()));
    expect(requested).toEqual([1]);
    expect(cancelled).toEqual([]);

    // Stable inputs do not create a second loop.
    act(() => root.render(render()));
    expect(requested).toEqual([1]);

    // A preset/state replacement cancels the old owner before starting another.
    act(() => root.render(render({ ...baseState, seed: baseState.seed + 1 })));
    expect(cancelled).toEqual([1]);
    expect(requested).toEqual([1, 2]);

    act(() => root.unmount());
    expect(cancelled).toEqual([1, 2]);
    expect(onFailure).not.toHaveBeenCalled();
  });
});
