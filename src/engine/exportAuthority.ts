import type { LoadedFont } from "./fontLoader";
import type { TextGeometry } from "./glyphGeometry";
import { createStaticRenderContext } from "./renderContextLifecycle";
import { generateRendererGeometry, rendererGeometryStateKey } from "./rendererRuntime";
import { getRendererManifest } from "./renderers/rendererManifest";
import type { GeometryGroup } from "./geometry";
import type { ArtboardRect, AuthoredArtboard } from "./sceneLayout";
import type { SubstrateBuildInput, SubstrateData } from "./substrate";
import type { ProjectState, RenderContext } from "../types";

export type ExportKey = string;

export interface FontResolution {
  status: "exact" | "native-approximate" | "missing";
  resourceKey: ExportKey | null;
  loadedFont: LoadedFont | null;
}

export interface ExportReadiness {
  status: "ready" | "font-missing" | "typography-pending" | "substrate-pending" | "renderer-pending" | "size-interaction-pending" | "scene-safety-limit" | "revision-mismatch" | "failed";
  reason: string;
  technicalReason: string;
  expectedKey?: ExportKey;
  actualKey?: ExportKey | null;
}

export interface ExportSnapshot {
  document: ProjectState;
  documentKey: ExportKey;
  /** Authored artboard minimum as persisted in the document (schema v8). */
  authoredArtboard: AuthoredArtboard;
  /** Resolved effective scene rect (origin-aware). Never persisted. */
  effectiveArtboard: ArtboardRect;
  /** Stable identity for the resolved scene (authored + effective + typography). */
  sceneLayoutKey: ExportKey;
  /** Stable identity for the typographic placement inside the scene. */
  typographyPlacementKey: ExportKey;
  font: { status: "exact" | "native-approximate"; resourceKey: ExportKey };
  typography: { inputKey: ExportKey; outputKey: ExportKey; geometry: TextGeometry | null };
  substrate?: { inputKey: ExportKey; outputKey: ExportKey; data: SubstrateData };
  renderer: { id: ProjectState["renderer"]; inputKey: ExportKey; geometryKey: ExportKey; geometry: GeometryGroup };
  context: { mode: ProjectState["exportFrameMode"]; timeMs: number; frame: number };
  artboard: ProjectState["artboard"];
  provenance: { schemaVersion: number; appVersion: string };
}

function key(prefix: string, value: unknown): ExportKey {
  return `${prefix}:${JSON.stringify(value)}`;
}

function documentProjection(state: ProjectState) {
  const { debug: _debug, ...document } = state;
  return document;
}

export function documentKey(state: ProjectState): ExportKey {
  return key("document", documentProjection(state));
}

export function resolveFontResolution(state: ProjectState, loadedFont: LoadedFont | null): FontResolution {
  if (!state.font) return { status: "native-approximate", resourceKey: "font:native", loadedFont: null };
  const matches = loadedFont
    && loadedFont.metadata.fileName === state.font.fileName
    && loadedFont.metadata.fullName === state.font.fullName
    && loadedFont.metadata.unitsPerEm === state.font.unitsPerEm;
  if (!matches) return { status: "missing", resourceKey: null, loadedFont: null };
  return {
    status: "exact",
    resourceKey: key("font", { metadata: loadedFont.metadata, fingerprint: loadedFont.fingerprint }),
    loadedFont,
  };
}

export function typographyInputKey(state: ProjectState, fontResourceKey: ExportKey): ExportKey {
  return key("typography-input", {
    text: state.text,
    font: fontResourceKey,
    fontSize: state.fontSize,
    lineHeight: state.lineHeight,
    tracking: state.tracking,
    kerningMode: state.kerningMode,
    kerningStrength: state.kerningStrength,
    opticalSpacing: state.opticalSpacing,
    opticalSpacingStrength: state.opticalSpacingStrength,
    textAlign: state.textAlign,
    textOffsetY: state.textOffsetY,
    artboard: state.artboard,
  });
}

export function typographyOutputKey(inputKey: ExportKey, font: FontResolution, geometry: TextGeometry | null): ExportKey | null {
  return font.status === "missing" || (font.status === "exact" && !geometry)
    ? null
    : key("typography-output", inputKey);
}

export function substrateBuildInputKey(input: SubstrateBuildInput, typographyKey: ExportKey | null): ExportKey {
  return key("substrate-input", {
    typographyKey,
    sourceText: input.sourceText,
    fontSize: input.fontSize,
    tracking: input.tracking,
    fontFamily: input.fontFamily,
    fontWeight: input.fontWeight,
    baselineY: input.baselineY,
    textX: input.textX,
    lineHeight: input.lineHeight,
    textAlign: input.textAlign,
    kerningMode: input.kerningMode,
    resolution: input.resolution,
    bounds: input.bounds,
    domainBounds: input.domainBounds,
    viewport: input.viewport,
  });
}

export function rendererInputKey(
  state: ProjectState,
  typographyKey: ExportKey,
  substrateKey: ExportKey | null,
  context: Pick<RenderContext, "timeMs" | "frame">,
): ExportKey {
  const manifest = getRendererManifest(state.renderer);
  return key("renderer-input", {
    rendererState: rendererGeometryStateKey(state),
    typographyKey,
    substrateKey: manifest.usesSubstrate ? substrateKey : null,
    time: manifest.usesTime ? { timeMs: context.timeMs, frame: context.frame } : { timeMs: 0, frame: 0 },
  });
}

export interface ResolveExportReadinessInput {
  font: FontResolution;
  typographyInputKey: ExportKey;
  typographyOutputKey: ExportKey | null;
  substrateInputKey: ExportKey;
  substrateOutputKey: ExportKey | null;
  substrateData: SubstrateData | null;
  rendererInputKey: ExportKey;
  rendererGeometryKey: ExportKey | null;
  /** True when the resolved effective rect hit ARTBOARD_LIMITS.max. */
  sceneSafetyLimitHit: boolean;
  failureReason?: string | null;
  renderer: ProjectState["renderer"];
}

export function resolveExportReadiness(input: ResolveExportReadinessInput): ExportReadiness {
  if (input.failureReason) return { status: "failed", reason: "Export preparation failed.", technicalReason: input.failureReason };
  if (input.font.status === "missing") return { status: "font-missing", reason: "Upload the project font before exporting.", technicalReason: "The project requests an exact font resource that is not resolved." };
  if (!input.typographyOutputKey) return { status: "typography-pending", reason: "Preparing export… typography is updating.", technicalReason: "Typography geometry is unavailable." };
  if (input.typographyOutputKey !== key("typography-output", input.typographyInputKey)) {
    return { status: "revision-mismatch", reason: "Preparing export… typography changed.", technicalReason: "Typography output does not match the active input.", expectedKey: input.typographyInputKey, actualKey: input.typographyOutputKey };
  }
  if (getRendererManifest(input.renderer).usesSubstrate) {
    if (!input.substrateData || !input.substrateOutputKey) return { status: "substrate-pending", reason: "Preparing export… substrate is rebuilding.", technicalReason: "This renderer requires a completed substrate result." };
    if (input.substrateOutputKey !== input.substrateInputKey) {
      return { status: "revision-mismatch", reason: "Preparing export… substrate changed.", technicalReason: "Preview substrate does not match the active substrate input.", expectedKey: input.substrateInputKey, actualKey: input.substrateOutputKey };
    }
  }
  if (input.rendererGeometryKey !== input.rendererInputKey) {
    return { status: "renderer-pending", reason: "Preparing export… renderer geometry is updating.", technicalReason: "Renderer geometry does not match the active renderer input.", expectedKey: input.rendererInputKey, actualKey: input.rendererGeometryKey };
  }
  if (input.sceneSafetyLimitHit) {
    return { status: "scene-safety-limit", reason: "Export is ready but the artwork was clipped to the safe artboard limit.", technicalReason: "The resolved effective artboard hit ARTBOARD_LIMITS.max." };
  }
  return { status: "ready", reason: "Ready to export.", technicalReason: "All authoritative stage identities match." };
}

export function captureExportSnapshot(args: {
  state: ProjectState;
  documentKey: ExportKey;
  font: FontResolution;
  typographyInputKey: ExportKey;
  typographyOutputKey: ExportKey;
  typographyGeometry: TextGeometry | null;
  substrateInputKey: ExportKey;
  substrateOutputKey: ExportKey | null;
  substrateData: SubstrateData | null;
  context: { mode: ProjectState["exportFrameMode"]; timeMs: number; frame: number };
  appVersion: string;
  authoredArtboard: AuthoredArtboard;
  effectiveArtboard: ArtboardRect;
  sceneLayoutKey: ExportKey;
  typographyPlacementKey: ExportKey;
}): ExportSnapshot {
  if (!args.font.resourceKey || args.font.status === "missing") throw new Error("Exact font resource is not resolved.");
  const manifest = getRendererManifest(args.state.renderer);
  if (manifest.usesSubstrate && (!args.substrateData || args.substrateOutputKey !== args.substrateInputKey)) {
    throw new Error("Matching substrate result is not ready.");
  }
  const document = structuredClone(args.state);
  // Rebuild the context from authoritative CPU-owned values; never reuse Canvas context.
  // The effective rect is fed in explicitly so the static export context matches
  // the live preview's resolved scene geometry exactly.
  const context: RenderContext = {
    ...createStaticRenderContext(document, args.typographyGeometry, manifest.usesSubstrate ? args.substrateData : null, args.effectiveArtboard),
    timeMs: args.context.timeMs,
    frame: args.context.frame,
  };
  const inputKey = rendererInputKey(document, args.typographyOutputKey, args.substrateOutputKey, context);
  const geometry = generateRendererGeometry(document, context);
  return Object.freeze({
    document,
    documentKey: args.documentKey,
    authoredArtboard: args.authoredArtboard,
    effectiveArtboard: args.effectiveArtboard,
    sceneLayoutKey: args.sceneLayoutKey,
    typographyPlacementKey: args.typographyPlacementKey,
    font: { status: args.font.status, resourceKey: args.font.resourceKey },
    typography: { inputKey: args.typographyInputKey, outputKey: args.typographyOutputKey, geometry: args.typographyGeometry },
    substrate: manifest.usesSubstrate && args.substrateData && args.substrateOutputKey
      ? { inputKey: args.substrateInputKey, outputKey: args.substrateOutputKey, data: args.substrateData }
      : undefined,
    renderer: { id: document.renderer, inputKey, geometryKey: inputKey, geometry },
    context: args.context,
    artboard: document.artboard,
    provenance: { schemaVersion: document.version, appVersion: args.appVersion },
  });
}