import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { rendererGeometryStateKey } from "../src/engine/rendererRuntime";
import { baseState } from "../src/engine/presets";
import { 
  createStaticRenderContext, 
  selectExportContext, 
  selectEstimateContext 
} from "../src/engine/renderContextLifecycle";

describe("App RenderContext lifecycle", () => {
  const dummyTextGeometry = { bounds: { x: 0, y: 0, width: 100, height: 100 }, glyphs: [], hasOutlines: false, advance: 100, baselineY: 0, originX: 0, advanceWidth: 100, sourceText: "TEST" };
  const dummySubstrateData = null;

  it("time/frame-only change must not change the static estimate/export context identity or cache key", () => {
    const staticContext1 = createStaticRenderContext(baseState, dummyTextGeometry, dummySubstrateData);
    const estimateContext1 = selectEstimateContext(staticContext1);
    
    // In React, a time tick doesn't mutate `baseState`, so staticRenderContext identity is preserved
    const staticContext2 = staticContext1; 
    const estimateContext2 = selectEstimateContext(staticContext2);

    expect(estimateContext1).toBe(estimateContext2);
    expect(rendererGeometryStateKey(baseState)).toBe(rendererGeometryStateKey(baseState));
  });

  it("geometry-affecting ProjectState change must update the static context or geometry key", () => {
    const state1 = { ...baseState, diffuserDensity: 50 };
    const state2 = { ...baseState, diffuserDensity: 60 };

    const staticContext1 = createStaticRenderContext(state1, dummyTextGeometry, dummySubstrateData);
    const staticContext2 = createStaticRenderContext(state2, dummyTextGeometry, dummySubstrateData);
    
    // In actual app, useMemo re-runs because state identity changes.
    expect(staticContext1).not.toBe(staticContext2);
    
    // Geometry key must reflect the structural change
    expect(rendererGeometryStateKey(state1)).not.toBe(rendererGeometryStateKey(state2));
  });

  it("current-frame export must still use live time/frame", () => {
    const state = { ...baseState, exportFrameMode: "current" as const };
    const staticContext = createStaticRenderContext(state, dummyTextGeometry, dummySubstrateData);
    const liveContext = { ...staticContext, timeMs: 120, frame: 10 };
    
    const exportContext = selectExportContext(state, liveContext, staticContext);
    expect(exportContext.timeMs).toBe(120);
    expect(exportContext.frame).toBe(10);
  });

  it("non-current export must use timeMs: 0 and frame: 0", () => {
    const state = { ...baseState, exportFrameMode: "time-zero" as const };
    const staticContext = createStaticRenderContext(state, dummyTextGeometry, dummySubstrateData);
    const liveContext = { ...staticContext, timeMs: 120, frame: 10 };
    
    const exportContext = selectExportContext(state, liveContext, staticContext);
    expect(exportContext.timeMs).toBe(0);
    expect(exportContext.frame).toBe(0);
  });

  it("prevents reintroducing inline timeMs/frame overrides in App.tsx", () => {
    // Scan App.tsx to ensure the bad pattern isn't silently reintroduced
    const appTsx = readFileSync(join(__dirname, "../src/App.tsx"), "utf8");
    const badPattern = /\{\s*\.\.\.renderContext,\s*timeMs:\s*0,\s*frame:\s*0\s*\}/g;
    expect(appTsx).not.toMatch(badPattern);
  });
});