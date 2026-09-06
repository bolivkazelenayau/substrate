import { baseState, applyPreset, getPresetDisplayLabel, getPresetScopeLabel, presetIds, presetMetadata } from "../../engine/presets";
import { getControlActivity } from "../../engine/controlOwnership";
import { getRenderer, rendererList } from "../../engine/renderers";
import { resolveDotRadiusBounds } from "../../engine/numericBounds";
import { CONTOUR_STROKE_WIDTH_LIMITS, supportsContourStrokeWidth } from "../../engine/contourStroke";
import type { ProjectState } from "../../types";
import { RendererLocalControls } from "./GlyphDisplacementControls";

interface RendererControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
  localOpen: boolean;
  onToggleLocal: () => void;
  advancedOpen: boolean;
  onToggleAdvanced: () => void;
}

export function RendererControls({ state, setState, parsedFontPathsAvailable, localOpen, onToggleLocal, advancedOpen, onToggleAdvanced }: RendererControlsProps) {
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  return (
    <>
      <div className="control-group renderer-selection preset-renderer-section" data-testid="renderer-selection" data-owner="Renderer selection">
        <label className="field">
          <span>Preset</span>
          <select data-testid="preset-select" value={state.preset} onChange={(event) => setState(applyPreset(state, event.target.value as ProjectState["preset"]))}>
            {presetIds.map((name) => <option key={name} value={name}>{getPresetDisplayLabel(name)}</option>)}
          </select>
          <small data-testid="preset-contract">Scope: {getPresetScopeLabel(state.preset)}. {presetMetadata[state.preset].description}</small>
        </label>
        <div className="segmented" aria-label="Renderer">
          {rendererList.map((item) => <button type="button" key={item.id} className={state.renderer === item.id ? "active" : ""} onClick={() => patch({ renderer: item.id })}>{item.label}</button>)}
        </div>
      </div>
      <RendererAdvancedPanel state={state} setState={setState} parsedFontPathsAvailable={parsedFontPathsAvailable} open={advancedOpen} onToggle={onToggleAdvanced} />
      <RendererLocalControls state={state} setState={setState} open={localOpen} onToggle={onToggleLocal} />
    </>
  );
}

function RendererAdvancedPanel({ state, setState, parsedFontPathsAvailable, open, onToggle }: { state: ProjectState; setState: (state: ProjectState) => void; parsedFontPathsAvailable: boolean; open: boolean; onToggle: () => void }) {
  const activity = getControlActivity(state, parsedFontPathsAvailable);
  const renderer = getRenderer(state.renderer);
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const boundsContext = { artboardWidth: state.artboard.width, artboardHeight: state.artboard.height, typographySize: state.fontSize };
  const dotBounds = resolveDotRadiusBounds({ ...boundsContext, currentValue: state.diffuserDotRadius });
  const hasRendererDetails = state.renderer === "wave-contours" || state.renderer.startsWith("sdf") || state.renderer === "glyph-diffuser";
  return (
    <div className="control-group accordion-group renderer-advanced-controls" data-testid="renderer-advanced-controls" data-owner="Renderer-local controls">
      <button type="button" className="accordion-summary" data-testid="renderer-detail" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> Renderer detail · advanced
      </button>
      {open && <div className="accordion-content">
        {!hasRendererDetails && <small className="inactive-hint">This renderer has no additional authored detail controls in this stage.</small>}
        {state.renderer === "wave-contours" && <label className="field compact-field"><span>Contour mode</span><select data-testid="wave-contour-mode" value={state.waveContourMode} onChange={(event) => patch({ waveContourMode: event.target.value as ProjectState["waveContourMode"] })}><option value="continuous">Continuous</option><option value="dotted">Dotted</option></select></label>}
        {supportsContourStrokeWidth(state) && <Range label="Contour thickness" value={state.contourStrokeWidth} min={CONTOUR_STROKE_WIDTH_LIMITS.min} max={CONTOUR_STROKE_WIDTH_LIMITS.softMax} step={0.25} onChange={(contourStrokeWidth) => patch({ contourStrokeWidth })} description="Normalized contour weight; scales with typography size." />}
{activity.glyphModulation && <label className="field compact-field"><span>Glyph modulation</span><select data-testid="glyph-field-mode" value={state.glyphFieldMode} onChange={(event) => patch({ glyphFieldMode: event.target.value as ProjectState["glyphFieldMode"] })}><option value="off">Off</option><option value="subtle">Subtle</option><option value="strong">Strong</option></select></label>}
        {activity.glyphModulation && state.glyphFieldMode !== "off" && <div className="control-group nested-group" data-owner="SDF glyph modulation"><div className="section-subheading">SDF glyph modulation</div><Range label="Influence" value={state.glyphFieldInfluence} min={0} max={100} onChange={(glyphFieldInfluence) => patch({ glyphFieldInfluence })} /><Range label="Displacement" value={state.glyphFieldDisplacement} min={0} max={40} onChange={(glyphFieldDisplacement) => patch({ glyphFieldDisplacement })} />{activity.glyphDensityModulation && <Range label="Density modulation" value={state.glyphFieldDensity} min={0} max={100} onChange={(glyphFieldDensity) => patch({ glyphFieldDensity })} />}{activity.glyphRadiusModulation && <Range label="Radius modulation" value={state.glyphFieldRadius} min={0} max={100} onChange={(glyphFieldRadius) => patch({ glyphFieldRadius })} />}{activity.glyphOpacityModulation && <Range label="Opacity modulation" value={state.glyphFieldOpacity} min={0} max={100} onChange={(glyphFieldOpacity) => patch({ glyphFieldOpacity })} />}</div>}
        {state.renderer === "glyph-diffuser" && <>
          <label className="field compact-field"><span>Diffuser domain</span><select data-testid="diffuser-domain" value={state.diffuserDomain} onChange={(event) => patch({ diffuserDomain: event.target.value as ProjectState["diffuserDomain"] })}><option value="inside-text">Inside text</option><option value="halo">Emitter halo</option><option value="text-halo">Text + halo</option></select></label>
          <label className="field compact-field"><span>Composition</span><select data-testid="diffuser-composition" value={state.diffuserComposition} onChange={(event) => patch({ diffuserComposition: event.target.value as ProjectState["diffuserComposition"] })}><option value="behind-text">Behind text</option><option value="through-text">Through text</option><option value="text-reactive">Text-reactive edges</option><option value="edge-eroded">Edge-eroded overlay</option><option value="clipped">Clipped to text</option></select></label>
          <Range label="Dot radius" value={state.diffuserDotRadius} min={dotBounds.min} max={dotBounds.softMax} step={dotBounds.step} onChange={(diffuserDotRadius) => patch({ diffuserDotRadius })} />
          <div className="control-group nested-group" data-owner="Glyph Diffuser detail"><div className="section-subheading">Glyph Diffuser detail</div><Range label="Ring contrast" value={state.diffuserRingContrast} min={0} max={1} step={0.05} onChange={(diffuserRingContrast) => patch({ diffuserRingContrast })} /><Range label="Ring sharpness" value={state.ringSharpness} min={0.5} max={8} step={0.1} onChange={(ringSharpness) => patch({ ringSharpness })} /><Range label="Band width" value={state.bandWidth} min={0.05} max={0.8} step={0.01} onChange={(bandWidth) => patch({ bandWidth })} /><Range label="Halo padding" value={state.diffuserHaloPadding} min={0} max={400} step={10} onChange={(diffuserHaloPadding) => patch({ diffuserHaloPadding })} /></div>
        </>}
        <div className="control-group nested-group" data-owner="Renderer safety budget"><div className="section-subheading">Renderer safety</div><Range label="Max nodes / marks" value={state.maxNodes} min={400} max={5000} step={100} onChange={(maxNodes) => patch({ maxNodes })} /><small className="inactive-hint">Safety budget for generated marks; retained across renderer switches.</small></div>
      </div>}
    </div>
  );
}

function Range({ label, value, min, max, step = 1, description, onChange }: { label: string; value: number; min: number; max: number; step?: number; description?: string; onChange: (value: number) => void }) {
  const defaults: Record<string, number> = { "Max nodes / marks": baseState.maxNodes, "Ring contrast": baseState.diffuserRingContrast, "Ring sharpness": baseState.ringSharpness, "Band width": baseState.bandWidth, "Halo padding": baseState.diffuserHaloPadding, Influence: baseState.glyphFieldInfluence, Displacement: baseState.glyphFieldDisplacement, "Density modulation": baseState.glyphFieldDensity, "Radius modulation": baseState.glyphFieldRadius, "Opacity modulation": baseState.glyphFieldOpacity, "Dot radius": baseState.diffuserDotRadius, "Contour thickness": baseState.contourStrokeWidth };
 return <label className="range"><span>{label}<output>{value}</output></span><input aria-label={label} type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => defaults[label] !== undefined && onChange(defaults[label])} onChange={(event) => onChange(Number(event.target.value))} />{description && <small>{description}</small>}</label>;
}
