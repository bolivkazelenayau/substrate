import type { TextGeometry } from "./glyphGeometry";
import { resolveSceneLayout, type ResolvedSceneLayout } from "./sceneLayout";
import type { ProjectState } from "../types";

/** Ephemeral draft scene: production authority only, never persisted. */
export function resolveSizeDraftSceneLayout(
  committedState: ProjectState,
  draftFontSize: number,
  textGeometry: TextGeometry | null,
): ResolvedSceneLayout {
  if (draftFontSize === committedState.fontSize) {
    return resolveSceneLayout(committedState, textGeometry);
  }
  return resolveSceneLayout({ ...committedState, fontSize: draftFontSize }, textGeometry);
}