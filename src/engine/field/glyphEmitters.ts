import type { PositionedGlyph, TextGeometry } from "../glyphGeometry";
import type { GlyphEmitterSourceMode, ProjectState } from "../../types";
import { getTextBounds } from "../textLayout";

export interface GlyphEmitterMetadata {
  glyphId: string;
  glyphIndex: number;
  character: string;
  textIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
  center: { x: number; y: number };
  centroid: { x: number; y: number };
  counterCenter: { x: number; y: number } | null;
  sourceAnchor: { x: number; y: number };
  emitterEligible: boolean;
}

export type EmitterSkipReason = "disabled" | "invalid-glyph" | "no-eligible-glyph";
export type EmitterFallbackReason = "counter-unavailable";

export interface ResolvedGlyphEmitterSource {
  id: string;
  glyphId: string;
  glyphLabel: string;
  glyph: GlyphEmitterMetadata;
  anchor: { x: number; y: number };
  weight: number;
  phaseOffset: number;
  radiusMultiplier: number;
  fallbackReason?: EmitterFallbackReason;
}

export interface SkippedGlyphEmitterSource {
  id: string;
  reason: EmitterSkipReason;
  requestedGlyphId: string | null;
}

export interface GlyphEmitterResolution {
  sources: ResolvedGlyphEmitterSource[];
  skipped: SkippedGlyphEmitterSource[];
  rowCount: number;
  activeRowCount: number;
}

export function getGlyphEmitterAnchor(glyph: GlyphEmitterMetadata, mode: GlyphEmitterSourceMode, custom?: { x: number; y: number }) {
  if (mode === "custom" && custom && Number.isFinite(custom.x) && Number.isFinite(custom.y)) return custom;
  if (mode === "counter-center") return glyph.counterCenter ?? glyph.center;
  if (mode === "centroid") return glyph.centroid;
  return glyph.center;
}

export function getGlyphById(glyphs: GlyphEmitterMetadata[], glyphId: string | null) {
  return glyphs.find((glyph) => glyph.glyphId === glyphId) ?? null;
}

export function resolveEmitterGlyph(glyphs: GlyphEmitterMetadata[], glyphId: string | null) {
  const eligible = glyphs.filter((glyph) => glyph.emitterEligible);
  if (glyphId === "auto-o-middle") {
    return eligible.find((glyph) => /[Oo0]/.test(glyph.character))
      ?? eligible[Math.floor((eligible.length - 1) / 2)]
      ?? null;
  }
  return getGlyphById(eligible, glyphId) ?? eligible[0] ?? null;
}

function resolveAutomaticGlyph(eligible: GlyphEmitterMetadata[], selector: string | null) {
  if (eligible.length === 0) return { glyph: null, fallbackReason: undefined };
  if (selector === "auto-last") return { glyph: eligible[eligible.length - 1], fallbackReason: undefined };
  if (selector === "auto-middle") {
    return { glyph: eligible[Math.floor((eligible.length - 1) / 2)], fallbackReason: undefined };
  }
  if (selector === "auto-counter") {
    const counter = eligible.find((glyph) => glyph.counterCenter !== null);
    return counter
      ? { glyph: counter, fallbackReason: undefined }
      : {
          glyph: eligible[Math.floor((eligible.length - 1) / 2)],
          fallbackReason: "counter-unavailable" as const,
        };
  }
  if (selector === "auto-o-middle") {
    return {
      glyph: eligible.find((glyph) => /[Oo0]/.test(glyph.character))
        ?? eligible[Math.floor((eligible.length - 1) / 2)],
      fallbackReason: undefined,
    };
  }
  return { glyph: eligible[0], fallbackReason: undefined };
}

export function resolveGlyphEmitterSources(
  state: ProjectState,
  textGeometry: TextGeometry | null,
): GlyphEmitterResolution {
  const rows = state.emitters.slice(0, 8);
  const eligible = getGlyphEmitterMetadata(state, textGeometry).filter((glyph) => glyph.emitterEligible);
  const sources: ResolvedGlyphEmitterSource[] = [];
  const skipped: SkippedGlyphEmitterSource[] = [];
  let activeRowCount = 0;

  for (const row of rows) {
    if (!row.enabled) {
      skipped.push({ id: row.id, reason: "disabled", requestedGlyphId: row.glyphId });
      continue;
    }
    activeRowCount += 1;
    if (eligible.length === 0) {
      skipped.push({ id: row.id, reason: "no-eligible-glyph", requestedGlyphId: row.glyphId });
      continue;
    }

    const automatic = row.glyphId === null || row.glyphId.startsWith("auto-");
    const resolution = automatic
      ? resolveAutomaticGlyph(eligible, row.glyphId)
      : { glyph: getGlyphById(eligible, row.glyphId), fallbackReason: undefined };
    if (!resolution.glyph) {
      skipped.push({ id: row.id, reason: "invalid-glyph", requestedGlyphId: row.glyphId });
      continue;
    }
    const glyph = resolution.glyph;
    sources.push({
      id: row.id,
      glyphId: glyph.glyphId,
      glyphLabel: getGlyphDisplayLabel(glyph),
      glyph,
      anchor: getGlyphEmitterAnchor(glyph, state.emitter.sourceMode, {
        x: state.emitter.customX,
        y: state.emitter.customY,
      }),
      weight: row.weight,
      phaseOffset: row.phaseOffset,
      radiusMultiplier: row.radiusMultiplier,
      fallbackReason: resolution.fallbackReason,
    });
  }

  return { sources, skipped, rowCount: rows.length, activeRowCount };
}

export function getGlyphDisplayLabel(glyph: GlyphEmitterMetadata) {
  return `${glyph.textIndex + 1} · ${glyph.character || "space"}`;
}

function fromPositioned(glyph: PositionedGlyph): GlyphEmitterMetadata | null {
  const bounds = glyph.path.bounds;
  if (!bounds) return null;
  return {
    glyphId: glyph.glyphId,
    glyphIndex: glyph.glyphIndex,
    character: glyph.character,
    textIndex: glyph.textIndex,
    bounds,
    center: glyph.center,
    centroid: glyph.centroid,
    counterCenter: glyph.counterCenter,
    sourceAnchor: glyph.sourceAnchor,
    emitterEligible: glyph.emitterEligible,
  };
}

export function getGlyphEmitterMetadata(state: ProjectState, textGeometry: TextGeometry | null): GlyphEmitterMetadata[] {
  if (textGeometry?.glyphs.length) return textGeometry.glyphs.map(fromPositioned).filter((glyph): glyph is GlyphEmitterMetadata => Boolean(glyph));
  const characters = Array.from(state.text);
  const textBounds = getTextBounds(state);
  const cellWidth = characters.length > 0 ? textBounds.width / characters.length : 0;
  return characters.map((character, index) => {
    const bounds = { x: textBounds.x + index * cellWidth, y: textBounds.y, width: cellWidth, height: textBounds.height };
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    return {
      glyphId: `native-${index}-${character.codePointAt(0) ?? 0}`,
      glyphIndex: character.codePointAt(0) ?? 0,
      character,
      textIndex: index,
      bounds,
      center,
      centroid: center,
      counterCenter: /[Oo0QPRBA]/.test(character) ? center : null,
      sourceAnchor: center,
      emitterEligible: !/\s/.test(character),
    };
  });
}
