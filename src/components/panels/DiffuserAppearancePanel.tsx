import { baseState } from "../../engine/presets";
import { getControlActivity } from "../../engine/controlOwnership";
import type { ProjectState } from "../../types";

interface DiffuserAppearancePanelProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  parsedFontPathsAvailable: boolean;
}

const defaults: Record<string, number> = {
  "Outline width": baseState.outlineStrokeWidth,
  "Overlay opacity": baseState.textOverlayOpacity,
  "Edge erosion": baseState.edgeErosionAmount,
  "Erosion width": baseState.edgeErosionWidth,
  "Interior protection": baseState.interiorProtection,
  "Warp amount": baseState.outlineWarpAmount,
  "Warp scale": baseState.outlineWarpScale,
  "Warp smoothing": baseState.outlineWarpSmoothing,
  "Warp edge bias": baseState.outlineWarpEdgeBias,
  "Max displacement": baseState.outlineWarpMaxDisplacement,
};

export function DiffuserAppearancePanel({ state, setState, parsedFontPathsAvailable }: DiffuserAppearancePanelProps) {
  if (state.renderer !== "glyph-diffuser") return null;
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const activity = getControlActivity(state, parsedFontPathsAvailable);

  return (
    <section className="control-section">
      <div className="section-heading"><span>03</span><h2>Overlay & Effects</h2></div>
      <label className="field compact-field">
        <span>Overlay mode</span>
        <select value={state.overlayMode} onChange={(event) => patchField({ overlayMode: event.target.value as ProjectState["overlayMode"] })}>
          <option value="solid">Solid</option><option value="outline">Outline</option><option value="knockout">Knockout</option><option value="hidden">Hidden</option>
          <option value="warped-outline">{parsedFontPathsAvailable ? "Warped outline" : "Warped outline · load font"}</option>
        </select>
      </label>
      {state.overlayMode === "outline" && <Range label="Outline width" value={state.outlineStrokeWidth} min={0.25} max={16} step={0.25} onChange={(outlineStrokeWidth) => patchField({ outlineStrokeWidth })} />}
      {state.overlayMode !== "hidden" && <Range label="Overlay opacity" value={state.textOverlayOpacity} min={0} max={1} step={0.05} onChange={(textOverlayOpacity) => patchField({ textOverlayOpacity })} />}
      {activity.edgeErosion && (
        <div className="control-group nested-group" style={{ marginTop: "12px", paddingTop: "10px", borderTop: "1px dashed #2a2a26" }}>
          <div className="section-subheading">Edge Erosion</div>
          <Range label="Edge erosion" value={state.edgeErosionAmount} min={0} max={1} step={0.05} onChange={(edgeErosionAmount) => patchField({ edgeErosionAmount })} />
          <Range label="Erosion width" value={state.edgeErosionWidth} min={0} max={64} onChange={(edgeErosionWidth) => patchField({ edgeErosionWidth })} />
          <Range label="Interior protection" value={state.interiorProtection} min={0} max={1} step={0.05} onChange={(interiorProtection) => patchField({ interiorProtection })} />
        </div>
      )}
      {state.overlayMode === "warped-outline" && (
        <div className={`control-group nested-group ${!activity.warp ? "disabled-group" : ""}`}>
          <div className="section-subheading">Warped Outline</div>
          {!activity.warp ? <small className="inactive-hint">Warped outline requires a loaded .ttf/.otf font.</small> : (
            <>
              <Range label="Warp amount" value={state.outlineWarpAmount} min={0} max={60} onChange={(outlineWarpAmount) => patchField({ outlineWarpAmount })} />
              <Range label="Warp scale" value={state.outlineWarpScale} min={0.25} max={3} step={0.05} onChange={(outlineWarpScale) => patchField({ outlineWarpScale })} />
              <Range label="Warp smoothing" value={state.outlineWarpSmoothing} min={0} max={1} step={0.05} onChange={(outlineWarpSmoothing) => patchField({ outlineWarpSmoothing })} />
              <Range label="Warp edge bias" value={state.outlineWarpEdgeBias} min={0} max={1} step={0.05} onChange={(outlineWarpEdgeBias) => patchField({ outlineWarpEdgeBias })} />
              <Range label="Max displacement" value={state.outlineWarpMaxDisplacement} min={0} max={80} onChange={(outlineWarpMaxDisplacement) => patchField({ outlineWarpMaxDisplacement })} />
              <label className="debug-toggle"><input type="checkbox" checked={state.preserveCounters} onChange={(event) => patchField({ preserveCounters: event.target.checked })} /><span>Preserve counters</span></label>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const resetValue = defaults[label];
  return <label className="range"><span>{label}<output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => resetValue !== undefined && onChange(resetValue)} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
