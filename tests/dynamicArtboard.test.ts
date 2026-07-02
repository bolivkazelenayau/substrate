import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { getTextArtboardOverflowWarning } from "../src/engine/contourDomain";
import { projectArtboard } from "../src/engine/artboard";

describe("dynamic artboard foundation", () => {
  const wideState = { ...baseState, artboard: { width: 1800, height: 900 } };
  const context = { timeMs: 0, frame: 0, viewport: projectArtboard(wideState) };

  it("threads dimensions through renderer context and deterministic SVG export", () => {
    const geometry = getRenderer("dots").generateGeometry({ ...wideState, renderer: "dots", fontSize: 560 }, context);
    const centers = geometry.geometries.flatMap((item) => item.type === "circle" ? [item.center] : []);
    expect(centers.some((point) => point.x > 1200)).toBe(true);
    const first = createSvg(wideState, context, null);
    const second = createSvg(wideState, context, null);
    expect(first).toContain('viewBox="0 0 1800 900"');
    expect(first).toContain('width="1800" height="900"');
    expect(first).toContain('<rect width="1800" height="900"');
    expect(first.replace(/<metadata>.*?<\/metadata>/, "")).toBe(second.replace(/<metadata>.*?<\/metadata>/, ""));
  });

  it("uses current artboard dimensions for overflow detection", () => {
    const text = { ...baseState, text: "SUBSTRATE", fontSize: 300 };
    expect(getTextArtboardOverflowWarning(text, null)).not.toBeNull();
    expect(getTextArtboardOverflowWarning({ ...text, artboard: { width: 2200, height: 1000 } }, null)).toBeNull();
  });

  it("prevents product renderers from importing the compatibility viewport", () => {
    const directory = resolve("src/engine/renderers");
    const files = ["flowLinesRenderer.ts", "rippleLinesRenderer.ts", "dotFieldRenderer.ts", "sdfFlowRenderer.ts", "sdfStreamlinesRenderer.ts", "sdfContoursRenderer.ts", "sdfHalftoneRenderer.ts", "glyphDiffuserRenderer.ts"];
    for (const file of files) expect(readFileSync(resolve(directory, file), "utf8")).not.toContain("VIEWPORT");
  });
});
