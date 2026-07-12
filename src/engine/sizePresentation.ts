import type { SizeDraftPolicy } from "./sizeRendererDraftPolicy";
import type { SizeInteractionState } from "../hooks/useSizeInteraction";

export type SizePresentation =
  | { kind: "exact" }
  | { kind: "draft"; gestureId: number; policy: SizeDraftPolicy }
  | { kind: "retained"; gestureId: number };

export function resolveSizePresentation(
  interaction: SizeInteractionState,
  exactReady: boolean,
): SizePresentation {
  if (interaction.phase === "idle") return { kind: "exact" };
  if (interaction.phase === "dragging") {
    return { kind: "draft", gestureId: interaction.gestureId, policy: interaction.draftPolicy };
  }
  if (exactReady) return { kind: "exact" };
  return { kind: "retained", gestureId: interaction.gestureId };
}

export function sizeDisplayFontSize(interaction: SizeInteractionState): number {
  switch (interaction.phase) {
    case "idle":
      return interaction.presentedSize;
    case "dragging":
      return interaction.draftSize;
    case "settling":
      return interaction.committedSize;
  }
}

export function sizeIsInteracting(interaction: SizeInteractionState): boolean {
  return interaction.phase !== "idle";
}