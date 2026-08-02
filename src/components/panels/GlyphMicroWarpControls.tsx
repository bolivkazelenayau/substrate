import { GLYPH_MICRO_WARP_PARSED_FONT_WARNING } from "../../engine/glyphMicroWarp";
import { baseState } from "../../engine/presets";
import type { ProjectState } from "../../types";

interface GlyphMicroWarpControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
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

export function GlyphMicroWarpControls({ state, setState, parsedFontPathsAvailable }: GlyphMicroWarpControlsProps) {
  const settings = state.glyphMicroWarp;
  const canToggle = parsedFontPathsAvailable || settings.enabled;
  const patch = (next: Partial<ProjectState["glyphMicroWarp"]>) => setState({
    ...state,
    glyphMicroWarp: { ...settings, ...next },
    preset: "Custom",
  });

  return (
    <section className="control-section glyph-micro-warp-section" data-testid="glyph-micro-warp-controls">
      <div className="section-subheading">Glyph Micro Warp</div>
      <label className={`debug-toggle${!canToggle ? " disabled" : ""}`}>
        <input
          data-testid="glyph-micro-warp-enabled"
          type="checkbox"
          checked={settings.enabled}
          disabled={!canToggle}
          onChange={(event) => patch({ enabled: event.target.checked })}
        />
        <span>Warp parsed glyph outlines</span>
      </label>
      <small className={parsedFontPathsAvailable ? "control-note" : "control-warning"}>
        {parsedFontPathsAvailable
          ? "Authoritative parsed-outline stage · before Fragmentation, mask, SDF, preview, and export."
          : GLYPH_MICRO_WARP_PARSED_FONT_WARNING}
      </small>
      {parsedFontPathsAvailable && !state.emitter.enabled && (
        <small className="emitter-inline-warning">Enable an emitter to define the local warp region.</small>
      )}

      <fieldset disabled={!settings.enabled || !parsedFontPathsAvailable}>
        <legend className="visually-hidden">Glyph Micro Warp parameters</legend>
        <Range testId="glyph-micro-warp-strength" label="Strength" value={settings.strength} min={0} max={100} step={1} onChange={(strength) => patch({ strength })} />
        <Range testId="glyph-micro-warp-radius" label="Response radius" value={settings.responseRadius} min={8} max={640} step={2} onChange={(responseRadius) => patch({ responseRadius })} />
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
    </section>
  );
}

function Range({ testId, label, value, min, max, step, onChange }: {
  testId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const resetValue = defaults[label];
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
        onChange={(event) => onChange(Number(event.target.value))}
        onDoubleClick={() => resetValue !== undefined && onChange(resetValue)}
      />
    </label>
  );
}
