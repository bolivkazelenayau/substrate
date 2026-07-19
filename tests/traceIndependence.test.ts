import { describe, expect, it, vi } from "vitest";
import { baseState } from "../src/engine/presets";
import {
  sceneLayoutStageKey,
  substrateStageKey,
  typographyStageKey,
} from "../src/engine/pipelineStageKeys";
import { rendererGeometryCacheKey, rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import type { RenderContext } from "../src/types";

const context: RenderContext = { timeMs: 0, frame: 0 };

describe("trace independence of authoritative keys", () => {
  it("does not let trace enablement change pipeline stage keys", async () => {
    const traced = await vi.importActual<typeof import("../src/engine/pipelineStageKeys")>("../src/engine/pipelineStageKeys");
    const typographyKey = typographyStageKey(baseState, "font:native");
    const sceneKey = sceneLayoutStageKey(baseState, null);
    const substrateInput = {
      sourceText: baseState.text,
      textGeometry: null,
      fontSize: baseState.fontSize,
      tracking: baseState.tracking,
      fontFamily: "sans-serif",
      fontWeight: 400,
      baselineY: 360,
      textX: 600,
      lineHeight: baseState.lineHeight,
      textAlign: baseState.textAlign,
      kerningMode: baseState.kerningMode,
      resolution: { width: 64, height: 39 },
      bounds: null,
      domainBounds: { x: 0, y: 0, width: 1200, height: 720 },
      viewport: { x: 0, y: 0, width: 1200, height: 720 },
    };
    const substrateKey = substrateStageKey(substrateInput, typographyKey);

    vi.doMock("../src/dev/interactionTrace", async () => {
      const actual = await vi.importActual<typeof import("../src/dev/interactionTrace")>("../src/dev/interactionTrace");
      return { ...actual, interactionTraceEnabled: true };
    });

    const tracedModule = await import("../src/engine/pipelineStageKeys");
    expect(tracedModule.typographyStageKey(baseState, "font:native")).toBe(typographyKey);
    expect(tracedModule.sceneLayoutStageKey(baseState, null)).toBe(sceneKey);
    expect(tracedModule.substrateStageKey(substrateInput, typographyKey)).toBe(substrateKey);

    vi.doUnmock("../src/dev/interactionTrace");
  });

  it("does not let trace enablement change renderer geometry identity", async () => {
    const stateKey = rendererGeometryStateKey(baseState);
    const cacheKey = rendererGeometryCacheKey(baseState, context);

    vi.doMock("../src/dev/interactionTrace", async () => {
      const actual = await vi.importActual<typeof import("../src/dev/interactionTrace")>("../src/dev/interactionTrace");
      return { ...actual, interactionTraceEnabled: true };
    });

    const tracedModule = await import("../src/engine/rendererRuntime");
    expect(tracedModule.rendererGeometryStateKey(baseState)).toBe(stateKey);
    expect(tracedModule.rendererGeometryCacheKey(baseState, context)).toBe(cacheKey);

    vi.doUnmock("../src/dev/interactionTrace");
  });

  it("rejects source patterns that gate semantic keys behind trace enablement", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const srcDir = path.resolve(__dirname, "../src");
    const files = fs.readdirSync(srcDir, { recursive: true }) as string[];
    const suspicious: string[] = [];
    for (const relative of files) {
      if (!relative.endsWith(".ts") && !relative.endsWith(".tsx")) continue;
      const filePath = path.join(srcDir, relative);
      const content = fs.readFileSync(filePath, "utf8");
      const match = content.match(/\b(?!trace)\w*(?:semanticKey|stageKey|inputKey|outputKey|rendererGeometryCacheKey)\w*\s*=\s*interactionTraceEnabled\s*\?/);
      if (match) {
        const lineNumber = content.slice(0, match.index).split("\n").length;
        const lines = content.split("\n");
        const currentLine = lines[lineNumber - 1] ?? "";
        const previousLine = lines[lineNumber - 2] ?? "";
        if (!currentLine.includes("trace-only") && !previousLine.includes("trace-only")) {
          suspicious.push(`${relative}:${lineNumber}`);
        }
      }
    }
    expect(suspicious).toEqual([]);
  });
});
