import { useMemo } from "react";
import { interactionTraceEnabled, traceEvent, traceStartSpan } from "../dev/interactionTrace";
import {
  deriveGlyphCalmWaterGeometry,
  glyphCalmWaterIdentity,
  type GlyphCalmWaterGeometry,
} from "../engine/glyphCalmWater";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ProjectState } from "../types";

const resultCache = new Map<string, GlyphCalmWaterGeometry>();
const CACHE_LIMIT = 8;

export function useGlyphCalmWaterGeometry(
  project: ProjectState,
  sourceGeometry: TextGeometry | null,
  sourceTypographyKey: string,
) {
  const identity = glyphCalmWaterIdentity(project, sourceTypographyKey, sourceGeometry);
  return useMemo(() => {
    const cached = identity.active ? resultCache.get(identity.geometryKey) : undefined;
    if (cached) {
      traceEvent({
        stage: "typography.calm-water.reused",
        phase: "instant",
        inputKey: identity.waterKey,
        outputKey: identity.geometryKey,
        counts: { contourPoints: cached.diagnostics.deformedPointCount },
      });
      return cached;
    }
    const endTrace = traceStartSpan("typography.calm-water.build", {
      inputKey: interactionTraceEnabled ? identity.waterKey : undefined,
      detail: { active: identity.active },
    });
    const result = deriveGlyphCalmWaterGeometry(project, sourceGeometry, sourceTypographyKey);
    if (!result.active) {
      traceEvent({
        stage: "typography.calm-water.disabled",
        phase: "instant",
        inputKey: interactionTraceEnabled ? result.waterKey : undefined,
        outputKey: result.geometryKey,
        detail: { reason: result.diagnostics.inactiveReason ?? null },
      });
    }
    endTrace({
      outputKey: result.geometryKey,
      counts: {
        sourcePoints: result.diagnostics.sourcePointCount,
        deformedPoints: result.diagnostics.deformedPointCount,
        affectedPoints: result.diagnostics.affectedPointCount,
      },
      detail: {
        active: result.active,
        buildDurationMs: result.diagnostics.buildDurationMs,
        maxDisplacement: result.diagnostics.maxDisplacement,
        safetyStatus: result.diagnostics.safetyStatus,
      },
    });
    if (result.active) {
      resultCache.set(result.geometryKey, result);
      if (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value!);
    }
    return result;
    // The focused identity excludes camera, preview, diagnostics, trace, and
    // every mark-space control by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.waterKey, identity.geometryKey, identity.active, sourceGeometry, sourceTypographyKey]);
}

export function clearGlyphCalmWaterGeometryCache() {
  resultCache.clear();
}
