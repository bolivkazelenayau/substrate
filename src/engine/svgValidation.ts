import { SVG_IDS } from "./constants";

export interface SvgReloadValidation {
  valid: boolean;
  errors: string[];
  document: XMLDocument | null;
}

export interface SvgDiagnostics {
  glyphPaths: number;
  generatedMarks: number;
  generatedPoints: number;
  elementCount: number;
  byteSize: number;
  serializationTimeMs: number;
  substrateType: "glyph-paths" | "native-text";
}

const RASTER_SVG_PATTERN = /<image\b|<canvas\b|<foreignObject\b|data:image\/|;base64,/i;

export function assertVectorOnlySvg(svg: string) {
  if (RASTER_SVG_PATTERN.test(svg)) {
    throw new Error("Final Artwork SVG contains a forbidden raster or foreign-object payload.");
  }
}

export function validateSvgReload(svg: string, expectPathMask: boolean, requireArtworkStructure = true): SvgReloadValidation {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const errors: string[] = [];
  const parserError = document.querySelector("parsererror");
  if (parserError) errors.push(`SVG XML parse error: ${parserError.textContent?.trim() || "unknown parser error"}`);

  const requiredIds = requireArtworkStructure
    ? [SVG_IDS.substrateMask, SVG_IDS.artwork, SVG_IDS.sourceText]
    : [SVG_IDS.artwork];
  requiredIds.forEach((id) => {
    if (!document.getElementById(id)) errors.push(`Missing required SVG group: #${id}`);
  });

  const substrate = document.getElementById(SVG_IDS.substrateMask);
  const glyphPaths = substrate?.querySelectorAll("path[data-glyph-index]").length ?? 0;
  if (expectPathMask && glyphPaths === 0) {
    errors.push("Expected a path-based glyph substrate, but no glyph paths were found in the mask.");
  }

  return { valid: errors.length === 0, errors, document: parserError ? null : document };
}

export function getExactSvgByteSize(svg: string) {
  return new TextEncoder().encode(svg).byteLength;
}

export function getSvgDiagnostics(svg: string, serializationTimeMs = 0): SvgDiagnostics {
  const validation = validateSvgReload(svg, false);
  const document = validation.document;
  const artwork = document?.getElementById(SVG_IDS.artwork);
  const substrate = document?.getElementById(SVG_IDS.substrateMask);
  const glyphPaths = substrate?.querySelectorAll("path[data-glyph-index]").length ?? 0;
  const generatedPoints = Array.from(artwork?.children ?? []).reduce((total, element) => {
    if (element.tagName === "polyline") return total + (element.getAttribute("points")?.trim().split(/\s+/).filter(Boolean).length ?? 0);
    if (element.tagName === "path") return total + 2;
    return total + 1;
  }, 0);
  return {
    glyphPaths,
    generatedMarks: artwork?.children.length ?? 0,
    generatedPoints,
    elementCount: document?.querySelectorAll("*").length ?? 0,
    byteSize: getExactSvgByteSize(svg),
    serializationTimeMs,
    substrateType: glyphPaths > 0 ? "glyph-paths" : "native-text",
  };
}

export function reportSvgValidation(svg: string, expectPathMask: boolean, requireArtworkStructure = true) {
  const result = validateSvgReload(svg, expectPathMask, requireArtworkStructure);
  if (!result.valid && import.meta.env.DEV) {
    console.error(`[SUBSTRATE] Invalid SVG export:\n${result.errors.join("\n")}`);
  }
  return result;
}
