import { DiffuserAppearancePanel } from "./DiffuserAppearancePanel";
import type { ProjectState } from "../../types";

export function AppearanceControls({ state, setState, parsedFontPathsAvailable }: { state: ProjectState; setState: (state: ProjectState) => void; parsedFontPathsAvailable: boolean }) {
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  return (
    <div className="appearance-stage-content" data-testid="appearance-controls" data-owner="Appearance">
      <div className="control-group appearance-controls">
        <div className="color-control-grid">
          <ColorControl label="Primary" value={state.primaryColor} onChange={(primaryColor) => patch({ primaryColor })} />
          <ColorControl label="Outline" value={state.outlineColor} onChange={(outlineColor) => patch({ outlineColor })} />
          <ColorControl label="Background" value={state.backgroundColor} onChange={(backgroundColor) => patch({ backgroundColor })} />
        </div>
        <label className="debug-toggle"><input type="checkbox" checked={state.transparentBackground} onChange={(event) => patch({ transparentBackground: event.target.checked })} /><span>Transparent background</span></label>
      </div>
      <DiffuserAppearancePanel state={state} setState={setState} parsedFontPathsAvailable={parsedFontPathsAvailable} />
    </div>
  );
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-control"><span>{label}</span><input type="color" value={value} aria-label={`${label} artwork color`} onChange={(event) => onChange(event.target.value)} /><output>{value.toUpperCase()}</output></label>;
}
