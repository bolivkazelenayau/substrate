import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import App from "../src/App";

describe("dev-only WebGPU overlay gating", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders the dev-only GPU FIELD DEBUG toggle in dev builds", () => {
    expect(import.meta.env.DEV).toBe(true);
    act(() => {
      root.render(createElement(App));
    });
    const button = container.querySelector(
      "button[aria-label*='WebGPU field debug overlay']",
    );
    expect(button, "dev GPU debug toggle should render in dev builds").not.toBeNull();
    expect(button!.textContent).toMatch(/GPU FIELD DEBUG/);
  });

  it("does not render the overlay panel until the toggle is opened", () => {
    act(() => {
      root.render(createElement(App));
    });
    expect(
      container.querySelector("[data-dev-web-gpu-overlay='true']"),
    ).toBeNull();
  });
});