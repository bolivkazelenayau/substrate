import type { Point } from "./geometry";

export interface ContourBudgetFragment<T> {
  points: Point[];
  payload: T;
}

export interface ContourBudgetResult<T> {
  fragments: Array<ContourBudgetFragment<T>>;
  originalFragmentCount: number;
  retainedFragmentCount: number;
  originalPointCount: number;
  retainedPointCount: number;
  budgetLimited: boolean;
  strategy: "none" | "proportional-even-decimation";
}

function evenlySpacedIndices(total: number, count: number) {
  if (count <= 0) return [];
  if (count === 1) return [Math.floor((total - 1) / 2)];
  return Array.from({ length: count }, (_, index) => Math.round(index * (total - 1) / (count - 1)));
}

function decimatePointsEvenly(points: Point[], targetCount: number) {
  if (targetCount >= points.length) return points;
  return evenlySpacedIndices(points.length, targetCount).map((index) => points[index]);
}

export function budgetContourFragmentsFairly<T>(
  fragments: Array<ContourBudgetFragment<T>>,
  maxPointBudget: number,
): ContourBudgetResult<T> {
  const pointBudget = Math.max(0, Math.floor(maxPointBudget));
  const originalPointCount = fragments.reduce((sum, fragment) => sum + fragment.points.length, 0);
  if (originalPointCount <= pointBudget) {
    return {
      fragments,
      originalFragmentCount: fragments.length,
      retainedFragmentCount: fragments.length,
      originalPointCount,
      retainedPointCount: originalPointCount,
      budgetLimited: false,
      strategy: "none",
    };
  }

  const maximumFragments = Math.floor(pointBudget / 3);
  const selected = fragments.length <= maximumFragments
    ? fragments
    : evenlySpacedIndices(fragments.length, maximumFragments).map((index) => fragments[index]);
  if (selected.length === 0) {
    return {
      fragments: [],
      originalFragmentCount: fragments.length,
      retainedFragmentCount: 0,
      originalPointCount,
      retainedPointCount: 0,
      budgetLimited: true,
      strategy: "proportional-even-decimation",
    };
  }

  const targetCounts = selected.map(() => 3);
  let remaining = pointBudget - selected.length * 3;
  const needs = selected.map((fragment) => Math.max(0, fragment.points.length - 3));
  const totalNeed = needs.reduce((sum, need) => sum + need, 0);
  if (remaining > 0 && totalNeed > 0) {
    needs.forEach((need, index) => {
      const allocation = Math.min(need, Math.floor(remaining * need / totalNeed));
      targetCounts[index] += allocation;
    });
    remaining = pointBudget - targetCounts.reduce((sum, count) => sum + count, 0);
    for (let index = 0; remaining > 0 && index < selected.length; index = (index + 1) % selected.length) {
      if (targetCounts[index] >= selected[index].points.length) {
        if (targetCounts.every((count, candidateIndex) => count >= selected[candidateIndex].points.length)) break;
        continue;
      }
      targetCounts[index] += 1;
      remaining -= 1;
    }
  }

  const budgeted = selected.map((fragment, index) => ({
    ...fragment,
    points: decimatePointsEvenly(fragment.points, targetCounts[index]),
  }));
  const retainedPointCount = budgeted.reduce((sum, fragment) => sum + fragment.points.length, 0);
  return {
    fragments: budgeted,
    originalFragmentCount: fragments.length,
    retainedFragmentCount: budgeted.length,
    originalPointCount,
    retainedPointCount,
    budgetLimited: true,
    strategy: "proportional-even-decimation",
  };
}
