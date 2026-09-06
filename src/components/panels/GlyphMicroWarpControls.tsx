import { GLYPH_MICRO_WARP_PARSED_FONT_WARNING } from "../../engine/glyphMicroWarp";
import { getControlActivity } from "../../engine/controlOwnership";
import { baseState } from "../../engine/presets";
import { SIZE_HARD_LIMITS } from "../../engine/numericBounds";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";

interface GlyphMicroWarpControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Strength: baseState.glyphMicroWarp.strength,
  "Response radius": baseState.glyphMicroWarp.responseRadius,
  "Detail scale": baseState.glyphMicroWarp.detailScale,
  "Detail octaves": baseState.glyphMicroWarp.detailOctaves,
  "Normal displacement": baseState.glyphMicroWarp.normalDisplacement,
  "Tangential displacement": baseState.glyphMicroWarp.tangentialDisplacement,
  "Edge turbulence": baseState.glyphMicroWarp.edgeTurbulence,
  "Detail steps": baseState.glyphMicroWarp.quantizationSteps,
  "Maximum displacement": baseState.glyphMicroWarp.maxDisplacement,
  "Seed influence": baseState.glyphMicroWarp.seedInfluence,
};

export function GlyphMicroWarpControls({ state, setState, parsedFontPathsAvailable, open, onToggle }: GlyphMicroWarpControlsProps) {
  const settings = state.glyphMicroWarp;
  const activity = getControlActivity(state, parsedFontPathsAvailable).glyphMicroWarpActivity;
  const canToggle = activity.supported || settings.enabled;
  const summary = activity.retained
    ? "Glyph Micro Warp · retained / inactive"
    : activity.supported
      ? "Glyph Micro Warp"
      : "Glyph Micro Warp · unavailable";
  const patch = (next: Partial<ProjectState["glyphMicroWarp"]>) => setState({
    ...state,
    glyphMicroWarp: { ...settings, ...next },
    preset: "Custom",
  });

  return (
    <div className={`control-group accordion-group glyph-micro-warp-section${activity.retained ? " retained-group" : ""}`} data-testid="glyph-micro-warp-controls" data-owner="Glyph Micro Warp">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {summary}
      </button>
      {open && <div className="accordion-content">
        <label className={`debug-toggle${!canToggle || activity.retained ? " disabled" : ""}`}>
          <input
            data-testid="glyph-micro-warp-enabled"
            type="checkbox"
            data-project-enabled={settings.enabled ? "true" : "false"}
            data-pipeline-active={activity.active ? "true" : "false"}
            checked={activity.active}
            disabled={!canToggle || activity.retained}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />
          <span>{activity.retained ? "Warp parsed glyph outlines · retained / inactive" : "Warp parsed glyph outlines"}</span>
        </label>
        <small className={activity.active || activity.supported ? "control-note" : "control-warning"}>
          {activity.retained
            ? `Retained but inactive: ${activity.reason}.`
            : parsedFontPathsAvailable
              ? "Authoritative parsed-outline stage · before Fragmentation, mask, SDF, preview, and export."
              : GLYPH_MICRO_WARP_PARSED_FONT_WARNING}
        </small>
        {parsedFontPathsAvailable && !state.emitter.enabled && (
          <small className="emitter-inline-warning">Enable an emitter to define the local warp region.</small>
        )}

      <fieldset disabled={!activity.active}>
        <legend className="visually-hidden">Glyph Micro Warp parameters</legend>
        <Range testId="glyph-micro-warp-strength" label="Strength" value={settings.strength} min={0} max={100} step={1} onChange={(strength) => patch({ strength })} />
        <Range testId="glyph-micro-warp-radius" label="Response radius" value={settings.responseRadius} min={8} max={640} step={2} hardMax={SIZE_HARD_LIMITS.emitterRadius} onChange={(responseRadius) => patch({ responseRadius })} />
        <label className="field compact-field">
          <span>Falloff</span>
          <select
            data-testid="glyph-micro-warp-falloff"
            value={settings.falloff}
            onChange={(event) => patch({ falloff: event.target.value as ProjectState["glyphMicroWarp"]["falloff"] })}
          >
            <option value="smoothstep">Smoothstep</option>
            <option value="gaussian">Gaussian</option>
            <option value="linear">Linear</option>
          </select>
        </label>
        <Range testId="glyph-micro-warp-detail-scale" label="Detail scale" value={settings.detailScale} min={4} max={160} step={1} onChange={(detailScale) => patch({ detailScale })} />
        <Range label="Detail octaves" value={settings.detailOctaves} min={1} max={3} step={1} onChange={(detailOctaves) => patch({ detailOctaves })} />
        <Range testId="glyph-micro-warp-normal" label="Normal displacement" value={settings.normalDisplacement} min={0} max={100} step={1} onChange={(normalDisplacement) => patch({ normalDisplacement })} />
        <Range testId="glyph-micro-warp-tangent" label="Tangential displacement" value={settings.tangentialDisplacement} min={0} max={100} step={1} onChange={(tangentialDisplacement) => patch({ tangentialDisplacement })} />
        <Range label="Edge turbulence" value={settings.edgeTurbulence} min={0} max={100} step={1} onChange={(edgeTurbulence) => patch({ edgeTurbulence })} />
        <Range label="Detail steps" value={settings.quantizationSteps} min={0} max={16} step={1} onChange={(quantizationSteps) => patch({ quantizationSteps })} />
        <Range testId="glyph-micro-warp-max" label="Maximum displacement" value={settings.maxDisplacement} min={0} max={48} step={0.5} onChange={(maxDisplacement) => patch({ maxDisplacement })} />
        <label className="debug-toggle">
          <input
            data-testid="glyph-micro-warp-preserve-counters"
            type="checkbox"
            checked={settings.preserveCounters}
            onChange={(event) => patch({ preserveCounters: event.target.checked })}
          />
          <span>Preserve counters and topology</span>
        </label>
        <Range label="Seed influence" value={settings.seedInfluence} min={0} max={100} step={5} onChange={(seedInfluence) => patch({ seedInfluence })} />
      </fieldset>
      </div>}
    </div>
  );
}

function Range({ testId, label, value, min, max, hardMax, step, onChange }: {
  testId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  hardMax?: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const resetValue = defaults[label];
  return <NumericRange parameter={`glyph-geometry.micro-warp.${label.toLowerCase().replaceAll(" ", "-")}`} label={label} value={value} min={min} max={max} hardMax={hardMax} step={step} resetValue={resetValue ?? value} testId={testId} onChange={onChange} />;
}
