import { describe, expect, it } from "vitest";
import {
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  clampZoom,
  defaultViewportNavigation,
  panBy,
  resetViewportNavigation,
  zoomAtCenter,
  zoomAtPoint,
} from "../src/engine/viewportNavigation";

describe("canvas viewport navigation math", () => {
  it("keeps the same world coordinate under a cursor anchor", () => {
    const state = { zoom: 1.5, panX: 24, panY: -18 };
    const anchor = { x: 180, y: 95 };
    const before = {
      x: (anchor.x - state.panX) / state.zoom,
      y: (anchor.y - state.panY) / state.zoom,
    };
    const next = zoomAtPoint(state, 3, anchor);
    expect((anchor.x - next.panX) / next.zoom).toBeCloseTo(before.x, 10);
    expect((anchor.y - next.panY) / next.zoom).toBeCloseTo(before.y, 10);
  });

  it("zooms around the viewport center and clamps safe extremes", () => {
    const state = { zoom: 1, panX: 40, panY: -20 };
    expect(zoomAtCenter(state, 2)).toEqual({ zoom: 2, panX: 80, panY: -40 });
    expect(clampZoom(0.01)).toBe(MIN_VIEWPORT_ZOOM);
    expect(clampZoom(100)).toBe(MAX_VIEWPORT_ZOOM);
  });

  it("pans independently and resets to the canonical fit view", () => {
    expect(panBy(defaultViewportNavigation, 18, -7)).toEqual({ zoom: 1, panX: 18, panY: -7 });
    expect(resetViewportNavigation()).toEqual(defaultViewportNavigation);
    expect(resetViewportNavigation()).not.toBe(defaultViewportNavigation);
  });
});
