import { baseState } from "../../engine/presets";
import { getControlActivity } from "../../engine/controlOwnership";
import { getRenderer } from "../../engine/renderers";
import { resolveDotRadiusBounds } from "../../engine/numericBounds";
import type { ProjectState } from "../../types";
import { DiffuserAppearancePanel } from "./DiffuserAppearancePanel";
import { CONTOUR_STROKE_WIDTH_LIMITS, supportsContourStrokeWidth } from "../../engine/contourStroke";

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
  "Contour thickness": baseState.contourStrokeWidth,
};

export function AdvancedFieldPanel({ state, setState, parsedFontPathsAvailable, open, onToggle }: AdvancedFieldPanelProps) {
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const activity = getControlActivity(state, parsedFontPathsAvailable);
  const glyphModulationEnabled = activity.glyphModulation && state.glyphFieldMode !== "off";
  const renderer = getRenderer(state.renderer);
  const dotBoundsContext = {
    artboardWidth: state.artboard.width,
    artboardHeight: state.artboard.height,
    typographySize: state.fontSize,
  };
  const diffuserDotBounds = resolveDotRadiusBounds({ ...dotBoundsContext, currentValue: state.diffuserDotRadius });
  const waveDotBounds = resolveDotRadiusBounds({ ...dotBoundsContext, currentValue: state.waveDotRadius });

  return (
    <section className="control-section advanced-disclosure-section">
      <div className="control-group accordion-group">
        <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
          <span>{open ? "▼" : "▶"}</span> Advanced Parameters
        </button>
        {open && (
          <div className="accordion-content">
            <div className="section-subheading">Field detail</div>
            {(["frequency", "turbulence", "edgeInfluence"] as const).map((id) => renderer.supportedControls.includes(id) && (
              <Range
                key={id}
                label={id === "edgeInfluence" ? "Edge influence" : id[0].toUpperCase() + id.slice(1)}
                value={state[id]}
                min={id === "frequency" ? 6 : 0}
                max={id === "frequency" ? 34 : 100}
                onChange={(value) => patchField({ [id]: value })}
              />
            ))}
            {state.renderer === "wave-contours" && (
              <label className="field compact-field">
                <span>Contour mode</span>
                <select value={state.waveContourMode} onChange={(event) => patchField({ waveContourMode: event.target.value as ProjectState["waveContourMode"] })}>
                  <option value="continuous">Continuous</option><option value="dotted">Dotted</option>
                </select>
              </label>
            )}
            {supportsContourStrokeWidth(state) && (
              <Range
                label="Contour thickness"
                value={state.contourStrokeWidth}
                min={CONTOUR_STROKE_WIDTH_LIMITS.min}
                max={CONTOUR_STROKE_WIDTH_LIMITS.softMax}
                step={0.25}
                description="Controls the vector stroke width of generated contour lines."
                onChange={(contourStrokeWidth) => patchField({ contourStrokeWidth })}
              />
            )}
            {state.renderer.startsWith("sdf") && (
              <label className="field compact-field">
                <span>Modulation mode</span>
                <select value={state.glyphFieldMode} onChange={(event) => patchField({ glyphFieldMode: event.target.value as ProjectState["glyphFieldMode"] })}>
                  <option value="off">Off</option><option value="subtle">Subtle</option><option value="strong">Strong</option>
                </select>
              </label>
            )}
            {state.renderer === "glyph-diffuser" && (
              <>
                <label className="field compact-field"><span>Diffuser domain</span><select value={state.diffuserDomain} onChange={(event) => patchField({ diffuserDomain: event.target.value as ProjectState["diffuserDomain"] })}><option value="inside-text">Inside text</option><option value="halo">Emitter halo</option><option value="text-halo">Text + halo</option></select></label>
                <label className="field compact-field"><span>Composition</span><select value={state.diffuserComposition} onChange={(event) => patchField({ diffuserComposition: event.target.value as ProjectState["diffuserComposition"] })}><option value="behind-text">Behind text</option><option value="through-text">Through text</option><option value="text-reactive">Text-reactive edges</option><option value="edge-eroded">Edge-eroded overlay</option><option value="clipped">Clipped to text</option></select></label>
                <Range label="Dot radius" value={state.diffuserDotRadius} defaultValue={baseState.diffuserDotRadius} min={diffuserDotBounds.min} max={diffuserDotBounds.softMax} step={diffuserDotBounds.step} onChange={(diffuserDotRadius) => patchField({ diffuserDotRadius })} />
              </>
            )}
            <Range label="Max nodes / marks" value={state.maxNodes} min={400} max={5000} step={100} onChange={(maxNodes) => patchField({ maxNodes })} />
            <DiffuserAppearancePanel state={state} setState={setState} parsedFontPathsAvailable={parsedFontPathsAvailable} />
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
                <Range label="Dot radius" value={state.waveDotRadius} defaultValue={baseState.waveDotRadius} min={waveDotBounds.min} max={waveDotBounds.softMax} step={waveDotBounds.step} onChange={(waveDotRadius) => patchField({ waveDotRadius })} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Range({ label, value, min, max, step = 1, defaultValue, description, onChange }: { label: string; value: number; min: number; max: number; step?: number; defaultValue?: number; description?: string; onChange: (value: number) => void }) {
  const resetValue = defaultValue ?? advancedDefaults[label];
  return <label className="range"><span>{label}<output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => onChange(resetValue)} onChange={(event) => onChange(Number(event.target.value))} />{description && <small>{description}</small>}</label>;
}
