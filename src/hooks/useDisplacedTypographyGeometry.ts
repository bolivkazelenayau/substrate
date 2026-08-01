import { useMemo } from "react";
import { interactionTraceEnabled, traceEvent, traceStartSpan } from "../dev/interactionTrace";
import {
  deriveDisplacedTypographyGeometry,
  glyphDisplacementIdentity,
  type DisplacedTypographyGeometry,
} from "../engine/glyphDisplacement";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ProjectState } from "../types";

const resultCache = new Map<string, DisplacedTypographyGeometry>();
const CACHE_LIMIT = 8;

export function useDisplacedTypographyGeometry(
  project: ProjectState,
  sourceGeometry: TextGeometry | null,
  sourceTypographyKey: string,
) {
  const identity = glyphDisplacementIdentity(project, sourceTypographyKey, sourceGeometry);
  return useMemo(() => {
    const cached = identity.active ? resultCache.get(identity.geometryKey) : undefined;
    if (cached) {
      traceEvent({
        stage: "typography.displacement.reused",
        phase: "instant",
        inputKey: identity.displacementKey,
        outputKey: identity.geometryKey,
        counts: { fragments: cached.diagnostics.fragmentCount },
      });
      return cached;
    }

    const endTrace = traceStartSpan("typography.displacement.build", {
      inputKey: interactionTraceEnabled ? identity.displacementKey : undefined,
      detail: { mode: project.glyphDisplacement.mode, active: identity.active },
    });
    const result = deriveDisplacedTypographyGeometry(project, sourceGeometry, sourceTypographyKey);
    if (!result.active) {
      traceEvent({
        stage: "typography.displacement.disabled",
        phase: "instant",
        inputKey: interactionTraceEnabled ? result.displacementKey : undefined,
        outputKey: result.geometryKey,
        detail: { reason: result.diagnostics.inactiveReason ?? null },
      });
    }
    traceEvent({
      stage: "typography.displacement.bounds",
      phase: "instant",
      inputKey: interactionTraceEnabled ? result.displacementKey : undefined,
      outputKey: result.geometryKey,
      counts: {
        fragments: result.diagnostics.fragmentCount,
        sourceContourPoints: result.diagnostics.sourceContourPoints,
      },
      detail: {
        inkBounds: result.inkBounds
          ? `${result.inkBounds.x},${result.inkBounds.y},${result.inkBounds.width},${result.inkBounds.height}`
          : null,
        clippingStatus: result.diagnostics.clippingStatus,
      },
    });
    endTrace({
      outputKey: result.geometryKey,
      counts: {
        fragments: result.diagnostics.fragmentCount,
        sourceContourPoints: result.diagnostics.sourceContourPoints,
        clippingOperations: result.diagnostics.clippingOperations,
      },
      detail: {
        active: result.active,
        exact: result.exact,
        buildDurationMs: result.diagnostics.buildDurationMs,
        peakTemporaryArrays: result.diagnostics.peakTemporaryArrays,
        clippingStatus: result.diagnostics.clippingStatus,
      },
    });
    if (result.active) {
      resultCache.set(result.geometryKey, result);
      if (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value!);
    }
    return result;
    // The semantic identity includes every consumed geometry input. Trace state
    // is deliberately absent and cannot affect memoization or output identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.displacementKey, identity.geometryKey, identity.active, sourceGeometry, sourceTypographyKey]);
}

export function clearDisplacedTypographyGeometryCache() {
  resultCache.clear();
}
