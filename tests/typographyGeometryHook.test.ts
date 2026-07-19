import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { useTypographyGeometry } from "../src/hooks/useTypographyGeometry";
import { baseState } from "../src/engine/presets";
import { loadReferenceFont } from "./utils/sceneLayoutHarness";
import type { LoadedFont } from "../src/engine/fontLoader";
import type { ProjectState } from "../src/types";

/**
 * Integration test for the typography geometry hook.
 *
 * The hook must rebuild glyph geometry when the focused typography inputs
 * (including fontSize) change. A previous Pass 5 regression gated the memo
 * dependency on `interactionTraceEnabled`; in production builds the dependency
 * collapsed and fontSize changes were ignored for parsed fonts.
 */
describe("useTypographyGeometry", () => {
  it("rebuilds parsed-font geometry when fontSize changes", async () => {
    const loadedFont = await loadReferenceFont();
    const results: Array<{ fontSize: number; bounds: string | null }> = [];

    function Harness({ project, font }: { project: ProjectState; font: LoadedFont | null }) {
      const build = useTypographyGeometry(project, font);
      results.push({
        fontSize: project.fontSize,
        bounds: build.value?.bounds
          ? `${build.value.bounds.width.toFixed(1)}x${build.value.bounds.height.toFixed(1)}`
          : null,
      });
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(createElement(Harness, { project: { ...baseState, fontSize: 148 }, font: loadedFont }));
    });
    await act(async () => {
      root.render(createElement(Harness, { project: { ...baseState, fontSize: 540 }, font: loadedFont }));
    });
    await act(async () => {
      root.render(createElement(Harness, { project: { ...baseState, fontSize: 148 }, font: loadedFont }));
    });

    act(() => root.unmount());
    container.remove();

    const builds148 = results.filter((r) => r.fontSize === 148);
    const builds540 = results.filter((r) => r.fontSize === 540);
    expect(builds148.length).toBeGreaterThanOrEqual(2);
    expect(builds540.length).toBeGreaterThanOrEqual(1);
    expect(builds540[0].bounds).not.toBeNull();
    expect(builds148[0].bounds).toBe(builds148[builds148.length - 1].bounds);
  });
});
