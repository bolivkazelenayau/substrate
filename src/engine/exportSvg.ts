import { APP_NAME, APP_VERSION, SVG_IDS, VIEWPORT } from "./constants";
import type { GeometryGroup, VectorGeometry } from "./geometry";
import { getRenderer } from "./renderers";
import { getTextLayout } from "./textLayout";
import type { TextGeometry } from "./glyphGeometry";
import type { ProjectState, RenderContext } from "../types";
import { measure } from "./performance";
import { generateEdgeErosionMarks } from "./edgeErosion";
import { generateWarpedOutline, getFinalOutlineGeometry } from "./outlineWarp";

const escape = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function serializeGeometry(group: GeometryGroup, precision: number): string {
  const number = (value: number) => Number(value.toFixed(precision));
  return group.geometries.map((geometry: VectorGeometry) => {
    if (geometry.type === "circle") {
      return `<circle cx="${number(geometry.center.x)}" cy="${number(geometry.center.y)}" r="${number(geometry.radius)}" opacity="${number(geometry.opacity)}"/>`;
    }
    if (geometry.type === "line") {
      return `<path d="M${number(geometry.start.x)} ${number(geometry.start.y)}L${number(geometry.end.x)} ${number(geometry.end.y)}" opacity="${number(geometry.opacity)}"/>`;
    }
    if (geometry.type === "polyline") {
      const points = geometry.points.map((point) => `${number(point.x)},${number(point.y)}`).join(" ");
      return `<polyline fill="none" points="${points}" opacity="${number(geometry.opacity)}"/>`;
    }
    return `<path d="${escape(geometry.d)}" opacity="${number(geometry.opacity)}"/>`;
  }).join("");
}

function serializeText(state: ProjectState, fill: string, visibility?: "hidden", useCustomFont = true) {
  const layout = getTextLayout(state, useCustomFont);
  const hidden = visibility ? ` visibility="${visibility}"` : "";
  const fontKerning = state.kerningMode === "none" ? ' font-kerning="none"' : "";
  return `<text x="${layout.x}" y="${layout.baselineY}" text-anchor="${layout.anchor}" font-family="${escape(layout.fontFamily)}" font-size="${layout.fontSize}" font-weight="${layout.fontWeight}" letter-spacing="${layout.tracking}"${fontKerning} fill="${fill}"${hidden}>${escape(layout.text)}</text>`;
}

function serializeGlyphPaths(textGeometry: TextGeometry) {
  return textGeometry.glyphs
    .filter((glyph) => glyph.path.d.length > 0)
    .map((glyph) => `<path data-character-index="${glyph.textIndex}" data-glyph-index="${glyph.glyphIndex}" d="${escape(glyph.path.d)}"/>`)
    .join("");
}

export function createSvg(state: ProjectState, context: RenderContext, textGeometry: TextGeometry | null = null, generatedGeometry?: GeometryGroup): string {
  const renderer = getRenderer(state.renderer);
  const geometry = generatedGeometry ?? renderer.generateGeometry(state, context);
  const exportContext = context.textGeometry === textGeometry ? context : { ...context, textGeometry };
  const warpedOutline = generateWarpedOutline(state, exportContext);
  const hasWarpedOutline = state.overlayMode === "warped-outline" && warpedOutline.paths.length > 0;
  const finalOutline = getFinalOutlineGeometry(textGeometry, warpedOutline, hasWarpedOutline);
  const timestamp = new Date().toISOString();
  const metadata = {
    appName: APP_NAME,
    appVersion: APP_VERSION,
    renderer: renderer.label,
    rendererId: renderer.id,
    exportMode: state.exportMode,
    seed: state.seed,
    exportTimestamp: timestamp,
    sourceText: state.text,
    font: state.font,
    substrateType: textGeometry?.hasOutlines ? "glyph-paths" : "native-text",
    project: state,
    outlineWarp: state.overlayMode === "warped-outline" ? warpedOutline.diagnostics : undefined,
  };

  const background = state.transparentBackground
    ? ""
    : `<g id="${SVG_IDS.background}"><rect width="${VIEWPORT.width}" height="${VIEWPORT.height}" fill="${state.backgroundColor}"/></g>`;
  const editable = `<g id="${SVG_IDS.artwork}">${serializeText(state, state.primaryColor, undefined, Boolean(textGeometry?.hasOutlines))}</g>`;
  const substrate = textGeometry?.hasOutlines
    ? `<g fill="white">${serializeGlyphPaths(textGeometry)}</g>`
    : serializeText(state, "white", undefined, false);
  const outline = textGeometry?.hasOutlines
    ? `<g id="${SVG_IDS.substrateOutline}" visibility="hidden" fill="none" stroke="${state.outlineColor}">${serializeGlyphPaths(textGeometry)}</g>`
    : "";
  const clipArtwork = renderer.clipPreviewToText?.(state) ?? true;
  const erodeOverlay = state.diffuserComposition === "edge-eroded" && state.edgeErosionAmount > 0 && state.edgeErosionWidth > 0;
  const erosionMarks = generateEdgeErosionMarks(state, exportContext);
  const serializedErosionMarks = erosionMarks.map((mark) =>
    `<circle cx="${mark.x}" cy="${mark.y}" r="${mark.radius}" opacity="${mark.opacity}"/>`,
  ).join("");
  const overlayMaskContent = textGeometry?.hasOutlines
    ? `<g fill="white" stroke="none" fill-rule="evenodd">${finalOutline.paths.map((path) => `<path d="${escape(path.d)}"/>`).join("")}</g><g id="diffuser-erosion-marks" fill="black" stroke="none">${serializedErosionMarks}</g>`
    : `${serializeText(state, "white", undefined, false)}<g id="diffuser-erosion-marks" fill="black" stroke="none">${serializedErosionMarks}</g>`;
  const overlayMask = renderer.showTextOverlay?.(state) && erodeOverlay
    ? `<mask id="diffuser-overlay-mask"><rect width="${VIEWPORT.width}" height="${VIEWPORT.height}" fill="black"/>${overlayMaskContent}</mask>`
    : "";
  const overlayFill = state.overlayMode === "knockout" ? state.backgroundColor : state.primaryColor;
  // Regular Outline mode renders each positioned glyph path as a clean, stroke-only
  // vector outline. It must NOT reuse the erosion-width setting as its stroke width
  // (the default erosion width of 16 SVG units would collapse the glyph fills).
  // `outlineStrokeWidth` is a dedicated, stable control clamped to [0.25, 16].
  const outlineStrokeWidth = Number.isFinite(state.outlineStrokeWidth) ? Math.max(0.25, state.outlineStrokeWidth) : 1.5;
  const overlayStyle = state.overlayMode === "outline"
    ? `fill="none" stroke="${state.outlineColor}" stroke-width="${outlineStrokeWidth}" stroke-linejoin="round" stroke-linecap="round"`
    : `fill="${overlayFill}" stroke="none"`;
  const textOverlay = renderer.showTextOverlay?.(state)
    ? textGeometry?.hasOutlines
      ? `<g id="diffuser-text-overlay" opacity="${renderer.textOverlayOpacity?.(state) ?? 1}"><g ${overlayStyle} fill-rule="evenodd"${erodeOverlay && state.overlayMode !== "outline" ? ' mask="url(#diffuser-overlay-mask)"' : ""}>${finalOutline.paths
        .map((path) => `<path${hasWarpedOutline ? ` data-warped-glyph="${path.glyphIndex}"` : ""} data-character-index="${path.textIndex}" data-glyph-index="${path.glyphIndex}" d="${escape(path.d)}"/>`).join("")}</g></g>`
      : `<g id="diffuser-text-overlay" opacity="${renderer.textOverlayOpacity?.(state) ?? 1}"><g ${overlayStyle}${erodeOverlay && state.overlayMode !== "outline" ? ' mask="url(#diffuser-overlay-mask)"' : ""}>${serializeText(state, state.overlayMode === "outline" ? "none" : overlayFill, undefined, false)}</g></g>`
    : "";
  const artwork = [
    `<defs><mask id="${SVG_IDS.mask}"><g id="${SVG_IDS.substrateMask}"><rect width="${VIEWPORT.width}" height="${VIEWPORT.height}" fill="black"/>${substrate}</g></mask>${overlayMask}</defs>`,
    outline,
    `<g id="${SVG_IDS.artwork}"${clipArtwork ? ` mask="url(#${SVG_IDS.mask})"` : ""} fill="${state.primaryColor}" stroke="${state.primaryColor}" stroke-width="1.15" stroke-linecap="round">${serializeGeometry(geometry, state.precision)}</g>`,
    textOverlay,
    `<g id="${SVG_IDS.sourceText}">${serializeText(state, "none", "hidden")}</g>`,
  ].join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEWPORT.width} ${VIEWPORT.height}" role="img" aria-label="${escape(state.text)} generative typography"><metadata>${escape(JSON.stringify(metadata))}</metadata>${background}${state.exportMode === "editable" ? editable : artwork}</svg>`;
}

export function createTimedSvg(state: ProjectState, context: RenderContext, textGeometry: TextGeometry | null = null, generatedGeometry?: GeometryGroup) {
  const result = measure(() => createSvg(state, context, textGeometry, generatedGeometry));
  return { svg: result.value, serializationTimeMs: result.durationMs };
}

export function validateSvgExport(svg: string, expectPathMask: boolean) {
  const hasMask = svg.includes(`<mask id="${SVG_IDS.mask}">`);
  const hasArtwork = svg.includes(`<g id="${SVG_IDS.artwork}"`);
  const hasPathMask = svg.includes(`<g id="${SVG_IDS.substrateMask}">`) && svg.includes('data-glyph-index="');
  return { hasMask, hasArtwork, hasPathMask, valid: hasMask && hasArtwork && (!expectPathMask || hasPathMask) };
}

export function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
