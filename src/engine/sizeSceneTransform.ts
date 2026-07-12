import type { GeometryGroup } from "./geometry";
import type { CircleMark, LineSegment, Polyline } from "./geometry";
import {
  artboardCenter,
  type Point,
  type ResolvedSceneLayout,
} from "./sceneLayout";

export interface SizeSceneTransform {
  pivot: Point;
  scale: number;
}

export function resolveSizeSceneTransform(
  sourceScene: ResolvedSceneLayout,
  sourceFontSize: number,
  targetScene: ResolvedSceneLayout,
  targetFontSize: number,
): SizeSceneTransform {
  const pivot = artboardCenter(sourceScene.authoredArtboardRect);
  const scale = sourceFontSize > 0 ? targetFontSize / sourceFontSize : 1;
  void targetScene;
  return { pivot, scale };
}

function transformPoint(point: Point, transform: SizeSceneTransform): Point {
  if (transform.scale === 1) return point;
  return {
    x: transform.pivot.x + (point.x - transform.pivot.x) * transform.scale,
    y: transform.pivot.y + (point.y - transform.pivot.y) * transform.scale,
  };
}

function transformGeometryItem<T extends GeometryGroup["geometries"][number]>(
  item: T,
  transform: SizeSceneTransform,
): T {
  if (transform.scale === 1) return item;
  if (item.type === "circle") {
    return {
      ...item,
      center: transformPoint(item.center, transform),
      radius: item.radius * transform.scale,
    };
  }
  if (item.type === "line") {
    return {
      ...item,
      start: transformPoint(item.start, transform),
      end: transformPoint(item.end, transform),
    };
  }
  if (item.type === "polyline") {
    return {
      ...item,
      points: item.points.map((point) => transformPoint(point, transform)),
    };
  }
  return item;
}

export function applySizeSceneTransformToGeometry(
  exact: GeometryGroup,
  transform: SizeSceneTransform,
  elementCap: number,
): GeometryGroup {
  if (transform.scale === 1) return exact;
  const capped = exact.geometries.slice(0, elementCap);
  return {
    ...exact,
    id: `${exact.id}:retained:${transform.scale.toFixed(4)}`,
    geometries: capped.map((item) => transformGeometryItem(item, transform)) as Array<
      LineSegment | CircleMark | Polyline
    >,
    diagnostics: exact.diagnostics
      ? { ...exact.diagnostics, fallback: true }
      : exact.diagnostics,
  };
}

export function sizeSceneTransformToSvg(
  transform: SizeSceneTransform,
): string | undefined {
  if (transform.scale === 1) return undefined;
  const { pivot, scale } = transform;
  return `translate(${pivot.x} ${pivot.y}) scale(${scale}) translate(${-pivot.x} ${-pivot.y})`;
}

export function sizeSceneTransformToCanvas(
  context2d: CanvasRenderingContext2D,
  transform: SizeSceneTransform,
): void {
  if (transform.scale === 1) return;
  const { pivot, scale } = transform;
  context2d.translate(pivot.x, pivot.y);
  context2d.scale(scale, scale);
  context2d.translate(-pivot.x, -pivot.y);
}