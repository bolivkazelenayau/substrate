import { baseState } from "../../engine/presets";
import { SIZE_HARD_LIMITS } from "../../engine/numericBounds";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";

interface GlyphInfluenceControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Radius: baseState.glyphInfluence.radius,
  "Edge softness": baseState.glyphInfluence.edgeSoftness,
  Neighborhood: baseState.emitter.neighborhoodSize,
};

export function GlyphInfluenceControls({ state, setState, open, onToggle }: GlyphInfluenceControlsProps) {
  const settings = state.glyphInfluence;
  const summary = state.emitter.enabled ? "Glyph Influence" : "Glyph Influence · waiting for emitter";
  const customPosition = state.emitter.sourceMode === "custom";
  const effectiveScope = customPosition ? "all-typography" : state.emitter.influenceScope;
  const patch = (next: Partial<ProjectState["glyphInfluence"]>) => setState({
    ...state,
    glyphInfluence: { ...settings, ...next },
    preset: "Custom",
  });
  const patchEmitter = (next: Partial<ProjectState["emitter"]>) => setState({
    ...state,
    emitter: { ...state.emitter, ...next },
    preset: "Custom",
  });

  return (
    <div className="control-group accordion-group glyph-influence-section" data-testid="glyph-influence-controls" data-owner="Glyph Influence envelope">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {summary}
      </button>
      {open && <div className="accordion-content">
      <small className="control-note">
        Choose which typography belongs to the emitter; Radius then controls spatial reach inside that scope.
      </small>
      <fieldset disabled={!state.emitter.enabled}>
        <legend className="visually-hidden">Glyph influence envelope</legend>
        {state.emitterMode === "single" ? <>
          <label className="field compact-field">
            <span>Scope</span>
            <select
              data-testid="glyph-influence-scope"
              value={effectiveScope}
              disabled={customPosition}
              onChange={(event) => patchEmitter({
                influenceScope: event.target.value as ProjectState["emitter"]["influenceScope"],
              })}
            >
              <option value="source-glyph">Source glyph</option>
              <option value="glyph-neighborhood">Glyph + neighbors</option>
              <option value="source-line">Text line</option>
              <option value="all-typography">All typography</option>
            </select>
            {customPosition && <small>Custom world-position emitters use spatial targeting across all typography.</small>}
          </label>
          {effectiveScope === "glyph-neighborhood" && <Range
            testId="glyph-influence-neighborhood"
            label="Neighborhood"
            value={state.emitter.neighborhoodSize}
            min={0}
            max={8}
            step={1}
            onChange={(neighborhoodSize) => patchEmitter({ neighborhoodSize })}
          />}
        </> : <small className="control-note">Each emitter row owns its scope and neighborhood.</small>}
        <Range testId="glyph-influence-radius" label="Radius" value={settings.radius} min={0} max={640} step={5} hardMax={SIZE_HARD_LIMITS.emitterRadius} onChange={(radius) => patch({ radius })} />
        <Range testId="glyph-influence-softness" label="Edge softness" value={settings.edgeSoftness} min={0} max={720} step={5} hardMax={SIZE_HARD_LIMITS.emitterRadius} onChange={(edgeSoftness) => patch({ edgeSoftness })} />
        <label className="field compact-field">
          <span>Falloff shape</span>
          <select
            data-testid="glyph-influence-falloff"
            value={settings.falloff}
            onChange={(event) => patch({ falloff: event.target.value as ProjectState["glyphInfluence"]["falloff"] })}
          >
            <option value="smoothstep">Soft</option>
            <option value="gaussian">Focused</option>
            <option value="linear">Even</option>
          </select>
        </label>
      </fieldset>
      {!state.emitter.enabled && <small className="emitter-inline-warning">Enable an emitter to activate this spatial envelope.</small>}
      </div>}
    </div>
  );
}

function Range({ testId, label, value, min, max, hardMax, step, onChange }: {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  hardMax?: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const resetValue = defaults[label];
  return <NumericRange parameter={`glyph-geometry.influence.${label.toLowerCase().replaceAll(" ", "-")}`} label={label} value={value} min={min} max={max} hardMax={hardMax} step={step} resetValue={resetValue ?? value} testId={testId} onChange={onChange} />;
}
