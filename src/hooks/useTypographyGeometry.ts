import { useMemo } from "react";
import type { LoadedFont } from "../engine/fontLoader";
import { layoutGlyphs } from "../engine/glyphLayout";
import { measure } from "../engine/performance";
import { typographyStageKey } from "../engine/pipelineStageKeys";
import type { ProjectState } from "../types";
import { interactionTraceEnabled, traceEvent, traceKey, traceStartSpan } from "../dev/interactionTrace";

export function useTypographyGeometry(project: ProjectState, loadedFont: LoadedFont | null) {
  const fontResourceKey = loadedFont?.fingerprint ?? "native-fallback";
  // Semantic identity for memoization: must always be computed, never gated
  // behind `interactionTraceEnabled`. The previous trace-only key collapsed to
  // `undefined` in production builds, so `fontSize` changes were ignored and
  // parsed-font glyph geometry became stale.
  const typographyKey = typographyStageKey(project, fontResourceKey);
  const traceInputKey = interactionTraceEnabled
    ? traceKey({
        text: project.text,
        font: fontResourceKey,
        fontSize: project.fontSize,
        lineHeight: project.lineHeight,
        tracking: project.tracking,
        textAlign: project.textAlign,
        textOffsetY: project.textOffsetY,
        artboard: project.artboard,
      })
    : undefined;
  return useMemo(
    () => {
      const endTrace = traceStartSpan("typography.build", {
        inputKey: traceInputKey,
        detail: { fontPath: loadedFont ? "parsed-font" : "native-fallback" },
      });
      const timed = measure(() => loadedFont ? layoutGlyphs(project, loadedFont) : null);
      const outputKey = interactionTraceEnabled && timed.value ? traceKey({ inputKey: traceInputKey, geometry: timed.value.bounds ?? null }) : traceInputKey;
      endTrace({
        outputKey,
        counts: timed.value ? { glyphs: timed.value.glyphs.length } : { glyphs: 0 },
        detail: {
          fontPath: loadedFont ? "parsed-font" : "native-fallback",
          hasOutlines: Boolean(timed.value?.hasOutlines),
          bounds: timed.value?.bounds ? `${timed.value.bounds.x},${timed.value.bounds.y},${timed.value.bounds.width},${timed.value.bounds.height}` : null,
        },
      });
      return timed;
    },
    // Typography rebuilds only when the focused typography input key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typographyKey, loadedFont],
  );
}
