import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Controls } from "../src/components/Controls";
import { applyPreset, baseState, presets } from "../src/engine/presets";
import type { SizeRangeHandlers } from "../src/hooks/useSizeInteraction";
import type { ProjectState } from "../src/types";
import { getTextBounds } from "../src/engine/textLayout";

type ProjectSetter = (state: ProjectState | ((current: ProjectState) => ProjectState)) => void;

function createTestSizeHandlers(
  getState: () => ProjectState,
  setState: ProjectSetter,
): SizeRangeHandlers {
  let dragging = false;
  let latest = getState().fontSize;
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    setState({ ...getState(), fontSize: latest });
  };
  return {
    onPointerDown: (value, _pointerId, _element) => {
      dragging = true;
      latest = value;
    },
    onKeyDown: (value) => {
      dragging = true;
      latest = value;
    },
    onKeyUp: (value) => {
      latest = value;
      finish();
    },
    onInput: (value) => {
      latest = value;
      if (!dragging && value !== getState().fontSize) {
        setState({ ...getState(), fontSize: value });
      }
    },
    onPointerUp: (value) => {
      latest = value;
      finish();
    },
    onLostPointerCapture: (value) => {
      latest = value;
      finish();
    },
    onBlur: (value) => {
      latest = value;
      finish();
    },
    onDoubleClickReset: (_value, defaultValue) => {
      dragging = false;
      setState({ ...getState(), fontSize: defaultValue });
    },
  };
}

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

  const renderControls = (state: ProjectState = baseState, parsedFontPathsAvailable = false) => {
    let current = state;
    const setState: ProjectSetter = (next) => {
      current = typeof next === "function" ? next(current) : next;
      updated = current;
    };
    act(() => {
      root.render(createElement(Controls, {
        state: current,
        setState,
        fileRef: { current: null },
        onImport: () => undefined,
        fontFileRef: { current: null },
        onFontUpload: () => undefined,
        onClearFont: () => undefined,
        fontLoaded: false,
        parsedFontPathsAvailable,
        previewSettings,
        onPreviewSettingsChange: () => undefined,
        emitterGlyphs: [],
        diagnosticsMode: "compact",
        onDiagnosticsModeChange: () => undefined,
        sizeDisplayFontSize: current.fontSize,
        sizeHandlers: createTestSizeHandlers(() => current, setState),
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

  it("does not expose artboard containment as an export option", () => {
    renderControls();
    openDisclosure("Export");
    expect(container.textContent).not.toContain("Artboard overflow");
    expect(container.textContent).not.toContain("Auto-grow artboard");
  });

  const openDisclosure = (label: string) => {
    const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((candidate) => candidate.textContent?.includes(label));
    expect(button, `${label} disclosure`).toBeTruthy();
    if (button!.getAttribute("aria-expanded") !== "true") {
      act(() => button!.click());
    }
  };

  const openSurfaceDisclosure = (testId: string) => {
    const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"] button.surface-disclosure-summary`);
    expect(button, `${testId} disclosure`).toBeTruthy();
    if (button!.getAttribute("aria-expanded") !== "true") {
      act(() => button!.click());
    }
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
    expect(next.textOffsetY).toBe(baseState.textOffsetY);
  });

  const typeRangeValue = (label: string, raw: string) => {
    const wrapper = [...container.querySelectorAll("label.range")]
      .find((candidate) => {
        const heading = candidate.querySelector(":scope > span");
        return heading?.childNodes[0]?.textContent?.trim() === label
          || heading?.textContent?.trim().startsWith(label);
      });
    expect(wrapper, `${label} range`).toBeTruthy();
    const output = wrapper!.querySelector("output");
    expect(output, `${label} output`).toBeTruthy();
    act(() => output!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = wrapper!.querySelector<HTMLInputElement>("input.range-value-edit");
    expect(editor, `${label} value editor`).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(editor!, raw);
      editor!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      editor!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  };

  it("accepts typed values via double-click on Size, Tracking, Line height, Kerning strength, and Vertical offset", () => {
    renderControls();
    openDisclosure("Advanced typography");

    typeRangeValue("Size", "777");
    expect(getUpdated()?.fontSize).toBe(777);

    updated = null;
    typeRangeValue("Tracking", "12");
    expect(getUpdated()?.tracking).toBe(12);

    updated = null;
    typeRangeValue("Line height", "5.5");
    expect(getUpdated()?.lineHeight).toBe(5.5);

    updated = null;
    typeRangeValue("Kerning strength", "1.75");
    expect(getUpdated()?.kerningStrength).toBe(1.75);

    updated = null;
    typeRangeValue("Vertical offset", "-64");
    expect(getUpdated()?.textOffsetY).toBe(-64);
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
    expect(emitterEditor?.textContent).toContain("Source + field definition");
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
    expect(emitterEditor?.textContent).not.toContain("Blend");
    openDisclosure("Field detail");
    expect(container.textContent).toContain("Emitter blend");
  });

  it("exposes art-directable display, exclusion, and orbit behavior controls", () => {
    renderControls({
      ...baseState,
      renderer: "sdf-halftone",
      emitter: { ...baseState.emitter, enabled: true },
    });
    openDisclosure("Emitter Display Response");

    const behavior = field("Behavior", "select") as HTMLSelectElement;
    expect([...behavior.options].map((option) => option.value)).toEqual([
      "field", "distort", "exclude", "orbit",
    ]);
    change(behavior, "orbit");
    expect(getUpdated()?.emitterDisplay.mode).toBe("orbit");
    expect(container.textContent).toContain("Orbit amount");
    expect(container.textContent).toContain("Settle / repel");

    updated = null;
    openSurfaceDisclosure("emitter-display-tuning");
    expect(container.textContent).toContain("Interior suppression");
    change(field("Grid amount", "input"), "92");
    expect(getUpdated()?.emitterDisplay.gridAmount).toBe(92);
    updated = null;
    change(field("Interior suppression", "input"), "84");
    expect(getUpdated()?.emitterDisplay.interiorSuppression).toBe(84);
  });

  it("keeps Emitter Micro Response orthogonal, mode-aware, and honestly disabled", () => {
    renderControls({
      ...baseState,
      renderer: "sdf-halftone",
      emitter: { ...baseState.emitter, enabled: true },
    });
    openDisclosure("Emitter Micro Response");

    const group = container.querySelector(".emitter-micro-response");
    expect(group).not.toBeNull();
    expect(group?.closest(".glyph-displacement-section")).toBeNull();
    const enabled = container.querySelector<HTMLInputElement>('[data-testid="emitter-micro-enabled"]')!;
    const occupancy = container.querySelector<HTMLSelectElement>('[data-testid="emitter-micro-occupancy"]')!;
    expect(enabled.disabled).toBe(false);
    expect(container.querySelector('[data-testid="emitter-micro-occupancy-enabled"]')).toBeNull();
    expect([...occupancy.options].map((option) => option.value)).toEqual([
      "legacy", "exclude-interior", "disperse-exterior",
    ]);

    act(() => enabled.click());
    expect(getUpdated()?.emitterMicroResponse.enabled).toBe(true);
    openSurfaceDisclosure("emitter-micro-tuning");
    expect(container.textContent).toContain("Position detail");
    expect(container.textContent).toContain("Density breakup");
    expect(container.textContent).not.toContain("Tangential flow");

    updated = null;
    change(occupancy, "disperse-exterior");
    expect(getUpdated()?.emitterMicroResponse.occupancy).toBe("disperse-exterior");
    expect(container.textContent).toContain("Exterior push");
    expect(container.textContent).toContain("Tangential flow");
    expect(container.textContent).toContain("Exterior shell");
    change(occupancy, "legacy");
    expect(getUpdated()?.emitterMicroResponse.occupancy).toBe("legacy");

    updated = null;
    change(field("Position detail", "input"), "73");
    expect(getUpdated()?.emitterMicroResponse.positionDetail).toBe(73);

    renderControls({ ...baseState, renderer: "flow" });
    openDisclosure("Emitter Micro Response");
    expect(container.querySelector<HTMLInputElement>('[data-testid="emitter-micro-enabled"]')).toBeNull();
    expect(container.textContent).toContain("intentionally unaffected");
    expect(container.textContent).toContain("unavailable");
  });

  it("exposes an independent glyph-contour falloff mode and explicit ring frequency", () => {
    renderControls({ ...baseState, renderer: "sdf-halftone" });
    openDisclosure("Glyph Falloff Field");

    const group = container.querySelector(".glyph-falloff-displacement");
    const mode = container.querySelector<HTMLSelectElement>('[data-testid="glyph-falloff-mode"]')!;
    expect(group).not.toBeNull();
    expect([...mode.options].map((option) => option.value)).toEqual(["off", "contour-rings"]);
    expect(container.textContent).not.toContain("Ring frequency");

    change(mode, "contour-rings");
    expect(getUpdated()?.glyphFalloffDisplacement.mode).toBe("contour-rings");
    expect(container.textContent).toContain("Ring frequency");
    expect(container.textContent).toContain("number of contour-following cycles");

    updated = null;
    change(field("Ring frequency", "input"), "9");
    expect(getUpdated()?.glyphFalloffDisplacement.ringFrequency).toBe(9);

    renderControls({ ...baseState, renderer: "flow" });
    openDisclosure("Glyph Falloff Field");
    expect(container.querySelector<HTMLSelectElement>('[data-testid="glyph-falloff-mode"]')).toBeNull();
    expect(container.textContent).toContain("intentionally unaffected");
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

    expect(container.textContent).toContain("Shared field definition");
    expect(container.textContent).toContain("Radius");
    expect(container.textContent).not.toContain("Source + field definition");
    expect(container.querySelector(".emitter-row-details")).toBeNull();

    const expandSecond = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Expand emitter 2 controls']",
    );
    expect(expandSecond).not.toBeNull();
    act(() => expandSecond!.click());
    const rowRanges = [...container.querySelectorAll(".emitter-row-details label.range")];
    expect(rowRanges.map((label) => label.querySelector("span")?.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Weight"), expect.stringContaining("Phase"), expect.stringContaining("Radius ×")]),
    );

    const sharedRadius = [...container.querySelectorAll<HTMLLabelElement>('[data-owner="Emitter shared field definition"] label.range')]
      .find((label) => label.querySelector("span")?.textContent?.startsWith("Radius"))
      ?.querySelector<HTMLInputElement>("input[type='range']");
    expect(sharedRadius).not.toBeNull();
    change(sharedRadius!, "400");
    expect(getUpdated()?.emitter.radius).toBe(400);
    updated = null;
    openDisclosure("Field detail");
    change(field("Emitter blend", "select"), "max");
    expect(getUpdated()?.fieldBlendMode).toBe("max");
    expect(container.textContent).toContain("Combines overlapping emitter contributions in the shared field.");
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

  it("states the parsed-font boundary honestly and exposes art-direction displacement controls", () => {
    renderControls();
    openDisclosure("Glyph Fragmentation");
    const enabled = container.querySelector<HTMLInputElement>('[data-testid="glyph-displacement-enabled"]');
    expect(enabled?.disabled).toBe(true);
    expect(container.textContent).toContain("Native fallback stays undisplaced");

    renderControls(applyPreset(baseState, "Fragment Matrix"), true);
    openDisclosure("Glyph Fragmentation");
    const exactEnabled = container.querySelector<HTMLInputElement>('[data-testid="glyph-displacement-enabled"]');
    expect(exactEnabled?.disabled).toBe(false);
    expect(container.textContent).toContain("shared by mask, SDF, preview, and export");
    const mode = field("Mode", "select") as HTMLSelectElement;
    expect(mode.value).toBe("grid");
    change(mode, "horizontal-slices");
    expect(getUpdated()?.glyphDisplacement.mode).toBe("horizontal-slices");
    expect(container.querySelector(".glyph-displacement-section legend")?.textContent).toContain("Glyph fragmentation parameters");
  });

  it("exposes Glyph Micro Warp as a separate parsed-outline control group", () => {
    renderControls();
    openDisclosure("Glyph Micro Warp");
    const unsupported = container.querySelector<HTMLInputElement>('[data-testid="glyph-micro-warp-enabled"]');
    expect(unsupported?.disabled).toBe(true);
    expect(container.textContent).toContain("native fallback remains exactly unwarped");

    renderControls({
      ...baseState,
      emitter: { ...baseState.emitter, enabled: true },
      glyphMicroWarp: { ...baseState.glyphMicroWarp, enabled: true },
    }, true);
    const group = container.querySelector(".glyph-micro-warp-section");
    expect(group).not.toBeNull();
    expect(group?.closest(".emitter-micro-response")).toBeNull();
    expect(group?.closest(".glyph-displacement-section")).toBeNull();
    expect(container.querySelector<HTMLInputElement>('[data-testid="glyph-micro-warp-enabled"]')?.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[data-testid="glyph-micro-warp-normal"]')?.disabled).toBe(false);
    expect(container.textContent).toContain("before Fragmentation, mask, SDF, preview, and export");

    change(container.querySelector<HTMLInputElement>('[data-testid="glyph-micro-warp-normal"]')!, "57");
    expect(getUpdated()?.glyphMicroWarp.normalDisplacement).toBe(57);
  });

  it("uses design-oriented shared influence and Calm Water controls without merging existing stages", () => {
    renderControls();
    openDisclosure("Calm Water");
    expect(container.querySelector<HTMLInputElement>('[data-testid="glyph-calm-water-enabled"]')?.disabled).toBe(true);
    expect(container.textContent).toContain("native fallback remains exactly undeformed");

    const calm = applyPreset(baseState, "Calm Current");
    renderControls(calm, true);
    openDisclosure("Glyph Influence");
    const influence = container.querySelector(".glyph-influence-section");
    const water = container.querySelector(".glyph-calm-water-section");
    expect(influence).not.toBeNull();
    expect(water).not.toBeNull();
    expect(water?.closest(".glyph-displacement-section")).toBeNull();
    expect(container.textContent).toContain("Choose which typography belongs to the emitter");
    expect(container.textContent).toContain("Broad contour-normal waves");
    expect(container.querySelector<HTMLInputElement>('[data-testid="glyph-calm-water-frequency-linked"]')?.checked).toBe(true);

    change(container.querySelector<HTMLInputElement>('[data-testid="glyph-calm-water-strength"]')!, "15");
    expect(getUpdated()?.glyphCalmWater.strength).toBe(15);
    change(container.querySelector<HTMLInputElement>('[data-testid="glyph-influence-radius"]')!, "140");
    expect(getUpdated()?.glyphInfluence.radius).toBe(140);
    change(container.querySelector<HTMLSelectElement>('[data-testid="glyph-influence-falloff"]')!, "gaussian");
    expect(getUpdated()?.glyphInfluence.falloff).toBe("gaussian");
    expect(container.querySelector<HTMLSelectElement>('[data-testid="glyph-influence-scope"]')?.value).toBe("source-glyph");
    change(container.querySelector<HTMLSelectElement>('[data-testid="glyph-influence-scope"]')!, "source-line");
    expect(getUpdated()?.emitter.influenceScope).toBe("source-line");
  });

  it("keeps emitter-local Slice explicit and retains the Global / Legacy control path", () => {
    const tidal = applyPreset(baseState, "Tidal Slice");
    renderControls(tidal, true);
    openDisclosure("Glyph Fragmentation");
    expect(container.querySelector<HTMLSelectElement>('[data-testid="glyph-slice-influence"]')?.value).toBe("emitter-falloff");
    expect(container.querySelector(".glyph-displacement-section")?.textContent).toContain("shared Glyph Influence envelope");
    expect(container.querySelector(".glyph-displacement-section")?.textContent).not.toContain("Response radius");

    renderControls({
      ...tidal,
      glyphDisplacement: { ...tidal.glyphDisplacement, sliceInfluence: "legacy" },
    }, true);
    expect(container.querySelector<HTMLSelectElement>('[data-testid="glyph-slice-influence"]')?.value).toBe("legacy");
    expect(container.querySelector(".glyph-displacement-section")?.textContent).toContain("Response radius");
    expect(container.querySelector(".glyph-displacement-section")?.textContent).toContain("Global / Legacy");
  });

  it("keeps regular dot-grid and static Canvas Performance controls available for SDF Halftone", () => {
    renderControls(applyPreset(baseState, "Fragment Matrix"), true);
    openDisclosure("Renderer-local controls");
    expect(container.querySelector<HTMLInputElement>('[data-testid="dot-grid-enabled"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-testid="dot-grid-spacing"]')?.disabled).toBe(false);
    openDisclosure("Preview");
    const mode = field("Preview Mode", "select") as HTMLSelectElement;
    expect(mode.querySelector<HTMLOptionElement>('option[value="canvas-2d"]')?.disabled).toBe(false);
  });

  it("exposes Display Dislocation as a separate renderer-local control group", () => {
    const preset = applyPreset(baseState, "Display Dislocation");
    renderControls(preset, false);
    openDisclosure("Glyph Fragmentation");
    openDisclosure("Renderer-local controls");

    expect(container.textContent).toContain("Glyph Fragmentation");
    expect(container.textContent).toContain("Display Dislocation");
    expect(container.textContent).toContain("Renderer-local inverse-domain response");
    expect(container.querySelector<HTMLInputElement>('[data-testid="display-dislocation-enabled"]')?.checked).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[data-testid="glyph-displacement-enabled"]')?.checked).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[data-testid="display-dislocation-amount"]')?.disabled).toBe(false);

    const mode = container.querySelector<HTMLSelectElement>('[data-testid="display-dislocation-mode"]')!;
    expect(mode.value).toBe("horizontal-bands");
    change(mode, "blocks");
    expect(getUpdated()?.displayDislocation.mode).toBe("blocks");
    expect(getUpdated()?.glyphDisplacement).toEqual(preset.glyphDisplacement);
  });

  it("shows a retained glyph-displacement state as inactive while Display Dislocation owns the pipeline", () => {
    const state = {
      ...applyPreset(baseState, "Display Dislocation"),
      font: { family: "Basic", fullName: "Basic Regular", fileName: "Basic-Regular.ttf", unitsPerEm: 1000, ascender: 800, descender: -200 },
      glyphDisplacement: { ...baseState.glyphDisplacement, enabled: true },
    };
    renderControls(state, true);
    openDisclosure("Glyph Fragmentation");

    const fragmentation = container.querySelector<HTMLInputElement>('[data-testid="glyph-displacement-enabled"]')!;
    expect(fragmentation.checked).toBe(false);
    expect(fragmentation.disabled).toBe(true);
    expect(fragmentation.dataset.projectEnabled).toBe("true");
    expect(fragmentation.dataset.pipelineActive).toBe("false");
    expect(container.textContent).toContain("retained / inactive");
    expect(container.textContent).toContain("Display Dislocation is active and owns the SDF Halftone dot-domain stage");
  });

  it("exposes preset scope and contract text", () => {
    renderControls();
    expect(container.querySelector('[data-testid="preset-contract"]')?.textContent).toContain("Scope: Renderer · Core field · Emitter");
    const preset = field("Preset", "select") as HTMLSelectElement;
    change(preset, "Display Dislocation");
    expect(container.querySelector('[data-testid="preset-contract"]')?.textContent).toContain("Scope: Full project snapshot");
  });

  it("keeps Display Dislocation unavailable until SDF Halftone regular-grid support is active", () => {
    renderControls(baseState);
    openDisclosure("Renderer-local controls");
    expect(container.querySelector<HTMLInputElement>('[data-testid="display-dislocation-enabled"]')?.disabled).toBe(true);
    expect(container.textContent).toContain("Available with SDF Halftone");
  });

  it("uses one sequential number for each normal-path section", () => {
    renderControls();
    const sections = [...container.querySelectorAll("[data-stage-heading='true']")]
      .map((heading) => ({
        number: heading.querySelector(":scope > span")?.textContent,
        label: heading.querySelector("h2")?.textContent,
      }));
    expect(sections).toEqual([
      { number: "01", label: "Typography" },
      { number: "02", label: "Field" },
      { number: "03", label: "Emitters" },
      { number: "04", label: "Glyph Geometry" },
      { number: "05", label: "Renderer" },
      { number: "06", label: "Mark Response" },
      { number: "07", label: "Appearance" },
      { number: "08", label: "Preview / Export" },
    ]);
    expect(new Set(sections.map(({ number }) => number)).size).toBe(sections.length);
  });

  it("keeps advanced, preview, export, and diagnostic controls available", () => {
    renderControls();
    openDisclosure("Advanced typography");
    openDisclosure("Emitters");
    openDisclosure("Field detail");
    openDisclosure("Renderer detail");
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
    openDisclosure("Renderer detail");
    expect(field("Contour thickness", "input").value).toBe("1.4");
    expect(container.textContent).toContain("Normalized contour weight; scales with typography size.");

    renderControls({ ...baseState, renderer: "flow" });
    expect(container.textContent).not.toContain("Contour thickness");

    renderControls({ ...baseState, renderer: "wave-contours", waveContourMode: "continuous" });
    openDisclosure("Renderer detail");
    expect(field("Contour thickness", "input").value).toBe("1.4");

    renderControls({ ...baseState, renderer: "wave-contours", waveContourMode: "dotted" });
    expect(container.textContent).not.toContain("Contour thickness");
  });

  it("gives every rendered range a stable accessible name", () => {
    renderControls({
      ...applyPreset(baseState, "Sonic Halftone"),
      emitter: { ...baseState.emitter, enabled: true },
    }, true);
    ["Field detail", "Emitters", "Glyph Influence", "Glyph Micro Warp", "Calm Water", "Glyph Fragmentation", "Renderer detail", "Renderer-local controls", "Emitter Display Response", "Emitter Micro Response", "Glyph Falloff Field"].forEach(openDisclosure);

    const ranges = [...container.querySelectorAll<HTMLInputElement>('input[type="range"]')];
    expect(ranges.length).toBeGreaterThan(0);
    ranges.forEach((range) => expect(range.getAttribute("aria-label")).toBeTruthy());
  });

  it("supports exact entry, invalid-input cancellation, and a discoverable per-control reset", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitter: { ...baseState.emitter, enabled: true, amplitude: 2.4 },
    });
    openDisclosure("Emitters");

    const wrapper = [...container.querySelectorAll("label.range")]
      .find((candidate) => candidate.querySelector(":scope > span")?.textContent?.startsWith("Strength"));
    expect(wrapper).not.toBeNull();
    const output = wrapper!.querySelector("output")!;
    act(() => output.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const editor = wrapper!.querySelector<HTMLInputElement>("input.range-value-edit")!;
    expect(editor).not.toBeNull();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(editor, "not-a-number");
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(updated).toBeNull();

    const currentWrapper = [...container.querySelectorAll("label.range")]
      .find((candidate) => candidate.querySelector(":scope > span")?.textContent?.startsWith("Strength"))!;
    act(() => currentWrapper.querySelector("output")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const validEditor = currentWrapper.querySelector<HTMLInputElement>("input.range-value-edit")!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(validEditor, "2.9");
      validEditor.dispatchEvent(new Event("input", { bubbles: true }));
      validEditor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(updated?.emitter.amplitude).toBe(2.9);

    const resetWrapper = [...container.querySelectorAll("label.range")]
      .find((candidate) => candidate.querySelector(":scope > span")?.textContent?.startsWith("Strength"))!;
    const reset = resetWrapper.querySelector<HTMLButtonElement>("button.range-reset");
    expect(reset?.getAttribute("aria-label")).toContain("Reset Strength");
    act(() => reset!.click());
    expect(updated?.emitter.amplitude).toBe(baseState.emitter.amplitude);
  });

  it("uses coherent coarse and fine keyboard tuning without changing stored units", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitter: { ...baseState.emitter, enabled: true },
    });
    openDisclosure("Emitters");
    const strength = field("Strength", "input") as HTMLInputElement;
    expect(strength.getAttribute("data-parameter")).toContain("emitters");

    act(() => {
      strength.focus();
      strength.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
      strength.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(updated?.emitter.amplitude).toBeCloseTo(baseState.emitter.amplitude + 0.5, 8);

    updated = null;
    act(() => {
      strength.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true }));
      strength.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const keyboardResult = updated as ProjectState | null;
    expect(keyboardResult?.emitter.amplitude).toBeCloseTo(baseState.emitter.amplitude + 0.5 + 0.01, 8);
  });

  it("keeps reset help out of slider names and exposes phase as degrees", () => {
    renderControls({
      ...baseState,
      renderer: "glyph-diffuser",
      emitter: { ...baseState.emitter, enabled: true, phase: Math.PI / 2 },
    });
    openDisclosure("Emitters");
    const phase = field("Phase", "input") as HTMLInputElement;
    expect(phase.getAttribute("aria-label")).toBe("Phase");
    expect(phase.getAttribute("title")).toBeNull();
    expect(phase.getAttribute("aria-valuetext")).toContain("90");
  });

  it("keeps occupancy as one product control and does not duplicate its legacy boolean", () => {
    renderControls({
      ...baseState,
      renderer: "sdf-halftone",
      emitter: { ...baseState.emitter, enabled: true },
    });
    openDisclosure("Emitter Micro Response");

    expect(container.querySelectorAll('[data-testid="emitter-micro-occupancy"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="emitter-micro-occupancy-enabled"]')).toBeNull();
    expect(container.querySelector('[data-testid="emitter-micro-occupancy"]')?.parentElement?.textContent).toContain("Occupancy");
  });
});
