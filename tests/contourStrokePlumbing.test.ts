import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");

describe("contour stroke-width plumbing", () => {
  it("keeps the shared preview class from overriding renderer stroke width", () => {
    const styles = source("styles.css");
    const marksRule = styles.match(/\.marks\s*\{[^}]*\}/)?.[0] ?? "";
    expect(marksRule).not.toMatch(/stroke-width\s*:/);
  });

  it("routes both contour renderers through configured contour stroke width", () => {
    expect(source("engine/renderers/sdfContoursRenderer.ts"))
      .toMatch(/strokeWidth:\s*resolveContourStrokeWidth/);
    expect(source("engine/renderers/waveContoursRenderer.ts"))
      .toMatch(/strokeWidth:[\s\S]*resolveContourStrokeWidth\(state\)/);
  });
});
