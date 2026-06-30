import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CanvasNavigation } from "../src/components/CanvasNavigation";

describe("CanvasNavigation", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(CanvasNavigation, null, createElement("div", { "data-testid": "artwork" }))));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("zooms with stage-local wheel handling and prevents canvas scroll", () => {
    const frame = container.querySelector<HTMLElement>(".canvas-navigation")!;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: 50, clientY: 40 });
    let dispatched = true;
    act(() => { dispatched = frame.dispatchEvent(wheel); });
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
});
