import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasNavigation } from "../src/components/CanvasNavigation";
import {
  getNavigationCompositingMode,
  resetNavigationCounters,
  setNavigationCompositingMode,
  snapshotNavigationCounters,
} from "../src/dev/viewportNavigationInstrumentation";

/** Flush any pending `requestAnimationFrame` so coalesced updates commit. */
async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

// A tiny counter that increments whenever `RenderProbe`'s body runs. Used to
// prove the children prop passed into `CanvasNavigation` does not re-run on
// viewport-only state changes (the element-bailout invariant).
function RenderProbe({ signal }: { signal: { mounts: number } }) {
  signal.mounts += 1;
  return createElement("div", { "data-testid": "probe" });
}

describe("CanvasNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    setNavigationCompositingMode("crisp");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(CanvasNavigation, null, createElement("div", { "data-testid": "artwork" }))));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setNavigationCompositingMode("crisp");
  });

  it("zooms with stage-local wheel handling and prevents canvas scroll", async () => {
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 50, clientY: 40 });
    let dispatched = true;
    act(() => { dispatched = frame.dispatchEvent(wheel); });
    await flushAnimationFrame();
    expect(dispatched).toBe(false);
    expect(Number(container.querySelector<HTMLElement>(".canvas-navigation-transform")!.dataset.canvasZoom)).toBeGreaterThan(1);
    expect(container.querySelector(".canvas-navigation-controls output")?.textContent).not.toBe("100%");
  });

  it("updates the zoom label with controls and FIT restores centered 100%", () => {
    const zoomIn = container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")!;
    const fit = container.querySelector<HTMLButtonElement>("button[aria-label='Fit canvas']")!;
    act(() => zoomIn.click());
    expect(container.querySelector(".canvas-navigation-controls output")?.textContent).toBe("125%");
    act(() => fit.click());
    expect(container.querySelector(".canvas-navigation-controls output")?.textContent).toBe("100%");
    expect(container.querySelector<HTMLElement>(".canvas-navigation-transform")?.style.transform).toBe("translate(0px, 0px) scale(1)");
  });

  it("keeps navigation controls outside the transformed artwork wrapper", () => {
    const frame = container.querySelector(".canvas-navigation")!;
    const transform = container.querySelector(".canvas-navigation-transform")!;
    const controls = container.querySelector(".canvas-navigation-controls")!;
    expect(transform.contains(frame.querySelector("[data-testid='artwork']"))).toBe(true);
    expect(transform.contains(controls)).toBe(false);
  });

  it("coalesces a burst of wheel events into a single React commit per frame", async () => {
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    resetNavigationCounters();
    act(() => {
      for (let i = 0; i < 6; i += 1) {
        frame.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 50, clientY: 40 }));
      }
    });
    expect(snapshotNavigationCounters().wheelEvents).toBe(6);
    expect(snapshotNavigationCounters().viewportActiveUpdates).toBe(0); // not yet committed
    await flushAnimationFrame();
    const after = snapshotNavigationCounters();
    expect(after.viewportActiveUpdates).toBe(1);
    expect(after.wheelEvents).toBe(6);
    const zoom = Number(container.querySelector<HTMLElement>(".canvas-navigation-transform")!.dataset.canvasZoom);
    expect(zoom).toBeGreaterThan(1);
  });

  it("uses the crisp 2D transform by default and does not promote a compositor layer", () => {
    const zoomIn = container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")!;
    act(() => zoomIn.click());
    const wrapper = container.querySelector<HTMLElement>(".canvas-navigation-transform")!;
    expect(getNavigationCompositingMode()).toBe("crisp");
    expect(wrapper.dataset.navigationCompositing).toBe("crisp");
    expect(wrapper.classList.contains("is-composited")).toBe(false);
    // The crisp default must NOT use `translate3d` (which promotes a GPU layer
    // and causes the transient zoom blur on a vector preview surface).
    expect(wrapper.style.transform).toContain("translate(");
    expect(wrapper.style.transform).not.toContain("translate3d(");
    expect(wrapper.style.transform).toContain("scale(");
  });

  it("composited dev mode switches to translate3d and tags the wrapper for will-change while active", async () => {
    setNavigationCompositingMode("composited");
    // Re-mount so the component re-reads the runtime compositing mode.
    act(() => root.render(createElement(CanvasNavigation, null, createElement("div", { "data-testid": "artwork" }))));
    const wrapper = container.querySelector<HTMLElement>(".canvas-navigation-transform")!;
    expect(getNavigationCompositingMode()).toBe("composited");
    expect(wrapper.dataset.navigationCompositing).toBe("composited");
    expect(wrapper.classList.contains("is-composited")).toBe(true);
    const zoomIn = container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']")!;
    act(() => zoomIn.click());
    expect(wrapper.style.transform).toContain("translate3d(");
    expect(wrapper.style.transform).toContain("scale(");
    // Firing a wheel event marks the active interaction so the gated
    // `will-change: transform` rule applies during the gesture only.
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    act(() => {
      frame.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 50, clientY: 40 }));
    });
    expect(wrapper.classList.contains("is-active-interaction")).toBe(true);
    expect(wrapper.classList.contains("is-composited")).toBe(true);
  });

  it("marks the transform wrapper as an active interaction during zoom and auto-clears after idle", async () => {
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    let dispatched = true;
    act(() => {
      dispatched = frame.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 50, clientY: 40 }));
    });
    expect(dispatched).toBe(false);
    const wrapper = container.querySelector<HTMLElement>(".canvas-navigation-transform")!;
    expect(wrapper.classList.contains("is-active-interaction")).toBe(true);
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 320));
    });
    expect(wrapper.classList.contains("is-active-interaction")).toBe(false);
  });
});

describe("CanvasNavigation viewport-only invariant", () => {
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

  it("does not re-run the artwork child body while zooming with wheel events", async () => {
    const probe = { mounts: 0 };
    act(() => root.render(createElement(CanvasNavigation, null, createElement(RenderProbe, { signal: probe }))));
    expect(probe.mounts).toBe(1);
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    act(() => {
      for (let i = 0; i < 8; i += 1) {
        frame.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -150, clientX: 50, clientY: 40 }));
      }
    });
    await flushAnimationFrame();
    expect(probe.mounts).toBe(1);
    // Sanity: the zoom did advance and committed.
    expect(Number(container.querySelector<HTMLElement>(".canvas-navigation-transform")!.dataset.canvasZoom)).toBeGreaterThan(1);
  });

  it("instrumentation snapshots counters and exposes reset", () => {
    resetNavigationCounters();
    expect(snapshotNavigationCounters().canvasNavigationRenders).toBe(0);
    act(() => root.render(createElement(CanvasNavigation, null, createElement("div", { "data-testid": "artwork" }))));
    expect(snapshotNavigationCounters().canvasNavigationRenders).toBeGreaterThanOrEqual(1);
  });
});