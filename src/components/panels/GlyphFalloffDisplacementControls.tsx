import { baseState } from "../../engine/presets";
import type { ProjectState } from "../../types";

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
  const patch = (next: Partial<ProjectState["glyphFalloffDisplacement"]>) => setState({
    ...state,
    glyphFalloffDisplacement: { ...settings, ...next },
    preset: "Custom",
  });
  const active = settings.mode !== "off";
  const unsupportedMessage = capability === "unaffected"
    ? "This renderer is intentionally unaffected; its existing geometry remains unchanged."
    : "This renderer has no compatible final-circle and authoritative-SDF contract.";

  return (
    <div className={`control-group accordion-group glyph-falloff-displacement${supported ? "" : " disabled-group"}`}>
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        Glyph Falloff Field{supported ? "" : " · unavailable"}
      </button>
      {open && (
        <div className="accordion-content">
          <small className="inactive-hint">
            {supported
              ? "Contour-following SDF displacement applied to final marks before Micro Response occupancy."
              : unsupportedMessage}
          </small>
          <fieldset disabled={!supported}>
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
                <Range
                  testId="glyph-falloff-ring-sharpness"
                  label="Ring sharpness"
                  value={settings.ringSharpness}
                  min={0.5}
                  max={8}
                  step={0.1}
                  onChange={(ringSharpness) => patch({ ringSharpness })}
                />
                <small className="control-note">
                  Frequency is the number of contour-following cycles across the field width; falloff controls their decay.
                </small>
              </>
            )}
          </fieldset>
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
}: {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range">
      <span>{label}<output>{value}</output></span>
      <input
        data-testid={testId}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        title="Double-click to reset"
        onDoubleClick={() => onChange(defaults[label])}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
