import type { TextGeometry } from "./glyphGeometry";
import { createTimedSvg } from "./exportSvg";
import { getExportBudgetWarnings } from "./exportBudget";
import { generateRendererGeometry, summarizeGeometry } from "./rendererRuntime";
import { getSvgDiagnostics } from "./svgValidation";
import type { ProjectState, RenderContext, RendererId } from "../types";

export interface CompatibilityExport {
  id: string;
  filename: string;
  svg: string;
  diagnostics: {
    renderer: string;
    substrateType: "glyph-paths" | "native-text";
    glyphPathCount: number;
    generatedElementCount: number;
    pointCount: number;
    byteSize: number;
    exportWarnings: string[];
    serializationTimeMs: number;
  };
}

interface CompatibilityExportInput {
  state: ProjectState;
  context: RenderContext;
  textGeometry: TextGeometry | null;
}

export function generateCompatibilityExportSet({ state, context, textGeometry }: CompatibilityExportInput): CompatibilityExport[] {
  const cases: Array<{ id: string; renderer: RendererId; exportMode?: ProjectState["exportMode"]; maxNodes?: number; text?: string; useGlyphs?: boolean }> = [
    { id: "editable-text", renderer: "flow", exportMode: "editable" },
    { id: "final-glyph-mask", renderer: "flow" },
    { id: "sdf-flow", renderer: "sdf-flow" },
    { id: "sdf-streamlines", renderer: "sdf-streamlines" },
    { id: "sdf-contours", renderer: "sdf-contours" },
    { id: "sdf-halftone", renderer: "sdf-halftone" },
    { id: "wave-contours", renderer: "wave-contours" },
    { id: "glyph-diffuser", renderer: "glyph-diffuser" },
    { id: "stress-high-marks", renderer: "dots", maxNodes: 5000 },
    { id: "special-characters", renderer: "flow", text: 'A&<>"', useGlyphs: false },
  ];

  return cases.map((item) => {
    const project: ProjectState = {
      ...state,
      renderer: item.renderer,
      exportMode: item.exportMode ?? "artwork",
      maxNodes: item.maxNodes ?? state.maxNodes,
      density: item.maxNodes ? 80 : state.density,
      text: item.text ?? state.text,
      emitter: item.renderer === "wave-contours" || item.renderer === "glyph-diffuser" ? { ...state.emitter, enabled: true } : state.emitter,
    };
    const geometryContext = item.useGlyphs === false ? { ...context, textGeometry: null, substrateData: null } : context;
    const geometry = generateRendererGeometry(project, geometryContext);
    const summary = summarizeGeometry(geometry);
    const glyphs = item.useGlyphs === false ? null : textGeometry;
    const timed = createTimedSvg(project, geometryContext, glyphs, geometry);
    const svgDiagnostics = getSvgDiagnostics(timed.svg, timed.serializationTimeMs);
    const substrateType = glyphs?.hasOutlines ? "glyph-paths" as const : "native-text" as const;
    const exportWarnings = getExportBudgetWarnings({
      ...summary,
      substrateType,
      exactByteSize: svgDiagnostics.byteSize,
    });
    return {
      id: item.id,
      filename: `${item.id}.svg`,
      svg: timed.svg,
      diagnostics: {
        renderer: item.renderer,
        substrateType,
        glyphPathCount: svgDiagnostics.glyphPaths,
        generatedElementCount: svgDiagnostics.generatedMarks,
        pointCount: svgDiagnostics.generatedPoints,
        byteSize: svgDiagnostics.byteSize,
        exportWarnings,
        serializationTimeMs: timed.serializationTimeMs,
      },
    };
  });
}
