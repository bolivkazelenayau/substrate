import { describe, expect, it } from "vitest";
import { budgetContourFragmentsFairly } from "../src/engine/contourBudget";

function fragment(index: number, pointCount = 20) {
  return {
    payload: { index },
    points: Array.from({ length: pointCount }, (_, pointIndex) => ({ x: index * 100 + pointIndex, y: index })),
  };
}

describe("fair contour budgeting", () => {
  it("preserves the identity path when the point budget is sufficient", () => {
    const fragments = [fragment(0, 4), fragment(1, 5)];
    const result = budgetContourFragmentsFairly(fragments, 20);
    expect(result.fragments).toBe(fragments);
    expect(result).toMatchObject({
      originalPointCount: 9,
      retainedPointCount: 9,
      budgetLimited: false,
      strategy: "none",
    });
  });

  it("retains early, middle, and late fragments instead of taking a prefix", () => {
    const result = budgetContourFragmentsFairly(Array.from({ length: 10 }, (_, index) => fragment(index)), 15);
    expect(result.fragments.map(({ payload }) => payload.index)).toEqual([0, 2, 5, 7, 9]);
    expect(result.retainedPointCount).toBeLessThanOrEqual(15);
    expect(result.budgetLimited).toBe(true);
    expect(result.strategy).toBe("proportional-even-decimation");
  });

  it("proportionally decimates retained fragments while preserving endpoints", () => {
    const fragments = [fragment(0, 30), fragment(1, 60), fragment(2, 90)];
    const result = budgetContourFragmentsFairly(fragments, 30);
    expect(result.fragments).toHaveLength(3);
    expect(result.fragments.map(({ points }) => points.length)).toEqual([7, 10, 13]);
    result.fragments.forEach(({ points }, index) => {
      expect(points[0]).toEqual(fragments[index].points[0]);
      expect(points.at(-1)).toEqual(fragments[index].points.at(-1));
    });
  });

  it("is deterministic for identical candidates and budget", () => {
    const fragments = Array.from({ length: 12 }, (_, index) => fragment(index, 11 + index));
    expect(budgetContourFragmentsFairly(fragments, 60)).toEqual(budgetContourFragmentsFairly(fragments, 60));
  });
});
