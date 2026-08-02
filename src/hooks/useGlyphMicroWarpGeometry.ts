import { useMemo } from "react";
import { interactionTraceEnabled, traceEvent, traceStartSpan } from "../dev/interactionTrace";
import {
  deriveGlyphMicroWarpGeometry,
  glyphMicroWarpIdentity,
  type GlyphMicroWarpGeometry,
} from "../engine/glyphMicroWarp";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ProjectState } from "../types";

const resultCache = new Map<string, GlyphMicroWarpGeometry>();
const CACHE_LIMIT = 8;

export function useGlyphMicroWarpGeometry(
  project: ProjectState,
  sourceGeometry: TextGeometry | null,
  sourceTypographyKey: string,
) {
  const identity = glyphMicroWarpIdentity(project, sourceTypographyKey, sourceGeometry);
  return useMemo(() => {
    const cached = identity.active ? resultCache.get(identity.geometryKey) : undefined;
    if (cached) {
      traceEvent({
        stage: "typography.micro-warp.reused",
        phase: "instant",
        inputKey: identity.warpKey,
        outputKey: identity.geometryKey,
        counts: { contourPoints: cached.diagnostics.warpedPointCount },
      });
      return cached;
    }
    const endTrace = traceStartSpan("typography.micro-warp.build", {
      inputKey: interactionTraceEnabled ? identity.warpKey : undefined,
      detail: { active: identity.active },
    });
    const result = deriveGlyphMicroWarpGeometry(project, sourceGeometry, sourceTypographyKey);
    if (!result.active) {
      traceEvent({
        stage: "typography.micro-warp.disabled",
        phase: "instant",
        inputKey: interactionTraceEnabled ? result.warpKey : undefined,
        outputKey: result.geometryKey,
        detail: { reason: result.diagnostics.inactiveReason ?? null },
      });
    }
    endTrace({
      outputKey: result.geometryKey,
      counts: {
        sourcePoints: result.diagnostics.sourcePointCount,
        warpedPoints: result.diagnostics.warpedPointCount,
        affectedPoints: result.diagnostics.affectedPointCount,
      },
      detail: {
        active: result.active,
        buildDurationMs: result.diagnostics.buildDurationMs,
        safetyStatus: result.diagnostics.safetyStatus,
      },
    });
    if (result.active) {
      resultCache.set(result.geometryKey, result);
      if (resultCache.size > CACHE_LIMIT) resultCache.delete(resultCache.keys().next().value!);
    }
    return result;
    // Trace state, camera, diagnostics, backend, and mark-space controls are
    // absent from the focused semantic identity by construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity.warpKey, identity.geometryKey, identity.active, sourceGeometry, sourceTypographyKey]);
}

export function clearGlyphMicroWarpGeometryCache() {
  resultCache.clear();
}
