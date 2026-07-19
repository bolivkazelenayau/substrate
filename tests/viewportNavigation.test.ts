import { describe, expect, it } from "vitest";
import {
  MAX_VIEWPORT_ZOOM,
  MIN_VIEWPORT_ZOOM,
  clampZoom,
  defaultViewportNavigation,
  fitViewportToContent,
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

  it("pans independently and resets to the canonical identity view", () => {
    expect(panBy(defaultViewportNavigation, 18, -7)).toEqual({ zoom: 1, panX: 18, panY: -7 });
    expect(resetViewportNavigation()).toEqual(defaultViewportNavigation);
    expect(resetViewportNavigation()).not.toBe(defaultViewportNavigation);
  });

  it("fits content that is larger than the frame by zooming out and clearing pan", () => {
    const fit = fitViewportToContent({ width: 800, height: 480 }, { width: 1600, height: 960 });
    expect(fit.zoom).toBeCloseTo(0.5, 8);
    expect(fit.panX).toBe(0);
    expect(fit.panY).toBe(0);
  });

  it("fits tall multi-line stages without changing the width-limited scale incorrectly", () => {
    // Authored-stable stage: same width as a width-fitted host, but taller.
    const frame = { width: 800, height: 480 };
    const compact = { width: 1000, height: 480 };
    const loose = { width: 1000, height: 960 };
    const fitCompact = fitViewportToContent(frame, compact);
    const fitLoose = fitViewportToContent(frame, loose);
    expect(fitCompact.zoom).toBeCloseTo(0.8, 8);
    expect(fitLoose.zoom).toBeCloseTo(0.5, 8);
    expect(fitLoose.zoom).toBeLessThan(fitCompact.zoom);
  });
});
