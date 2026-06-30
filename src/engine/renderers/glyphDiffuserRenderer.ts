import { VIEWPORT } from "../constants";
import { buildCompositeWaveField, getEmitterContributionAtPoint, getFalloffWeight, sampleGlyphField } from "../field/compositeWaveField";
import type { CircleMark, RendererDiagnostics } from "../geometry";
import { createSeededRandom } from "../random";
import { sampleEdge, sampleMask } from "../substrate";
import type { VectorRenderer } from "./types";
import type { ProjectState } from "../../types";

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

function zeroStrengthDiagnostics(state: ProjectState): RendererDiagnostics {
  const enabledRows = state.emitterMode === "multiple"
    ? state.emitters.filter((row) => row.enabled)
    : [];
  return {
    ...fallbackDiagnostics("Glyph Diffuser has no positive-strength emitter contribution."),
    substrateAvailable: true,
    fallback: false,
    rendererActiveFieldEmitterCount: 0,
    activeContributingEmitterCount: 0,
    zeroStrengthEmitterCount: state.emitterMode === "single" ? 1 : enabledRows.length,
    artboardBoundsClipped: false,
    artboardEdgeFeather: 0,
    renderedMarkCountPerEmitter: state.emitterMode === "single"
      ? { [state.emitter.id]: 0 }
      : Object.fromEntries(enabledRows.map((row) => [row.id, 0])),
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
    const zeroStrengthCount = state.emitterMode === "single"
      ? Number(state.emitter.amplitude <= 0)
      : state.emitters.filter((row) => row.enabled && (state.emitter.amplitude <= 0 || row.weight <= 0)).length;
    if (state.emitter.amplitude <= 0
      || (state.emitterMode === "multiple" && !state.emitters.some((row) => row.enabled && row.weight > 0))) {
      return { id: "glyph-diffuser", geometries: [], diagnostics: zeroStrengthDiagnostics(state) };
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
    const sourceDomains = field.sources.map((source) => ({
      source,
      radius: haloRadius * source.radiusMultiplier,
    }));
    const artboardBoundsClipped = sourceDomains.some(({ source, radius }) =>
      source.anchor.x - radius < 0
      || source.anchor.y - radius < 0
      || source.anchor.x + radius > VIEWPORT.width
      || source.anchor.y + radius > VIEWPORT.height);
    const artboardEdgeFeather = artboardBoundsClipped ? 56 : 0;
    const multiple = state.emitterMode === "multiple";
    // Multiple mode uses an artboard-anchored lattice. Union bounds are only
    // an acceptance mask; they must not shift every candidate when one row's
    // radius changes. Single mode retains the legacy anchor-relative lattice.
    const minX = multiple ? 0 : Math.max(0, field.anchor.x - haloRadius);
    const maxX = multiple ? VIEWPORT.width : Math.min(VIEWPORT.width, field.anchor.x + haloRadius);
    const minY = multiple ? 0 : Math.max(0, field.anchor.y - haloRadius);
    const maxY = multiple ? VIEWPORT.height : Math.min(VIEWPORT.height, field.anchor.y + haloRadius);
    const columns = Math.max(1, Math.ceil((maxX - minX) / spacing));
    const rows = Math.max(1, Math.ceil((maxY - minY) / spacing));
    const requestedDots = columns * rows;
    const acceptedPool: Array<{
      geometry: CircleMark;
      emitterId: string;
      crest: boolean;
      priority: number;
    }> = [];
    
    const rendererFrequency = state.frequency / 18;
    const waveFrequency = state.emitter.frequency * rendererFrequency;
    const bandThreshold = 1 - state.bandWidth;
    const invBandWidth = 1 / Math.max(0.001, state.bandWidth);
    const invContributionDivisor = 1 / Math.max(0.001, state.emitter.amplitude * state.amplitude / 22);
    const ringContrastFactor = 0.55 + state.diffuserRingContrast * 0.95;
    const readabilityFactor = 1 - state.edgeInfluence / 100 * 0.72;
    const reactiveBase = 0.35;
    const reactiveScale = 0.65 + state.edgeInfluence / 100 * 0.55;
    const densityAcceptanceBase = 0.012 + densityRatio * 0.08;

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
    const renderedMarkCountPerEmitter: Record<string, number> = state.emitterMode === "multiple"
      ? Object.fromEntries(state.emitters.filter((row) => row.enabled).map((row) => [row.id, 0]))
      : { [state.emitter.id]: 0 };
    const sampleCountPerEmitter: Record<string, number> = Object.fromEntries(
      field.sources.map((source) => [source.id, 0]),
    );

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = minX + (column + 0.5) * spacing + (random() * 2 - 1) * jitter;
        const y = minY + (row + 0.5) * spacing + (random() * 2 - 1) * jitter;
        // Consume a fixed random budget per multi-emitter candidate. A row
        // changing acceptance must not perturb random values in another row's
        // standalone region.
        const fixedGrain = multiple ? 0.72 + random() * 0.56 : 0;
        const fixedAcceptanceRoll = multiple ? random() : 0;
        const fixedRadiusNoise = multiple ? 0.82 + random() * 0.36 : 0;
        if (x < 0 || x > VIEWPORT.width || y < 0 || y > VIEWPORT.height) continue;
        let nearestDomain = sourceDomains[0];
        let distance = Math.hypot(x - nearestDomain.source.anchor.x, y - nearestDomain.source.anchor.y);
        let normalizedDistance = distance / Math.max(1, nearestDomain.radius);
        if (normalizedDistance <= 1) sampleCountPerEmitter[nearestDomain.source.id] += 1;
        for (let index = 1; index < sourceDomains.length; index += 1) {
          const candidate = sourceDomains[index];
          const candidateDistance = Math.hypot(x - candidate.source.anchor.x, y - candidate.source.anchor.y);
          const candidateNormalized = candidateDistance / Math.max(1, candidate.radius);
          if (candidateNormalized <= 1) sampleCountPerEmitter[candidate.source.id] += 1;
          if (candidateNormalized < normalizedDistance) {
            nearestDomain = candidate;
            distance = candidateDistance;
            normalizedDistance = candidateNormalized;
          }
        }
        const mask = sampleMask(substrate, x, y);
        const insideText = mask >= 0.5;
        const insideHalo = normalizedDistance <= 1;
        const domainAccepted = state.diffuserDomain === "inside-text"
          ? insideText
          : state.diffuserDomain === "halo"
            ? insideHalo
            : insideText || insideHalo;
        if (!domainAccepted || (state.diffuserComposition === "clipped" && !insideText)) {
          rejectedOutsideMask += 1;
          continue;
        }

        const contribution = state.emitterMode === "single"
          ? getEmitterContributionAtPoint(samplingState, field.sourceGlyph, field.anchor, x, y)
          : sampleGlyphField(field, x, y);
        const farField = normalizedDistance;
        const falloff = getFalloffWeight(farField, state.emitter.falloff);
        const wave = Math.abs(Math.sin(
          distance * waveFrequency + state.emitter.phase + nearestDomain.source.phaseOffset,
        ));
        const bandPosition = Math.max(0, Math.min(1, (wave - bandThreshold) * invBandWidth));
        const ringStrength = Math.pow(bandPosition * bandPosition * (3 - 2 * bandPosition), state.ringSharpness);
        const contributionStrength = Math.min(1, Math.abs(contribution) * invContributionDivisor);
        const ringSignal = Math.min(1, ringStrength * ringContrastFactor + contributionStrength * 0.12);
        ringStrengthTotal += ringStrength;
        falloffTotal += falloff;
        fieldSamples += 1;
        const grain = multiple ? fixedGrain : 0.72 + random() * 0.56;
        const readability = insideText && state.diffuserComposition === "behind-text" ? readabilityFactor : 1;
        const edge = sampleEdge(substrate, x, y);
        const reactive = state.diffuserComposition === "text-reactive"
          ? reactiveBase + Math.min(1, edge * 1.8) * reactiveScale
          : 1;
        const edgeDistance = Math.min(x, VIEWPORT.width - x, y, VIEWPORT.height - y);
        const edgeT = artboardEdgeFeather
          ? Math.max(0, Math.min(1, edgeDistance / artboardEdgeFeather))
          : 1;
        const edgeFeather = edgeT * edgeT * (3 - 2 * edgeT);
        const falloffShape = Math.pow(falloff, 1.45);
        const acceptance = Math.min(0.98, (densityAcceptanceBase + ringSignal * 0.88) * falloffShape * grain * readability * reactive * edgeFeather);
        const acceptanceRoll = multiple ? fixedAcceptanceRoll : random();
        if (acceptance <= 1e-6) {
          rejectedByInfluence += 1;
          if (farField > 0.62) rejectedFarFieldCandidates += 1;
          continue;
        }
        const radiusNoise = multiple ? fixedRadiusNoise : 0.82 + random() * 0.36;
        const reactiveRadius = state.diffuserComposition === "text-reactive" ? 0.72 + edge * 0.7 : 1;
        const radius = Math.max(0.35, state.diffuserDotRadius * (0.42 + ringSignal * 0.78) * radiusNoise * reactiveRadius);
        const opacity = Math.max(0, Math.min(0.94, (0.24 + falloff * 0.34 + ringSignal * 0.34) * edgeFeather));
        const coordinatePriority = Math.abs(Math.sin(
          x * 12.9898 + y * 78.233 + state.seed * 0.001,
        ));
        acceptedPool.push({
          geometry: { type: "circle", center: { x, y }, radius, opacity },
          emitterId: nearestDomain.source.id,
          crest: ringStrength >= 0.5,
          priority: acceptance * (0.5 + acceptanceRoll * 0.35 + coordinatePriority * 0.15),
        });
      }
    }

    // Density owns the normal-strength amount; radius owns spatial distribution.
    // Strength scales a per-emitter quota so low-strength rows stay subtle and
    // cannot displace another emitter unless the explicit global node cap applies.
    const densityMarkBudget = Math.max(1, Math.round(state.density * 6));
    const strengthByEmitter = new Map(field.sources.map((source) => [
      source.id,
      Math.max(0, state.emitter.amplitude * source.weight),
    ]));
    const emitterBudgets = new Map([...strengthByEmitter].map(([id, strength]) => [
      id,
      Math.max(0, Math.round(densityMarkBudget * Math.pow(strength, 0.85))),
    ]));
    const selectedByEmitter = field.sources.flatMap((source) => {
      const budget = emitterBudgets.get(source.id) ?? 0;
      return acceptedPool
        .filter((candidate) => candidate.emitterId === source.id)
        .sort((a, b) => b.priority - a.priority)
        .slice(0, budget);
    });
    const selected = selectedByEmitter.length > state.maxNodes
      ? [...selectedByEmitter].sort((a, b) => b.priority - a.priority).slice(0, state.maxNodes)
      : selectedByEmitter;
    const geometries = selected.map((candidate) => candidate.geometry);
    for (const id of Object.keys(renderedMarkCountPerEmitter)) renderedMarkCountPerEmitter[id] = 0;
    radiusTotal = 0;
    opacityTotal = 0;
    minRadius = Infinity;
    maxRadius = 0;
    acceptedCrestDots = 0;
    for (const candidate of selected) {
      renderedMarkCountPerEmitter[candidate.emitterId] += 1;
      radiusTotal += candidate.geometry.radius;
      opacityTotal += candidate.geometry.opacity;
      minRadius = Math.min(minRadius, candidate.geometry.radius);
      maxRadius = Math.max(maxRadius, candidate.geometry.radius);
      if (candidate.crest) acceptedCrestDots += 1;
    }
    clipped = selectedByEmitter.length > state.maxNodes;
    const cappedCount = Math.max(0, acceptedPool.length - geometries.length);
    const effectiveStrengthResponse = field.sources.length
      ? field.sources.reduce((sum, source) => sum + Math.pow(strengthByEmitter.get(source.id) ?? 0, 0.85), 0)
        / field.sources.length
      : 0;

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
        candidateCount: requestedDots,
        preCapAcceptedCount: acceptedPool.length,
        cappedCount,
        effectiveDensity: requestedDots ? geometries.length / requestedDots : 0,
        effectiveStrengthResponse,
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
        rendererActiveFieldEmitterCount: field.sources.length,
        activeContributingEmitterCount: field.sources.length,
        zeroStrengthEmitterCount: zeroStrengthCount,
        consumedFieldMode: field.compositionMode,
        renderedMarkCountPerEmitter,
        fieldNormalizationMode: field.normalizationMode,
        artboardBoundsClipped,
        artboardEdgeFeather,
        emitterDomainDiagnostics: sourceDomains.map(({ source, radius }) => ({
          id: source.id,
          anchorX: source.anchor.x,
          anchorY: source.anchor.y,
          weight: source.weight,
          effectiveStrength: state.emitter.amplitude * source.weight,
          radiusMultiplier: source.radiusMultiplier,
          effectiveRadius: state.emitter.radius * source.radiusMultiplier,
          samplingRadius: radius,
          bounds: {
            minX: Math.max(0, source.anchor.x - radius),
            minY: Math.max(0, source.anchor.y - radius),
            maxX: Math.min(VIEWPORT.width, source.anchor.x + radius),
            maxY: Math.min(VIEWPORT.height, source.anchor.y + radius),
          },
          sampleCount: sampleCountPerEmitter[source.id],
          renderedMarkCount: renderedMarkCountPerEmitter[source.id],
        })),
        waveOutputCount: geometries.length,
        warning: [
          artboardBoundsClipped
            ? `Emitter sampling exceeds the ${VIEWPORT.width}×${VIEWPORT.height} artboard; output is intentionally edge-feathered and clipped to export bounds.`
            : "",
          clipped ? `Diffuser output clipped at the ${state.maxNodes} node budget.` : "",
        ].filter(Boolean).join(" ") || undefined,
      },
    };
  },
};
