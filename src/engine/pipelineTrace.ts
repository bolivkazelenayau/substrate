import { interactionTraceEnabled, traceEvent } from "../dev/interactionTrace";
import type { RendererRequirements } from "./rendererRequirements";

export function tracePipelineRequirements(rendererId: string, requirements: RendererRequirements) {
  if (!interactionTraceEnabled) return;
  traceEvent({
    stage: "pipeline.requirements.resolve",
    phase: "instant",
    detail: {
      rendererId,
      typography: requirements.typography,
      scene: requirements.scene,
      substrate: requirements.substrate,
      staticField: requirements.staticField,
      glyphField: requirements.glyphField,
      occupancy: requirements.occupancy,
      animationTime: requirements.animationTime,
    },
  });
}

export function tracePipelineStage(
  stage: string,
  disposition: "required" | "skipped" | "reused" | "invalidated",
  detail: Record<string, string | number | boolean | null> = {},
) {
  if (!interactionTraceEnabled) return;
  traceEvent({
    stage: `pipeline.stage.${disposition}`,
    phase: "instant",
    detail: { stage, ...detail },
  });
  if (disposition === "invalidated" && detail.reason) {
    traceEvent({
      stage: "pipeline.stage.invalidationReason",
      phase: "instant",
      detail: { stage, reason: detail.reason },
    });
  }
}

export function traceDuplicateLiveRendererPrevented(inputKey: string) {
  if (!interactionTraceEnabled) return;
  traceEvent({
    stage: "renderer.live.duplicatePrevented",
    phase: "instant",
    inputKey,
  });
}