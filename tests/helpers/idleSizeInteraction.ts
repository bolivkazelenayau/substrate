import type { SizeInteractionState } from "../../src/hooks/useSizeInteraction";

export function idleSizeInteraction(committedFontSize: number): SizeInteractionState {
  return { phase: "idle", presentedSize: committedFontSize };
}