import { useState } from "react";
import { baseState } from "../../engine/presets";
import { getControlActivity } from "../../engine/controlOwnership";
import { getProductFeatureState } from "../../engine/parameterOwnership";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";
import { ProductSurfaceDisclosure } from "./ProductSurfaceDisclosure";
import { featureSummary, productStateLabel } from "./productSurfaceState";

interface GlyphFalloffDisplacementControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  supported: boolean;
  capability: "supported" | "unaffected" | "unsupported";
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Strength: baseState.glyphFalloffDisplacement.strength,
  "Field width": baseState.glyphFalloffDisplacement.fieldWidth,
  "Ring frequency": baseState.glyphFalloffDisplacement.ringFrequency,
  "Ring sharpness": baseState.glyphFalloffDisplacement.ringSharpness,
};

export function GlyphFalloffDisplacementControls({
  state,
  setState,
  supported,
  capability,
  open,
  onToggle,
}: GlyphFalloffDisplacementControlsProps) {
  const settings = state.glyphFalloffDisplacement;
  const activity = getControlActivity(state, true).glyphFalloffDisplacementActivity;
  const featureState = getProductFeatureState(state, "glyph-falloff");
  const [tuningOpen, setTuningOpen] = useState(false);
  const patch = (next: Partial<ProjectState["glyphFalloffDisplacement"]>) => setState({
    ...state,
    glyphFalloffDisplacement: { ...settings, ...next },
    preset: "Custom",
  });
  const active = activity.active;
  const summary = activity.retained
    ? "Glyph Falloff Field · retained / inactive"
    : activity.supported
      ? featureSummary("Glyph Falloff Field", featureState)
      : "Glyph Falloff Field · unavailable";

  return (
    <div className={`control-group accordion-group glyph-falloff-displacement${activity.retained ? " retained-group" : !supported ? " disabled-group" : ""}`} data-testid="glyph-falloff-displacement" data-owner="Glyph Falloff Field">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        {summary}
      </button>
      {open && (
        <div className="accordion-content">
          <small className={activity.retained || !supported ? "control-warning" : "inactive-hint"}>
            {activity.retained
              ? `Retained but inactive: ${activity.reason}.`
              : supported
                ? "Contour-following SDF displacement applied to final marks before Micro Response occupancy."
                : capability === "unaffected"
                  ? "This renderer is intentionally unaffected; its existing geometry remains unchanged."
                  : "This renderer has no compatible final-circle and authoritative-SDF contract."}
          </small>
          {activity.retained && <small className="retained-state-summary">Retained settings: {settings.mode === "contour-rings" ? "Contour rings" : "Off"}.</small>}
          {supported && <fieldset>
            <legend className="visually-hidden">Glyph Falloff Field parameters</legend>
            <label className="field compact-field">
              <span>Mode</span>
              <select
                data-testid="glyph-falloff-mode"
                value={settings.mode}
                onChange={(event) => patch({
                  mode: event.target.value as ProjectState["glyphFalloffDisplacement"]["mode"],
                })}
              >
                <option value="off">Off</option>
                <option value="contour-rings">Contour rings</option>
              </select>
            </label>
            {active && (
              <>
                <Range
                  testId="glyph-falloff-strength"
                  label="Strength"
                  value={settings.strength}
                  min={0}
                  max={96}
                  step={1}
                  onChange={(strength) => patch({ strength })}
                />
                <Range
                  testId="glyph-falloff-width"
                  label="Field width"
                  value={settings.fieldWidth}
                  min={4}
                  max={320}
                  step={2}
                  onChange={(fieldWidth) => patch({ fieldWidth })}
                />
                <label className="field compact-field">
                  <span>Falloff</span>
                  <select
                    data-testid="glyph-falloff-curve"
                    value={settings.falloff}
                    onChange={(event) => patch({
                      falloff: event.target.value as ProjectState["glyphFalloffDisplacement"]["falloff"],
                    })}
                  >
                    <option value="smoothstep">Smoothstep</option>
                    <option value="gaussian">Gaussian</option>
                    <option value="linear">Linear</option>
                  </select>
                </label>
                <Range
                  testId="glyph-falloff-ring-frequency"
                  label="Ring frequency"
                  value={settings.ringFrequency}
                  min={0.5}
                  max={16}
                  step={0.5}
                  onChange={(ringFrequency) => patch({ ringFrequency })}
                />
                <small className="control-note">
                  Frequency is the number of contour-following cycles across the field width; falloff controls their decay.
                </small>
              </>
            )}
          </fieldset>}
          <ProductSurfaceDisclosure label="Custom tuning…" open={tuningOpen} onToggle={() => setTuningOpen((value) => !value)} status={productStateLabel(featureState)} testId="glyph-falloff-tuning">
            <Range testId="glyph-falloff-ring-sharpness" label="Ring sharpness" value={settings.ringSharpness} min={0.5} max={8} step={0.1} onChange={(ringSharpness) => patch({ ringSharpness })} controlId="glyphFalloffDisplacement.ringSharpness" />
          </ProductSurfaceDisclosure>
        </div>
      )}
    </div>
  );
}

function Range({
  testId,
  label,
  value,
  min,
  max,
  step,
  onChange,
  controlId,
}: {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  controlId?: string;
}) {
  return <NumericRange parameter={`mark-response.glyph-falloff.${label.toLowerCase().replaceAll(" ", "-")}`} controlId={controlId} label={label} value={value} min={min} max={max} step={step} resetValue={defaults[label] ?? value} testId={testId} onChange={onChange} />;
}
