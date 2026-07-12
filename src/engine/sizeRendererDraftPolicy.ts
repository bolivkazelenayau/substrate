import type { RendererId } from "../types";

export type SizeDraftPolicy = "renderer-aware" | "retained-transform";

/** Preview-only node budget for lightweight renderer-aware drafts. */
export const SIZE_DRAFT_RENDERER_MAX_NODES = 250;

const RENDERER_AWARE_DRAFT: ReadonlySet<RendererId> = new Set([
  "flow",
  "ripple",
  "dots",
]);

export function sizeDraftPolicy(rendererId: RendererId): SizeDraftPolicy {
  return RENDERER_AWARE_DRAFT.has(rendererId) ? "renderer-aware" : "retained-transform";
}