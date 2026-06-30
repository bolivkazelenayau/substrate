import { useEffect, useState } from "react";
import { buildCompositeWaveField, type CompositeWaveField } from "../engine/field/compositeWaveField";
import type { ProjectState, RenderContext } from "../types";

// Renders a preview-only data URL of the composite glyph wave field.
// Prefers the shared `RenderContext.glyphField` built by `App` so the field is
// not rebuilt just to colour-map it; falls back to `buildCompositeWaveField`
// for tests and non-App callers that supply a context without the shared field.
export function useWaveFieldDebugImage(state: ProjectState, context: RenderContext, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setUrl(null);
      return;
    }
    const field: CompositeWaveField | null = context.glyphField ?? buildCompositeWaveField(state, context);
    if (!field) {
      setUrl(null);
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = field.width;
    canvas.height = field.height;
    const drawing = canvas.getContext("2d");
    if (!drawing) return;
    const image = drawing.createImageData(field.width, field.height);
    const maximum = Math.max(Math.abs(field.min), Math.abs(field.max), 0.0001);
    const data = field.data;
    for (let index = 0; index < data.length; index += 1) {
      const normalized = data[index] / maximum;
      image.data[index * 4] = normalized < 0 ? Math.round(-normalized * 255) : 20;
      image.data[index * 4 + 1] = normalized > 0 ? Math.round(normalized * 220) : 30;
      image.data[index * 4 + 2] = normalized > 0 ? 255 : Math.round(-normalized * 150);
      image.data[index * 4 + 3] = Math.abs(normalized) > 0.01 ? 210 : 0;
    }
    drawing.putImageData(image, 0, 0);
    setUrl(canvas.toDataURL("image/png"));
  }, [context, enabled, state]);
  return url;
}
