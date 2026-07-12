import { describe, expect, it } from "vitest";
import { documentKey } from "../src/engine/exportAuthority";
import { createSvg } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { canonicalizeSvgForGolden, hashCanonicalSvg } from "./utils/canonicalSvg";
import { buildProductionSceneFrame } from "./utils/sceneLayoutHarness";

describe("exact Size round trip", () => {
  const initialState = {
    ...baseState,
    renderer: "flow" as const,
    preset: "Edge Current" as const,
    artboard: { width: 1200, height: 720 },
    fontSize: 148,
    textOffsetY: 0,
    seed: 24091,
  };

  it("restores authored scene, keys, preview viewBox, and export summary after 148 → 540 → 148", () => {
    const initial = buildProductionSceneFrame(initialState, null);
    const mid = buildProductionSceneFrame({ ...initialState, fontSize: 540 }, null);
    const final = buildProductionSceneFrame({ ...initialState, fontSize: 148 }, null);
    const initialGeometry = generateRendererGeometry(initialState, initial.context);
    const finalGeometry = generateRendererGeometry({ ...initialState, fontSize: 148 }, final.context);

    expect(mid.scene.key).not.toBe(initial.scene.key);
    expect(final.scene.key).toBe(initial.scene.key);
    expect(final.scene.effectiveArtboard).toEqual(initial.scene.effectiveArtboard);
    expect(final.scene.typography.key).toBe(initial.scene.typography.key);
    expect(final.scene.authoredArtboard).toEqual(initial.scene.authoredArtboard);
    expect(final.rendererKey).toBe(initial.rendererKey);
    expect(final.svgViewBox).toBe(initial.svgViewBox);
    expect(final.exportSceneKey).toBe(initial.exportSceneKey);
    expect(documentKey({ ...initialState, fontSize: 148 })).toBe(documentKey(initialState));
    expect(finalGeometry.geometries.length).toBe(initialGeometry.geometries.length);

    const initialSvg = canonicalizeSvgForGolden(createSvg(
      initialState,
      initial.context,
      null,
      initialGeometry,
      undefined,
      initial.scene.effectiveArtboard,
    ));
    const finalSvg = canonicalizeSvgForGolden(createSvg(
      { ...initialState, fontSize: 148 },
      final.context,
      null,
      finalGeometry,
      undefined,
      final.scene.effectiveArtboard,
    ));
    expect(hashCanonicalSvg(finalSvg)).toBe(hashCanonicalSvg(initialSvg));
    expect(finalSvg).toBe(initialSvg);
  });
});