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
  backend: "canvas-2d" as const,
  quality: "full" as const,
};

describe("Safe Typography controls", () => {
  let container: HTMLDivElement;
  let root: Root;
  let updated: ProjectState | null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    updated = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const renderControls = (state: ProjectState = baseState) => {
    act(() => {
      root.render(createElement(Controls, {
        state,
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
        diagnosticsMode: "compact",
        onDiagnosticsModeChange: () => undefined,
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

  const doubleClick = (control: HTMLInputElement) => {
    act(() => control.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  };

  const getUpdated = (): ProjectState | null => updated;

  it("renders all six controls and wires their existing state fields", () => {
    renderControls();

    change(field("Kerning mode", "select"), "none");
    expect(getUpdated()?.kerningMode).toBe("none");

    updated = null;
    change(field("Kerning strength", "input"), "1.4");
    expect(getUpdated()?.kerningStrength).toBe(1.4);

    updated = null;
    const opticalSpacing = field("Optical spacing", "input") as HTMLInputElement;
    act(() => opticalSpacing.click());
    expect(updated).toMatchObject({ opticalSpacing: true, opticalSpacingStrength: 0.25 });

    updated = null;
    change(field("Optical strength", "input"), "0.6");
    expect(getUpdated()?.opticalSpacingStrength).toBe(0.6);

    updated = null;
    change(field("Text alignment", "select"), "right");
    expect(getUpdated()?.textAlign).toBe("right");

    updated = null;
    change(field("Vertical offset", "input"), "-32");
    expect(getUpdated()?.textOffsetY).toBe(-32);
  });

  it("owns single-emitter controls in the main Emitters section", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitter: { ...baseState.emitter, enabled: true },
      emitterMode: "single",
    });

    const sourceGlyph = field("Source glyph", "select");
    const emitterEditor = sourceGlyph.closest(".emitter-editor");
    expect(emitterEditor).not.toBeNull();
    expect(emitterEditor?.textContent).toContain("Single emitter");
    expect(container.querySelector(".accordion-summary")?.textContent).toContain("Emitters");

    change(field("Radius", "input"), "620");
    expect(getUpdated()?.emitter.radius).toBe(620);
    updated = null;
    change(field("Phase", "input"), "1.4");
    expect(getUpdated()?.emitter.phase).toBe(1.4);
    updated = null;
    change(field("Strength", "input"), "2.2");
    expect(getUpdated()?.emitter.amplitude).toBe(2.2);

    const advanced = [...container.querySelectorAll(".accordion-group")]
      .find((group) => group.querySelector(".accordion-summary")?.textContent?.includes("Advanced Parameters"));
    expect(advanced?.textContent).not.toContain("Emitter Settings");
  });

  it("resets numeric controls through their normal update path without touching siblings", () => {
    renderControls({
      ...baseState,
      fontSize: 200,
      tracking: 12,
      emitter: { ...baseState.emitter, enabled: true, amplitude: 2.2, radius: 700 },
    });
    doubleClick(field("Size", "input") as HTMLInputElement);
    expect(getUpdated()).toMatchObject({ fontSize: baseState.fontSize, tracking: 12 });

    updated = null;
    doubleClick(field("Strength", "input") as HTMLInputElement);
    expect(getUpdated()?.emitter).toMatchObject({
      amplitude: baseState.emitter.amplitude,
      radius: 700,
    });
  });

  it("resets expanded emitter-row controls to the canonical row defaults", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitterMode: "multiple",
      emitter: { ...baseState.emitter, enabled: true },
      emitters: [{ ...baseState.emitters[0], id: "row", weight: 1.8, phaseOffset: 2, radiusMultiplier: 1.7 }],
    });
    act(() => container.querySelector<HTMLButtonElement>("button[aria-label='Expand emitter 1 controls']")!.click());
    doubleClick(field("Weight", "input") as HTMLInputElement);
    expect(getUpdated()?.emitters[0]).toMatchObject({
      weight: baseState.emitters[0].weight,
      phaseOffset: 2,
      radiusMultiplier: 1.7,
    });
  });

  it("shows row-local controls and clearly labeled shared controls in multiple mode", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitter: { ...baseState.emitter, enabled: true },
      emitterMode: "multiple",
      emitters: [
        { ...baseState.emitters[0], id: "first", enabled: true, label: "First" },
        { ...baseState.emitters[0], id: "second", enabled: true, label: "Second" },
      ],
    });

    expect(container.textContent).toContain("Global field shaping · all emitters");
    expect(container.textContent).toContain("Global base radius");
    expect(container.textContent).not.toContain("Single emitter");
    expect([...container.querySelectorAll("label")]
      .some((label) => label.querySelector("span")?.textContent?.startsWith("Radius"))).toBe(false);

    const expandSecond = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Expand emitter 2 controls']",
    );
    expect(expandSecond).not.toBeNull();
    act(() => expandSecond!.click());
    const rowRanges = [...container.querySelectorAll(".emitter-row-details label.range")];
    expect(rowRanges.map((label) => label.querySelector("span")?.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Weight"), expect.stringContaining("Phase"), expect.stringContaining("Radius ×")]),
    );

    change(field("Global base radius", "input"), "700");
    expect(getUpdated()?.emitter.radius).toBe(700);
    expect(getUpdated()?.emitters).toEqual([
      expect.objectContaining({ id: "first", radiusMultiplier: 1 }),
      expect.objectContaining({ id: "second", radiusMultiplier: 1 }),
    ]);
  });

  it("shows Full as the default preview-only quality control", () => {
    renderControls();
    const advancedOutput = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Advanced Output"));
    expect(advancedOutput).toBeTruthy();
    act(() => advancedOutput!.click());
    const quality = field("Preview Quality", "select") as HTMLSelectElement;
    expect(quality.value).toBe("full");
    expect(quality.parentElement?.textContent).toContain("every path stays synchronized");
    expect(quality.parentElement?.textContent).toContain("SVG export remains full quality");
  });

  it("shows an explicit Canvas Performance mode and Edge Current recommendation", () => {
    renderControls();
    const advancedOutput = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Advanced Output"));
    act(() => advancedOutput!.click());
    const mode = field("Preview Mode", "select") as HTMLSelectElement;
    expect(mode.value).toBe("canvas-2d");
    expect(mode.textContent).toContain("Canvas Performance · preview only");
    expect(mode.textContent).toContain("SVG Accuracy · vector DOM");
    expect(mode.parentElement?.textContent).toContain("Recommended for Edge Current");
    expect(mode.parentElement?.textContent).toContain("Export remains full vector SVG");
  });
});
