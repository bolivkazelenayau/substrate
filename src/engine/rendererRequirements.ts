import { getRendererManifest, type RendererManifest } from "./renderers/rendererManifest";
import type { ProjectState, RendererId } from "../types";

export type RendererCapabilities = {
  requiresTypographyGeometry: boolean;
  requiresSceneLayout: boolean;
  requiresSubstrate: boolean;
  requiresStaticField: boolean;
  requiresGlyphField: boolean;
  requiresOccupancy: boolean;
  usesAnimationTime: boolean;
  supportsCanvasPreview: boolean;
};

export type RendererRequirements = {
  typography: boolean;
  scene: boolean;
  substrate: boolean;
  staticField: boolean;
  glyphField: boolean;
  occupancy: boolean;
  animationTime: boolean;
};

const CANVAS_PREVIEW_RENDERERS = new Set<RendererId>(["flow", "ripple", "dots"]);

function manifestUsesField(manifest: RendererManifest): boolean {
  const deps = new Set(manifest.dependencies);
  return deps.has("field") || deps.has("emitters");
}

function manifestUsesGlyphField(manifest: RendererManifest): boolean {
  const deps = new Set(manifest.dependencies);
  return deps.has("field") || deps.has("emitters") || deps.has("glyphModulation");
}

function manifestUsesTypographyGeometry(manifest: RendererManifest): boolean {
  const deps = new Set(manifest.dependencies);
  return deps.has("typography") || deps.has("textGeometry") || deps.has("text");
}

export function rendererCapabilitiesFromManifest(manifest: RendererManifest): RendererCapabilities {
  return {
    requiresTypographyGeometry: manifestUsesTypographyGeometry(manifest),
    requiresSceneLayout: true,
    requiresSubstrate: manifest.usesSubstrate,
    requiresStaticField: manifestUsesField(manifest),
    requiresGlyphField: manifestUsesGlyphField(manifest),
    requiresOccupancy: manifest.usesSubstrate,
    usesAnimationTime: manifest.usesTime,
    supportsCanvasPreview: CANVAS_PREVIEW_RENDERERS.has(manifest.id),
  };
}

export function resolveRendererRequirements(rendererId: RendererId): RendererRequirements {
  const capabilities = rendererCapabilitiesFromManifest(getRendererManifest(rendererId));
  return {
    typography: capabilities.requiresTypographyGeometry,
    scene: capabilities.requiresSceneLayout,
    substrate: capabilities.requiresSubstrate,
    staticField: capabilities.requiresStaticField,
    glyphField: capabilities.requiresGlyphField,
    occupancy: capabilities.requiresOccupancy,
    animationTime: capabilities.usesAnimationTime,
  };
}

export function resolveRendererRequirementsForState(state: ProjectState): RendererRequirements {
  return resolveRendererRequirements(state.renderer);
}