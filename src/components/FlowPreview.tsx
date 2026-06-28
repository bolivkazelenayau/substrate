import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { GeometryGroup, LineSegment } from "../engine/geometry";

interface FlowPreviewProps {
  geometry: GeometryGroup;
}

export const FlowPreview = memo(function FlowPreview({ geometry }: FlowPreviewProps) {
  const lines = geometry.geometries as LineSegment[];
  const lineRefs = useRef<Array<SVGLineElement | null>>([]);
  const elements = useMemo(() => {
    lineRefs.current.length = lines.length;
    return Array.from({ length: lines.length }, (_, index) => (
      <line
        key={index}
        ref={(element) => {
          lineRefs.current[index] = element;
        }}
      />
    ));
  }, [lines.length]);

  useLayoutEffect(() => {
    lines.forEach((line, index) => {
      const element = lineRefs.current[index];
      if (!element) return;
      element.setAttribute("x1", String(line.start.x));
      element.setAttribute("y1", String(line.start.y));
      element.setAttribute("x2", String(line.end.x));
      element.setAttribute("y2", String(line.end.y));
      element.setAttribute("opacity", String(line.opacity ?? 1));
    });
  }, [lines]);

  return elements;
});
