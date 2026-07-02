import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { migrateAndRepairProject, parseImportedProjectJson, validateProjectV8Shape } from "../src/engine/projectImport";
import { serializeProjectDocument } from "../src/hooks/useProjectDocument";
import { createDefaultPreviewSettings } from "../src/hooks/usePreviewSettings";
import { createDefaultDiagnosticsMode } from "../src/hooks/useDiagnosticsState";

describe("runtime and document boundaries", () => {
  it("serializes only ProjectState, not preview or diagnostics runtime state", () => {
    const runtime = {
      preview: createDefaultPreviewSettings(),
      diagnosticsMode: "full" as const,
    };
    const serialized = serializeProjectDocument(baseState);

    expect(serialized).not.toContain("diagnosticsMode");
    expect(serialized).not.toContain('"fpsCap"');
    expect(JSON.parse(serialized)).toEqual(baseState);
    expect(JSON.parse(serialized).debug).toEqual(baseState.debug);
    expect(runtime.diagnosticsMode).toBe("full");
  });

  it("defaults new runtime sessions to quiet diagnostics without changing persisted debug", () => {
    expect(createDefaultDiagnosticsMode()).toBe("off");
    expect(baseState.version).toBe(8);
    expect(baseState).toHaveProperty("debug");
  });

  it("validates imported unknown JSON before preserving migration and repair", () => {
    expect(() => parseImportedProjectJson([])).toThrow();
    const result = migrateAndRepairProject({ version: 6, text: "BOUNDARY", density: 999 });

    expect(result.project.version).toBe(8);
    expect(result.project.text).toBe("BOUNDARY");
    expect(result.project.density).toBe(80);
    expect(validateProjectV8Shape(result.project).version).toBe(8);
  });

  it("keeps SVG export isolated from preview, WebGPU, diagnostics, and experiments", () => {
    const source = readFileSync(resolve(process.cwd(), "src/engine/exportSvg.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*(Canvas|preview|gpu|diagnostic|experiment)/i);
  });

  it("declares focused panel boundaries", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/panels/PanelSection.tsx"), "utf8");
    for (const panel of ["ArtworkPanel", "TypographyPanel", "FieldPanel", "AppearancePanel", "PreviewPanel", "ExportPanel", "DiagnosticsPanel"]) {
      expect(source).toContain(panel);
    }
  });
});
