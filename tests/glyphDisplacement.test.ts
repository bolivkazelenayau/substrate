import { createCanvas, Path2D } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyDisplacementTransform,
  deriveDisplacedTypographyGeometry,
  GLYPH_DISPLACEMENT_BUDGETS,
  glyphDisplacementIdentity,
} from "../src/engine/glyphDisplacement";
import { createInteractionTrace } from "../src/dev/interactionTrace";
import { createSvg } from "../src/engine/exportSvg";
import { vectorGeometryBounds } from "../src/engine/geometry";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { getRenderer } from "../src/engine/renderers";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import { buildSubstrate } from "../src/engine/substrate/buildSubstrate";
import type { RasterSurfaceFactory } from "../src/engine/substrate/rasterizeGlyphs";
import { sampleMask } from "../src/engine/substrate/sampling";
import { getTextLayout } from "../src/engine/textLayout";
import { validateProject } from "../src/engine/projectSchema";
import type { GlyphDisplacementMode, ProjectState } from "../src/types";

const fixturePath = resolve("tests/fixtures/Basic-Regular.ttf");
const canvasFactory: RasterSurfaceFactory = (width, height) => {
  const canvas = createCanvas(width, height);
  return {
    context: canvas.getContext("2d") as unknown as ReturnType<RasterSurfaceFactory>["context"],
    createPath: (pathData) => new Path2D(pathData),
  };
};

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(fixturePath);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  loaded = await parseFontBuffer(buffer, "Basic-Regular.ttf");
});

function stateFor(mode: GlyphDisplacementMode, overrides: Partial<ProjectState["glyphDisplacement"]> = {}): ProjectState {
  return {
    ...baseState,
    text: "BREAK",
    font: loaded.metadata,
    renderer: "sdf-halftone",
    glyphDisplacement: {
      ...baseState.glyphDisplacement,
      enabled: true,
      mode,
      strength: 72,
      responseRadius: 520,
      fragmentSize: 34,
      gap: 8,
      quantizationSteps: 6,
      jitter: 28,
      fragmentRotation: 2,
      ...overrides,
    },
  };
}

function derive(state: ProjectState, key = "typography-output:fixture") {
  const source = layoutGlyphs(state, loaded);
  return { source, result: deriveDisplacedTypographyGeometry(state, source, key) };
}

function buildActiveSubstrate(state: ProjectState, geometry: ReturnType<typeof layoutGlyphs>) {
  const scene = resolveSceneLayout(state, geometry);
  const layout = getTextLayout(state, true);
  return buildSubstrate({
    sourceText: state.text,
    textGeometry: geometry,
    fontSize: state.fontSize,
    tracking: state.tracking,
    fontFamily: layout.fontFamily,
    fontWeight: layout.fontWeight,
    baselineY: layout.baselineY,
    textX: layout.x,
    resolution: { width: 360, height: 216 },
    bounds: geometry.bounds,
    domainBounds: scene.effectiveArtboard,
    viewport: scene.effectiveArtboard,
  }, canvasFactory).data;
}

describe("glyph-domain displacement", () => {
  it("returns the exact legacy geometry object and key when disabled or zero strength", () => {
    const state = stateFor("horizontal-slices");
    const source = layoutGlyphs(state, loaded);
    const disabled = deriveDisplacedTypographyGeometry({ ...state, glyphDisplacement: { ...state.glyphDisplacement, enabled: false } }, source, "source:key");
    const zero = deriveDisplacedTypographyGeometry({ ...state, glyphDisplacement: { ...state.glyphDisplacement, strength: 0 } }, source, "source:key");
    expect(disabled.geometry).toBe(source);
    expect(zero.geometry).toBe(source);
    expect(disabled.geometryKey).toBe("source:key");
    expect(zero.geometryKey).toBe("source:key");
  });

  it.each(["warp", "horizontal-slices", "vertical-slices", "grid", "radial-sectors"] as const)(
    "%s produces deterministic displaced vector authority",
    (mode) => {
      const state = stateFor(mode);
      const first = derive(state).result;
      const second = derive(state).result;
      expect(first.active).toBe(true);
      expect(first.exact).toBe(true);
      expect(first.geometry?.displacement?.mode).toBe(mode);
      expect(first.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(second.geometry?.glyphs.map((glyph) => glyph.path.d));
      expect(first.fragmentBounds.length).toBeGreaterThan(0);
      expect(first.geometryKey).toBe(second.geometryKey);
    },
  );

  it("uses one coherent affine transform for every point in a horizontal slice", () => {
    const { result } = derive(stateFor("horizontal-slices", { fragmentRotation: 0 }));
    const fragment = result.fragments.find((candidate) => candidate.responseWeight > 0.25)!;
    const a = { x: fragment.sourceBounds.x + 2, y: fragment.sourceBounds.y + 2 };
    const b = { x: a.x + 11, y: a.y + 5 };
    const movedA = applyDisplacementTransform(a, fragment.transform);
    const movedB = applyDisplacementTransform(b, fragment.transform);
    expect(movedB.x - movedA.x).toBeCloseTo(b.x - a.x, 5);
    expect(movedB.y - movedA.y).toBeCloseTo(b.y - a.y, 5);
  });

  it("keeps grid-cell motion coherent and opens source-domain gaps", () => {
    const noGap = derive(stateFor("grid", { gap: 0 })).result;
    const withGap = derive(stateFor("grid", { gap: 14 })).result;
    expect(withGap.fragments.every((fragment) => Number.isFinite(fragment.transform.e) && Number.isFinite(fragment.transform.f))).toBe(true);
    const noGapArea = noGap.fragments.reduce((sum, fragment) => sum + fragment.sourceBounds.width * fragment.sourceBounds.height, 0);
    const withGapArea = withGap.fragments.reduce((sum, fragment) => sum + fragment.sourceBounds.width * fragment.sourceBounds.height, 0);
    expect(withGapArea).toBeLessThan(noGapArea);
  });

  it("applies radial falloff so near-emitter fragments move more than distant fragments", () => {
    const { result } = derive(stateFor("radial-sectors", { responseRadius: 170, strength: 110, radialTangential: 100 }));
    const weights = result.fragments.map((fragment) => fragment.responseWeight);
    expect(Math.max(...weights)).toBeGreaterThan(Math.min(...weights));
    expect(Math.max(...weights)).toBeGreaterThan(0.25);
  });

  it("changes deterministic geometry with an influential seed and ignores seed when influence is zero", () => {
    const influenced = stateFor("grid", { seedInfluence: 100 });
    const first = derive(influenced).result;
    const changed = derive({ ...influenced, seed: influenced.seed + 1 }).result;
    expect(changed.geometryKey).not.toBe(first.geometryKey);
    expect(changed.geometry?.glyphs.map((glyph) => glyph.path.d)).not.toEqual(first.geometry?.glyphs.map((glyph) => glyph.path.d));

    const fixed = stateFor("grid", { seedInfluence: 0 });
    const fixedSource = layoutGlyphs(fixed, loaded);
    expect(glyphDisplacementIdentity(fixed, "source", fixedSource).geometryKey)
      .toBe(glyphDisplacementIdentity({ ...fixed, seed: fixed.seed + 1 }, "source", fixedSource).geometryKey);
  });

  it("contains every fragment in authoritative displaced bounds and expands a non-zero-origin scene", () => {
    const state = { ...stateFor("grid", { strength: 180 }), artboard: { width: 300, height: 300 }, textOffsetY: -260 };
    const { result } = derive(state);
    const bounds = result.inkBounds!;
    for (const fragment of result.fragmentBounds) {
      expect(fragment.x).toBeGreaterThanOrEqual(bounds.x - 1e-5);
      expect(fragment.y).toBeGreaterThanOrEqual(bounds.y - 1e-5);
      expect(fragment.x + fragment.width).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-5);
      expect(fragment.y + fragment.height).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-5);
    }
    const scene = resolveSceneLayout(state, result.geometry);
    expect(scene.effectiveArtboard.x < 0 || scene.effectiveArtboard.y < 0).toBe(true);
  });

  it("includes every consumed geometry input in the focused key and excludes unrelated state", () => {
    const state = stateFor("grid");
    const source = layoutGlyphs(state, loaded);
    const baseKey = glyphDisplacementIdentity(state, "source", source).geometryKey;
    const mutations: ProjectState[] = [
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, mode: "vertical-slices" } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, strength: state.glyphDisplacement.strength + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, responseRadius: state.glyphDisplacement.responseRadius + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, falloff: "gaussian" } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, fragmentSize: state.glyphDisplacement.fragmentSize + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, gap: state.glyphDisplacement.gap + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, quantizationSteps: state.glyphDisplacement.quantizationSteps + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, direction: state.glyphDisplacement.direction + 5 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, radialTangential: state.glyphDisplacement.radialTangential + 5 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, jitter: state.glyphDisplacement.jitter + 1 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, fragmentRotation: state.glyphDisplacement.fragmentRotation + 0.25 } },
      { ...state, glyphDisplacement: { ...state.glyphDisplacement, seedInfluence: state.glyphDisplacement.seedInfluence - 1 } },
      { ...state, seed: state.seed + 1 },
      { ...state, emitter: { ...state.emitter, sourceMode: "custom", customX: 420, customY: 280 } },
    ];
    mutations.forEach((mutation) => expect(glyphDisplacementIdentity(mutation, "source", source).geometryKey).not.toBe(baseKey));
    expect(glyphDisplacementIdentity({ ...state, primaryColor: "#ff0000" }, "source", source).geometryKey).toBe(baseKey);
    expect(glyphDisplacementIdentity({ ...state, debug: { ...state.debug, glyphBounds: true } }, "source", source).geometryKey).toBe(baseKey);
    expect(glyphDisplacementIdentity({ ...state, dotGrid: { ...state.dotGrid, spacing: 19 } }, "source", source).geometryKey).toBe(baseKey);
    expect(glyphDisplacementIdentity({ ...state, emitterDisplay: { ...state.emitterDisplay, mode: "orbit" } }, "source", source).geometryKey).toBe(baseKey);
  });

  it("produces identical focused keys and geometry with trace collection on or off", () => {
    const state = stateFor("grid");
    const enabledTrace = createInteractionTrace({ enabled: true, now: () => 10 });
    enabledTrace.beginScenario("glyph-displacement");
    enabledTrace.emit({ stage: "test.trace", phase: "instant" });
    const traced = derive(state).result;
    const disabledTrace = createInteractionTrace({ enabled: false, now: () => 20 });
    disabledTrace.emit({ stage: "test.trace", phase: "instant" });
    const untraced = derive(state).result;
    expect(enabledTrace.snapshot()).toHaveLength(2);
    expect(disabledTrace.snapshot()).toHaveLength(0);
    expect(untraced.geometryKey).toBe(traced.geometryKey);
    expect(untraced.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(traced.geometry?.glyphs.map((glyph) => glyph.path.d));
  });

  it("is explicitly parsed-font-only for native fallback", () => {
    const state = stateFor("grid");
    const native = deriveDisplacedTypographyGeometry({ ...state, font: null }, null, "native:source");
    expect(native).toMatchObject({ active: false, exact: false, geometryKey: "native:source" });
    expect(native.diagnostics.inactiveReason).toBe("native-fallback");
  });

  it("rasterizes and classifies a regular world grid against the displaced domain", () => {
    const state = { ...stateFor("horizontal-slices"), dotGrid: { ...baseState.dotGrid, enabled: true, spacing: 11, radius: 2 } };
    const result = derive(state).result;
    const substrate = buildActiveSubstrate(state, result.geometry!);
    const scene = resolveSceneLayout(state, result.geometry);
    const group = getRenderer("sdf-halftone").generateGeometry(state, {
      timeMs: 0,
      frame: 0,
      textGeometry: result.geometry,
      textGeometryKey: result.geometryKey,
      substrateData: substrate,
      substrateKey: "substrate:displaced",
      viewport: { ...scene.effectiveArtboard, centerX: scene.effectiveArtboard.x + scene.effectiveArtboard.width / 2, centerY: scene.effectiveArtboard.y + scene.effectiveArtboard.height / 2 },
    });
    expect(group.diagnostics).toMatchObject({ dotGridRegular: true, dotGridOriginX: 0, dotGridOriginY: 0, glyphDisplacementKey: result.geometryKey });
    expect(group.geometries.length).toBeGreaterThan(0);
    expect(vectorGeometryBounds(group)).toMatchObject({ complete: true });
    expect(group.geometries.every((item) => item.type === "circle"
      && Math.abs(item.center.x / state.dotGrid.spacing - Math.round(item.center.x / state.dotGrid.spacing)) < 1e-6
      && Math.abs(item.center.y / state.dotGrid.spacing - Math.round(item.center.y / state.dotGrid.spacing)) < 1e-6
      && sampleMask(substrate, item.center.x, item.center.y) >= state.dotGrid.threshold)).toBe(true);
  });

  it("exports the same displaced vector authority in artwork and editable modes", () => {
    const state = { ...stateFor("grid"), dotGrid: { ...baseState.dotGrid, enabled: true } };
    const result = derive(state).result;
    const substrate = buildActiveSubstrate(state, result.geometry!);
    const scene = resolveSceneLayout(state, result.geometry);
    const context = {
      timeMs: 0,
      frame: 0,
      textGeometry: result.geometry,
      textGeometryKey: result.geometryKey,
      substrateData: substrate,
      substrateKey: "substrate:displaced",
      viewport: { ...scene.effectiveArtboard, centerX: scene.effectiveArtboard.x + scene.effectiveArtboard.width / 2, centerY: scene.effectiveArtboard.y + scene.effectiveArtboard.height / 2 },
    };
    const geometry = getRenderer("sdf-halftone").generateGeometry(state, context);
    const artwork = createSvg(state, context, result.geometry, geometry, undefined, scene.effectiveArtboard);
    const editable = createSvg({ ...state, exportMode: "editable" }, context, result.geometry, geometry, undefined, scene.effectiveArtboard);
    expect(artwork).toContain(`&quot;geometryKey&quot;:&quot;${result.geometryKey}&quot;`);
    expect(artwork).toContain("&quot;glyphDomainAuthority&quot;");
    expect(artwork).toContain(`&quot;rendererElementCount&quot;:${geometry.geometries.length}`);
    expect(artwork).toMatch(/<circle\b/);
    expect(editable).toContain("data-glyph-index=");
    expect(editable).not.toMatch(/<image\b|<canvas\b|<foreignObject\b/i);
  });

  it("round-trips size and persisted schema exactly", () => {
    const initial = stateFor("horizontal-slices");
    const at148 = derive(initial).result;
    const at540 = derive({ ...initial, fontSize: 540 }).result;
    const back148 = derive({ ...initial, fontSize: 148 }).result;
    expect(at540.geometryKey).not.toBe(at148.geometryKey);
    expect(back148.geometryKey).toBe(at148.geometryKey);
    expect(back148.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(at148.geometry?.glyphs.map((glyph) => glyph.path.d));
    expect(validateProject(JSON.parse(JSON.stringify(initial))).project).toEqual(initial);
  });

  it("reports deterministic safety clipping", () => {
    const state = {
      ...stateFor("grid", { fragmentSize: 4, strength: 120 }),
      text: "MMMMMMMMMMMMMMMMMMMM",
      fontSize: 540,
    };
    const first = derive(state).result;
    const second = derive(state).result;
    expect(first.diagnostics.clippingStatus).toBe("budget-limited");
    expect(second.diagnostics.clippingStatus).toBe(first.diagnostics.clippingStatus);
    expect(second.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(first.geometry?.glyphs.map((glyph) => glyph.path.d));
  });

  it("caps fragment-center displacement at the deterministic bounds-growth budget", () => {
    const { result } = derive(stateFor("grid", { strength: 100_000, fragmentRotation: 0 }));
    expect(result.diagnostics.clippingStatus).toBe("budget-limited");
    for (const fragment of result.fragments) {
      const center = {
        x: fragment.sourceBounds.x + fragment.sourceBounds.width / 2,
        y: fragment.sourceBounds.y + fragment.sourceBounds.height / 2,
      };
      const displaced = applyDisplacementTransform(center, fragment.transform);
      expect(Math.hypot(displaced.x - center.x, displaced.y - center.y))
        .toBeLessThanOrEqual(GLYPH_DISPLACEMENT_BUDGETS.boundsGrowth + 1e-4);
    }
  });
});
