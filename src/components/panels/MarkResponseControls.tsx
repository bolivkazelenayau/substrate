import { getControlActivity } from "../../engine/controlOwnership";
import type { ProjectState } from "../../types";
import { EmitterDisplayResponseControls } from "./EmitterControls";
import { EmitterMicroResponseControls } from "./EmitterMicroResponseControls";
import { GlyphFalloffDisplacementControls } from "./GlyphFalloffDisplacementControls";

export function MarkResponseControls({ state, setState, parsedFontPathsAvailable, openState, toggle }: { state: ProjectState; setState: (state: ProjectState) => void; parsedFontPathsAvailable: boolean; openState: Record<string, boolean>; toggle: (id: string) => void }) {
  const activity = getControlActivity(state, parsedFontPathsAvailable);
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const patchDisplay = (next: Partial<ProjectState["emitterDisplay"]>) => patch({ emitterDisplay: { ...state.emitterDisplay, ...next } });
  return (
    <>
      <EmitterDisplayResponseControls state={state} supported={activity.emitterDisplay} patchDisplay={patchDisplay} open={openState.emitterDisplay} onToggle={() => toggle("emitterDisplay")} />
      <EmitterMicroResponseControls state={state} setState={setState} supported={activity.emitterMicroResponse} capability={activity.emitterMicroResponseCapability} open={openState.microResponse} onToggle={() => toggle("microResponse")} />
      <GlyphFalloffDisplacementControls state={state} setState={setState} supported={activity.glyphFalloffDisplacement} capability={activity.glyphFalloffDisplacementCapability} open={openState.glyphFalloff} onToggle={() => toggle("glyphFalloff")} />
    </>
  );
}
