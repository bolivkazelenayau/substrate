import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");
const sourceExtensions = [".ts", ".tsx"];
const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^"'()]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : sourceExtensions.some((extension) => path.endsWith(extension)) ? [path] : [];
  });
}

function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(importPattern)].map((match) => match[1] ?? match[2]);
}

function resolvedImport(file: string, specifier: string): string {
  return specifier.startsWith(".")
    ? relative(root, resolve(dirname(file), specifier)).replaceAll("\\", "/")
    : specifier;
}

describe("production import boundaries", () => {
  it("keeps SVG export isolated from preview, WebGPU, diagnostics, experiments, and runtime hooks", () => {
    const file = resolve(root, "engine/exportSvg.ts");
    const imports = importsOf(file).map((specifier) => resolvedImport(file, specifier));
    expect(imports).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/(?:^|\/)(?:gpu|experiments|components\/dev|hooks)(?:\/|$)|(?:^|\/)(?:preview|diagnostic)/i),
    ]));
  });

  it("prevents normal production modules from importing experiments", () => {
    const violations = sourceFiles(root)
      .filter((file) => !relative(root, file).replaceAll("\\", "/").startsWith("experiments/"))
      .flatMap((file) => importsOf(file)
        .map((specifier) => resolvedImport(file, specifier))
        .filter((specifier) => specifier.startsWith("experiments/"))
        .map((specifier) => `${relative(root, file)} -> ${specifier}`));
    expect(violations).toEqual([]);
  });

  it("loads dev overlay modules dynamically rather than through eager imports", () => {
    const app = readFileSync(resolve(root, "App.tsx"), "utf8");
    expect(app).not.toMatch(/from\s+["'][^"']*components\/dev\//);
    expect(app).toContain('lazy(() => import("./components/dev/WebGpuFieldOverlay")');
    expect(app).toContain('lazy(() => import("./components/dev/PreviewPerformanceMeter")');
  });
});
