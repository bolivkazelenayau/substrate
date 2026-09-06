import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createInteractionTrace } from "../src/dev/interactionTrace";
import {
  deriveGlyphCalmWaterGeometry,
  glyphCalmWaterIdentity,
} from "../src/engine/glyphCalmWater";
import { deriveDisplacedTypographyGeometry } from "../src/engine/glyphDisplacement";
import { flattenGlyphMicroWarpCommands, glyphMicroWarpSignedArea } from "../src/engine/glyphMicroWarp";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { validateProject } from "../src/engine/projectSchema";
import type { ProjectState } from "../src/types";

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function waterState(overrides: Partial<ProjectState["glyphCalmWater"]> = {}): ProjectState {
  return {
    ...baseState,
    text: "BOAT",
    fontSize: 220,
    font: loaded.metadata,
    emitter: {
      ...baseState.emitter,
      enabled: true,
      sourceMode: "custom",
      customX: 600,
      customY: 360,
      frequency: 0.055,
      phase: 0.4,
    },
    glyphInfluence: { ...baseState.glyphInfluence, radius: 150, edgeSoftness: 260 },
    glyphCalmWater: {
      ...baseState.glyphCalmWater,
      enabled: true,
      strength: 12,
      frequencyMultiplier: 0.55,
      surfaceVariation: 38,
      drift: 10,
      detail: 14,
      ...overrides,
    },
  };
}

function derive(state: ProjectState, key = "typography:water-source") {
  const source = layoutGlyphs(state, loaded);
  return { source, result: deriveGlyphCalmWaterGeometry(state, source, key) };
}

describe("Calm Water glyph deformation", () => {
  it("is an exact no-op when disabled", () => {
    const state = waterState({ enabled: false });
    const source = layoutGlyphs(state, loaded);
    const result = deriveGlyphCalmWaterGeometry(state, source, "source:key");
    expect(result.geometry).toBe(source);
    expect(result.geometryKey).toBe("source:key");
    expect(result.active).toBe(false);
  });

  it("builds deterministic, bounded, authoritative water contours", () => {
    const state = waterState();
    const first = derive(state).result;
    const second = derive(state).result;
    expect(first.active).toBe(true);
    expect(first.exact).toBe(true);
    expect(first.geometryKey).toBe(second.geometryKey);
    expect(first.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(second.geometry?.glyphs.map((glyph) => glyph.path.d));
    expect(first.diagnostics.affectedPointCount).toBeGreaterThan(0);
    expect(first.diagnostics.maxDisplacement).toBeGreaterThan(0);
    expect(first.diagnostics.maxDisplacement).toBeLessThanOrEqual(state.glyphCalmWater.strength + 1e-6);
    expect(first.geometry?.calmWater?.geometryKey).toBe(first.geometryKey);
  });

  it("keeps neighboring contour displacement coherent", () => {
    const { source, result } = derive(waterState({ strength: 14, detail: 18 }));
    const sourceGlyph = source.glyphs.find((glyph) => glyph.path.commands.length > 0)!;
    const outputGlyph = result.geometry!.glyphs.find((glyph) => glyph.glyphId === sourceGlyph.glyphId)!;
    const sourceContours = flattenGlyphMicroWarpCommands(sourceGlyph.path.commands).contours;
    const outputContours = flattenGlyphMicroWarpCommands(outputGlyph.path.commands).contours;
    const sourceContour = sourceContours.reduce((longest, contour) => contour.points.length > longest.points.length ? contour : longest);
    const outputContour = outputContours.find((contour) => contour.points.length === sourceContour.points.length)!;
    const displacementDeltas = sourceContour.points.map((point, index) => {
      const nextIndex = (index + 1) % sourceContour.points.length;
      const dx = outputContour.points[index].x - point.x;
      const dy = outputContour.points[index].y - point.y;
      const nextDx = outputContour.points[nextIndex].x - sourceContour.points[nextIndex].x;
      const nextDy = outputContour.points[nextIndex].y - sourceContour.points[nextIndex].y;
      return Math.hypot(nextDx - dx, nextDy - dy);
    });
    const meanDelta = displacementDeltas.reduce((sum, value) => sum + value, 0) / displacementDeltas.length;
    expect(meanDelta).toBeLessThan(1.5);
  });

  it("responds to emitter frequency only while linked", () => {
    const linked = waterState({ frequencyLinked: true });
    const linkedSource = layoutGlyphs(linked, loaded);
    const linkedKey = glyphCalmWaterIdentity(linked, "source", linkedSource).geometryKey;
    const linkedChanged = glyphCalmWaterIdentity({
      ...linked,
      emitter: { ...linked.emitter, frequency: linked.emitter.frequency * 1.7 },
    }, "source", linkedSource).geometryKey;
    expect(linkedChanged).not.toBe(linkedKey);

    const unlinked = waterState({ frequencyLinked: false, wavelength: 180 });
    const unlinkedSource = layoutGlyphs(unlinked, loaded);
    const unlinkedKey = glyphCalmWaterIdentity(unlinked, "source", unlinkedSource).geometryKey;
    const unlinkedChanged = glyphCalmWaterIdentity({
      ...unlinked,
      emitter: { ...unlinked.emitter, frequency: unlinked.emitter.frequency * 1.7 },
    }, "source", unlinkedSource).geometryKey;
    expect(unlinkedChanged).toBe(unlinkedKey);
    expect(glyphCalmWaterIdentity({
      ...linked,
      glyphCalmWater: { ...linked.glyphCalmWater, wavelength: linked.glyphCalmWater.wavelength + 90 },
    }, "source", linkedSource).geometryKey).toBe(linkedKey);
    expect(glyphCalmWaterIdentity({
      ...unlinked,
      glyphCalmWater: { ...unlinked.glyphCalmWater, frequencyMultiplier: 1.8 },
    }, "source", unlinkedSource).geometryKey).toBe(unlinkedKey);
  });

  it("tracks every consumed semantic dependency and ignores emitter-only machinery", () => {
    const state = waterState();
    const source = layoutGlyphs(state, loaded);
    const baseKey = glyphCalmWaterIdentity(state, "source", source).geometryKey;
    const mutations: ProjectState[] = [
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, strength: 13 } },
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, frequencyMultiplier: 0.8 } },
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, surfaceVariation: 46 } },
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, drift: 18 } },
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, detail: 24 } },
      { ...state, glyphCalmWater: { ...state.glyphCalmWater, preserveCounters: false } },
      { ...state, glyphInfluence: { ...state.glyphInfluence, radius: state.glyphInfluence.radius + 15 } },
      { ...state, glyphInfluence: { ...state.glyphInfluence, edgeSoftness: state.glyphInfluence.edgeSoftness + 20 } },
      { ...state, glyphInfluence: { ...state.glyphInfluence, falloff: "gaussian" } },
      { ...state, seed: state.seed + 1 },
      { ...state, emitter: { ...state.emitter, phase: state.emitter.phase + 0.25 } },
      { ...state, emitter: { ...state.emitter, customX: state.emitter.customX + 12 } },
    ];
    for (const mutation of mutations) {
      expect(glyphCalmWaterIdentity(mutation, "source", source).geometryKey).not.toBe(baseKey);
    }
    expect(glyphCalmWaterIdentity({
      ...state,
      emitter: { ...state.emitter, amplitude: state.emitter.amplitude + 10, radius: state.emitter.radius + 20 },
    }, "source", source).geometryKey).toBe(baseKey);
  });

  it("preserves contour winding and counter topology", () => {
    const { source, result } = derive({ ...waterState(), text: "BOO", glyphCalmWater: { ...waterState().glyphCalmWater, strength: 18 } });
    for (const sourceGlyph of source.glyphs) {
      const outputGlyph = result.geometry!.glyphs.find((glyph) => glyph.glyphId === sourceGlyph.glyphId)!;
      const sourceContours = flattenGlyphMicroWarpCommands(sourceGlyph.path.commands).contours;
      const outputContours = flattenGlyphMicroWarpCommands(outputGlyph.path.commands).contours;
      expect(outputContours).toHaveLength(sourceContours.length);
      outputContours.forEach((contour, index) => {
        expect(Math.sign(glyphMicroWarpSignedArea(contour.points)))
          .toBe(Math.sign(glyphMicroWarpSignedArea(sourceContours[index].points)));
      });
    }
    expect(result.diagnostics.safetyStatus).not.toBe("point-budget-limited");
  });

  it("blends multiple emitters deterministically", () => {
    const state = {
      ...waterState(),
      emitterMode: "multiple" as const,
      emitters: [
        { id: "left", glyphId: "auto-first", enabled: true, weight: 1, phaseOffset: 0, radiusMultiplier: 0.8, influenceScope: "source-glyph" as const, neighborhoodSize: 1, label: "Left" },
        { id: "right", glyphId: "auto-last", enabled: true, weight: 0.85, phaseOffset: 1.1, radiusMultiplier: 0.9, influenceScope: "source-glyph" as const, neighborhoodSize: 1, label: "Right" },
      ],
    };
    const first = derive(state).result;
    const second = derive(state).result;
    expect(first.diagnostics.emitterCount).toBe(2);
    expect(first.diagnostics.maxEmitterContributions).toBeGreaterThan(1);
    expect(second.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(first.geometry?.glyphs.map((glyph) => glyph.path.d));
  });

  it("deforms the continuous outline before localized Slice and keeps one final authority", () => {
    const state: ProjectState = {
      ...waterState({ strength: 8 }),
      glyphDisplacement: {
        ...baseState.glyphDisplacement,
        enabled: true,
        mode: "horizontal-slices",
        sliceInfluence: "emitter-falloff",
        strength: 28,
        fragmentSize: 36,
        gap: 2,
      },
    };
    const source = layoutGlyphs(state, loaded);
    const water = deriveGlyphCalmWaterGeometry(state, source, "typography:base");
    const sliced = deriveDisplacedTypographyGeometry(state, water.geometry, water.geometryKey);
    expect(water.active).toBe(true);
    expect(sliced.active).toBe(true);
    expect(sliced.sourceTypographyKey).toBe(water.geometryKey);
    expect(sliced.geometry?.calmWater?.geometryKey).toBe(water.geometryKey);
    expect(sliced.geometry?.displacement?.sourceTypographyKey).toBe(water.geometryKey);
  });

  it("serializes the same water outline into the SVG mask, overlay, and metadata", () => {
    const state = waterState();
    const result = derive(state).result;
    const svg = createSvg(state, { timeMs: 0, frame: 0 }, result.geometry);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const waterPath = result.geometry!.glyphs[0].path.d;
    expect(document.querySelector("#substrate-mask path[data-glyph-index]")?.getAttribute("d")).toBe(waterPath);
    expect(document.querySelector("#substrate-outline path[data-glyph-index]")?.getAttribute("d")).toBe(waterPath);
    const editable = new DOMParser().parseFromString(
      createSvg({ ...state, exportMode: "editable" }, { timeMs: 0, frame: 0 }, result.geometry),
      "image/svg+xml",
    );
    expect(editable.querySelector("#generated-artwork path[data-glyph-index]")?.getAttribute("d")).toBe(waterPath);
    const metadata = JSON.parse(document.querySelector("metadata")!.textContent!);
    expect(metadata.project.version).toBe(15);
    expect(metadata.glyphCalmWater.geometryKey).toBe(result.geometryKey);
  });

  it("excludes camera, diagnostics, renderer, and trace collection from its semantic identity", () => {
    const state = waterState();
    const source = layoutGlyphs(state, loaded);
    const baseKey = glyphCalmWaterIdentity(state, "source", source).geometryKey;
    const trace = createInteractionTrace({ enabled: true, now: () => 10 });
    trace.beginScenario("calm-water");
    trace.emit({ stage: "test", phase: "instant" });
    expect(trace.snapshot()).toHaveLength(2);
    expect(glyphCalmWaterIdentity({ ...state, renderer: "dots" }, "source", source).geometryKey).toBe(baseKey);
    expect(glyphCalmWaterIdentity({ ...state, primaryColor: "#ff0000" }, "source", source).geometryKey).toBe(baseKey);
    expect(glyphCalmWaterIdentity({ ...state, debug: { ...state.debug, glyphBounds: true } }, "source", source).geometryKey).toBe(baseKey);
  });

  it("round-trips v15 state and disables back to the exact baseline", () => {
    const state = waterState();
    expect(validateProject(JSON.parse(JSON.stringify(state))).project).toEqual(state);
    const source = layoutGlyphs(state, loaded);
    const active = deriveGlyphCalmWaterGeometry(state, source, "source");
    const disabled = deriveGlyphCalmWaterGeometry({
      ...state,
      glyphCalmWater: { ...state.glyphCalmWater, enabled: false },
    }, source, "source");
    expect(active.geometryKey).not.toBe("source");
    expect(disabled.geometry).toBe(source);
    expect(disabled.geometryKey).toBe("source");
  });
});
