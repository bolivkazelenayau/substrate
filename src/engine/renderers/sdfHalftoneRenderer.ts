import type { CircleMark, GeometryGroup, RendererDiagnostics } from "../geometry";
import { createSeededRandom } from "../random";
import { contextArtboard, projectArtboard } from "../artboard";
import { artboardBottom, artboardLeft, artboardRight, artboardTop, worldToLocal } from "../sceneLayout";
import { sampleDistance, sampleDistanceGradient, sampleEdge, sampleMask, type SubstrateData } from "../substrate";
import type { VectorRenderer } from "./types";
import { getGlyphFieldSampler } from "../field/glyphFieldModulation";
import { SAFETY_BUDGETS } from "../safetyBudget";
import { createEmitterDisplaySampler, emitterDisplayUsesExterior, type EmitterDisplaySample } from "../field/emitterDisplayResponse";
import type { ArtboardRect } from "../sceneLayout";
import type { ProjectState, RenderContext } from "../../types";
import {
  createDisplayDislocationSampler,
  isDisplayDislocationActive,
  type DisplayDislocationSampler,
} from "../displayDislocation";
import {
  circleInsideArtboard,
  createEmitterMicroResponseSampler,
  emitterMicroResponseDiagnostics,
  emitterMicroResponseUsesExterior,
  type EmitterMicroResponseSampler,
} from "../field/emitterMicroResponse";
import {
  createGlyphFalloffDisplacementSampler,
  glyphFalloffDisplacementDiagnostics,
  isGlyphFalloffDisplacementConfigured,
  type GlyphFalloffDisplacementSampler,
} from "../field/glyphFalloffDisplacement";

interface OccupiedDot {
  x: number;
  y: number;
  radius: number;
}

function fallbackDiagnostics(warning: string): RendererDiagnostics {
  return {
    acceptedCandidates: 0,
    rejectedCandidates: 0,
    averageSampledDistance: 0,
    substrateAvailable: false,
    fallback: true,
    requestedDots: 0,
    acceptedDots: 0,
    rejectedOutsideMask: 0,
    rejectedBySpacing: 0,
    averageRadius: 0,
    minRadius: 0,
    maxRadius: 0,
    maxNodesClipped: false,
    warning,
  };
}

function smoothstep(value: number) {
  const amount = Math.max(0, Math.min(1, value));
  return amount * amount * (3 - 2 * amount);
}

/**
 * A DPR-independent world grid. The legacy path classifies at the lattice
 * point and may apply mark-space emitter display afterward. Display
 * Dislocation instead keeps the target lattice fixed and inverse-maps each
 * target through one coherent region translation before membership sampling.
 */
function generateRegularDotGrid(
  state: ProjectState,
  context: RenderContext,
  substrate: SubstrateData,
  artboard: ArtboardRect,
  displayResponse: ReturnType<typeof createEmitterDisplaySampler>,
  displayDislocation: DisplayDislocationSampler,
  glyphFalloff: GlyphFalloffDisplacementSampler,
  microResponse: EmitterMicroResponseSampler,
): GeometryGroup {
  const buildStarted = displayDislocation.active ? performance.now() : 0;
  const spacing = Math.max(3, state.dotGrid.spacing);
  const configuredRadius = Math.max(0.1, Math.min(spacing * 0.48, state.dotGrid.radius));
  const threshold = Math.max(0, Math.min(1, state.dotGrid.threshold));
  const softness = Math.max(0, Math.min(1, state.dotGrid.edgeSoftness));
  const bounds = substrate.bounds ?? artboard;
  const baseMinX = Math.max(artboardLeft(artboard), bounds.x);
  const baseMaxX = Math.min(artboardRight(artboard), bounds.x + bounds.width);
  const baseMinY = Math.max(artboardTop(artboard), bounds.y);
  const baseMaxY = Math.min(artboardBottom(artboard), bounds.y + bounds.height);
  const samplingPadding = (displayDislocation.active ? displayDislocation.maxDisplacement : 0)
    + (microResponse.exterior ? microResponse.candidatePadding : 0);
  const minX = Math.max(artboardLeft(artboard), bounds.x - samplingPadding);
  const maxX = Math.min(artboardRight(artboard), bounds.x + bounds.width + samplingPadding);
  const minY = Math.max(artboardTop(artboard), bounds.y - samplingPadding);
  const maxY = Math.min(artboardBottom(artboard), bounds.y + bounds.height + samplingPadding);
  // Integer lattice coordinates keep the origin fixed at world (0, 0), even
  // when effective scene expansion introduces a negative artboard origin.
  const firstColumn = Math.ceil(minX / spacing);
  const lastColumn = Math.floor(maxX / spacing);
  const firstRow = Math.ceil(minY / spacing);
  const lastRow = Math.floor(maxY / spacing);
  const columns = Math.max(0, lastColumn - firstColumn + 1);
  const rows = Math.max(0, lastRow - firstRow + 1);
  const requestedDots = columns * rows;
  // Expansion must not coarsen the unchanged outer lattice. Derive the
  // deterministic safety stride from the pre-dislocation domain.
  const baseColumns = Math.max(0, Math.floor(baseMaxX / spacing) - Math.ceil(baseMinX / spacing) + 1);
  const baseRows = Math.max(0, Math.floor(baseMaxY / spacing) - Math.ceil(baseMinY / spacing) + 1);
  const strideCandidateCount = displayDislocation.active ? baseColumns * baseRows : requestedDots;
  const candidateStride = strideCandidateCount > SAFETY_BUDGETS.candidateAttempts
    ? Math.ceil(Math.sqrt(strideCandidateCount / SAFETY_BUDGETS.candidateAttempts))
    : 1;
  const geometries: CircleMark[] = [];
  let rejectedOutsideMask = 0;
  let rejectedByInfluence = 0;
  let sampledDistanceTotal = 0;
  let radiusTotal = 0;
  let minRadius = Number.POSITIVE_INFINITY;
  let maxRadius = 0;
  let displaySamples = 0;
  let displayDisplacement = 0;
  let displayInteriorRejections = 0;
  let displayBreakupRejections = 0;
  let displayQuantizedSamples = 0;
  let dislocationAffectedCandidates = 0;
  let dislocationAcceptedCandidates = 0;
  let dislocationGapRejections = 0;
  let dislocationInverseSamples = 0;
  let dislocationMaxDisplacement = 0;
  const dislocatedRegions = new Set<string>();
  let clipped = false;

  outer:
  for (let row = firstRow; row <= lastRow; row += candidateStride) {
    for (let column = firstColumn; column <= lastColumn; column += candidateStride) {
      if (geometries.length >= state.maxNodes) {
        clipped = true;
        break outer;
      }
      const targetX = column * spacing;
      const targetY = row * spacing;
      let sourceX = targetX;
      let sourceY = targetY;
      let dislocationAffected = false;
      if (displayDislocation.active) {
        const dislocation = displayDislocation.sample(targetX, targetY);
        dislocationInverseSamples += 1;
        if (dislocation.affected) {
          dislocationAffected = true;
          dislocationAffectedCandidates += 1;
          dislocationMaxDisplacement = Math.max(dislocationMaxDisplacement, dislocation.displacement);
          if (dislocation.regionId) dislocatedRegions.add(dislocation.regionId);
          if (dislocation.gapRejected) {
            dislocationGapRejections += 1;
            rejectedByInfluence += 1;
            continue;
          }
          sourceX = dislocation.source.x;
          sourceY = dislocation.source.y;
        }
      }
      const mask = sampleMask(substrate, sourceX, sourceY);
      const distance = sampleDistance(substrate, sourceX, sourceY);
      const rendererDomainAccepted = mask >= threshold && distance > 0;
      const microExteriorCandidate = !rendererDomainAccepted
        && microResponse.exterior
        && microResponse.acceptsExteriorCandidate(
          targetX,
          targetY,
          sampleDistance(substrate, targetX, targetY),
          configuredRadius,
        );
      if (!rendererDomainAccepted && !microExteriorCandidate) {
        rejectedOutsideMask += 1;
        continue;
      }
      let x = targetX;
      let y = targetY;
      let opacityScale = 1;
      let radiusScale = 1;
      if (!displayDislocation.active && displayResponse.active) {
        const display = displayResponse.sample(sourceX, sourceY, (row - firstRow) * Math.max(1, columns) + (column - firstColumn));
        displaySamples += 1;
        if (!display.keep) {
          if (display.interiorRejected) displayInteriorRejections += 1;
          if (display.breakupRejected) displayBreakupRejections += 1;
          rejectedByInfluence += 1;
          continue;
        }
        x = display.point.x;
        y = display.point.y;
        opacityScale = display.opacityScale;
        radiusScale = display.radiusScale;
        displayDisplacement += display.displacement;
        if (display.quantized) displayQuantizedSamples += 1;
      }
      const edgeFactor = softness <= 0
        ? 1
        : Math.max(0.18, smoothstep((mask - threshold) / Math.max(0.001, softness) + 0.35));
      const radius = Math.max(0.1, configuredRadius * (1 - softness * 0.5 + softness * 0.5 * edgeFactor) * radiusScale);
      const opacity = Math.max(0.12, Math.min(1, edgeFactor * opacityScale));
      let geometry: CircleMark = { type: "circle", center: { x, y }, radius, opacity };
      let glyphFalloffAffected = false;
      let microResponseAffected = false;
      if (glyphFalloff.active) {
        const falloffSample = glyphFalloff.sampleCircle(geometry);
        geometry = falloffSample.mark;
        glyphFalloffAffected = falloffSample.affected;
        x = geometry.center.x;
        y = geometry.center.y;
      }
      if (microResponse.active) {
        const responseSample = microResponse.sampleCircle(
          geometry,
          (row - firstRow) * Math.max(1, columns) + (column - firstColumn),
        );
        if (!responseSample.keep) {
          rejectedByInfluence += 1;
          continue;
        }
        geometry = responseSample.mark;
        microResponseAffected = responseSample.affected;
        x = geometry.center.x;
        y = geometry.center.y;
      }
      if ((glyphFalloffAffected || microResponseAffected) && !circleInsideArtboard(geometry, artboard)) {
        if (glyphFalloffAffected) glyphFalloff.recordSafetyClip();
        if (microResponseAffected) microResponse.recordSafetyClip();
        rejectedOutsideMask += 1;
        continue;
      }
      geometries.push(geometry);
      sampledDistanceTotal += distance;
      radiusTotal += radius;
      minRadius = Math.min(minRadius, radius);
      maxRadius = Math.max(maxRadius, radius);
      if (dislocationAffected) dislocationAcceptedCandidates += 1;
    }
  }

  const attemptedCandidates = Math.ceil(rows / candidateStride) * Math.ceil(columns / candidateStride);
  const displacement = context.textGeometry?.displacement;
  const artboardClipped = displayDislocation.active && (
    bounds.x - samplingPadding < artboardLeft(artboard)
    || bounds.x + bounds.width + samplingPadding > artboardRight(artboard)
    || bounds.y - samplingPadding < artboardTop(artboard)
    || bounds.y + bounds.height + samplingPadding > artboardBottom(artboard)
  );
  const dislocationClippingState = artboardClipped
    ? clipped ? "artboard-and-node-budget" : "artboard"
    : clipped ? "node-budget" : "none";
  const warning = displayDislocation.active
    ? [
        clipped ? `Dot-grid output clipped at the ${state.maxNodes} node budget.` : null,
        artboardClipped ? "Display Dislocation sampling padding reached the effective artboard." : null,
      ].filter(Boolean).join(" ") || undefined
    : clipped ? `Dot-grid output clipped at the ${state.maxNodes} node budget.` : undefined;
  return {
    id: "sdf-halftone",
    geometries,
    diagnostics: {
      acceptedCandidates: geometries.length,
      rejectedCandidates: rejectedOutsideMask + rejectedByInfluence,
      averageSampledDistance: geometries.length ? sampledDistanceTotal / geometries.length : 0,
      substrateAvailable: true,
      fallback: false,
      requestedDots,
      attemptedCandidates,
      candidateBudgetReached: candidateStride > 1,
      acceptedDots: geometries.length,
      acceptedGridPoints: geometries.length,
      rejectedOutsideMask,
      rejectedBySpacing: 0,
      rejectedByInfluence,
      averageRadius: geometries.length ? radiusTotal / geometries.length : 0,
      minRadius: geometries.length ? minRadius : 0,
      maxRadius,
      maxNodesClipped: clipped,
      dotGridRegular: !microResponse.microActive && !glyphFalloff.active,
      dotGridSpacing: spacing * candidateStride,
      dotGridOriginX: 0,
      dotGridOriginY: 0,
      glyphDisplacementKey: displacement?.geometryKey ?? context.textGeometryKey ?? "base",
      glyphDisplacementFragmentCount: displacement?.fragmentCount ?? 0,
      emitterDisplayMode: state.emitterDisplay.mode,
      emitterDisplaySamples: displaySamples,
      emitterDisplayAverageDisplacement: displaySamples ? displayDisplacement / displaySamples : 0,
      emitterDisplayInteriorRejections: displayInteriorRejections,
      emitterDisplayBreakupRejections: displayBreakupRejections,
      emitterDisplayQuantizedSamples: displayQuantizedSamples,
      ...emitterMicroResponseDiagnostics(state, microResponse),
      ...glyphFalloffDisplacementDiagnostics(state, glyphFalloff),
      ...(displayDislocation.active ? {
        displayDislocationMode: state.displayDislocation.mode,
        displayDislocationCandidateCount: attemptedCandidates,
        displayDislocationAffectedCandidates: dislocationAffectedCandidates,
        displayDislocationAcceptedCandidates: dislocationAcceptedCandidates,
        displayDislocationRegionCount: dislocatedRegions.size,
        displayDislocationGapRejections: dislocationGapRejections,
        displayDislocationInverseSamples: dislocationInverseSamples,
        displayDislocationMaxDisplacement: dislocationMaxDisplacement,
        displayDislocationBuildTimeMs: Math.max(0, performance.now() - buildStarted),
        displayDislocationClippingState: dislocationClippingState,
        displayDislocationSourceCount: displayDislocation.sourceCount,
        displayDislocationSourceDomain: "original-glyph" as const,
      } : {}),
      warning,
    },
  };
}

export const sdfHalftoneRenderer: VectorRenderer = {
  id: "sdf-halftone",
  label: "SDF Halftone",
  supportedControls: ["density", "amplitude", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "circle",
  usesTime: false,
  usesSubstrate: true,
  clipPreviewToText: (state) => !isDisplayDislocationActive(state)
    && !emitterDisplayUsesExterior(state)
    && !emitterMicroResponseUsesExterior(state)
    && !isGlyphFalloffDisplacementConfigured(state),
  estimateCost(state) {
    const artboard = projectArtboard(state);
    const density = Math.max(10, Math.min(80, state.density));
    const spacing = 26 - (density - 10) / 70 * 18;
    const boundsArea = artboard.width * artboard.height * 0.38;
    const marks = Math.min(state.maxNodes, Math.ceil(boundsArea / (spacing * spacing)));
    return { marks, nodes: marks, label: `${marks.toLocaleString()} circles` };
  },
  generateGeometry(state, context) {
    const artboard = contextArtboard(context);
    const substrate = context.substrateData;
    if (!substrate || substrate.substrateType === "empty" || substrate.diagnostics.maskCoverage <= 0 || substrate.diagnostics.maxDistance <= 0) {
      return {
        id: "sdf-halftone",
        geometries: [],
        diagnostics: fallbackDiagnostics("SDF Halftone requires a non-empty signed distance substrate."),
      };
    }
    const glyph = getGlyphFieldSampler(state, context);
    const displayResponse = createEmitterDisplaySampler(state, context);
    const displayDislocation = createDisplayDislocationSampler(state, context);
    const microResponse = createEmitterMicroResponseSampler(state, context);
    const glyphFalloff = createGlyphFalloffDisplacementSampler(state, context);
    if (state.dotGrid.enabled) {
      return generateRegularDotGrid(state, context, substrate, artboard, displayResponse, displayDislocation, glyphFalloff, microResponse);
    }

    const random = createSeededRandom(state.seed);
    const density = Math.max(10, Math.min(80, state.density));
    const densityRatio = (density - 10) / 70;
    const spacing = 26 - densityRatio * 18;
    const maxRadius = Math.max(1.2, Math.min(spacing * 0.46, 1.2 + state.amplitude * 0.2));
    const minRadius = Math.max(0.55, Math.min(1.5, maxRadius * 0.24));
    const influence = Math.max(0, Math.min(1, state.edgeInfluence / 100));
    const jitter = spacing * 0.42 * Math.max(0, Math.min(1, state.turbulence / 100));
    const edgeBand = Math.max(spacing, substrate.diagnostics.maxDistance * (0.72 - influence * 0.52));
    const bounds = substrate.bounds;
    const samplingPadding = Math.max(
      displayResponse.exterior ? displayResponse.shellRadius : spacing,
      microResponse.exterior ? microResponse.candidatePadding : spacing,
    );
    const minX = Math.max(artboardLeft(artboard), (bounds?.x ?? artboardLeft(artboard)) - samplingPadding);
    const maxX = Math.min(artboardRight(artboard), (bounds ? bounds.x + bounds.width : artboardRight(artboard)) + samplingPadding);
    const minY = Math.max(artboardTop(artboard), (bounds?.y ?? artboardTop(artboard)) - samplingPadding);
    const maxY = Math.min(artboardBottom(artboard), (bounds ? bounds.y + bounds.height : artboardBottom(artboard)) + samplingPadding);
    const columns = Math.max(1, Math.ceil((maxX - minX) / spacing));
    const rows = Math.max(1, Math.ceil((maxY - minY) / spacing));
    const requestedDots = columns * rows;
    const candidateStride = requestedDots > SAFETY_BUDGETS.candidateAttempts
      ? Math.ceil(Math.sqrt(requestedDots / SAFETY_BUDGETS.candidateAttempts)) : 1;
    const attemptedCandidates = Math.ceil(rows / candidateStride) * Math.ceil(columns / candidateStride);
    const geometries: CircleMark[] = [];
    // Numeric occupancy grid, keyed as `(cellY + OFFSET) * SPAN + (cellX + OFFSET)`.
    // Avoids string-key allocation per accepted dot while preserving identical spacing
    // behaviour. Offset/Span are large enough that physically adjacent cells always
    // map to adjacent numeric keys (no false collisions even when displacement pushes
    // candidates outside the viewport before acceptance filtering).
    const occupancy = new Map<number, OccupiedDot[]>();
    const occupancyCellSize = Math.max(2, maxRadius * 2);
    const occupancyKeyOffset = 65_536;
    const occupancyKeySpan = 131_072;
    let rejectedOutsideMask = 0;
    let rejectedBySpacing = 0;
    let rejectedByInfluence = 0;
    let sampledDistanceTotal = 0;
    let radiusTotal = 0;
    let actualMinRadius = Number.POSITIVE_INFINITY;
    let actualMaxRadius = 0;
    let clipped = false;
    let fieldValueTotal = 0;
    let displacementTotal = 0;
    let rejectedDisplacedCandidates = 0;
    let fieldInfluencedAcceptanceCount = 0;
    let ringStrengthTotal = 0;
    let ringSamples = 0;
    let acceptedCrestDots = 0;
    let displayResponseSamples = 0;
    let displayDisplacementTotal = 0;
    let displayInteriorRejections = 0;
    let displayBreakupRejections = 0;
    let displayQuantizedSamples = 0;

    outer:
    for (let row = 0; row < rows; row += candidateStride) {
      for (let column = 0; column < columns; column += candidateStride) {
        if (geometries.length >= state.maxNodes) {
          clipped = true;
          break outer;
        }

        const centerX = minX + (column + 0.5) * spacing;
        const centerY = minY + (row + 0.5) * spacing;
        let x = centerX + (random() * 2 - 1) * jitter;
        let y = centerY + (random() * 2 - 1) * jitter;
        let mask = sampleMask(substrate, x, y);
        let distance = sampleDistance(substrate, x, y);
        let displaySample: EmitterDisplaySample | null = null;

        if (displayResponse.exterior) {
          const displayProbe = displayResponse.probe(x, y);
          if (!displayProbe.affected || Math.abs(displayProbe.signedDistance) > displayResponse.shellRadius) {
            rejectedOutsideMask += 1;
            continue;
          }
          displaySample = displayResponse.sample(x, y, row * columns + column);
          displayResponseSamples += 1;
          if (!displaySample.keep) {
            if (displaySample.interiorRejected) displayInteriorRejections += 1;
            if (displaySample.breakupRejected) displayBreakupRejections += 1;
            rejectedByInfluence += 1;
            continue;
          }
          x = displaySample.point.x;
          y = displaySample.point.y;
          mask = sampleMask(substrate, x, y);
          distance = sampleDistance(substrate, x, y);
          displayDisplacementTotal += displaySample.displacement;
          if (displaySample.quantized) displayQuantizedSamples += 1;
        } else {
          let rendererDomainAccepted = mask >= 0.55 && distance > 0;
          let microExteriorCandidate = !rendererDomainAccepted
            && microResponse.exterior
            && microResponse.acceptsExteriorCandidate(x, y, distance, minRadius);
          if (!rendererDomainAccepted && !microExteriorCandidate) {
            x = centerX;
            y = centerY;
            mask = sampleMask(substrate, x, y);
            distance = sampleDistance(substrate, x, y);
            rendererDomainAccepted = mask >= 0.55 && distance > 0;
            microExteriorCandidate = !rendererDomainAccepted
              && microResponse.exterior
              && microResponse.acceptsExteriorCandidate(x, y, distance, minRadius);
          }
          if (!rendererDomainAccepted && !microExteriorCandidate) {
            rejectedOutsideMask += 1;
            continue;
          }
          if (displayResponse.active) {
            displaySample = displayResponse.sample(x, y, row * columns + column);
            displayResponseSamples += 1;
            if (!displaySample.keep) {
              if (displaySample.breakupRejected) displayBreakupRejections += 1;
              rejectedByInfluence += 1;
              continue;
            }
            x = displaySample.point.x;
            y = displaySample.point.y;
            mask = sampleMask(substrate, x, y);
            distance = sampleDistance(substrate, x, y);
            displayDisplacementTotal += displaySample.displacement;
            if (displaySample.quantized) displayQuantizedSamples += 1;
          }
        }

        const fieldValue = glyph.enabled ? glyph.value(x, y) : 0;
        if (glyph.displacementEnabled && !displayResponse.exterior) {
          const fieldGradient = glyph.gradient(x, y);
          if (fieldGradient.finite && fieldGradient.magnitude > 1e-6) {
            const displacement = state.glyphFieldDisplacement * glyph.strength * (0.3 + Math.abs(fieldValue) * 0.7);
            const direction = fieldValue >= 0 ? 1 : -1;
            const candidateX = x + fieldGradient.x / fieldGradient.magnitude * displacement * direction;
            const candidateY = y + fieldGradient.y / fieldGradient.magnitude * displacement * direction;
            if (sampleMask(substrate, candidateX, candidateY) >= 0.55 && sampleDistance(substrate, candidateX, candidateY) > 0) {
              x = candidateX;
              y = candidateY;
              mask = sampleMask(substrate, x, y);
              distance = sampleDistance(substrate, x, y);
              displacementTotal += displacement;
            } else rejectedDisplacedCandidates += 1;
          }
        }

        const edge = sampleEdge(substrate, x, y);
        const gradient = sampleDistanceGradient(substrate, x, y);
        const responseDistance = displayResponse.exterior || microResponse.exterior
          ? Math.abs(distance)
          : distance;
        const edgeProximity = Math.exp(-responseDistance / edgeBand);
        const edgeSignal = Math.min(1, edgeProximity * 0.82 + edge * 0.38);
        const fieldDensity = glyph.densityEnabled ? Math.abs(fieldValue) * state.glyphFieldDensity / 100 * glyph.strength : 0;
        const bandPosition = Math.max(0, Math.min(1, (Math.abs(fieldValue) - (1 - state.bandWidth)) / Math.max(0.001, state.bandWidth)));
        const ringStrength = glyph.densityEnabled ? Math.pow(bandPosition * bandPosition * (3 - 2 * bandPosition), state.ringSharpness) : 0;
        if (glyph.densityEnabled) {
          ringStrengthTotal += ringStrength;
          ringSamples += 1;
        }
        const structuredDensity = glyph.densityEnabled ? 0.42 + ringStrength * 0.98 + fieldDensity * 0.52 : 1;
        let acceptance = Math.min(1, (1 - influence * 0.78 + influence * 0.78 * edgeSignal) * structuredDensity);
        if (displaySample) acceptance = Math.min(1, acceptance * displaySample.opacityScale);
        if (random() > acceptance) {
          rejectedByInfluence += 1;
          continue;
        }
        if (glyph.enabled && fieldDensity > 0.01) fieldInfluencedAcceptanceCount += 1;
        if (ringStrength >= 0.5) acceptedCrestDots += 1;

        const interiorRatio = Math.max(0, Math.min(1, responseDistance / Math.max(maxRadius * 2.4, spacing * 0.7)));
        const edgeWeightedRatio = (1 - influence * 0.42) * interiorRatio + influence * 0.42 * edgeSignal;
        const radiusNoise = 1 + (random() * 2 - 1) * Math.min(0.18, state.turbulence / 700);
        const gradientSafety = Number.isFinite(gradient.magnitude) ? 1 : 0.85;
        const radiusModulation = glyph.radiusEnabled ? 1 + fieldValue * state.glyphFieldRadius / 100 * glyph.strength * 0.75 : 1;
        let radius = Math.max(minRadius, Math.min(maxRadius * 1.35, (minRadius + (maxRadius - minRadius) * edgeWeightedRatio) * radiusNoise * gradientSafety * radiusModulation));
        if (displaySample) radius = Math.max(minRadius, Math.min(maxRadius * 1.35, radius * displaySample.radiusScale));
        let opacity = Math.max(0.18, Math.min(0.98, (0.48 + interiorRatio * 0.34 + edgeSignal * influence * 0.14) * (glyph.opacityEnabled ? (1 + fieldValue * state.glyphFieldOpacity / 100 * glyph.strength) : 1)));
        if (displaySample) opacity = Math.max(0.18, Math.min(0.98, opacity * displaySample.opacityScale));
        let geometry: CircleMark = { type: "circle", center: { x, y }, radius, opacity };
        let glyphFalloffAffected = false;
        let microResponseAffected = false;
        if (glyphFalloff.active) {
          const falloffSample = glyphFalloff.sampleCircle(geometry);
          geometry = falloffSample.mark;
          glyphFalloffAffected = falloffSample.affected;
          x = geometry.center.x;
          y = geometry.center.y;
        }
        if (microResponse.active) {
          const responseSample = microResponse.sampleCircle(geometry, row * columns + column);
          if (!responseSample.keep) {
            rejectedByInfluence += 1;
            continue;
          }
          geometry = responseSample.mark;
          microResponseAffected = responseSample.affected;
          x = geometry.center.x;
          y = geometry.center.y;
          radius = geometry.radius;
          opacity = geometry.opacity;
        }
        if ((glyphFalloffAffected || microResponseAffected) && !circleInsideArtboard(geometry, artboard)) {
          if (glyphFalloffAffected) glyphFalloff.recordSafetyClip();
          if (microResponseAffected) microResponse.recordSafetyClip();
          rejectedOutsideMask += 1;
          continue;
        }
        const cellX = Math.floor(worldToLocal(artboard, { x, y }).x / occupancyCellSize);
        const cellY = Math.floor(worldToLocal(artboard, { x, y }).y / occupancyCellSize);
        let overlaps = false;
        for (let oy = -1; oy <= 1 && !overlaps; oy += 1) {
          for (let ox = -1; ox <= 1 && !overlaps; ox += 1) {
            const nearby = occupancy.get((cellY + oy + occupancyKeyOffset) * occupancyKeySpan + (cellX + ox + occupancyKeyOffset)) ?? null;
            if (nearby) {
              for (let k = 0; k < nearby.length && !overlaps; k += 1) {
                const dot = nearby[k];
                if (Math.hypot(x - dot.x, y - dot.y) < (radius + dot.radius) * 0.86) overlaps = true;
              }
            }
          }
        }
        if (overlaps) {
          rejectedBySpacing += 1;
          continue;
        }

        geometries.push(geometry);
        const occupiedKey = (cellY + occupancyKeyOffset) * occupancyKeySpan + (cellX + occupancyKeyOffset);
        const occupied = occupancy.get(occupiedKey) ?? [];
        occupied.push({ x, y, radius });
        occupancy.set(occupiedKey, occupied);
        sampledDistanceTotal += responseDistance;
        radiusTotal += radius;
        actualMinRadius = Math.min(actualMinRadius, radius);
        actualMaxRadius = Math.max(actualMaxRadius, radius);
        fieldValueTotal += Math.abs(fieldValue);
      }
    }

    const rejectedCandidates = rejectedOutsideMask + rejectedBySpacing + rejectedByInfluence;
    return {
      id: "sdf-halftone",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates,
        averageSampledDistance: geometries.length > 0 ? sampledDistanceTotal / geometries.length : 0,
        substrateAvailable: true,
        fallback: false,
        requestedDots,
        attemptedCandidates,
        candidateBudgetReached: candidateStride > 1,
        acceptedDots: geometries.length,
        rejectedOutsideMask,
        rejectedBySpacing,
        averageRadius: geometries.length > 0 ? radiusTotal / geometries.length : 0,
        minRadius: geometries.length > 0 ? actualMinRadius : 0,
        maxRadius: actualMaxRadius,
        maxNodesClipped: clipped,
        glyphFieldEnabled: glyph.enabled,
        selectedGlyph: glyph.field ? `${glyph.field.sourceGlyph.textIndex + 1} · ${glyph.field.sourceGlyph.character}` : undefined,
        glyphFieldMode: state.glyphFieldMode,
        averageGlyphFieldValue: geometries.length ? fieldValueTotal / geometries.length : 0,
        averageGlyphFieldDisplacement: geometries.length ? displacementTotal / geometries.length : 0,
        rejectedDisplacedCandidates,
        fieldInfluencedAcceptanceCount,
        averageRingStrength: ringSamples ? ringStrengthTotal / ringSamples : 0,
        acceptedCrestDots,
        emitterDisplayMode: state.emitterDisplay.mode,
        emitterDisplaySamples: displayResponseSamples,
        emitterDisplayAverageDisplacement: displayResponseSamples ? displayDisplacementTotal / displayResponseSamples : 0,
        emitterDisplayInteriorRejections: displayInteriorRejections,
        emitterDisplayBreakupRejections: displayBreakupRejections,
        emitterDisplayQuantizedSamples: displayQuantizedSamples,
        ...emitterMicroResponseDiagnostics(state, microResponse),
        ...glyphFalloffDisplacementDiagnostics(state, glyphFalloff),
        warning: clipped ? `Dot output clipped at the ${state.maxNodes} node budget.` : undefined,
      },
    };
  },
};
