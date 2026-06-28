import { VIEWPORT } from "../constants";
import { buildCompositeWaveField, getEmitterContributionAtPoint, getFalloffWeight } from "../field/compositeWaveField";
import type { CircleMark, RendererDiagnostics } from "../geometry";
import { createSeededRandom } from "../random";
import { sampleEdge, sampleMask } from "../substrate";
import type { VectorRenderer } from "./types";

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
    averageOpacity: 0,
    maxNodesClipped: false,
    warning,
  };
}

export const glyphDiffuserRenderer: VectorRenderer = {
  id: "glyph-diffuser",
  label: "Glyph Diffuser",
  supportedControls: ["density", "amplitude", "frequency", "turbulence", "edgeInfluence", "maxNodes"],
  svgElementType: "circle",
  usesTime: false,
  usesSubstrate: true,
  usesGlyphEmitterField: true,
  clipPreviewToText: (state) => state.diffuserComposition === "clipped",
  showTextOverlay: (state) => state.overlayMode !== "hidden" && (state.overlayMode === "warped-outline" || state.diffuserComposition === "behind-text" || state.diffuserComposition === "edge-eroded"),
  textOverlayOpacity: (state) => state.textOverlayOpacity,
  estimateCost: (state) => ({ marks: state.maxNodes, nodes: state.maxNodes, label: `≤ ${state.maxNodes.toLocaleString()} circles` }),
  generateGeometry(state, context) {
    const substrate = context.substrateData;
    const field = context.glyphField ?? buildCompositeWaveField(state, context);
    if (!state.emitter.enabled) {
      return { id: "glyph-diffuser", geometries: [], diagnostics: fallbackDiagnostics("Glyph Diffuser requires an enabled glyph emitter.") };
    }
    if (!substrate || !field) {
      return { id: "glyph-diffuser", geometries: [], diagnostics: fallbackDiagnostics("Glyph Diffuser requires a non-empty substrate.") };
    }
    const started = performance.now();
    const random = createSeededRandom(state.seed);
    const densityRatio = (state.density - 10) / 70;
    const spacing = 24 - densityRatio * 18;
    const jitter = spacing * (0.15 + state.turbulence / 100 * 0.38);
    const haloRadius = state.emitter.radius + (state.diffuserDomain === "inside-text" ? 0 : state.diffuserHaloPadding);
    const samplingState = haloRadius === state.emitter.radius
      ? state
      : { ...state, emitter: { ...state.emitter, radius: haloRadius } };
    const minX = Math.max(0, field.anchor.x - haloRadius);
    const maxX = Math.min(VIEWPORT.width, field.anchor.x + haloRadius);
    const minY = Math.max(0, field.anchor.y - haloRadius);
    const maxY = Math.min(VIEWPORT.height, field.anchor.y + haloRadius);
    const columns = Math.max(1, Math.ceil((maxX - minX) / spacing));
    const rows = Math.max(1, Math.ceil((maxY - minY) / spacing));
    const requestedDots = columns * rows;
    const geometries: CircleMark[] = [];
    let rejectedOutsideMask = 0;
    let rejectedByInfluence = 0;
    let radiusTotal = 0;
    let opacityTotal = 0;
    let minRadius = Infinity;
    let maxRadius = 0;
    let clipped = false;
    let ringStrengthTotal = 0;
    let falloffTotal = 0;
    let fieldSamples = 0;
    let rejectedFarFieldCandidates = 0;
    let acceptedCrestDots = 0;

    outer:
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (geometries.length >= state.maxNodes) {
          clipped = true;
          break outer;
        }
        const x = minX + (column + 0.5) * spacing + (random() * 2 - 1) * jitter;
        const y = minY + (row + 0.5) * spacing + (random() * 2 - 1) * jitter;
        const distance = Math.hypot(x - field.anchor.x, y - field.anchor.y);
        const mask = sampleMask(substrate, x, y);
        const insideText = mask >= 0.5;
        const insideHalo = distance <= haloRadius;
        const domainAccepted = state.diffuserDomain === "inside-text"
          ? insideText
          : state.diffuserDomain === "halo"
            ? insideHalo
            : insideText || insideHalo;
        if (!domainAccepted || (state.diffuserComposition === "clipped" && !insideText)) {
          rejectedOutsideMask += 1;
          continue;
        }

        const contribution = getEmitterContributionAtPoint(samplingState, field.sourceGlyph, field.anchor, x, y);
        const falloff = getFalloffWeight(distance / Math.max(1, haloRadius), state.emitter.falloff);
        const rendererFrequency = state.frequency / 18;
        const wave = Math.abs(Math.sin(distance * state.emitter.frequency * rendererFrequency + state.emitter.phase));
        const bandThreshold = 1 - state.bandWidth;
        const bandPosition = Math.max(0, Math.min(1, (wave - bandThreshold) / Math.max(0.001, state.bandWidth)));
        const ringStrength = Math.pow(bandPosition * bandPosition * (3 - 2 * bandPosition), state.ringSharpness);
        const contributionStrength = Math.min(1, Math.abs(contribution) / Math.max(0.001, state.emitter.amplitude * state.amplitude / 22));
        const ringSignal = Math.min(1, ringStrength * (0.55 + state.diffuserRingContrast * 0.95) + contributionStrength * 0.12);
        ringStrengthTotal += ringStrength;
        falloffTotal += falloff;
        fieldSamples += 1;
        const grain = 0.72 + random() * 0.56;
        const readability = insideText && state.diffuserComposition === "behind-text"
          ? 1 - state.edgeInfluence / 100 * 0.72
          : 1;
        const edge = sampleEdge(substrate, x, y);
        const reactive = state.diffuserComposition === "text-reactive"
          ? 0.35 + Math.min(1, edge * 1.8) * (0.65 + state.edgeInfluence / 100 * 0.55)
          : 1;
        const farField = distance / Math.max(1, haloRadius);
        const falloffShape = Math.pow(falloff, 1.45);
        const acceptance = Math.min(0.98, (0.012 + densityRatio * 0.08 + ringSignal * 0.88) * falloffShape * grain * readability * reactive);
        if (random() > acceptance) {
          rejectedByInfluence += 1;
          if (farField > 0.62) rejectedFarFieldCandidates += 1;
          continue;
        }
        if (ringStrength >= 0.5) acceptedCrestDots += 1;

        const radiusNoise = 0.82 + random() * 0.36;
        const reactiveRadius = state.diffuserComposition === "text-reactive" ? 0.72 + edge * 0.7 : 1;
        const radius = Math.max(0.35, state.diffuserDotRadius * (0.42 + ringSignal * 0.78) * radiusNoise * reactiveRadius);
        const opacity = Math.max(0.18, Math.min(0.94, 0.24 + falloff * 0.34 + ringSignal * 0.34));
        geometries.push({ type: "circle", center: { x, y }, radius, opacity });
        radiusTotal += radius;
        opacityTotal += opacity;
        minRadius = Math.min(minRadius, radius);
        maxRadius = Math.max(maxRadius, radius);
      }
    }

    return {
      id: "glyph-diffuser",
      geometries,
      diagnostics: {
        acceptedCandidates: geometries.length,
        rejectedCandidates: rejectedOutsideMask + rejectedByInfluence,
        averageSampledDistance: 0,
        substrateAvailable: true,
        fallback: false,
        requestedDots,
        acceptedDots: geometries.length,
        rejectedOutsideMask,
        rejectedBySpacing: 0,
        rejectedByInfluence,
        rejectedFarFieldCandidates,
        averageRingStrength: fieldSamples ? ringStrengthTotal / fieldSamples : 0,
        averageFalloff: fieldSamples ? falloffTotal / fieldSamples : 0,
        acceptedCrestDots,
        averageRadius: geometries.length ? radiusTotal / geometries.length : 0,
        minRadius: geometries.length ? minRadius : 0,
        maxRadius,
        averageOpacity: geometries.length ? opacityTotal / geometries.length : 0,
        maxNodesClipped: clipped,
        selectedGlyph: `${field.sourceGlyph.textIndex + 1} · ${field.sourceGlyph.character}`,
        emitterAnchorX: field.anchor.x,
        emitterAnchorY: field.anchor.y,
        emitterSourceMode: state.emitter.sourceMode,
        fieldWidth: field.width,
        fieldHeight: field.height,
        fieldMin: field.min,
        fieldMax: field.max,
        fieldBuildTimeMs: field.buildTimeMs,
        contourExtractionTimeMs: Math.max(0, performance.now() - started),
        fieldMembership: "glyph-bounds-approximate",
        diffuserDomain: state.diffuserDomain,
        diffuserComposition: state.diffuserComposition,
        waveOutputCount: geometries.length,
        warning: clipped ? `Diffuser output clipped at the ${state.maxNodes} node budget.` : undefined,
      },
    };
  },
};
