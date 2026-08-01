import { baseState } from "../../engine/presets";
import { getRendererManifest } from "../../engine/renderers/rendererManifest";
import type { ProjectState } from "../../types";

interface GlyphDisplacementControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
}

const defaults: Record<string, number> = {
  Strength: baseState.glyphDisplacement.strength,
  "Response radius": baseState.glyphDisplacement.responseRadius,
  "Slice / cell size": baseState.glyphDisplacement.fragmentSize,
  Gap: baseState.glyphDisplacement.gap,
  "Offset steps": baseState.glyphDisplacement.quantizationSteps,
  Direction: baseState.glyphDisplacement.direction,
  "Radial / tangential": baseState.glyphDisplacement.radialTangential,
  Jitter: baseState.glyphDisplacement.jitter,
  "Fragment rotation": baseState.glyphDisplacement.fragmentRotation,
  "Seed influence": baseState.glyphDisplacement.seedInfluence,
  "Grid spacing": baseState.dotGrid.spacing,
  "Dot radius": baseState.dotGrid.radius,
  Threshold: baseState.dotGrid.threshold,
  "Edge softness": baseState.dotGrid.edgeSoftness,
  "Display response radius": baseState.displayDislocation.responseRadius,
  "Displacement amount": baseState.displayDislocation.displacementAmount,
  "Band / cell size": baseState.displayDislocation.regionSize,
  "Display gap": baseState.displayDislocation.gap,
  "Display offset steps": baseState.displayDislocation.quantizationSteps,
  "Display direction": baseState.displayDislocation.direction,
  "Alternating offset": baseState.displayDislocation.alternatingOffset,
  "Radial bias": baseState.displayDislocation.radialBias,
};

export function GlyphDisplacementControls({ state, setState, parsedFontPathsAvailable }: GlyphDisplacementControlsProps) {
  const settings = state.glyphDisplacement;
  const displaySettings = state.displayDislocation;
  const manifest = getRendererManifest(state.renderer);
  const exactAvailable = parsedFontPathsAvailable && manifest.glyphDomainDisplacement === "supported";
  const canToggle = exactAvailable || settings.enabled;
  const dotGridAvailable = state.renderer === "sdf-halftone";
  const displayAvailable = dotGridAvailable && state.dotGrid.enabled;
  const patchProject = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const patchDisplacement = (next: Partial<ProjectState["glyphDisplacement"]>) => patchProject({
    glyphDisplacement: { ...settings, ...next },
  });
  const patchDotGrid = (next: Partial<ProjectState["dotGrid"]>) => patchProject({
    dotGrid: { ...state.dotGrid, ...next },
  });
  const patchDisplayDislocation = (next: Partial<ProjectState["displayDislocation"]>) => patchProject({
    displayDislocation: { ...displaySettings, ...next },
  });
  const fragmentMode = settings.mode !== "warp";

  return (
    <section className="control-section glyph-displacement-section" data-testid="glyph-displacement-controls">
      <div className="section-subheading">Glyph Fragmentation</div>
      <label className={`debug-toggle${!canToggle ? " disabled" : ""}`}>
        <input
          data-testid="glyph-displacement-enabled"
          type="checkbox"
          checked={settings.enabled}
          disabled={!canToggle}
          onChange={(event) => patchDisplacement({ enabled: event.target.checked })}
        />
        <span>Fragment glyph domain</span>
      </label>
      <small className={exactAvailable ? "control-note" : "control-warning"}>
        {exactAvailable
          ? "Exact parsed-outline stage · shared by mask, SDF, preview, and export."
          : "Load a .ttf/.otf outline font to enable exact glyph displacement. Native fallback stays undisplaced."}
      </small>

      <fieldset disabled={!settings.enabled || !exactAvailable}>
        <legend className="visually-hidden">Glyph fragmentation parameters</legend>
        <label className="field compact-field">
          <span>Mode</span>
          <select
            data-testid="glyph-displacement-mode"
            value={settings.mode}
            onChange={(event) => patchDisplacement({ mode: event.target.value as ProjectState["glyphDisplacement"]["mode"] })}
          >
            <option value="warp">Domain warp</option>
            <option value="horizontal-slices">Horizontal slices</option>
            <option value="vertical-slices">Vertical slices</option>
            <option value="grid">Grid cells</option>
            <option value="radial-sectors">Radial sectors</option>
          </select>
        </label>
        <Range testId="glyph-displacement-strength" label="Strength" value={settings.strength} min={0} max={220} step={2} onChange={(strength) => patchDisplacement({ strength })} />
        <Range label="Response radius" value={settings.responseRadius} min={40} max={1200} step={10} onChange={(responseRadius) => patchDisplacement({ responseRadius })} />
        <label className="field compact-field">
          <span>Falloff</span>
          <select value={settings.falloff} onChange={(event) => patchDisplacement({ falloff: event.target.value as ProjectState["glyphDisplacement"]["falloff"] })}>
            <option value="smoothstep">Smoothstep</option>
            <option value="gaussian">Gaussian</option>
            <option value="linear">Linear</option>
          </select>
        </label>
        <Range label="Slice / cell size" value={settings.fragmentSize} min={8} max={180} step={2} onChange={(fragmentSize) => patchDisplacement({ fragmentSize })} />
        {fragmentMode && <Range label="Gap" value={settings.gap} min={0} max={64} step={1} onChange={(gap) => patchDisplacement({ gap })} />}
        <Range label="Offset steps" value={settings.quantizationSteps} min={1} max={16} step={1} onChange={(quantizationSteps) => patchDisplacement({ quantizationSteps })} />
        <Range label="Direction" value={settings.direction} min={-180} max={180} step={5} onChange={(direction) => patchDisplacement({ direction })} />
        <Range label="Radial / tangential" value={settings.radialTangential} min={-100} max={100} step={5} onChange={(radialTangential) => patchDisplacement({ radialTangential })} />
        <Range label="Jitter" value={settings.jitter} min={0} max={100} step={2} onChange={(jitter) => patchDisplacement({ jitter })} />
        {fragmentMode && <Range label="Fragment rotation" value={settings.fragmentRotation} min={0} max={8} step={0.25} onChange={(fragmentRotation) => patchDisplacement({ fragmentRotation })} />}
        <Range label="Seed influence" value={settings.seedInfluence} min={0} max={100} step={5} onChange={(seedInfluence) => patchDisplacement({ seedInfluence })} />
      </fieldset>

      <div className="control-group nested-group">
        <div className="section-subheading">Dot matrix</div>
        <label className={`debug-toggle${!dotGridAvailable ? " disabled" : ""}`}>
          <input
            data-testid="dot-grid-enabled"
            type="checkbox"
            checked={state.dotGrid.enabled}
            disabled={!dotGridAvailable && !state.dotGrid.enabled}
            onChange={(event) => patchDotGrid({ enabled: event.target.checked })}
          />
          <span>Regular world grid</span>
        </label>
        <small>{dotGridAvailable ? "Vector circles sampled against the active glyph domain." : "Available with SDF Halftone."}</small>
        <fieldset disabled={!dotGridAvailable || !state.dotGrid.enabled}>
          <legend className="visually-hidden">Dot matrix parameters</legend>
          <Range testId="dot-grid-spacing" label="Grid spacing" value={state.dotGrid.spacing} min={4} max={32} step={1} onChange={(spacing) => patchDotGrid({ spacing })} />
          <Range label="Dot radius" value={state.dotGrid.radius} min={0.5} max={8} step={0.1} onChange={(radius) => patchDotGrid({ radius })} />
          <Range label="Threshold" value={state.dotGrid.threshold} min={0.1} max={0.9} step={0.05} onChange={(threshold) => patchDotGrid({ threshold })} />
          <Range label="Edge softness" value={state.dotGrid.edgeSoftness} min={0} max={1} step={0.05} onChange={(edgeSoftness) => patchDotGrid({ edgeSoftness })} />
        </fieldset>
      </div>

      <div className="control-group nested-group" data-testid="display-dislocation-controls">
        <div className="section-subheading">Display Dislocation</div>
        <label className={`debug-toggle${!displayAvailable ? " disabled" : ""}`}>
          <input
            data-testid="display-dislocation-enabled"
            type="checkbox"
            checked={displaySettings.enabled}
            disabled={!displayAvailable && !displaySettings.enabled}
            onChange={(event) => patchDisplayDislocation({ enabled: event.target.checked })}
          />
          <span>Dislocate dot display</span>
        </label>
        <small className={displayAvailable && state.emitter.enabled ? "control-note" : "control-warning"}>
          {!dotGridAvailable
            ? "Available with SDF Halftone."
            : !state.dotGrid.enabled
              ? "Enable the regular Dot matrix first."
              : !state.emitter.enabled
                ? "Enable an emitter to define the local response."
                : "Inverse-domain sampling keeps the world lattice fixed and exports vector circles."}
        </small>
        {displaySettings.enabled && settings.enabled && (
          <small className="control-note">
            Display Dislocation samples the original glyph mask; saved Glyph Fragmentation settings remain unchanged.
          </small>
        )}
        <fieldset disabled={!displayAvailable || !displaySettings.enabled}>
          <legend className="visually-hidden">Display dislocation parameters</legend>
          <label className="field compact-field">
            <span>Region mode</span>
            <select
              data-testid="display-dislocation-mode"
              value={displaySettings.mode}
              onChange={(event) => patchDisplayDislocation({ mode: event.target.value as ProjectState["displayDislocation"]["mode"] })}
            >
              <option value="horizontal-bands">Local horizontal bands</option>
              <option value="vertical-bands">Local vertical bands</option>
              <option value="blocks">Local rectangular blocks</option>
            </select>
          </label>
          <Range label="Display response radius" value={displaySettings.responseRadius} min={40} max={900} step={10} onChange={(responseRadius) => patchDisplayDislocation({ responseRadius })} />
          <label className="field compact-field">
            <span>Falloff</span>
            <select value={displaySettings.falloff} onChange={(event) => patchDisplayDislocation({ falloff: event.target.value as ProjectState["displayDislocation"]["falloff"] })}>
              <option value="smoothstep">Smoothstep</option>
              <option value="gaussian">Gaussian</option>
              <option value="linear">Linear</option>
            </select>
          </label>
          <Range testId="display-dislocation-amount" label="Displacement amount" value={displaySettings.displacementAmount} min={0} max={160} step={2} onChange={(displacementAmount) => patchDisplayDislocation({ displacementAmount })} />
          <Range label="Band / cell size" value={displaySettings.regionSize} min={8} max={160} step={2} onChange={(regionSize) => patchDisplayDislocation({ regionSize })} />
          <Range label="Display gap" value={displaySettings.gap} min={0} max={48} step={1} onChange={(gap) => patchDisplayDislocation({ gap })} />
          <Range label="Display offset steps" value={displaySettings.quantizationSteps} min={1} max={16} step={1} onChange={(quantizationSteps) => patchDisplayDislocation({ quantizationSteps })} />
          <Range label="Display direction" value={displaySettings.direction} min={-180} max={180} step={5} onChange={(direction) => patchDisplayDislocation({ direction })} />
          <Range label="Alternating offset" value={displaySettings.alternatingOffset} min={0} max={100} step={5} onChange={(alternatingOffset) => patchDisplayDislocation({ alternatingOffset })} />
          <Range label="Radial bias" value={displaySettings.radialBias} min={0} max={60} step={5} onChange={(radialBias) => patchDisplayDislocation({ radialBias })} />
          <label className="field compact-field">
            <span>Seed</span>
            <input
              data-testid="display-dislocation-seed"
              type="number"
              min={0}
              max={999999}
              step={1}
              value={displaySettings.seed}
              onChange={(event) => patchDisplayDislocation({ seed: Number(event.target.value) })}
            />
          </label>
        </fieldset>
      </div>
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
        title="Double-click to reset"
        onDoubleClick={() => resetValue !== undefined && onChange(resetValue)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
