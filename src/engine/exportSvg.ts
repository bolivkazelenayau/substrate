import { APP_NAME, APP_VERSION, SVG_IDS } from "./constants";
import { vectorGeometryBounds, type GeometryGroup, type VectorGeometry } from "./geometry";
import { getRenderer } from "./renderers";
import { getTextLayout } from "./textLayout";
import type { TextGeometry } from "./glyphGeometry";
import type { ProjectState, RenderContext } from "../types";
import { measure } from "./performance";
import { generateEdgeErosionMarks } from "./edgeErosion";
import { generateWarpedOutline, getFinalOutlineGeometry } from "./outlineWarp";
import { assertPresetExportable } from "./presetExportability";
import { assertVectorOnlySvg } from "./svgValidation";
import { DEFAULT_CONTOUR_STROKE_WIDTH, LEGACY_EXPORT_STROKE_WIDTH } from "./contourStroke";
import type { ExportSnapshot } from "./exportAuthority";
import { createStaticRenderContext } from "./renderContextLifecycle";
import { resolveRendererRequirements } from "./rendererRequirements";
import type { ArtboardRect } from "./sceneLayout";
import { baseState } from "./presets";

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
  const content = layout.lines.length === 1
    ? escape(layout.text)
    : layout.lines.map((line) =>
      `<tspan x="${line.x}" y="${line.baselineY}">${escape(line.text)}</tspan>`,
    ).join("");
  const preserveWhitespace = layout.lines.length > 1 || /(^|\n) | {2}/.test(layout.text) ? ' xml:space="preserve"' : "";
  return `<text x="${layout.x}" y="${layout.baselineY}"${preserveWhitespace} text-anchor="${layout.anchor}" font-family="${escape(layout.fontFamily)}" font-size="${layout.fontSize}" font-weight="${layout.fontWeight}" letter-spacing="${layout.tracking}"${fontKerning} fill="${fill}"${hidden}>${content}</text>`;
}

function serializeGlyphPaths(textGeometry: TextGeometry) {
  return textGeometry.glyphs
    .filter((glyph) => glyph.path.d.length > 0)
    .map((glyph) => `<path data-character-index="${glyph.textIndex}" data-glyph-index="${glyph.glyphIndex}" d="${escape(glyph.path.d)}"/>`)
    .join("");
}

export function createSvg(
  state: ProjectState,
  context: RenderContext,
  textGeometry: TextGeometry | null = null,
  generatedGeometry?: GeometryGroup,
  capturedContext?: { timeMs: number; frame: number },
  effectiveArtboardOverride?: ArtboardRect,
  authority?: { typographyKey: string; sceneKey: string; rendererKey: string },
): string {
  const authoredWidth = state.artboard.width;
  const authoredHeight = state.artboard.height;
  const effective: ArtboardRect = effectiveArtboardOverride ?? { x: 0, y: 0, width: authoredWidth, height: authoredHeight };
  const { width, height, x: rectX, y: rectY } = effective;
  const isAuthoredDefault = authoredWidth === 1200 && authoredHeight === 720 && rectX === 0 && rectY === 0 && width === 1200 && height === 720;
  const dimensionAttributes = isAuthoredDefault ? "" : ` width="${width}" height="${height}"`;
  assertPresetExportable(state.preset, state.exportMode);
  const renderer = getRenderer(state.renderer);
  const geometry = generatedGeometry ?? renderer.generateGeometry(state, context);
  const exportContext = context.textGeometry === textGeometry ? context : { ...context, textGeometry };
  const warpedOutline = generateWarpedOutline(state, exportContext);
  const hasWarpedOutline = state.overlayMode === "warped-outline" && warpedOutline.paths.length > 0;
  const finalOutline = getFinalOutlineGeometry(textGeometry, warpedOutline, hasWarpedOutline);
  const timestamp = new Date().toISOString();
  const legacyEmitterDisplay = Object.entries(baseState.emitterDisplay)
    .every(([name, value]) => state.emitterDisplay[name as keyof ProjectState["emitterDisplay"]] === value);
  const legacyGlyphDisplacement = Object.entries(baseState.glyphDisplacement)
    .every(([name, value]) => state.glyphDisplacement[name as keyof ProjectState["glyphDisplacement"]] === value);
  const legacyDotGrid = Object.entries(baseState.dotGrid)
    .every(([name, value]) => state.dotGrid[name as keyof ProjectState["dotGrid"]] === value);
  const legacyDisplayDislocation = Object.entries(baseState.displayDislocation)
    .every(([name, value]) => state.displayDislocation[name as keyof ProjectState["displayDislocation"]] === value);
  const legacyEmitterMicroResponse = Object.entries(baseState.emitterMicroResponse)
    .every(([name, value]) => state.emitterMicroResponse[name as keyof ProjectState["emitterMicroResponse"]] === value);
  const legacyGlyphMicroWarp = Object.entries(baseState.glyphMicroWarp)
    .every(([name, value]) => state.glyphMicroWarp[name as keyof ProjectState["glyphMicroWarp"]] === value);
  const legacyGlyphFalloffDisplacement = Object.entries(baseState.glyphFalloffDisplacement)
    .every(([name, value]) => state.glyphFalloffDisplacement[name as keyof ProjectState["glyphFalloffDisplacement"]] === value);
  // Sequential default-state elision keeps pre-feature SVG metadata byte-stable
  // after timestamp normalization. An active stage retains its introducing
  // schema and cannot be mislabeled as an older project.
  const v12CompatibilityMetadataState = legacyGlyphFalloffDisplacement
    ? (() => {
        const { glyphFalloffDisplacement: _glyphFalloffDisplacement, ...v13WithoutGlyphFalloff } = state;
        return { ...v13WithoutGlyphFalloff, version: 12 as const };
      })()
    : state;
  const compatibilityMetadataState = legacyGlyphFalloffDisplacement && legacyGlyphMicroWarp
    ? (() => {
        const { glyphMicroWarp: _glyphMicroWarp, ...v12WithoutMicroWarp } = v12CompatibilityMetadataState;
        const v11Project = { ...v12WithoutMicroWarp, version: 11 as const };
        if (!legacyEmitterMicroResponse) return v11Project;
        const { emitterMicroResponse: _emitterMicroResponse, ...v11WithoutEmitterMicro } = v11Project;
        const v10Project = { ...v11WithoutEmitterMicro, version: 10 as const };
        if (!legacyDisplayDislocation) return v10Project;
        const { displayDislocation: _displayDislocation, ...v10WithoutDisplayDislocation } = v10Project;
        return { ...v10WithoutDisplayDislocation, version: 9 as const };
      })()
    : v12CompatibilityMetadataState;
  const metadataProject = isAuthoredDefault && legacyEmitterDisplay && legacyGlyphDisplacement && legacyDotGrid && legacyDisplayDislocation && legacyEmitterMicroResponse && legacyGlyphMicroWarp && legacyGlyphFalloffDisplacement
    ? (() => {
        const {
          artboard: _artboard,
          version: _version,
          contourStrokeWidth,
          lineHeight,
          emitterDisplay: _emitterDisplay,
          glyphDisplacement: _glyphDisplacement,
          dotGrid: _dotGrid,
          ...legacyProject
        } = compatibilityMetadataState;
        const typographyProject = lineHeight === 1 ? legacyProject : { ...legacyProject, lineHeight };
        if (contourStrokeWidth !== DEFAULT_CONTOUR_STROKE_WIDTH) {
          return { version: 7, ...typographyProject, contourStrokeWidth };
        }
        return { version: 7, ...typographyProject };
      })()
    : compatibilityMetadataState;
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
    project: metadataProject,
    authoredArtboard: { width: authoredWidth, height: authoredHeight },
    effectiveArtboard: { x: rectX, y: rectY, width, height },
    outlineWarp: state.overlayMode === "warped-outline" ? warpedOutline.diagnostics : undefined,
    glyphMicroWarp: textGeometry?.microWarp ?? undefined,
    glyphDisplacement: textGeometry?.displacement ?? undefined,
    glyphDomainAuthority: textGeometry?.displacement || textGeometry?.microWarp ? {
      typographyKey: authority?.typographyKey ?? textGeometry.displacement?.geometryKey ?? textGeometry.microWarp!.geometryKey,
      sceneKey: authority?.sceneKey,
      rendererKey: authority?.rendererKey,
      rendererElementCount: geometry.geometries.length,
      rendererOutputBounds: vectorGeometryBounds(geometry),
    } : undefined,
    exportContext: capturedContext,
  };

  const rectArgs = rectX === 0 && rectY === 0
    ? `width="${width}" height="${height}"`
    : `x="${rectX}" y="${rectY}" width="${width}" height="${height}"`;
  const background = state.transparentBackground
    ? ""
    : `<g id="${SVG_IDS.background}"><rect ${rectArgs} fill="${state.backgroundColor}"/></g>`;
  const editable = textGeometry?.displacement || textGeometry?.microWarp
    ? `<g id="${SVG_IDS.artwork}" fill="${state.primaryColor}" fill-rule="nonzero">${serializeGlyphPaths(textGeometry)}</g>`
    : `<g id="${SVG_IDS.artwork}">${serializeText(state, state.primaryColor, undefined, Boolean(textGeometry?.hasOutlines))}</g>`;
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
    ? `<mask id="diffuser-overlay-mask"><rect ${rectArgs} fill="black"/>${overlayMaskContent}</mask>`
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
    `<defs><mask id="${SVG_IDS.mask}"><g id="${SVG_IDS.substrateMask}"><rect ${rectArgs} fill="black"/>${substrate}</g></mask>${overlayMask}</defs>`,
    outline,
    `<g id="${SVG_IDS.artwork}"${clipArtwork ? ` mask="url(#${SVG_IDS.mask})"` : ""} fill="${state.primaryColor}" stroke="${state.primaryColor}" stroke-width="${renderer.strokeWidth?.(state) ?? LEGACY_EXPORT_STROKE_WIDTH}" stroke-linecap="round">${serializeGeometry(geometry, state.precision)}</g>`,
    textOverlay,
    `<g id="${SVG_IDS.sourceText}">${serializeText(state, "none", "hidden")}</g>`,
  ].join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg"${dimensionAttributes} viewBox="${rectX} ${rectY} ${width} ${height}" role="img" aria-label="${escape(state.text)} generative typography"><metadata>${escape(JSON.stringify(metadata))}</metadata>${background}${state.exportMode === "editable" ? editable : artwork}</svg>`;
  assertVectorOnlySvg(svg);
  return svg;
}

export function createTimedSvg(
  state: ProjectState,
  context: RenderContext,
  textGeometry: TextGeometry | null = null,
  generatedGeometry?: GeometryGroup,
  exportContext?: { timeMs: number; frame: number },
  effectiveArtboardOverride?: ArtboardRect,
  authority?: { typographyKey: string; sceneKey: string; rendererKey: string },
) {
  const result = measure(() => createSvg(state, context, textGeometry, generatedGeometry, exportContext, effectiveArtboardOverride, authority));
  return { svg: result.value, serializationTimeMs: result.durationMs };
}

export function createTimedSvgFromSnapshot(snapshot: ExportSnapshot) {
  const context: RenderContext = {
    ...createStaticRenderContext(
      snapshot.document,
      snapshot.typography.geometry,
      snapshot.substrate?.data ?? null,
      snapshot.effectiveArtboard,
      resolveRendererRequirements(snapshot.document.renderer),
      snapshot.typography.outputKey,
      snapshot.substrate?.outputKey ?? null,
    ),
    timeMs: snapshot.context.timeMs,
    frame: snapshot.context.frame,
  };
  return createTimedSvg(
    snapshot.document,
    context,
    snapshot.typography.geometry,
    snapshot.renderer.geometry,
    snapshot.context,
    snapshot.effectiveArtboard,
    {
      typographyKey: snapshot.typography.outputKey,
      sceneKey: snapshot.sceneLayoutKey,
      rendererKey: snapshot.renderer.geometryKey,
    },
  );
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
