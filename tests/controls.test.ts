import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Controls } from "../src/components/Controls";
import { baseState } from "../src/engine/presets";
import type { ProjectState } from "../src/types";

const previewSettings = {
  fpsCap: 30 as const,
  pauseWhenHidden: true,
  reducedMotion: false,
  backend: "auto" as const,
};

describe("Safe Typography controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let updated: ProjectState | null;

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    updated = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderControls = () => {
    act(() => {
      root.render(createElement(Controls, {
        state: baseState,
        setState: (state: ProjectState) => { updated = state; },
        fileRef: { current: null },
        onImport: () => undefined,
        fontFileRef: { current: null },
        onFontUpload: () => undefined,
        onClearFont: () => undefined,
        fontLoaded: false,
        parsedFontPathsAvailable: false,
        previewSettings,
        onPreviewSettingsChange: () => undefined,
        emitterGlyphs: [],
        diagnosticsExpanded: false,
        onDiagnosticsExpandedChange: () => undefined,
      }));
    });
  };

  const field = (label: string, selector: "select" | "input") => {
    const wrapper = [...container.querySelectorAll("label")]
      .find((candidate) => candidate.querySelector("span")?.textContent?.startsWith(label));
    const control = wrapper?.querySelector(selector);
    expect(control, `${label} control`).not.toBeNull();
    return control as HTMLInputElement | HTMLSelectElement;
  };

  const change = (control: HTMLInputElement | HTMLSelectElement, value: string) => {
    act(() => {
      const prototype = control instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("renders all six controls and wires their existing state fields", () => {
    renderControls();

    change(field("Kerning mode", "select"), "none");
    expect(updated?.kerningMode).toBe("none");

    updated = null;
    change(field("Kerning strength", "input"), "1.4");
    expect(updated?.kerningStrength).toBe(1.4);

    updated = null;
    const opticalSpacing = field("Optical spacing", "input") as HTMLInputElement;
    act(() => opticalSpacing.click());
    expect(updated).toMatchObject({ opticalSpacing: true, opticalSpacingStrength: 0.25 });

    updated = null;
    change(field("Optical strength", "input"), "0.6");
    expect(updated?.opticalSpacingStrength).toBe(0.6);

    updated = null;
    change(field("Text alignment", "select"), "right");
    expect(updated?.textAlign).toBe("right");

    updated = null;
    change(field("Vertical offset", "input"), "-32");
    expect(updated?.textOffsetY).toBe(-32);
  });
});
