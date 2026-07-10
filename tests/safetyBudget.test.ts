import { describe, expect, it } from "vitest";
import { SAFETY_BUDGETS, planCanvasBackingStore, planContourWork, planDenseOccupancy, planSubstrateRaster } from "../src/engine/safetyBudget";

describe("deterministic safety planners", () => {
  it.each([[64, 16_384], [16_384, 64], [16_384, 16_384]])("bounds extreme substrate %d x %d before allocation", (width, height) => {
    const plan = planSubstrateRaster({ requestedWidth: width * 12, requestedHeight: height * 12 });
    expect(plan.width).toBeLessThanOrEqual(SAFETY_BUDGETS.substrateAxis);
    expect(plan.height).toBeLessThanOrEqual(SAFETY_BUDGETS.substrateAxis);
    expect(plan.cells).toBeLessThanOrEqual(SAFETY_BUDGETS.substrateCells);
    expect(plan.peakBytes).toBeGreaterThan(plan.residentBytes);
    expect(plan.reduced).toBe(true);
    expect(plan).toEqual(planSubstrateRaster({ requestedWidth: width * 12, requestedHeight: height * 12 }));
  });

  it("repairs invalid raster inputs without exposing an unsafe allocation size", () => {
    for (const value of [0, -1, NaN, Infinity, Number.MAX_VALUE]) {
      const plan = planSubstrateRaster({ requestedWidth: value, requestedHeight: value });
      expect(plan.cells).toBeLessThanOrEqual(SAFETY_BUDGETS.substrateCells);
      expect(plan.width).toBeGreaterThan(0);
      expect(plan.height).toBeGreaterThan(0);
    }
  });

  it("preserves standard substrate resolution exactly", () => {
    const plan = planSubstrateRaster({ requestedWidth: 384, requestedHeight: 230 });
    expect(plan).toMatchObject({ width: 384, height: 230, reduced: false });
  });

  it("caps presentation canvas from CSS dimensions and DPR", () => {
    const plan = planCanvasBackingStore({ cssWidth: 60_000, cssHeight: 400, dpr: 4 });
    expect(plan.pixels).toBeLessThanOrEqual(SAFETY_BUDGETS.canvasPixels);
    expect(plan.width).toBeLessThanOrEqual(SAFETY_BUDGETS.canvasAxis);
    expect(plan.height).toBeLessThanOrEqual(SAFETY_BUDGETS.canvasAxis);
  });

  it("coarsens dense occupancy and contour work before allocation/scans", () => {
    const occupancy = planDenseOccupancy(16_384, 16_384, 1);
    expect(occupancy.bytes).toBeLessThanOrEqual(SAFETY_BUDGETS.denseOccupancyBytes);
    expect(occupancy.coarsened).toBe(true);
    const contour = planContourWork(4_096, 4_096, 18);
    expect(contour.cellLevelVisits).toBeLessThanOrEqual(SAFETY_BUDGETS.contourCellLevelVisits);
  });
});
