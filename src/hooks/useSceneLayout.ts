import { useMemo } from "react";
import {
  resolveSceneLayout,
  sceneLayoutKey,
  type ResolvedSceneLayout,
} from "../engine/sceneLayout";
import { sceneLayoutStageKey } from "../engine/pipelineStageKeys";
import { interactionTraceEnabled, traceEvent, traceKey, traceStartSpan } from "../dev/interactionTrace";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ProjectState } from "../types";

/**
 * Memoized production scene resolver. Pure: never writes to `ProjectState`.
 *
 * The scene resolver is the single authority for:
 *   - canonical typography placement (centered on the authored artboard
 *     center plus the user-authored `textOffsetY` displacement);
 *   - the effective scene artboard rect (symmetric growth around the
 *     authored center, never persisted);
 *   - the scene identity key consumed by substrate, renderers, diagnostics,
 *     preview, and export.
 *
 * Replaces the previous `useAutoGrowArtboard` hook, which mutated the
 * persisted document with one-way artboard-growth and `textOffsetY` repair
 * writes. No automatic document repair happens here or anywhere downstream.
 */
export function useSceneLayout(
  project: ProjectState,
  textGeometry: TextGeometry | null,
): ResolvedSceneLayout {
  const sceneInputKey = sceneLayoutStageKey(project, textGeometry);
  return useMemo(() => {
    const inputKey = interactionTraceEnabled ? sceneInputKey : undefined;
    const resolveTrace = traceStartSpan("scene.layout", {
      inputKey,
      detail: { authority: "resolved-scene" },
    });
    const layout = resolveSceneLayout(project, textGeometry);
    resolveTrace({
      outputKey: layout.key,
      counts: {
        effectiveWidth: layout.effectiveArtboard.width,
        effectiveHeight: layout.effectiveArtboard.height,
      },
      detail: {
        effectiveX: layout.effectiveArtboard.x,
        effectiveY: layout.effectiveArtboard.y,
        expandedX: layout.expandedX,
        expandedY: layout.expandedY,
        canonicalBaseline: layout.typography.canonicalBaseline,
        resolvedBaseline: layout.typography.resolvedBaseline,
        authoredOffsetY: layout.typography.authoredOffset.y,
        layoutBounds: `${layout.typography.layoutBounds.x},${layout.typography.layoutBounds.y},${layout.typography.layoutBounds.width},${layout.typography.layoutBounds.height}`,
        inkBounds: `${layout.typography.inkBounds.x},${layout.typography.inkBounds.y},${layout.typography.inkBounds.width},${layout.typography.inkBounds.height}`,
      },
    });
    traceEvent({
      stage: "scene.layout",
      phase: "instant",
      inputKey,
      outputKey: layout.key,
      counts: {
        effectiveWidth: layout.effectiveArtboard.width,
        effectiveHeight: layout.effectiveArtboard.height,
      },
      detail: {
        effectiveX: layout.effectiveArtboard.x,
        effectiveY: layout.effectiveArtboard.y,
        expandedX: layout.expandedX,
        expandedY: layout.expandedY,
      },
    });
    return layout;
  }, [sceneInputKey, textGeometry]);
}

export { sceneLayoutKey };