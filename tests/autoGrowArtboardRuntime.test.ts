import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Controls } from "../src/components/Controls";
import { getTextArtboardOverflowWarning } from "../src/engine/contourDomain";
import type { TextGeometry } from "../src/engine/glyphGeometry";
import { AUTO_GROW_ARTBOARD_WARNING } from "../src/engine/artboardExpansion";
import { baseState } from "../src/engine/presets";
import {
  AUTO_GROW_ARTBOARD_DEBOUNCE_MS,
  useAutoGrowArtboard,
} from "../src/hooks/useAutoGrowArtboard";
import type { ArtboardOverflowMode, ProjectState } from "../src/types";

const previewSettings = {
  fpsCap: 30 as const,
  pauseWhenHidden: true,
  reducedMotion: false,
  backend: "canvas-2d" as const,
  quality: "full" as const,
};

function AutoGrowHarness({
  initialProject,
  initialMode = "clip",
}: {
  initialProject: ProjectState;
  initialMode?: ArtboardOverflowMode;
}) {
  const [project, setProject] = useState(initialProject);
  const [mode, setMode] = useState<ArtboardOverflowMode>(initialMode);
  const [textGeometry, setTextGeometry] = useState<TextGeometry | null>(null);
  const autoGrow = useAutoGrowArtboard({ mode, project, textGeometry, updateProject: setProject });
  const overflowWarning = getTextArtboardOverflowWarning(project, textGeometry);
  const displayedOverflowWarning = overflowWarning
    ? mode === "clip"
      ? overflowWarning
      : autoGrow.plan.available
        ? ""
        : AUTO_GROW_ARTBOARD_WARNING
    : "";

  return createElement("div", null,
    createElement("output", {
      "data-artboard": `${project.artboard.width}x${project.artboard.height}`,
      "data-font-size": project.fontSize,
      "data-overflow": overflowWarning ?? "",
      "data-displayed-overflow": displayedOverflowWarning,
      "data-auto-grow-pending": String(autoGrow.pending),
      "data-debug": String(project.debug.glyphBounds),
      "data-renderer": project.renderer,
      "data-seed": project.seed,
    }),
    createElement("button", {
      type: "button",
      "data-action": "large-size",
      onClick: () => setProject((current) => ({ ...current, fontSize: 540 })),
    }, "Large size"),
    createElement("button", {
      type: "button",
      "data-action": "small-size",
      onClick: () => setProject((current) => ({ ...current, fontSize: 80 })),
    }, "Small size"),
    createElement("button", {
      type: "button",
      "data-action": "long-text",
      onClick: () => setProject((current) => ({ ...current, text: "SUBSTRATE SUBSTRATE" })),
    }, "Long text"),
    createElement("button", {
      type: "button",
      "data-action": "diagnostics",
      onClick: () => setProject((current) => ({
        ...current,
        debug: { ...current.debug, glyphBounds: !current.debug.glyphBounds },
      })),
    }, "Toggle diagnostics"),
    createElement("button", {
      type: "button",
      "data-action": "wide-font",
      onClick: () => setTextGeometry({
        glyphs: [],
        bounds: { x: 100, y: 100, width: 1500, height: 300 },
        baselineY: 400,
        originX: 100,
        advanceWidth: 1500,
        sourceText: project.text,
        hasOutlines: true,
      }),
    }, "Load wide font"),
    createElement(Controls, {
      state: project,
      setState: setProject,
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
      artboardOverflowMode: mode,
      onArtboardOverflowModeChange: setMode,
    }),
  );
}

describe("auto-grow artboard runtime wiring", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });

  it("expands existing overflow when the Export selector changes from Clip to Auto-grow", () => {
    const initialProject = { ...baseState, text: "SUBSTRATE", fontSize: 560 };
    expect(getTextArtboardOverflowWarning(initialProject, null)).not.toBeNull();
    act(() => root.render(createElement(AutoGrowHarness, { initialProject })));

    const exportButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Export"));
    act(() => exportButton!.click());
    const selector = [...container.querySelectorAll<HTMLSelectElement>("select")]
      .find((select) => select.parentElement?.textContent?.includes("Artboard overflow"))!;

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(selector, "auto-grow");
      selector.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const output = container.querySelector("output")!;
    expect(output.dataset.artboard).not.toBe("1200x720");
    expect(output.dataset.fontSize).toBe("560");
    expect(output.dataset.overflow).toBe("");
  });

  it("expands the default 1200x720 artboard after the exact 140 to 540 typography change", () => {
    const initialProject = { ...baseState, text: "SUBSTRATE", fontSize: 140 };
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject,
      initialMode: "auto-grow",
    })));
    expect(container.querySelector("output")?.dataset.artboard).toBe("1200x720");
    act(() => container.querySelector<HTMLButtonElement>("[data-action='large-size']")!.click());
    const pending = container.querySelector("output")!;
    expect(pending.dataset.autoGrowPending).toBe("true");
    expect(pending.dataset.displayedOverflow).toBe("");
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    const output = container.querySelector("output")!;
    expect(output.dataset.artboard).not.toBe("1200x720");
    expect(output.dataset.fontSize).toBe("540");
    expect(output.dataset.renderer).toBe(initialProject.renderer);
    expect(output.dataset.seed).toBe(String(initialProject.seed));
    expect(output.dataset.overflow).toBe("");
  });

  it("Clip mode shows overflow immediately and never schedules automatic growth", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "SUBSTRATE", fontSize: 540 },
    })));
    const output = container.querySelector("output")!;
    expect(output.dataset.displayedOverflow).toContain("Export will be clipped");
    expect(output.dataset.artboard).toBe("1200x720");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expands after text content changes while Auto-grow is enabled", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "TYPE", fontSize: 240 },
      initialMode: "auto-grow",
    })));
    act(() => container.querySelector<HTMLButtonElement>("[data-action='long-text']")!.click());
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    expect(container.querySelector("output")?.dataset.artboard).not.toBe("1200x720");
  });

  it("expands when a newly loaded font produces overflowing authoritative bounds", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "SUBSTRATE", fontSize: 100 },
      initialMode: "auto-grow",
    })));
    act(() => container.querySelector<HTMLButtonElement>("[data-action='wide-font']")!.click());
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    expect(container.querySelector("output")?.dataset.artboard).not.toBe("1200x720");
  });

  it("never shrinks after typography becomes smaller", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "SUBSTRATE", fontSize: 560 },
      initialMode: "auto-grow",
    })));
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    const grown = container.querySelector("output")!.dataset.artboard;
    act(() => container.querySelector<HTMLButtonElement>("[data-action='small-size']")!.click());
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    expect(container.querySelector("output")?.dataset.artboard).toBe(grown);
  });

  it("does not schedule expansion for diagnostics-only changes", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "TYPE", fontSize: 80 },
      initialMode: "auto-grow",
    })));
    expect(vi.getTimerCount()).toBe(0);
    act(() => container.querySelector<HTMLButtonElement>("[data-action='diagnostics']")!.click());
    expect(vi.getTimerCount()).toBe(0);
    expect(container.querySelector("output")?.dataset.artboard).toBe("1200x720");
  });

  it("recomputes from the latest document state when the debounce fires", () => {
    act(() => root.render(createElement(AutoGrowHarness, {
      initialProject: { ...baseState, text: "SUBSTRATE", fontSize: 560 },
      initialMode: "auto-grow",
    })));
    act(() => container.querySelector<HTMLButtonElement>("[data-action='diagnostics']")!.click());
    act(() => vi.advanceTimersByTime(AUTO_GROW_ARTBOARD_DEBOUNCE_MS));
    expect(container.querySelector("output")?.dataset.debug).toBe("true");
    expect(container.querySelector("output")?.dataset.artboard).not.toBe("1200x720");
  });
});
