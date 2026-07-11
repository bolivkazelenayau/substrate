import type { LoadedFont } from "./fontLoader";
import type { GlyphBounds, TextGeometry } from "./glyphGeometry";
import { layoutGlyphs } from "./glyphLayout";
import { resolveTextBoundsModel } from "./textBounds";
import { getTextLayout } from "./textLayout";
import { ARTBOARD_LIMITS } from "./artboard";
import type { ProjectState } from "../types";
import { resolveTypographyPlacement } from "./typographyPlacement";

export interface TypographySizePlacement {
  size: number;
  project: ProjectState;
  geometry: TextGeometry | null;
  layoutBounds: GlyphBounds;
  inkBounds: GlyphBounds;
  projectedArtboard: ProjectState["artboard"];
  visualCenter: { x: number; y: number };
  baselineY: number;
  originX: number;
}

const MAX_PLACEMENT_PASSES = 5;

/**
 * Canonical Size placement: keep horizontal alignment based on the typography
 * layout, but center the measured ink vertically in the projected non-shrinking
 * artboard. Font layout boxes reserve descent space that makes uppercase artwork
 * appear low at large sizes, so they are not a reliable visual Y anchor.
 */
export function resolveArtboardCenteredTypographySize(
  base: ProjectState,
  loadedFont: LoadedFont | null,
  requestedSize: number,
): TypographySizePlacement {
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : base.fontSize;
  const project: ProjectState = {
    ...base,
    fontSize: size,
    artboard: { ...base.artboard },
  };
  const measured = measure(project, loadedFont);

  const layout = getTextLayout(project);
  return {
    size,
    project,
    geometry: measured.geometry,
    layoutBounds: measured.layoutBounds,
    inkBounds: measured.inkBounds,
    projectedArtboard: project.artboard,
    visualCenter: resolveTypographyPlacement(project, measured.layoutBounds, measured.inkBounds, measured.geometry?.originX ?? layout.x).visualCenter,
    baselineY: measured.geometry?.baselineY ?? layout.baselineY,
    originX: measured.geometry?.originX ?? layout.lines[0]?.originX ?? layout.x,
  };
}

/** Apply only the document fields owned by a Size transaction. */
export function applyTypographySizePlacement(
  current: ProjectState,
  placement: TypographySizePlacement,
): ProjectState {
  return {
    ...current,
    fontSize: placement.size,
  };
}

/** Capture typography exactly where the settled document currently places it. */
export function resolveSettledTypographyPlacement(
  project: ProjectState,
  loadedFont: LoadedFont | null,
): TypographySizePlacement {
  const measured = measure(project, loadedFont);
  const layout = getTextLayout(project);
  return {
    size: project.fontSize,
    project,
    geometry: measured.geometry,
    layoutBounds: measured.layoutBounds,
    inkBounds: measured.inkBounds,
    projectedArtboard: project.artboard,
    visualCenter: resolveTypographyPlacement(project, measured.layoutBounds, measured.inkBounds, measured.geometry?.originX ?? layout.x).visualCenter,
    baselineY: measured.geometry?.baselineY ?? layout.baselineY,
    originX: measured.geometry?.originX ?? layout.lines[0]?.originX ?? layout.x,
  };
}

/**
 * Presentation-only Size projection derived from one immutable typography
 * revision. It deliberately performs no glyph layout: bounds, baseline, and
 * origin are scaled directly from the gesture-start placement.
 */
export function projectTypographySizeFromPlacement(
  source: TypographySizePlacement,
  requestedSize: number,
): TypographySizePlacement {
  const size = Number.isFinite(requestedSize) && requestedSize > 0 ? requestedSize : source.size;
  const scale = size / Math.max(1, source.size);
  const padding = Math.max(48, size * 0.08);
  const horizontalExtent = Math.max(
    source.visualCenter.x - source.inkBounds.x,
    source.inkBounds.x + source.inkBounds.width - source.visualCenter.x,
  ) * scale;
  const verticalExtent = Math.max(
    source.visualCenter.y - source.inkBounds.y,
    source.inkBounds.y + source.inkBounds.height - source.visualCenter.y,
  ) * scale;
  const projectedArtboard = {
    width: Math.min(ARTBOARD_LIMITS.max, Math.ceil(Math.max(source.project.artboard.width, (horizontalExtent + padding) * 2))),
    height: Math.min(ARTBOARD_LIMITS.max, Math.ceil(Math.max(source.project.artboard.height, (verticalExtent + padding) * 2))),
  };
  const visualCenter = { x: source.project.artboard.width / 2, y: source.project.artboard.height / 2 + source.project.textOffsetY };
  const translateX = visualCenter.x - source.visualCenter.x;
  const translateY = visualCenter.y - source.visualCenter.y;
  const projectBounds = (bounds: GlyphBounds): GlyphBounds => ({
    x: source.visualCenter.x + (bounds.x - source.visualCenter.x) * scale + translateX,
    y: source.visualCenter.y + (bounds.y - source.visualCenter.y) * scale + translateY,
    width: bounds.width * scale,
    height: bounds.height * scale,
  });
  const baselineY = source.visualCenter.y + (source.baselineY - source.visualCenter.y) * scale + translateY;
  const originX = source.visualCenter.x + (source.originX - source.visualCenter.x) * scale + translateX;
  const unplacedProject: ProjectState = {
    ...source.project,
    fontSize: size,
    artboard: projectedArtboard,
  };
  const unplacedBaseline = getTextLayout(unplacedProject).baselineY;
  const project = {
    ...unplacedProject,
    textOffsetY: unplacedProject.textOffsetY + baselineY - unplacedBaseline,
  };
  return {
    size,
    project,
    geometry: null,
    layoutBounds: projectBounds(source.layoutBounds),
    inkBounds: projectBounds(source.inkBounds),
    projectedArtboard,
    visualCenter,
    baselineY,
    originX,
  };
}

function measure(project: ProjectState, loadedFont: LoadedFont | null) {
  const geometry = loadedFont ? layoutGlyphs(project, loadedFont) : null;
  const bounds = resolveTextBoundsModel(project, geometry);
  return { geometry, layoutBounds: bounds.layoutBounds, inkBounds: bounds.inkBounds };
}

function center(bounds: GlyphBounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}
