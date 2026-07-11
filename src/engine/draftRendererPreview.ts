import type { GeometryGroup, VectorGeometry } from "./geometry";
import type { ProjectState, RendererId } from "../types";
import type { TypographySizePlacement } from "./typographySizePlacement";
import { getRenderer } from "./renderers";

export type DraftPreviewQuality = "responsive" | "bounded-substrate";

export interface FrozenRendererRevision {
  snapshotId: number;
  rendererId: RendererId;
  geometryRevisionKey: string;
  geometry: GeometryGroup;
  mask: {
    enabled: boolean;
    typography: TypographySizePlacement;
  };
  appearance: {
    primaryColor: string;
    backgroundColor: string;
    transparentBackground: boolean;
    strokeWidth: number;
  };
  sourceWorldBounds: { x: number; y: number; width: number; height: number };
  artboard: ProjectState["artboard"];
  gestureStartSize: number;
  project: ProjectState;
  typography: TypographySizePlacement;
}

export interface DraftRenderInput {
  snapshot: FrozenRendererRevision;
  target: TypographySizePlacement;
  projectedArtboard: ProjectState["artboard"];
  previewQuality: DraftPreviewQuality;
  scale: number;
  draftKey: string;
}

export interface DraftPreviewPlan {
  maxMarks: number;
  maxBackingPixels: number;
  maxFps: number;
  quality: DraftPreviewQuality;
}

const DENSE_RENDERERS = new Set<RendererId>(["sdf-flow", "sdf-streamlines", "sdf-contours", "sdf-halftone", "wave-contours", "glyph-diffuser"]);

export function planDraftRendererPreview(rendererId: RendererId): DraftPreviewPlan {
  return DENSE_RENDERERS.has(rendererId)
    ? { maxMarks: 480, maxBackingPixels: 720_000, maxFps: 15, quality: "bounded-substrate" }
    : { maxMarks: 800, maxBackingPixels: 960_000, maxFps: 20, quality: "responsive" };
}

export function createFrozenRendererRevision(
  project: ProjectState,
  geometry: GeometryGroup,
  geometryRevisionKey: string,
  typography: TypographySizePlacement,
  snapshotId: number,
): FrozenRendererRevision {
  const renderer = getRenderer(project.renderer);
  return {
    snapshotId,
    rendererId: project.renderer,
    geometryRevisionKey,
    geometry,
    mask: {
      enabled: renderer.clipPreviewToText?.(project) ?? true,
      typography,
    },
    appearance: {
      primaryColor: project.primaryColor,
      backgroundColor: project.backgroundColor,
      transparentBackground: project.transparentBackground,
      strokeWidth: Math.max(0.35, renderer.strokeWidth?.(project) ?? 1),
    },
    sourceWorldBounds: { x: 0, y: 0, width: project.artboard.width, height: project.artboard.height },
    artboard: { ...project.artboard },
    gestureStartSize: project.fontSize,
    project,
    typography,
  };
}

export function createDraftRenderInput(
  snapshot: FrozenRendererRevision,
  target: TypographySizePlacement,
  sequence: number,
): DraftRenderInput {
  const plan = planDraftRendererPreview(snapshot.rendererId);
  return {
    snapshot,
    target,
    projectedArtboard: target.projectedArtboard,
    previewQuality: plan.quality,
    scale: target.size / Math.max(1, snapshot.gestureStartSize),
    draftKey: `${snapshot.geometryRevisionKey}|snapshot:${snapshot.snapshotId}|size:${target.size}|draft:${sequence}`,
  };
}

export function sampleDraftGeometry(geometry: GeometryGroup, maxMarks: number): VectorGeometry[] {
  if (geometry.geometries.length <= maxMarks) return geometry.geometries;
  const stride = geometry.geometries.length / maxMarks;
  return Array.from({ length: maxMarks }, (_, index) => geometry.geometries[Math.floor(index * stride)]);
}

export function planDraftCanvas(artboard: ProjectState["artboard"], maxBackingPixels: number) {
  const aspect = Math.max(1e-6, artboard.width / artboard.height);
  const width = Math.max(1, Math.floor(Math.sqrt(maxBackingPixels * aspect)));
  const height = Math.max(1, Math.floor(width / aspect));
  return { width, height };
}
