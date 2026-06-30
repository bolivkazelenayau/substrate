import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, validateLoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { serializeProjectDocument } from "../src/hooks/useProjectDocument";

const root = resolve(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : /\.(?:ts|tsx)$/.test(path) ? [path] : [];
  });
}

describe("lazy font engine boundary", () => {
  it("contains the only direct opentype.js import inside the lazy implementation", () => {
    const directImports = sourceFiles(root).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return /from\s+["']opentype\.js["']/.test(source)
        ? [relative(root, file).replaceAll("\\", "/")]
        : [];
    });
    expect(directImports).toEqual(["engine/fonts/opentypeFontEngine.ts"]);

    const loader = readFileSync(resolve(root, "engine/fonts/loadFontEngine.ts"), "utf8");
    expect(loader).toContain('import("./opentypeFontEngine")');
    expect(readFileSync(resolve(root, "engine/exportSvg.ts"), "utf8")).not.toContain("opentype");
  });

  it("parses uploaded font outlines through the asynchronous engine boundary", async () => {
    const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/Basic-Regular.ttf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
    const project = { ...baseState, text: "SUBSTRATE", font: loaded.metadata };
    const geometry = layoutGlyphs(project, loaded);

    expect(validateLoadedFont(loaded)).toBe(true);
    expect(loaded.metadata.fileName).toBe("Basic-Regular.ttf");
    expect(geometry.hasOutlines).toBe(true);
    expect(geometry.glyphs.some((glyph) => glyph.path.d.length > 0)).toBe(true);
  });

  it("keeps native fallback parser-free and project JSON free of font bytes", () => {
    const fontLoader = readFileSync(resolve(root, "engine/fontLoader.ts"), "utf8");
    expect(fontLoader).not.toContain('from "opentype.js"');

    const serialized = serializeProjectDocument({
      ...baseState,
      font: {
        family: "Basic",
        fullName: "Basic Regular",
        fileName: "Basic-Regular.ttf",
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
      },
    });
    expect(serialized).not.toMatch(/raw|bytes|arrayBuffer|fontData/i);
    expect(JSON.parse(serialized).font.fileName).toBe("Basic-Regular.ttf");
  });

  it("keeps resolved-font SVG output deterministic and vector-only", async () => {
    const bytes = readFileSync(resolve(process.cwd(), "tests/fixtures/Basic-Regular.ttf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
    const project = { ...baseState, text: "TYPE", font: loaded.metadata };
    const geometry = layoutGlyphs(project, loaded);
    const context = { timeMs: 0, frame: 0, textGeometry: geometry };
    const first = createSvg(project, context, geometry);
    const second = createSvg(project, context, geometry);
    const withoutTimestamp = (svg: string) => svg.replace(/&quot;exportTimestamp&quot;:&quot;[^&]+&quot;/, "&quot;exportTimestamp&quot;:&quot;stable&quot;");

    expect(withoutTimestamp(first)).toBe(withoutTimestamp(second));
    expect(first).not.toMatch(/<(?:canvas|image|foreignObject)\b/i);
  });
});
