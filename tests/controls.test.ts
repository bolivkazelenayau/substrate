import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Controls } from "../src/components/Controls";
import { baseState, presets } from "../src/engine/presets";
import type { ProjectState } from "../src/types";
import { getTextBounds } from "../src/engine/textLayout";

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

  it("defaults artboard overflow to clipping", () => {
    renderControls();
    openDisclosure("Export");
    expect(field("Artboard overflow", "select").value).toBe("clip");
    expect(container.textContent).toContain("It never shrinks automatically.");
  });

  const openDisclosure = (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button, `${label} disclosure`).toBeTruthy();
    act(() => button!.click());
  };

  it("shows field-study labels while preserving preset option values", () => {
    renderControls();
    const preset = field("Preset", "select") as HTMLSelectElement;
    const options = [...preset.options];
    expect(options[0]).toMatchObject({ value: "Edge Current", text: "TRACE / 01 — Edge Current" });
    expect(options[1]).toMatchObject({ value: "Sonic Ripple", text: "ARC / 02 — Sonic Ripple" });
    expect(options.at(-1)).toMatchObject({ value: "Custom", text: "Custom" });

    change(preset, "Sonic Ripple");
    expect(getUpdated()).toEqual({ ...baseState, ...presets["Sonic Ripple"], preset: "Sonic Ripple" });
  });

  it("uses contextual typography bounds and preserves an oversized current value", () => {
    renderControls({ ...baseState, fontSize: 777 });
    const size = field("Size", "input") as HTMLInputElement;
    expect(Number(size.max)).toBeGreaterThanOrEqual(777);
    expect(Number(size.max)).not.toBe(220);
    expect(size.value).toBe("777");
  });

  it("preserves the fallback text bounds center when changing size", () => {
    renderControls();
    const before = getTextBounds(baseState);
    change(field("Size", "input"), "500");
    const next = getUpdated()!;
    const after = getTextBounds(next);
    expect(after.y + after.height / 2).toBeCloseTo(before.y + before.height / 2, 8);
    expect(next.fontSize).toBe(500);
    expect(next.textOffsetY).not.toBe(baseState.textOffsetY);
  });

  it("renders all six controls and wires their existing state fields", () => {
    renderControls();
    openDisclosure("Advanced typography");

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
    openDisclosure("Emitters");

    const sourceGlyph = field("Source glyph", "select");
    const emitterEditor = sourceGlyph.closest(".emitter-editor");
    expect(emitterEditor).not.toBeNull();
    expect(emitterEditor?.textContent).toContain("Single emitter");
    expect([...container.querySelectorAll(".accordion-summary")]
      .some((summary) => summary.textContent?.includes("Emitters"))).toBe(true);

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
    openDisclosure("Advanced typography");
    openDisclosure("Emitters");
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
    openDisclosure("Emitters");
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
    openDisclosure("Emitters");

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
    openDisclosure("Preview");
    const quality = field("Preview Quality", "select") as HTMLSelectElement;
    expect(quality.value).toBe("full");
    expect(quality.parentElement?.textContent).toContain("every path stays synchronized");
    expect(quality.parentElement?.textContent).toContain("SVG export remains full quality");
  });

  it("shows an explicit Canvas Performance mode and Edge Current recommendation", () => {
    renderControls();
    openDisclosure("Preview");
    const mode = field("Preview Mode", "select") as HTMLSelectElement;
    expect(mode.value).toBe("canvas-2d");
    expect(mode.textContent).toContain("Canvas Performance · preview only");
    expect(mode.textContent).toContain("SVG Accuracy · vector DOM");
    expect(mode.parentElement?.textContent).toContain("Recommended for Edge Current");
    expect(mode.parentElement?.textContent).toContain("Preview only — does not affect SVG export");
    expect(mode.parentElement?.textContent).toContain("Canvas: faster / SVG: crisper");
  });

  it("uses one sequential number for each normal-path section", () => {
    renderControls();
    const sections = [...container.querySelectorAll(".section-heading")]
      .map((heading) => ({
        number: heading.querySelector(":scope > span")?.textContent,
        label: heading.querySelector("h2")?.textContent,
      }));
    expect(sections).toEqual([
      { number: "01", label: "Artwork" },
      { number: "02", label: "Preset / Renderer" },
      { number: "03", label: "Core Field" },
      { number: "04", label: "Appearance" },
      { number: "05", label: "Preview" },
      { number: "06", label: "Export" },
      { number: "07", label: "Diagnostics" },
    ]);
    expect(new Set(sections.map(({ number }) => number)).size).toBe(sections.length);
  });

  it("keeps advanced, preview, export, and diagnostic controls available", () => {
    renderControls();
    openDisclosure("Advanced typography");
    openDisclosure("Emitters");
    openDisclosure("Advanced Parameters");
    openDisclosure("Preview");
    openDisclosure("Export");
    openDisclosure("Diagnostics");

    [
      "Kerning strength",
      "Source glyph",
      "Frequency",
      "Preview Quality",
      "Editable Text SVG",
      "Numeric precision",
      "Import project JSON",
      "Diagnostics visibility",
      "Substrate view",
    ].forEach((label) => expect(container.textContent).toContain(label));
  });

  it("shows contour thickness only for continuous contour renderers", () => {
    renderControls({ ...baseState, renderer: "sdf-contours" });
    openDisclosure("Advanced Parameters");
    expect(field("Contour thickness", "input").value).toBe("1.15");
    expect(container.textContent).toContain("Controls the vector stroke width");

    renderControls({ ...baseState, renderer: "flow" });
    expect(container.textContent).not.toContain("Contour thickness");

    renderControls({ ...baseState, renderer: "wave-contours", waveContourMode: "continuous" });
    openDisclosure("Advanced Parameters");
    expect(field("Contour thickness", "input").value).toBe("1.15");

    renderControls({ ...baseState, renderer: "wave-contours", waveContourMode: "dotted" });
    expect(container.textContent).not.toContain("Contour thickness");
  });
});
