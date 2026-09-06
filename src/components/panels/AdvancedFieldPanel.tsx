import { baseState } from "../../engine/presets";
import { getRenderer } from "../../engine/renderers";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";

interface FieldAdvancedPanelProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Frequency: baseState.frequency,
  Turbulence: baseState.turbulence,
  "Edge influence": baseState.edgeInfluence,
};

/** Field-owned detail only. Renderer, appearance, budget, and diagnostics
 * controls intentionally live in their own stage-owned disclosures. */
export function FieldAdvancedPanel({ state, setState, open, onToggle }: FieldAdvancedPanelProps) {
  const renderer = getRenderer(state.renderer);
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const supported = (id: "frequency" | "turbulence" | "edgeInfluence") => renderer.supportedControls.includes(id);

  return (
    <div className="control-group accordion-group field-advanced-controls" data-testid="field-advanced-controls" data-owner="Core field detail">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> Field detail · advanced
      </button>
      {open && <div className="accordion-content">
        {supported("frequency") && <Range label="Frequency" value={state.frequency} min={6} max={34} onChange={(frequency) => patchField({ frequency })} />}
        {supported("turbulence") && <Range label="Turbulence" value={state.turbulence} min={0} max={100} onChange={(turbulence) => patchField({ turbulence })} />}
        {supported("edgeInfluence") && <Range label="Edge influence" value={state.edgeInfluence} min={0} max={100} onChange={(edgeInfluence) => patchField({ edgeInfluence })} />}
        <label className="field compact-field">
          <span>Emitter blend</span>
          <select value={state.fieldBlendMode} onChange={(event) => patchField({ fieldBlendMode: event.target.value as ProjectState["fieldBlendMode"] })}>
            <option value="add">Add</option>
            <option value="max">Max</option>
          </select>
          <small>Combines overlapping emitter contributions in the shared field.</small>
        </label>
      </div>}
    </div>
  );
}

/** Compatibility export for consumers that imported the old component name. */
export const AdvancedFieldPanel = FieldAdvancedPanel;

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
 return <NumericRange parameter={`field.${label.toLowerCase().replaceAll(" ", "-")}`} label={label} value={value} min={min} max={max} step={step} resetValue={defaults[label] ?? value} onChange={onChange} />;
}
