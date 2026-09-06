import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createSvg } from "../src/engine/exportSvg";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import {
  deriveGlyphMicroWarpGeometry,
  flattenGlyphMicroWarpCommands,
  glyphMicroWarpIdentity,
  glyphMicroWarpSignedArea,
} from "../src/engine/glyphMicroWarp";
import { deriveDisplacedTypographyGeometry } from "../src/engine/glyphDisplacement";
import { layoutGlyphs } from "../src/engine/glyphLayout";
import { baseState } from "../src/engine/presets";
import { migrateAndRepairProject } from "../src/engine/projectImport";
import { resolveSceneLayout } from "../src/engine/sceneLayout";
import type { GlyphBounds, TextGeometry } from "../src/engine/glyphGeometry";
import type { GlyphMicroWarpSettings, ProjectState } from "../src/types";

let loaded: LoadedFont;

beforeAll(async () => {
  const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
  loaded = await parseFontBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    "Basic-Regular.ttf",
  );
});

function stateWithWarp(
  warp: Partial<GlyphMicroWarpSettings> = {},
  project: Partial<ProjectState> = {},
): ProjectState {
  return {
    ...baseState,
    text: "OX",
    font: loaded.metadata,
    fontSize: 380,
    emitter: {
      ...baseState.emitter,
      enabled: true,
      glyphId: null,
      sourceMode: "counter-center",
      phase: 0.31,
    },
    glyphMicroWarp: {
      ...baseState.glyphMicroWarp,
      enabled: true,
      strength: 84,
      responseRadius: 165,
      detailScale: 20,
      normalDisplacement: 88,
      tangentialDisplacement: 18,
      maxDisplacement: 14,
      ...warp,
    },
    ...project,
  };
}

function build(state: ProjectState, sourceKey = "typography:test") {
  const source = layoutGlyphs(state, loaded);
  return { source, result: deriveGlyphMicroWarpGeometry(state, source, sourceKey) };
}

function contourPoints(geometry: TextGeometry, glyphIndex = 0) {
  return flattenGlyphMicroWarpCommands(geometry.glyphs[glyphIndex].path.commands).contours;
}

function flattenedPoints(geometry: TextGeometry, glyphIndex = 0) {
  return contourPoints(geometry, glyphIndex).flatMap((contour) => contour.points);
}

function delta(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: b.x - a.x, y: b.y - a.y, magnitude: Math.hypot(b.x - a.x, b.y - a.y) };
}

function expectBoundsContain(bounds: GlyphBounds, point: { x: number; y: number }) {
  expect(point.x).toBeGreaterThanOrEqual(bounds.x - 1e-6);
  expect(point.y).toBeGreaterThanOrEqual(bounds.y - 1e-6);
  expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
  expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
}

describe("Glyph Micro Warp authoritative outline stage", () => {
  it("returns exact source object and identity when disabled", () => {
    const state = stateWithWarp({ enabled: false });
    const source = layoutGlyphs(state, loaded);
    const result = deriveGlyphMicroWarpGeometry(state, source, "typography:base");
    expect(result.active).toBe(false);
    expect(result.geometry).toBe(source);
    expect(result.geometryKey).toBe("typography:base");
    expect(result.warpKey).toBe("glyph-micro-warp:disabled");
  });

  it("moves sampled outline points near the emitter and leaves outside-radius points exact", () => {
    const state = stateWithWarp({ responseRadius: 145 });
    const { source, result } = build(state);
    const before = flattenedPoints(source);
    const after = flattenedPoints(result.geometry!);
    expect(after).toHaveLength(before.length);
    const anchor = source.glyphs[0].counterCenter!;
    const paired = before.map((point, index) => ({ point, moved: delta(point, after[index]).magnitude }));
    expect(paired.some(({ point, moved }) => Math.hypot(point.x - anchor.x, point.y - anchor.y) < 145 && moved > 0.05)).toBe(true);
    expect(paired.filter(({ point }) => Math.hypot(point.x - anchor.x, point.y - anchor.y) >= 145).every(({ moved }) => moved < 1e-8)).toBe(true);
    expect(result.diagnostics.affectedPointCount).toBeGreaterThan(0);
  });

  it("uses coherent neighboring detail rather than independent white-noise jumps", () => {
    const { source, result } = build(stateWithWarp({ detailScale: 28, maxDisplacement: 12 }));
    const beforeContours = contourPoints(source);
    const afterContours = contourPoints(result.geometry!);
    const vectorJumps: number[] = [];
    beforeContours.forEach((contour, contourIndex) => {
      const after = afterContours[contourIndex].points;
      const vectors = contour.points.map((point, index) => delta(point, after[index]));
      vectors.forEach((vector, index) => {
        const next = vectors[(index + 1) % vectors.length];
        vectorJumps.push(Math.hypot(vector.x - next.x, vector.y - next.y));
      });
    });
    expect(Math.max(...vectorJumps)).toBeLessThanOrEqual(12);
    expect(vectorJumps.filter((jump) => jump < 4).length / vectorJumps.length).toBeGreaterThan(0.75);
  });

  it("is deterministic for a seed and sensitive to an active seed change", () => {
    const state = stateWithWarp({ seedInfluence: 100 });
    const source = layoutGlyphs(state, loaded);
    const first = deriveGlyphMicroWarpGeometry(state, source, "typography:seed");
    const second = deriveGlyphMicroWarpGeometry(state, source, "typography:seed");
    const changed = deriveGlyphMicroWarpGeometry({ ...state, seed: state.seed + 1 }, source, "typography:seed");
    expect(second.geometry?.glyphs.map((glyph) => glyph.path.d)).toEqual(first.geometry?.glyphs.map((glyph) => glyph.path.d));
    expect(second.geometryKey).toBe(first.geometryKey);
    expect(changed.geometryKey).not.toBe(first.geometryKey);
    expect(changed.geometry?.glyphs[0].path.d).not.toBe(first.geometry?.glyphs[0].path.d);
  });

  it("keeps seed changes semantically inactive when seed influence is zero", () => {
    const state = stateWithWarp({ seedInfluence: 0 });
    const source = layoutGlyphs(state, loaded);
    const first = deriveGlyphMicroWarpGeometry(state, source, "typography:seed-off");
    const changed = deriveGlyphMicroWarpGeometry({ ...state, seed: state.seed + 999 }, source, "typography:seed-off");
    expect(changed.geometryKey).toBe(first.geometryKey);
    expect(changed.geometry?.glyphs[0].path.d).toBe(first.geometry?.glyphs[0].path.d);
  });

  it("keeps normal and tangential displacement independently art-directable", () => {
    const normalState = stateWithWarp({ normalDisplacement: 100, tangentialDisplacement: 0, preserveCounters: false });
    const tangentState = stateWithWarp({ normalDisplacement: 0, tangentialDisplacement: 100, preserveCounters: false });
    const source = layoutGlyphs(normalState, loaded);
    const normal = deriveGlyphMicroWarpGeometry(normalState, source, "typography:components").geometry!;
    const tangent = deriveGlyphMicroWarpGeometry(tangentState, source, "typography:components").geometry!;
    expect(normal.glyphs[0].path.d).not.toBe(tangent.glyphs[0].path.d);

    const before = contourPoints(source)[0].points;
    const normalAfter = contourPoints(normal)[0].points;
    const tangentAfter = contourPoints(tangent)[0].points;
    const index = before.findIndex((point, cursor) => delta(point, normalAfter[cursor]).magnitude > 0.1 && delta(point, tangentAfter[cursor]).magnitude > 0.1);
    expect(index).toBeGreaterThanOrEqual(0);
    const previous = before[(index - 1 + before.length) % before.length];
    const next = before[(index + 1) % before.length];
    const magnitude = Math.hypot(next.x - previous.x, next.y - previous.y);
    const localTangent = { x: (next.x - previous.x) / magnitude, y: (next.y - previous.y) / magnitude };
    const localNormal = { x: -localTangent.y, y: localTangent.x };
    const normalVector = delta(before[index], normalAfter[index]);
    const tangentVector = delta(before[index], tangentAfter[index]);
    expect(Math.abs(normalVector.x * localTangent.x + normalVector.y * localTangent.y)).toBeLessThan(1e-5);
    expect(Math.abs(tangentVector.x * localNormal.x + tangentVector.y * localNormal.y)).toBeLessThan(1e-5);
  });

  it("blends overlapping multiple emitters without a nearest-emitter seam", () => {
    const preliminary = stateWithWarp({ responseRadius: 420 });
    const source = layoutGlyphs(preliminary, loaded);
    const state: ProjectState = {
      ...preliminary,
      emitterMode: "multiple",
      emitters: [
        { ...baseState.emitters[0], id: "left", glyphId: source.glyphs[0].glyphId, enabled: true, weight: 1, radiusMultiplier: 1 },
        { ...baseState.emitters[0], id: "right", glyphId: source.glyphs[1].glyphId, enabled: true, weight: 1, radiusMultiplier: 1 },
      ],
    };
    const rebuiltSource = layoutGlyphs(state, loaded);
    const result = deriveGlyphMicroWarpGeometry(state, rebuiltSource, "typography:multi");
    expect(result.diagnostics.emitterCount).toBe(2);
    expect(result.diagnostics.maxEmitterContributions).toBe(2);
    const before = flattenedPoints(rebuiltSource);
    const after = flattenedPoints(result.geometry!);
    const vectors = before.map((point, index) => delta(point, after[index]));
    const jumps = vectors.map((vector, index) => {
      const next = vectors[(index + 1) % vectors.length];
      return Math.hypot(vector.x - next.x, vector.y - next.y);
    });
    expect(Math.max(...jumps)).toBeLessThanOrEqual(state.glyphMicroWarp.maxDisplacement * 1.5);
  });

  it("preserves contour direction, counter anchor, and readable hole semantics", () => {
    const state = stateWithWarp({ preserveCounters: true, maxDisplacement: 18 });
    const { source, result } = build(state);
    const before = contourPoints(source);
    const after = contourPoints(result.geometry!);
    expect(after).toHaveLength(before.length);
    before.forEach((contour, index) => {
      expect(Math.sign(glyphMicroWarpSignedArea(after[index].points))).toBe(Math.sign(glyphMicroWarpSignedArea(contour.points)));
    });
    expect(result.geometry?.glyphs[0].counterCenter).toEqual(source.glyphs[0].counterCenter);
    expect(result.diagnostics.safetyStatus).not.toBe("point-budget-limited");
  });

  it("derives bounds that contain every reconstructed contour point", () => {
    const { result } = build(stateWithWarp({ maxDisplacement: 20 }));
    expect(result.geometry?.bounds).not.toBeNull();
    for (const glyph of result.geometry!.glyphs) {
      if (!glyph.path.bounds) continue;
      for (const point of flattenedPoints({ ...result.geometry!, glyphs: [glyph] }, 0)) expectBoundsContain(glyph.path.bounds, point);
    }
    for (const point of result.geometry!.glyphs.flatMap((_, index) => flattenedPoints(result.geometry!, index))) {
      expectBoundsContain(result.geometry!.bounds!, point);
    }
  });

  it("supports negative world origins without mutating authored offsets", () => {
    const state = stateWithWarp({}, { artboard: { width: 420, height: 300 }, fontSize: 620, textOffsetY: -360 });
    const authoredOffset = state.textOffsetY;
    const { result } = build(state, "typography:negative-origin");
    const scene = resolveSceneLayout(state, result.geometry);
    expect(result.geometry?.bounds?.y).toBeLessThan(0);
    expect(scene.effectiveArtboard.y).toBeLessThanOrEqual(result.geometry!.bounds!.y);
    expect(state.textOffsetY).toBe(authoredOffset);
  });

  it("excludes diagnostics, renderer backend, and mark-space response controls from its focused key", () => {
    const state = stateWithWarp();
    const source = layoutGlyphs(state, loaded);
    const base = glyphMicroWarpIdentity(state, "typography:key", source);
    const changed = glyphMicroWarpIdentity({
      ...state,
      renderer: "sdf-halftone",
      debug: { ...state.debug, frameTime: !state.debug.frameTime },
      emitterMicroResponse: { ...state.emitterMicroResponse, enabled: true, positionDetail: 99 },
    }, "typography:key", source);
    expect(changed).toEqual(base);
  });

  it("mutates its key for every consumed warp parameter and resolved emitter position", () => {
    const state = stateWithWarp();
    const source = layoutGlyphs(state, loaded);
    const base = glyphMicroWarpIdentity(state, "typography:key-mutations", source).geometryKey;
    const settings: Array<keyof GlyphMicroWarpSettings> = [
      "strength", "responseRadius", "falloff", "detailScale", "detailOctaves",
      "normalDisplacement", "tangentialDisplacement", "edgeTurbulence",
      "quantizationSteps", "maxDisplacement", "preserveCounters", "seedInfluence",
    ];
    for (const name of settings) {
      const value = state.glyphMicroWarp[name];
      const next = typeof value === "boolean"
        ? !value
        : typeof value === "string"
          ? "linear"
          : value + 1;
      const changed = glyphMicroWarpIdentity({
        ...state,
        glyphMicroWarp: { ...state.glyphMicroWarp, [name]: next },
      }, "typography:key-mutations", source);
      expect(changed.geometryKey, name).not.toBe(base);
    }
    const custom = glyphMicroWarpIdentity({
      ...state,
      emitter: { ...state.emitter, sourceMode: "custom", customX: 111, customY: 222 },
    }, "typography:key-mutations", source);
    expect(custom.geometryKey).not.toBe(base);
  });

  it("reports parsed-font exact support and explicit native fallback identity", () => {
    const state = stateWithWarp();
    const source = layoutGlyphs(state, loaded);
    const parsed = deriveGlyphMicroWarpGeometry(state, source, "typography:capability");
    const native = deriveGlyphMicroWarpGeometry(state, { ...source, hasOutlines: false }, "typography:native");
    expect(parsed.active).toBe(true);
    expect(parsed.exact).toBe(true);
    expect(native.active).toBe(false);
    expect(native.diagnostics.inactiveReason).toBe("native-fallback");
    expect(native.geometryKey).toBe("typography:native");
  });

  it("feeds warped contours into existing Fragmentation and preserves one final authority", () => {
    const state = stateWithWarp({}, {
      glyphDisplacement: {
        ...baseState.glyphDisplacement,
        enabled: true,
        mode: "horizontal-slices",
        strength: 32,
      },
    });
    const source = layoutGlyphs(state, loaded);
    const micro = deriveGlyphMicroWarpGeometry(state, source, "typography:composition");
    const fragmented = deriveDisplacedTypographyGeometry(state, micro.geometry, micro.geometryKey);
    expect(micro.active).toBe(true);
    expect(fragmented.active).toBe(true);
    expect(fragmented.sourceTypographyKey).toBe(micro.geometryKey);
    expect(fragmented.geometry?.microWarp?.warpKey).toBe(micro.warpKey);
    expect(fragmented.geometry?.displacement?.sourceTypographyKey).toBe(micro.geometryKey);
  });

  it("serializes the same warped outline into authoritative SVG mask and artwork", () => {
    const state = stateWithWarp({}, { renderer: "glyph-diffuser", exportMode: "artwork" });
    const { result } = build(state, "typography:export");
    const svg = createSvg(state, { timeMs: 0, frame: 0 }, result.geometry);
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const warpedPath = result.geometry!.glyphs[0].path.d;
    const maskPath = document.querySelector("#substrate-mask path[data-glyph-index]")?.getAttribute("d");
    const outlinePath = document.querySelector("#substrate-outline path[data-glyph-index]")?.getAttribute("d");
    const overlayPath = document.querySelector("#diffuser-text-overlay path[data-glyph-index]")?.getAttribute("d");
    const metadata = JSON.parse(document.querySelector("metadata")!.textContent!);
    expect(maskPath).toBe(warpedPath);
    expect(outlinePath).toBe(warpedPath);
    expect(overlayPath).toBe(warpedPath);
    expect(metadata.glyphMicroWarp.geometryKey).toBe(result.geometryKey);
  });

  it("migrates v11 with disabled defaults and round-trips active settings", () => {
    const { glyphMicroWarp: _glyphMicroWarp, ...v12WithoutWarp } = stateWithWarp();
    const v11 = { ...v12WithoutWarp, version: 11 };
    const migrated = migrateAndRepairProject(v11).project;
    expect(migrated.version).toBe(15);
    expect(migrated.glyphMicroWarp).toEqual(baseState.glyphMicroWarp);
    const active = stateWithWarp({ strength: 73, detailScale: 13, preserveCounters: false });
    expect(migrateAndRepairProject(JSON.parse(JSON.stringify(active))).project.glyphMicroWarp).toEqual(active.glyphMicroWarp);
  });

  it("returns the exact original geometry and key after an enable/disable round trip", () => {
    const enabled = stateWithWarp();
    const source = layoutGlyphs(enabled, loaded);
    const warped = deriveGlyphMicroWarpGeometry(enabled, source, "typography:round-trip");
    const restored = deriveGlyphMicroWarpGeometry({
      ...enabled,
      glyphMicroWarp: { ...enabled.glyphMicroWarp, enabled: false },
    }, source, "typography:round-trip");
    expect(warped.geometryKey).not.toBe("typography:round-trip");
    expect(restored.geometry).toBe(source);
    expect(restored.geometryKey).toBe("typography:round-trip");
  });
});
