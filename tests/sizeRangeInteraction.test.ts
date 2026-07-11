import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SizeRange } from "../src/components/panels/ArtworkTypographyPanels";
import { baseState } from "../src/engine/presets";

interface Counters { starts: number; changes: number; commits: number; cancels: number; resets: number }

function Probe({ initial, counters }: { initial: number; counters: Counters }) {
  const [value, setValue] = useState(initial);
  return createElement(SizeRange, {
    value, min: 1, max: 600, defaultValue: baseState.fontSize,
    onStart: () => { counters.starts += 1; },
    onChange: (next: number) => { counters.changes += 1; setValue(next); },
    onCommit: () => { counters.commits += 1; },
    onCancel: () => { counters.cancels += 1; },
    onReset: (next: number) => { counters.resets += 1; setValue(next); },
  });
}

describe("unlocked native Size range", () => {
  let container: HTMLDivElement;
  let root: Root;
  let counters: Counters;

  beforeEach(() => {
    vi.useFakeTimers();
    counters = { starts: 0, changes: 0, commits: 0, cancels: 0, resets: 0 };
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers(); });

  function render(initial: number) {
    act(() => root.render(createElement(Probe, { initial, counters })));
    return container.querySelector<HTMLInputElement>('input[data-size-range]')!;
  }
  function event(input: HTMLInputElement, type: string, init?: EventInit) {
    act(() => input.dispatchEvent(new Event(type, { bubbles: true, ...init })));
  }
  function change(input: HTMLInputElement, value: number) {
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(value));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it.each([64, 100, 139, 148, 235, 540])("double-click resets %i once and remains usable", (initial) => {
    const input = render(initial);
    event(input, "pointerdown"); event(input, "pointerup");
    event(input, "pointerdown"); event(input, "pointerup");
    act(() => input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    expect(input.value).toBe(String(baseState.fontSize));
    expect(counters.resets).toBe(1);
    expect(counters.commits).toBe(0);
    expect(input.disabled).toBe(false);

    event(input, "pointerdown");
    change(input, 235);
    event(input, "pointerup");
    expect(counters.commits).toBe(1);
    expect(input.disabled).toBe(false);
  });

  it("deduplicates pointerup, lost capture, and blur", () => {
    const input = render(100);
    event(input, "pointerdown");
    change(input, 235);
    event(input, "pointerup");
    event(input, "lostpointercapture");
    event(input, "blur");
    expect(counters.commits).toBe(1);
  });

  it("cancels a no-change pointer gesture instead of leaving a draft active", () => {
    const input = render(148);
    event(input, "pointerdown");
    event(input, "pointerup");
    expect(counters.commits).toBe(0);
    expect(counters.cancels).toBe(1);
    expect(input.disabled).toBe(false);
  });

  it("settles keyboard input on keyup or the trailing boundary and cancels on Escape", () => {
    const input = render(100);
    change(input, 101);
    act(() => input.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true })));
    expect(counters.commits).toBe(1);

    change(input, 102);
    act(() => vi.advanceTimersByTime(160));
    expect(counters.commits).toBe(2);

    change(input, 103);
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => vi.advanceTimersByTime(200));
    expect(counters.commits).toBe(2);
    expect(counters.cancels).toBe(1);
  });
});
