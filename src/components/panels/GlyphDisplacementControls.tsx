import { useState } from "react";
import { baseState } from "../../engine/presets";
import { SIZE_HARD_LIMITS } from "../../engine/numericBounds";
import { getControlActivity } from "../../engine/controlOwnership";
import { getProductFeatureState } from "../../engine/parameterOwnership";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";
import { ProductSurfaceDisclosure } from "./ProductSurfaceDisclosure";
import { featureSummary, productStateLabel } from "./productSurfaceState";

interface GlyphDisplacementControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
  open: boolean;
  onToggle: () => void;
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
};

export function GlyphDisplacementControls({ state, setState, parsedFontPathsAvailable, open, onToggle }: GlyphDisplacementControlsProps) {
  const settings = state.glyphDisplacement;
  const activity = getControlActivity(state, parsedFontPathsAvailable).glyphDisplacement;
  const featureState = getProductFeatureState(state, "fragmentation");
  const [tuningOpen, setTuningOpen] = useState(false);
  const canToggle = activity.supported || settings.enabled;
  const summary = activity.retained
    ? "Glyph Fragmentation · retained / inactive"
    : activity.supported
      ? featureSummary("Glyph Fragmentation", featureState)
      : "Glyph Fragmentation · unavailable";
  const patchProject = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const patchDisplacement = (next: Partial<ProjectState["glyphDisplacement"]>) => {
    const enabling = next.enabled === true;
    patchProject({
      glyphDisplacement: { ...settings, ...next },
      ...(enabling ? { displayDislocation: { ...state.displayDislocation, enabled: false } } : {}),
    });
  };
  const fragmentMode = settings.mode !== "warp";
  const sliceMode = settings.mode === "horizontal-slices" || settings.mode === "vertical-slices";
  const localizedSlice = sliceMode && settings.sliceInfluence === "emitter-falloff";

  return (
    <div className={`control-group accordion-group glyph-displacement-section${activity.retained ? " retained-group" : ""}`} data-testid="glyph-displacement-controls" data-owner="Glyph Fragmentation">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {summary}
      </button>
      {open && <div className="accordion-content">
        <label className={`debug-toggle${!canToggle || activity.retained ? " disabled" : ""}`}>
          <input
            data-testid="glyph-displacement-enabled"
            type="checkbox"
            data-project-enabled={settings.enabled ? "true" : "false"}
            data-pipeline-active={activity.active ? "true" : "false"}
            checked={activity.active}
            disabled={!canToggle || activity.retained}
            onChange={(event) => patchDisplacement({ enabled: event.target.checked })}
          />
          <span>{activity.retained ? "Fragment glyph domain · retained / inactive" : "Fragment glyph domain"}</span>
        </label>
        <small className={activity.active || activity.supported ? "control-note" : "control-warning"}>
          {activity.retained
            ? `Retained but inactive: ${activity.reason}.`
            : activity.active
              ? "Exact parsed-outline stage · shared by mask, SDF, preview, and export."
              : parsedFontPathsAvailable
                ? "Enable Fragmentation to edit its parsed-outline geometry stage."
                : "Load a .ttf/.otf outline font to enable exact glyph displacement. Native fallback stays undisplaced."}
        </small>
        {activity.active && <fieldset>
          <legend className="visually-hidden">Glyph fragmentation parameters</legend>
          <label className="field compact-field">
            <span>Mode</span>
            <select data-testid="glyph-displacement-mode" value={settings.mode} onChange={(event) => patchDisplacement({ mode: event.target.value as ProjectState["glyphDisplacement"]["mode"] })}>
              <option value="warp">Domain warp</option>
              <option value="horizontal-slices">Horizontal slices</option>
              <option value="vertical-slices">Vertical slices</option>
              <option value="grid">Grid cells</option>
              <option value="radial-sectors">Radial sectors</option>
            </select>
          </label>
          {sliceMode && <label className="field compact-field">
            <span>Slice influence</span>
            <select data-testid="glyph-slice-influence" value={settings.sliceInfluence} onChange={(event) => patchDisplacement({ sliceInfluence: event.target.value as ProjectState["glyphDisplacement"]["sliceInfluence"] })}>
              <option value="emitter-falloff">Emitter falloff</option>
              <option value="legacy">Global / Legacy</option>
            </select>
          </label>}
          <Range testId="glyph-displacement-strength" label="Strength" value={settings.strength} min={0} max={localizedSlice ? 80 : 220} step={2} onChange={(strength) => patchDisplacement({ strength })} />
          {!localizedSlice && <>
        <Range label="Response radius" value={settings.responseRadius} min={40} max={1200} step={10} hardMax={SIZE_HARD_LIMITS.emitterRadius} onChange={(responseRadius) => patchDisplacement({ responseRadius })} />
            <label className="field compact-field"><span>Falloff</span><select value={settings.falloff} onChange={(event) => patchDisplacement({ falloff: event.target.value as ProjectState["glyphDisplacement"]["falloff"] })}><option value="smoothstep">Smoothstep</option><option value="gaussian">Gaussian</option><option value="linear">Linear</option></select></label>
          </>}
          {localizedSlice && <small className={state.emitter.enabled ? "control-note" : "control-warning"}>{state.emitter.enabled ? "Radius and edge softness come from the shared Glyph Influence envelope." : "Enable an emitter to position the Slice influence envelope."}</small>}
          <Range label="Slice / cell size" value={settings.fragmentSize} min={8} max={180} step={2} onChange={(fragmentSize) => patchDisplacement({ fragmentSize })} />
          {fragmentMode && <Range label="Gap" value={settings.gap} min={0} max={64} step={1} onChange={(gap) => patchDisplacement({ gap })} />}
          <Range label="Direction" value={settings.direction} min={-180} max={180} step={5} onChange={(direction) => patchDisplacement({ direction })} />
          <Range label="Radial / tangential" value={settings.radialTangential} min={-100} max={100} step={5} onChange={(radialTangential) => patchDisplacement({ radialTangential })} />
          <Range label="Jitter" value={settings.jitter} min={0} max={100} step={2} onChange={(jitter) => patchDisplacement({ jitter })} />
          {fragmentMode && <Range label="Fragment rotation" value={settings.fragmentRotation} min={0} max={8} step={0.25} onChange={(fragmentRotation) => patchDisplacement({ fragmentRotation })} />}
        </fieldset>}
        <ProductSurfaceDisclosure label="Custom tuning…" open={tuningOpen} onToggle={() => setTuningOpen((value) => !value)} status={productStateLabel(featureState)} testId="glyph-displacement-tuning">
          <Range label="Offset steps" value={settings.quantizationSteps} min={1} max={16} step={1} onChange={(quantizationSteps) => patchDisplacement({ quantizationSteps })} controlId="glyphDisplacement.quantizationSteps" />
          <Range label="Seed influence" value={settings.seedInfluence} min={0} max={100} step={5} onChange={(seedInfluence) => patchDisplacement({ seedInfluence })} controlId="glyphDisplacement.seedInfluence" />
        </ProductSurfaceDisclosure>
      </div>}
    </div>
  );
}

export function RendererLocalControls({ state, setState, open, onToggle }: { state: ProjectState; setState: (state: ProjectState) => void; open: boolean; onToggle: () => void }) {
  const [displayTuningOpen, setDisplayTuningOpen] = useState(false);
  const activity = getControlActivity(state, true);
  const dotGridSupported = activity.dotGrid.supported;
  const displaySettings = state.displayDislocation;
  const displayFeatureState = getProductFeatureState(state, "display-dislocation");
  const displayConfigured = displaySettings.enabled;
  const patchProject = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const patchDotGrid = (next: Partial<ProjectState["dotGrid"]>) => patchProject({ dotGrid: { ...state.dotGrid, ...next } });
  const patchDisplay = (next: Partial<ProjectState["displayDislocation"]>) => patchProject({ displayDislocation: { ...displaySettings, ...next } });
  return (
    <div className="control-group accordion-group renderer-local-controls" data-testid="renderer-local-controls" data-owner="Renderer-local controls">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> Renderer-local controls
      </button>
      {open && <div className="accordion-content">
        <div className={`control-group nested-group${!dotGridSupported ? " disabled-group" : ""}`} data-testid="dot-grid-controls" data-owner="SDF Halftone Dot Matrix">
          <div className="section-subheading">Dot Matrix{dotGridSupported ? "" : " · unavailable"}</div>
          <label className={`debug-toggle${!dotGridSupported ? " disabled" : ""}`}>
            <input data-testid="dot-grid-enabled" type="checkbox" checked={state.dotGrid.enabled} data-project-enabled={state.dotGrid.enabled ? "true" : "false"} data-pipeline-active={activity.dotGrid.active ? "true" : "false"} disabled={!dotGridSupported && !state.dotGrid.enabled} onChange={(event) => patchDotGrid({ enabled: event.target.checked })} />
            <span>{activity.dotGrid.retained ? "Regular world grid · retained / inactive" : "Regular world grid"}</span>
          </label>
          <small className={activity.dotGrid.retained ? "control-warning" : "inactive-hint"}>{activity.dotGrid.retained ? `Retained but inactive: ${activity.dotGrid.reason}.` : dotGridSupported ? "Vector circles sampled against the active glyph domain." : "Available with SDF Halftone."}</small>
          {activity.dotGrid.active && <fieldset>
            <legend className="visually-hidden">Dot matrix parameters</legend>
           <Range testId="dot-grid-spacing" label="Grid spacing" value={state.dotGrid.spacing} min={4} max={32} step={1} onChange={(spacing) => patchDotGrid({ spacing })} />
           <Range label="Dot radius" value={state.dotGrid.radius} min={0.5} max={8} step={0.1} onChange={(radius) => patchDotGrid({ radius })} />
           <Range label="Threshold" value={state.dotGrid.threshold} min={0.1} max={0.9} step={0.05} onChange={(threshold) => patchDotGrid({ threshold })} />
           <Range label="Edge softness" value={state.dotGrid.edgeSoftness} min={0} max={1} step={0.05} onChange={(edgeSoftness) => patchDotGrid({ edgeSoftness })} controlId="dotGrid.edgeSoftness" />
           </fieldset>}
         </div>
        <div className={`control-group nested-group${!activity.displayDislocation.supported || (displayConfigured && !activity.displayDislocation.active) ? " retained-group" : ""}`} data-testid="display-dislocation-controls" data-owner="Display Dislocation">
          <div className="section-subheading">Display Dislocation{!activity.displayDislocation.supported ? " · unavailable" : ""}</div>
          <label className={`debug-toggle${!activity.displayDislocation.supported || (displayConfigured && !activity.displayDislocation.active) ? " disabled" : ""}`}>
            <input
              data-testid="display-dislocation-enabled"
              type="checkbox"
              data-project-enabled={displaySettings.enabled ? "true" : "false"}
              data-pipeline-active={activity.displayDislocation.active ? "true" : "false"}
              checked={activity.displayDislocation.active}
              disabled={!activity.displayDislocation.supported || (displayConfigured && !activity.displayDislocation.active)}
              onChange={(event) => patchProject({
                displayDislocation: { ...displaySettings, enabled: event.target.checked },
                ...(event.target.checked ? { glyphDisplacement: { ...state.glyphDisplacement, enabled: false } } : {}),
              })}
            />
            <span>{activity.displayDislocation.retained ? "Dislocate dot display · retained / inactive" : "Dislocate dot display"}</span>
          </label>
          <small className={activity.displayDislocation.retained ? "control-warning" : "inactive-hint"}>{activity.displayDislocation.retained ? `Retained but inactive: ${activity.displayDislocation.reason}.` : activity.displayDislocation.supported ? "Renderer-local inverse-domain response for the SDF Halftone dot grid." : "Available with SDF Halftone."}</small>
          {activity.displayDislocation.active && <fieldset>
            <legend className="visually-hidden">Display Dislocation parameters</legend>
            <label className="field compact-field"><span>Region mode</span><select data-testid="display-dislocation-mode" value={displaySettings.mode} onChange={(event) => patchDisplay({ mode: event.target.value as ProjectState["displayDislocation"]["mode"] })}><option value="horizontal-bands">Local horizontal bands</option><option value="vertical-bands">Local vertical bands</option><option value="blocks">Local rectangular blocks</option></select></label>
            <Range label="Display response radius" value={displaySettings.responseRadius} min={40} max={900} step={10} onChange={(responseRadius) => patchDisplay({ responseRadius })} />
            <label className="field compact-field"><span>Falloff</span><select value={displaySettings.falloff} onChange={(event) => patchDisplay({ falloff: event.target.value as ProjectState["displayDislocation"]["falloff"] })}><option value="smoothstep">Smoothstep</option><option value="gaussian">Gaussian</option><option value="linear">Linear</option></select></label>
            <Range testId="display-dislocation-amount" label="Displacement amount" value={displaySettings.displacementAmount} min={0} max={160} step={2} onChange={(displacementAmount) => patchDisplay({ displacementAmount })} />
            <Range label="Band / cell size" value={displaySettings.regionSize} min={8} max={160} step={2} onChange={(regionSize) => patchDisplay({ regionSize })} />
            <Range label="Display gap" value={displaySettings.gap} min={0} max={48} step={1} onChange={(gap) => patchDisplay({ gap })} />
            <Range label="Display direction" value={displaySettings.direction} min={-180} max={180} step={5} onChange={(direction) => patchDisplay({ direction })} />
            <Range label="Alternating offset" value={displaySettings.alternatingOffset} min={0} max={100} step={5} onChange={(alternatingOffset) => patchDisplay({ alternatingOffset })} />
            <Range label="Radial bias" value={displaySettings.radialBias} min={0} max={60} step={5} onChange={(radialBias) => patchDisplay({ radialBias })} />
          </fieldset>}
          <ProductSurfaceDisclosure label="Custom tuning…" open={displayTuningOpen} onToggle={() => setDisplayTuningOpen((value) => !value)} status={productStateLabel(displayFeatureState)} testId="display-dislocation-tuning">
            <Range label="Display offset steps" value={displaySettings.quantizationSteps} min={1} max={16} step={1} onChange={(quantizationSteps) => patchDisplay({ quantizationSteps })} controlId="displayDislocation.quantizationSteps" />
            <NumericRange parameter="renderer.display-dislocation-seed" controlId="displayDislocation.seed" label="Seed" value={displaySettings.seed} min={0} max={999999} hardMax={999999} step={1} resetValue={baseState.displayDislocation.seed} testId="display-dislocation-seed" onChange={(seed) => patchDisplay({ seed })} />
          </ProductSurfaceDisclosure>
        </div>
      </div>}
    </div>
  );
}

function Range({ testId, label, value, min, max, hardMax, step, onChange, controlId }: { testId?: string; label: string; value: number; min: number; max: number; hardMax?: number; step: number; onChange: (value: number) => void; controlId?: string }) {
  const resetValue = {
    ...defaults,
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
  }[label];
 return <NumericRange parameter={`glyph-geometry.fragmentation.${label.toLowerCase().replaceAll(" ", "-").replaceAll("/", "-")}`} controlId={controlId} label={label} value={value} min={min} max={max} hardMax={hardMax} step={step} resetValue={resetValue ?? value} testId={testId} onChange={onChange} />;
}
