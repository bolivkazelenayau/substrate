import { useMemo } from "react";
import type { LoadedFont } from "../engine/fontLoader";
import { layoutGlyphs } from "../engine/glyphLayout";
import { measure } from "../engine/performance";
import type { ProjectState } from "../types";
import { interactionTraceEnabled, traceEvent, traceKey, traceStartSpan } from "../dev/interactionTrace";

export function useTypographyGeometry(project: ProjectState, loadedFont: LoadedFont | null) {
  const inputKey = interactionTraceEnabled
    ? traceKey({
        text: project.text,
        font: loadedFont?.fingerprint ?? "native-fallback",
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
        inputKey,
        detail: { fontPath: loadedFont ? "parsed-font" : "native-fallback" },
      });
      const timed = measure(() => loadedFont ? layoutGlyphs(project, loadedFont) : null);
      const outputKey = interactionTraceEnabled && timed.value ? traceKey({ inputKey, geometry: timed.value.bounds ?? null }) : inputKey;
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
    [inputKey, loadedFont],
  );
}
