import type { ProjectState, RenderContext } from "../types";
import type { GlyphPathCommand, PositionedGlyph } from "./glyphGeometry";
import { getFalloffWeight, sampleGlyphField, sampleGlyphFieldGradient } from "./field/compositeWaveField";
import { sampleDistanceGradient } from "./substrate";

interface Point { x: number; y: number }
interface Contour { points: Point[]; closed: boolean }

export interface WarpedGlyphPath {
  glyphIndex: number;
  textIndex: number;
  d: string;
}

export interface OutlineWarpDiagnostics {
  overlayMode: "warped-outline";
  requestedOverlay: "warped-outline";
  effectiveOverlay: "warped-outline" | "solid-fallback";
  active: boolean;
  glyphPathSource: "parsed-font" | "native-fallback";
  warpedGlyphCount: number;
  sampledOutlinePoints: number;
  averageDisplacement: number;
  maxDisplacement: number;
  clampedPoints: number;
  counterPreservationWarnings: number;
  activeEmitterGlyph?: string;
  effectiveWarpStrength: number;
  nativeFallbackLimitation?: string;
  inactiveReason?: string;
  warning?: string;
}

export interface WarpedOutlineResult {
  paths: WarpedGlyphPath[];
  diagnostics: OutlineWarpDiagnostics;
}

export const NATIVE_OUTLINE_WARP_WARNING = "Warped outline requires a loaded .ttf/.otf font. Native SVG text uses solid fallback.";

export function areOutlineWarpControlsActive(overlayMode: ProjectState["overlayMode"], hasParsedGlyphPaths: boolean) {
  return overlayMode === "warped-outline" && hasParsedGlyphPaths;
}

export function outlineWarpCacheKey(state: ProjectState) {
  return [
    state.overlayMode,
    state.outlineWarpAmount,
    state.outlineWarpScale,
    state.outlineWarpSmoothing,
    state.outlineWarpEdgeBias,
    state.outlineWarpMaxDisplacement,
    state.preserveCounters ? 1 : 0,
  ].join("|");
}

function interpolateQuadratic(a: Point, control: Point, b: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * a.x + 2 * inverse * t * control.x + t * t * b.x,
    y: inverse * inverse * a.y + 2 * inverse * t * control.y + t * t * b.y,
  };
}

function interpolateCubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * a.x + 3 * inverse * inverse * t * c1.x + 3 * inverse * t * t * c2.x + t ** 3 * b.x,
    y: inverse ** 3 * a.y + 3 * inverse * inverse * t * c1.y + 3 * inverse * t * t * c2.y + t ** 3 * b.y,
  };
}

function sampleCommands(commands: GlyphPathCommand[], curveSteps: number): Contour[] {
  const contours: Contour[] = [];
  let current: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  const finish = (closed: boolean) => {
    if (current.length > 1) contours.push({ points: current, closed });
    current = [];
  };
  for (const command of commands) {
    if (command.type === "M" && command.x !== undefined && command.y !== undefined) {
      finish(true);
      cursor = { x: command.x, y: command.y };
      current.push(cursor);
    } else if (command.type === "L" && command.x !== undefined && command.y !== undefined) {
      cursor = { x: command.x, y: command.y };
      current.push(cursor);
    } else if (command.type === "Q" && command.x !== undefined && command.y !== undefined && command.x1 !== undefined && command.y1 !== undefined) {
      const start = cursor;
      const control = { x: command.x1, y: command.y1 };
      const end = { x: command.x, y: command.y };
      for (let step = 1; step <= curveSteps; step += 1) current.push(interpolateQuadratic(start, control, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "C" && command.x !== undefined && command.y !== undefined && command.x1 !== undefined && command.y1 !== undefined && command.x2 !== undefined && command.y2 !== undefined) {
      const start = cursor;
      const control1 = { x: command.x1, y: command.y1 };
      const control2 = { x: command.x2, y: command.y2 };
      const end = { x: command.x, y: command.y };
      for (let step = 1; step <= curveSteps; step += 1) current.push(interpolateCubic(start, control1, control2, end, step / curveSteps));
      cursor = end;
    } else if (command.type === "Z") {
      finish(true);
    }
  }
  finish(true);
  return contours;
}

function signedArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return area / 2;
}

function smoothVectors(vectors: Point[], amount: number, closed: boolean): Point[] {
  if (vectors.length < 3 || amount <= 0) return vectors;
  const passes = Math.max(1, Math.round(1 + amount * 3));
  const blend = 0.22 + amount * 0.68;
  let result = vectors;
  for (let pass = 0; pass < passes; pass += 1) {
    result = result.map((vector, index) => {
      if (!closed && (index === 0 || index === result.length - 1)) return vector;
      const previous = result[(index - 1 + result.length) % result.length];
      const next = result[(index + 1) % result.length];
      const average = { x: (previous.x + vector.x * 2 + next.x) / 4, y: (previous.y + vector.y * 2 + next.y) / 4 };
      return {
        x: vector.x * (1 - blend) + average.x * blend,
        y: vector.y * (1 - blend) + average.y * blend,
      };
    });
  }
  return result;
}

function serializeContours(contours: Contour[]) {
  const number = (value: number) => Number(value.toFixed(2));
  return contours.map((contour) => {
    if (contour.points.length < 2) return "";
    const [first, ...rest] = contour.points;
    return `M${number(first.x)} ${number(first.y)}${rest.map((point) => `L${number(point.x)} ${number(point.y)}`).join("")}${contour.closed ? "Z" : ""}`;
  }).join("");
}

function emptyDiagnostics(nativeFallbackLimitation?: string): OutlineWarpDiagnostics {
  return {
    overlayMode: "warped-outline",
    requestedOverlay: "warped-outline",
    effectiveOverlay: nativeFallbackLimitation ? "solid-fallback" : "warped-outline",
    active: false,
    glyphPathSource: nativeFallbackLimitation ? "native-fallback" : "parsed-font",
    warpedGlyphCount: 0,
    sampledOutlinePoints: 0,
    averageDisplacement: 0,
    maxDisplacement: 0,
    clampedPoints: 0,
    counterPreservationWarnings: 0,
    effectiveWarpStrength: 0,
    nativeFallbackLimitation,
    inactiveReason: nativeFallbackLimitation ? "no parsed glyph paths" : undefined,
  };
}

function warpGlyph(
  glyph: PositionedGlyph,
  state: ProjectState,
  context: RenderContext,
  counters: { sampled: number; displacement: number; max: number; clamped: number; counterWarnings: number; effectiveStrength: number },
): WarpedGlyphPath | null {
  const field = context.glyphField;
  if (!field || glyph.path.commands.length === 0) return null;
  const curveSteps = Math.max(5, Math.min(24, Math.round(6 + state.outlineWarpSmoothing * 14)));
  const contours = sampleCommands(glyph.path.commands, curveSteps);
  if (contours.length === 0) return null;
  const areas = contours.map((contour) => Math.abs(signedArea(contour.points)));
  const largestArea = Math.max(1, ...areas);
  const peak = Math.max(0.001, Math.abs(field.min), Math.abs(field.max));
  const anchor = field.anchor;
  const maxDisplacement = Math.max(0, state.outlineWarpMaxDisplacement);

  const warped = contours.map((contour, contourIndex) => {
    const isCounter = areas[contourIndex] < largestArea * 0.62;
    const counterScale = state.preserveCounters && isCounter ? 0.28 : 1;
    if (state.preserveCounters && isCounter && state.outlineWarpAmount > maxDisplacement * 0.8) counters.counterWarnings += 1;
    const vectors = contour.points.map((point) => {
      const samplePoint = {
        x: anchor.x + (point.x - anchor.x) / Math.max(0.25, state.outlineWarpScale),
        y: anchor.y + (point.y - anchor.y) / Math.max(0.25, state.outlineWarpScale),
      };
      const sharedValue = (context.sampleGlyphField?.(samplePoint.x, samplePoint.y) ?? sampleGlyphField(field, samplePoint.x, samplePoint.y)) / peak;
      const radialX = point.x - anchor.x;
      const radialY = point.y - anchor.y;
      const radialMagnitude = Math.max(1, Math.hypot(radialX, radialY));
      const radialDirection = { x: radialX / radialMagnitude, y: radialY / radialMagnitude };
      const phase = radialMagnitude * state.emitter.frequency * (state.frequency / 18) / Math.max(0.25, state.outlineWarpScale) + state.emitter.phase;
      const rawCrest = Math.sin(phase);
      const crest = Math.sign(rawCrest) * Math.pow(Math.abs(rawCrest), 1 + state.ringSharpness * 0.2);
      const falloff = getFalloffWeight(radialMagnitude / Math.max(1, state.emitter.radius), state.emitter.falloff);
      const value = Math.max(-1, Math.min(1, crest * falloff * 0.78 + sharedValue * 0.22));
      const fieldGradient = context.sampleGlyphFieldGradient?.(samplePoint.x, samplePoint.y) ?? sampleGlyphFieldGradient(field, samplePoint.x, samplePoint.y);
      const sdfGradient = context.substrateData ? sampleDistanceGradient(context.substrateData, point.x, point.y) : { x: 0, y: 0, magnitude: 0 };
      const fieldMagnitude = Math.max(1e-6, fieldGradient.magnitude);
      const sdfMagnitude = Math.max(1e-6, sdfGradient.magnitude);
      const sampledFieldDirection = fieldGradient.finite && fieldGradient.magnitude > 1e-6
        ? { x: fieldGradient.x / fieldMagnitude, y: fieldGradient.y / fieldMagnitude }
        : radialDirection;
      const alignment = sampledFieldDirection.x * radialDirection.x + sampledFieldDirection.y * radialDirection.y;
      if (alignment < 0) {
        sampledFieldDirection.x *= -1;
        sampledFieldDirection.y *= -1;
      }
      const stabilizedFieldX = radialDirection.x * 0.72 + sampledFieldDirection.x * 0.28;
      const stabilizedFieldY = radialDirection.y * 0.72 + sampledFieldDirection.y * 0.28;
      const stabilizedMagnitude = Math.max(1e-6, Math.hypot(stabilizedFieldX, stabilizedFieldY));
      const fieldDirection = { x: stabilizedFieldX / stabilizedMagnitude, y: stabilizedFieldY / stabilizedMagnitude };
      const edgeBias = state.outlineWarpEdgeBias;
      let directionX = fieldDirection.x * (1 - edgeBias) + sdfGradient.x / sdfMagnitude * edgeBias;
      let directionY = fieldDirection.y * (1 - edgeBias) + sdfGradient.y / sdfMagnitude * edgeBias;
      const directionMagnitude = Math.max(1e-6, Math.hypot(directionX, directionY));
      directionX /= directionMagnitude;
      directionY /= directionMagnitude;
      const sliderResponse = Math.pow(Math.max(0, Math.min(1, state.outlineWarpAmount / 60)), 0.82);
      const amplitudeScale = Math.max(0.6, Math.min(1.45, state.amplitude / 28 * state.emitter.amplitude));
      const requested = 38 * sliderResponse * value * amplitudeScale * counterScale;
      const displacement = Math.max(-maxDisplacement, Math.min(maxDisplacement, requested));
      if (Math.abs(requested) > maxDisplacement + 1e-6) counters.clamped += 1;
      counters.sampled += 1;
      counters.displacement += Math.abs(displacement);
      counters.max = Math.max(counters.max, Math.abs(displacement));
      counters.effectiveStrength += Math.abs(requested);
      return { x: directionX * displacement, y: directionY * displacement };
    });
    const smoothed = smoothVectors(vectors, state.outlineWarpSmoothing, contour.closed);
    return {
      closed: contour.closed,
      points: contour.points.map((point, index) => ({ x: point.x + smoothed[index].x, y: point.y + smoothed[index].y })),
    };
  });
  return { glyphIndex: glyph.glyphIndex, textIndex: glyph.textIndex, d: serializeContours(warped) };
}

export function generateWarpedOutline(state: ProjectState, context: RenderContext): WarpedOutlineResult {
  if (state.overlayMode !== "warped-outline") return { paths: [], diagnostics: emptyDiagnostics() };
  const textGeometry = context.textGeometry;
  if (!textGeometry?.hasOutlines) {
    return {
      paths: [],
      diagnostics: emptyDiagnostics(NATIVE_OUTLINE_WARP_WARNING),
    };
  }
  if (state.outlineWarpAmount <= 0) {
    const paths = textGeometry.glyphs
      .filter((glyph) => glyph.path.d.length > 0)
      .map((glyph) => ({ glyphIndex: glyph.glyphIndex, textIndex: glyph.textIndex, d: glyph.path.d }));
    return {
      paths,
      diagnostics: {
        ...emptyDiagnostics(),
        warpedGlyphCount: paths.length,
      },
    };
  }
  if (!context.glyphField) {
    return {
      paths: [],
      diagnostics: {
        ...emptyDiagnostics(),
        effectiveOverlay: "solid-fallback",
        inactiveReason: "no glyph emitter field",
        warning: "Warped outline requires an enabled glyph emitter field; solid outline fallback is active.",
      },
    };
  }
  const counters = { sampled: 0, displacement: 0, max: 0, clamped: 0, counterWarnings: 0, effectiveStrength: 0 };
  const paths = textGeometry.glyphs
    .map((glyph) => warpGlyph(glyph, state, context, counters))
    .filter((path): path is WarpedGlyphPath => Boolean(path?.d));
  const strong = state.outlineWarpAmount > 24 || counters.clamped > counters.sampled * 0.15;
  return {
    paths,
    diagnostics: {
      overlayMode: "warped-outline",
      requestedOverlay: "warped-outline",
      effectiveOverlay: "warped-outline",
      active: paths.length > 0 && counters.max > 0,
      glyphPathSource: "parsed-font",
      warpedGlyphCount: paths.length,
      sampledOutlinePoints: counters.sampled,
      averageDisplacement: counters.sampled ? counters.displacement / counters.sampled : 0,
      maxDisplacement: counters.max,
      clampedPoints: counters.clamped,
      counterPreservationWarnings: counters.counterWarnings,
      activeEmitterGlyph: `${context.glyphField.sourceGlyph.textIndex + 1} · ${context.glyphField.sourceGlyph.character}`,
      effectiveWarpStrength: counters.sampled ? counters.effectiveStrength / counters.sampled : 0,
      warning: strong ? "Strong outline warp may reduce glyph readability or narrow counters." : undefined,
    },
  };
}
