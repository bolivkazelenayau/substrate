import { useEffect, useState } from "react";
import { buildCompositeWaveField, type CompositeWaveField } from "../engine/field/compositeWaveField";
import type { ProjectState, RenderContext } from "../types";
import { planSubstrateRaster } from "../engine/safetyBudget";

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
    const plan = planSubstrateRaster({ requestedWidth: field.width, requestedHeight: field.height });
    const canvas = document.createElement("canvas");
    canvas.width = plan.width;
    canvas.height = plan.height;
    const drawing = canvas.getContext("2d");
    if (!drawing) return;
    const image = drawing.createImageData(plan.width, plan.height);
    const maximum = Math.max(Math.abs(field.min), Math.abs(field.max), 0.0001);
    const data = field.data;
    for (let y = 0; y < plan.height; y += 1) for (let x = 0; x < plan.width; x += 1) {
      const index = Math.min(field.height - 1, Math.floor(y * field.height / plan.height)) * field.width + Math.min(field.width - 1, Math.floor(x * field.width / plan.width));
      const outputIndex = y * plan.width + x;
      const normalized = data[index] / maximum;
      image.data[outputIndex * 4] = normalized < 0 ? Math.round(-normalized * 255) : 20;
      image.data[outputIndex * 4 + 1] = normalized > 0 ? Math.round(normalized * 220) : 30;
      image.data[outputIndex * 4 + 2] = normalized > 0 ? 255 : Math.round(-normalized * 150);
      image.data[outputIndex * 4 + 3] = Math.abs(normalized) > 0.01 ? 210 : 0;
    }
    drawing.putImageData(image, 0, 0);
    setUrl(canvas.toDataURL("image/png"));
  }, [context, enabled, state]);
  return url;
}
