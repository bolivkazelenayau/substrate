import { GLYPH_CALM_WATER_PARSED_FONT_WARNING } from "../../engine/glyphCalmWater";
import { getControlActivity } from "../../engine/controlOwnership";
import { baseState } from "../../engine/presets";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";

interface GlyphCalmWaterControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Strength: baseState.glyphCalmWater.strength,
  "Rhythm multiplier": baseState.glyphCalmWater.frequencyMultiplier,
  Wavelength: baseState.glyphCalmWater.wavelength,
  "Surface variation": baseState.glyphCalmWater.surfaceVariation,
  Drift: baseState.glyphCalmWater.drift,
  Detail: baseState.glyphCalmWater.detail,
};

export function GlyphCalmWaterControls({ state, setState, parsedFontPathsAvailable, open, onToggle }: GlyphCalmWaterControlsProps) {
  const settings = state.glyphCalmWater;
  const activity = getControlActivity(state, parsedFontPathsAvailable).glyphCalmWaterActivity;
  const canToggle = activity.supported || settings.enabled;
  const summary = activity.retained
    ? "Calm Water · retained / inactive"
    : activity.supported
      ? "Calm Water"
      : "Calm Water · unavailable";
  const patch = (next: Partial<ProjectState["glyphCalmWater"]>) => setState({
    ...state,
    glyphCalmWater: { ...settings, ...next },
    preset: "Custom",
  });

  return (
    <div className={`control-group accordion-group glyph-calm-water-section${activity.retained ? " retained-group" : ""}`} data-testid="glyph-calm-water-controls" data-owner="Calm Water">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {summary}
      </button>
      {open && <div className="accordion-content">
      <label className={`debug-toggle${!canToggle || activity.retained ? " disabled" : ""}`}>
        <input
          data-testid="glyph-calm-water-enabled"
          type="checkbox"
          data-project-enabled={settings.enabled ? "true" : "false"}
          data-pipeline-active={activity.active ? "true" : "false"}
          checked={activity.active}
          disabled={!canToggle || activity.retained}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <span>{activity.retained ? "Deform glyphs as a calm surface · retained / inactive" : "Deform glyphs as a calm surface"}</span>
      </label>
      <small className={activity.active || activity.supported ? "control-note" : "control-warning"}>
        {activity.retained
          ? `Retained but inactive: ${activity.reason}.`
          : parsedFontPathsAvailable
            ? "Broad contour-normal waves · after Micro Warp and before Fragmentation."
            : GLYPH_CALM_WATER_PARSED_FONT_WARNING}
      </small>
      {parsedFontPathsAvailable && !state.emitter.enabled && (
        <small className="emitter-inline-warning">Enable an emitter to position the water response.</small>
      )}

      <fieldset disabled={!activity.active}>
        <legend className="visually-hidden">Calm Water character</legend>
        <Range testId="glyph-calm-water-strength" label="Strength" value={settings.strength} min={0} max={24} step={0.5} onChange={(strength) => patch({ strength })} />
        <label className="debug-toggle">
          <input
            data-testid="glyph-calm-water-frequency-linked"
            type="checkbox"
            checked={settings.frequencyLinked}
            onChange={(event) => patch({ frequencyLinked: event.target.checked })}
          />
          <span>Linked to emitter rhythm</span>
        </label>
        {settings.frequencyLinked
          ? <Range testId="glyph-calm-water-frequency-multiplier" label="Rhythm multiplier" value={settings.frequencyMultiplier} min={0.25} max={2} step={0.05} onChange={(frequencyMultiplier) => patch({ frequencyMultiplier })} />
          : <Range testId="glyph-calm-water-wavelength" label="Wavelength" value={settings.wavelength} min={40} max={520} step={5} onChange={(wavelength) => patch({ wavelength })} />}
        <Range testId="glyph-calm-water-variation" label="Surface variation" value={settings.surfaceVariation} min={0} max={100} step={2} onChange={(surfaceVariation) => patch({ surfaceVariation })} />
        <Range testId="glyph-calm-water-drift" label="Drift" value={settings.drift} min={0} max={40} step={1} onChange={(drift) => patch({ drift })} />
        <Range testId="glyph-calm-water-detail" label="Detail" value={settings.detail} min={0} max={60} step={1} onChange={(detail) => patch({ detail })} />
        <label className="debug-toggle">
          <input
            data-testid="glyph-calm-water-preserve-counters"
            type="checkbox"
            checked={settings.preserveCounters}
            onChange={(event) => patch({ preserveCounters: event.target.checked })}
          />
          <span>Preserve counters and topology</span>
        </label>
      </fieldset>
      </div>}
    </div>
  );
}

function Range({ testId, label, value, min, max, step, onChange }: {
  testId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const resetValue = defaults[label];
  return <NumericRange parameter={`glyph-geometry.calm-water.${label.toLowerCase().replaceAll(" ", "-")}`} label={label} value={value} min={min} max={max} step={step} resetValue={resetValue ?? value} testId={testId} onChange={onChange} />;
}
