import { describe, expect, it } from "vitest";
import { artboardExpansionTriggerKey, planArtboardExpansionToText } from "../src/engine/artboardExpansion";
import { getTextArtboardOverflowWarning } from "../src/engine/contourDomain";
import { createSvg, validateSvgExport } from "../src/engine/exportSvg";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";
import { projectArtboard } from "../src/engine/artboard";

describe("expand artboard to text", () => {
  it("expands centered oversized text with padding without changing artwork controls", () => {
    const state = { ...baseState, text: "SUBSTRATE", fontSize: 560, renderer: "ripple" as const };
    expect(getTextArtboardOverflowWarning(state, null)).not.toBeNull();
    const plan = planArtboardExpansionToText(state, null);
    expect(plan.available).toBe(true);
    expect(plan.changed).toBe(true);
    expect(plan.nextState.artboard.width).toBeGreaterThan(state.artboard.width);
    expect(plan.nextState.fontSize).toBe(state.fontSize);
    expect(plan.nextState.renderer).toBe(state.renderer);
    expect(plan.nextState.preset).toBe(state.preset);
    expect(plan.nextState.density).toBe(state.density);
    expect(plan.projectedInkBounds.x).toBeGreaterThanOrEqual(plan.padding);
    expect(plan.projectedInkBounds.x + plan.projectedInkBounds.width + plan.padding)
      .toBeLessThanOrEqual(plan.nextState.artboard.width);
    expect(getTextArtboardOverflowWarning(plan.nextState, null)).toBeNull();
  });

  it("compensates negative vertical ink with textOffsetY and keeps positive coordinates", () => {
    const state = { ...baseState, text: "TYPE", fontSize: 560, textOffsetY: -500 };
    const plan = planArtboardExpansionToText(state, null);
    expect(plan.available).toBe(true);
    expect(plan.nextState.textOffsetY).toBeGreaterThan(state.textOffsetY);
    expect(plan.projectedInkBounds.y).toBeGreaterThanOrEqual(plan.padding);
  });

  it("never shrinks an artboard after oversized text becomes smaller", () => {
    const expanded = planArtboardExpansionToText({ ...baseState, text: "SUBSTRATE", fontSize: 560 }, null).nextState;
    const smaller = planArtboardExpansionToText({ ...expanded, fontSize: 120 }, null);
    expect(smaller.changed).toBe(false);
    expect(smaller.nextState.artboard).toEqual(expanded.artboard);
  });

  it("does not schedule auto-grow for diagnostics-only changes", () => {
    const state = { ...baseState, text: "SUBSTRATE", fontSize: 560 };
    const before = planArtboardExpansionToText(state, null);
    const after = planArtboardExpansionToText({
      ...state,
      debug: { ...state.debug, glyphBounds: !state.debug.glyphBounds },
    }, null);
    expect(artboardExpansionTriggerKey(after)).toBe(artboardExpansionTriggerKey(before));
  });

  it("refuses unsafe horizontal compensation without a horizontal offset field", () => {
    const state = { ...baseState, text: "SUBSTRATE", fontSize: 560, textAlign: "left" as const };
    const plan = planArtboardExpansionToText(state, {
      glyphs: [],
      bounds: { x: -100, y: 50, width: 1800, height: 500 },
      baselineY: 405,
      originX: 55,
      advanceWidth: 1800,
      sourceText: state.text,
      hasOutlines: true,
    });
    expect(plan.available).toBe(false);
    expect(plan.reason).toContain("horizontal offset");
    expect(plan.nextState).toBe(state);
  });

  it("exports and round-trips the expanded v8 artboard deterministically", () => {
    const plan = planArtboardExpansionToText({ ...baseState, text: "SUBSTRATE", fontSize: 560 }, null);
    const restored = validateProject(JSON.parse(JSON.stringify(plan.nextState))).project;
    expect(restored.artboard).toEqual(plan.nextState.artboard);
    const context = { timeMs: 0, frame: 0, viewport: projectArtboard(restored) };
    const svg = createSvg(restored, context, null);
    expect(svg).toContain(`width="${restored.artboard.width}" height="${restored.artboard.height}"`);
    expect(svg).toContain(`viewBox="0 0 ${restored.artboard.width} ${restored.artboard.height}"`);
    expect(validateSvgExport(svg, false).valid).toBe(true);
  });
});
