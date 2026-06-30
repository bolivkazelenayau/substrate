import { baseState } from "../../engine/presets";
import { getControlActivity } from "../../engine/controlOwnership";
import type { ProjectState } from "../../types";

interface AdvancedFieldPanelProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
}

const advancedDefaults: Record<string, number> = {
  "Max nodes / marks": baseState.maxNodes,
  "Ring contrast": baseState.diffuserRingContrast,
  "Ring sharpness": baseState.ringSharpness,
  "Band width": baseState.bandWidth,
  "Halo padding": baseState.diffuserHaloPadding,
  Influence: baseState.glyphFieldInfluence,
  Displacement: baseState.glyphFieldDisplacement,
  "Density modulation": baseState.glyphFieldDensity,
  "Radius modulation": baseState.glyphFieldRadius,
  "Opacity modulation": baseState.glyphFieldOpacity,
  "Dot spacing": baseState.waveDotSpacing,
  "Dot radius": baseState.waveDotRadius,
};

export function AdvancedFieldPanel({ state, setState, parsedFontPathsAvailable, open, onToggle }: AdvancedFieldPanelProps) {
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const activity = getControlActivity(state, parsedFontPathsAvailable);
  const glyphModulationEnabled = activity.glyphModulation && state.glyphFieldMode !== "off";

  return (
    <section className="control-section">
      <div className="section-heading"><span>{state.renderer === "glyph-diffuser" ? "04" : "03"}</span><h2>Advanced</h2></div>
      <div className="control-group accordion-group">
        <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
          <span>{open ? "▼" : "▶"}</span> Advanced Parameters
        </button>
        {open && (
          <div className="accordion-content">
            <Range label="Max nodes / marks" value={state.maxNodes} min={400} max={5000} step={100} onChange={(maxNodes) => patchField({ maxNodes })} />
            {state.renderer === "glyph-diffuser" && (
              <div className="control-group nested-group">
                <div className="section-subheading">Diffuser Detail</div>
                <Range label="Ring contrast" value={state.diffuserRingContrast} min={0} max={1} step={0.05} onChange={(diffuserRingContrast) => patchField({ diffuserRingContrast })} />
                <Range label="Ring sharpness" value={state.ringSharpness} min={0.5} max={8} step={0.1} onChange={(ringSharpness) => patchField({ ringSharpness })} />
                <Range label="Band width" value={state.bandWidth} min={0.05} max={0.8} step={0.01} onChange={(bandWidth) => patchField({ bandWidth })} />
                <Range label="Halo padding" value={state.diffuserHaloPadding} min={0} max={400} step={10} onChange={(diffuserHaloPadding) => patchField({ diffuserHaloPadding })} />
              </div>
            )}
            {glyphModulationEnabled && (
              <div className="control-group nested-group">
                <div className="section-subheading">Glyph Modulation</div>
                <Range label="Influence" value={state.glyphFieldInfluence} min={0} max={100} onChange={(glyphFieldInfluence) => patchField({ glyphFieldInfluence })} />
                <Range label="Displacement" value={state.glyphFieldDisplacement} min={0} max={40} onChange={(glyphFieldDisplacement) => patchField({ glyphFieldDisplacement })} />
                {activity.glyphDensityModulation && <Range label="Density modulation" value={state.glyphFieldDensity} min={0} max={100} onChange={(glyphFieldDensity) => patchField({ glyphFieldDensity })} />}
                {activity.glyphRadiusModulation && <Range label="Radius modulation" value={state.glyphFieldRadius} min={0} max={100} onChange={(glyphFieldRadius) => patchField({ glyphFieldRadius })} />}
                {activity.glyphOpacityModulation && <Range label="Opacity modulation" value={state.glyphFieldOpacity} min={0} max={100} onChange={(glyphFieldOpacity) => patchField({ glyphFieldOpacity })} />}
              </div>
            )}
            {state.renderer === "wave-contours" && state.waveContourMode === "dotted" && (
              <div className="control-group nested-group">
                <div className="section-subheading">Wave Details</div>
                <Range label="Dot spacing" value={state.waveDotSpacing} min={3} max={40} onChange={(waveDotSpacing) => patchField({ waveDotSpacing })} />
                <Range label="Dot radius" value={state.waveDotRadius} defaultValue={baseState.waveDotRadius} min={0.4} max={8} step={0.1} onChange={(waveDotRadius) => patchField({ waveDotRadius })} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Range({ label, value, min, max, step = 1, defaultValue, onChange }: { label: string; value: number; min: number; max: number; step?: number; defaultValue?: number; onChange: (value: number) => void }) {
  const resetValue = defaultValue ?? advancedDefaults[label];
  return <label className="range"><span>{label}<output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => onChange(resetValue)} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
