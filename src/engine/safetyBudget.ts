/** Deterministic product limits. These deliberately do not depend on device capability. */
export const SAFETY_BUDGETS = {
  substrateCells: 1_048_576, substrateAxis: 4_096,
  canvasPixels: 4_194_304, canvasAxis: 4_096,
  contourCellLevelVisits: 10_000_000, denseOccupancyBytes: 2 * 1024 * 1024,
  diagnosticVectorNodes: 1_000, diagnosticRasterPixels: 1_048_576,
  candidateAttempts: 50_000,
} as const;

export interface RasterPlan { width: number; height: number; cells: number; requestedWidth: number; requestedHeight: number; residentBytes: number; peakBytes: number; reduced: boolean; reason: string | null; }
const positiveInteger = (value: number) => Number.isFinite(value) && value > 0 ? Math.max(1, Math.floor(value)) : 1;
function fitAxes(width: number, height: number, axis: number, cells: number) {
  let scale = Math.min(1, axis / width, axis / height, Math.sqrt(cells / (width * height)));
  if (!Number.isFinite(scale) || scale <= 0) scale = 1 / Math.max(width, height);
  let resolvedWidth = Math.max(1, Math.floor(width * scale)), resolvedHeight = Math.max(1, Math.floor(height * scale));
  while (resolvedWidth > axis || resolvedHeight > axis || resolvedWidth * resolvedHeight > cells) {
    if (resolvedWidth >= resolvedHeight && resolvedWidth > 1) resolvedWidth -= 1;
    else if (resolvedHeight > 1) resolvedHeight -= 1; else break;
  }
  return { width: resolvedWidth, height: resolvedHeight };
}
export function planSubstrateRaster(input: { requestedWidth: number; requestedHeight: number }): RasterPlan {
  const valid = Number.isFinite(input.requestedWidth) && Number.isFinite(input.requestedHeight) && input.requestedWidth > 0 && input.requestedHeight > 0;
  const requestedWidth = positiveInteger(input.requestedWidth), requestedHeight = positiveInteger(input.requestedHeight);
  const fitted = fitAxes(requestedWidth, requestedHeight, SAFETY_BUDGETS.substrateAxis, SAFETY_BUDGETS.substrateCells), cells = fitted.width * fitted.height;
  return { ...fitted, cells, requestedWidth, requestedHeight, residentBytes: cells * 16, peakBytes: cells * 40, reduced: !valid || fitted.width !== requestedWidth || fitted.height !== requestedHeight, reason: !valid ? "invalid-raster-dimensions" : fitted.width !== requestedWidth || fitted.height !== requestedHeight ? "substrate-safety-cap" : null };
}
export interface CanvasPlan { cssWidth: number; cssHeight: number; requestedWidth: number; requestedHeight: number; width: number; height: number; pixels: number; reduced: boolean; reason: string | null; }
export function planCanvasBackingStore(input: { cssWidth: number; cssHeight: number; dpr: number }): CanvasPlan {
  const cssWidth = positiveInteger(input.cssWidth), cssHeight = positiveInteger(input.cssHeight), dpr = Number.isFinite(input.dpr) && input.dpr > 0 ? input.dpr : 1;
  const requestedWidth = Math.max(1, Math.round(cssWidth * dpr)), requestedHeight = Math.max(1, Math.round(cssHeight * dpr));
  const fitted = fitAxes(requestedWidth, requestedHeight, SAFETY_BUDGETS.canvasAxis, SAFETY_BUDGETS.canvasPixels);
  return { cssWidth, cssHeight, requestedWidth, requestedHeight, ...fitted, pixels: fitted.width * fitted.height, reduced: fitted.width !== requestedWidth || fitted.height !== requestedHeight, reason: fitted.width !== requestedWidth || fitted.height !== requestedHeight ? "canvas-safety-cap" : null };
}
export interface OccupancyPlan { width: number; height: number; cellSize: number; cells: number; bytes: number; coarsened: boolean; }
export function planDenseOccupancy(domainWidth: number, domainHeight: number, requestedCellSize: number, bytesPerCell = 1): OccupancyPlan {
  const width = positiveInteger(domainWidth), height = positiveInteger(domainHeight); let cellSize = Math.max(1, Number.isFinite(requestedCellSize) ? requestedCellSize : 1);
  let columns = Math.max(1, Math.ceil(width / cellSize)), rows = Math.max(1, Math.ceil(height / cellSize)); const maxCells = Math.max(1, Math.floor(SAFETY_BUDGETS.denseOccupancyBytes / Math.max(1, bytesPerCell)));
  if (columns * rows > maxCells) {
    cellSize *= Math.sqrt((columns * rows) / maxCells);
    columns = Math.max(1, Math.ceil(width / cellSize)); rows = Math.max(1, Math.ceil(height / cellSize));
    // Ceil rounding may still exceed the byte budget by a few cells.
    while (columns * rows > maxCells) {
      cellSize *= 1.001;
      columns = Math.max(1, Math.ceil(width / cellSize)); rows = Math.max(1, Math.ceil(height / cellSize));
    }
  }
  return { width: columns, height: rows, cellSize, cells: columns * rows, bytes: columns * rows * bytesPerCell, coarsened: cellSize !== requestedCellSize };
}
export interface ContourWorkPlan { rasterCells: number; requestedLevels: number; levels: number; cellLevelVisits: number; reduced: boolean; }
export function planContourWork(width: number, height: number, requestedLevels: number): ContourWorkPlan {
  // Substrate plans normally make this a no-op. Keeping the planner defensive
  // also prevents direct/legacy callers from reporting an unsafe scan budget.
  const rasterCells = Math.min(SAFETY_BUDGETS.contourCellLevelVisits, Math.max(0, (positiveInteger(width) - 1) * (positiveInteger(height) - 1))), safeRequested = positiveInteger(requestedLevels);
  const levels = Math.max(1, Math.min(safeRequested, Math.floor(SAFETY_BUDGETS.contourCellLevelVisits / Math.max(1, rasterCells))));
  return { rasterCells, requestedLevels: safeRequested, levels, cellLevelVisits: rasterCells * levels, reduced: levels !== safeRequested };
}
export function planDiagnosticSamples(requested: number) { const attempted = Math.max(0, Number.isFinite(requested) ? Math.floor(requested) : 0); return { attempted, emitted: Math.min(attempted, SAFETY_BUDGETS.diagnosticVectorNodes), reduced: attempted > SAFETY_BUDGETS.diagnosticVectorNodes }; }
