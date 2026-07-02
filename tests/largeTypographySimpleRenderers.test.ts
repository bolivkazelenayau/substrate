import { describe, expect, it } from "vitest";
import { getRenderer } from "../src/engine/renderers";
import { baseState } from "../src/engine/presets";

function coordinate(geometry: ReturnType<ReturnType<typeof getRenderer>["generateGeometry"]>["geometries"][number]) {
  if (geometry.type === "circle") return geometry.center;
  if (geometry.type === "line") return geometry.start;
  if (geometry.type === "polyline") return geometry.points[0];
  return null;
}

describe.each(["flow", "ripple", "dots"] as const)("%s large-type edge coverage", (rendererId) => {
  it("retains deterministic candidates in both artboard edge bands", () => {
    const state = { ...baseState, renderer: rendererId, fontSize: 560, density: 58 };
    const context = { timeMs: 0, frame: 0 };
    const renderer = getRenderer(rendererId);
    const first = renderer.generateGeometry(state, context);
    const second = renderer.generateGeometry(state, context);
    const points = first.geometries.map(coordinate).filter((point): point is { x: number; y: number } => point !== null);
    expect(points.some(({ x }) => x < 42)).toBe(true);
    expect(points.some(({ x }) => x > 1158)).toBe(true);
    expect(first).toEqual(second);
  });
});
