import { baseState } from "../../engine/presets";
import type { ProjectState } from "../../types";

interface EmitterMicroResponseControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  supported: boolean;
  capability: "supported" | "unaffected" | "unsupported";
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  "Position detail": baseState.emitterMicroResponse.positionDetail,
  "Density breakup": baseState.emitterMicroResponse.densityBreakup,
  "Detail scale": baseState.emitterMicroResponse.detailScale,
  "Response radius": baseState.emitterMicroResponse.responseRadius,
  "Max displacement": baseState.emitterMicroResponse.maxDisplacement,
  "Exterior push": baseState.emitterMicroResponse.exteriorPush,
  "Tangential flow": baseState.emitterMicroResponse.tangentialFlow,
  Divergence: baseState.emitterMicroResponse.divergence,
  "Exterior shell": baseState.emitterMicroResponse.exteriorShell,
};

export function EmitterMicroResponseControls({
  state,
  setState,
  supported,
  capability,
  open,
  onToggle,
}: EmitterMicroResponseControlsProps) {
  const response = state.emitterMicroResponse;
  const patch = (next: Partial<ProjectState["emitterMicroResponse"]>) => setState({
    ...state,
    emitterMicroResponse: { ...response, ...next },
    preset: "Custom",
  });
  const responseActive = response.enabled || response.occupancy !== "legacy";
  const unsupportedMessage = capability === "unaffected"
    ? "This renderer is intentionally unaffected; its existing geometry remains unchanged."
    : "This renderer has no compatible final-circle and authoritative-SDF contract.";

  return (
    <div className={`control-group accordion-group emitter-micro-response${supported ? "" : " disabled-group"}`}>
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        Emitter Micro Response{supported ? "" : " · unavailable"}
      </button>
      {open && (
        <div className="accordion-content">
          <small className="inactive-hint">
            {supported
              ? "Fine mark response after the authoritative glyph SDF and any Display Dislocation transform."
              : unsupportedMessage}
          </small>
          <fieldset disabled={!supported}>
            <legend className="visually-hidden">Emitter Micro Response parameters</legend>
            <label className="debug-toggle">
              <input
                type="checkbox"
                data-testid="emitter-micro-enabled"
                checked={response.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              <span>Enable micro response</span>
            </label>
            <label className="debug-toggle">
              <input
                type="checkbox"
                data-testid="emitter-micro-occupancy-enabled"
                checked={response.occupancy !== "legacy"}
                onChange={(event) => patch({
                  occupancy: event.target.checked ? "exclude-interior" : "legacy",
                })}
              />
              <span>Enable solid-glyph occupancy</span>
            </label>
            <label className="field compact-field">
              <span>Occupancy</span>
              <select
                data-testid="emitter-micro-occupancy"
                value={response.occupancy}
                onChange={(event) => patch({
                  occupancy: event.target.value as ProjectState["emitterMicroResponse"]["occupancy"],
                })}
              >
                <option value="legacy">Legacy</option>
                <option value="exclude-interior">Exclude interior</option>
                <option value="disperse-exterior">Disperse exterior</option>
              </select>
              <small>Occupancy is independent from positional detail and density breakup.</small>
            </label>

            {responseActive && (
              <>
                <Range
                  label="Response radius"
                  value={response.responseRadius}
                  min={8}
                  max={720}
                  step={4}
                  onChange={(responseRadius) => patch({ responseRadius })}
                />
                <label className="field compact-field">
                  <span>Falloff</span>
                  <select
                    value={response.falloff}
                    onChange={(event) => patch({
                      falloff: event.target.value as ProjectState["emitterMicroResponse"]["falloff"],
                    })}
                  >
                    <option value="smoothstep">Smoothstep</option>
                    <option value="gaussian">Gaussian</option>
                    <option value="linear">Linear</option>
                  </select>
                </label>
              </>
            )}

            {response.enabled && (
              <>
                <Range
                  label="Position detail"
                  value={response.positionDetail}
                  min={0}
                  max={100}
                  onChange={(positionDetail) => patch({ positionDetail })}
                />
                <Range
                  label="Density breakup"
                  value={response.densityBreakup}
                  min={0}
                  max={100}
                  onChange={(densityBreakup) => patch({ densityBreakup })}
                />
                <Range
                  label="Detail scale"
                  value={response.detailScale}
                  min={2}
                  max={96}
                  step={2}
                  onChange={(detailScale) => patch({ detailScale })}
                />
                <Range
                  label="Max displacement"
                  value={response.maxDisplacement}
                  min={0}
                  max={96}
                  onChange={(maxDisplacement) => patch({ maxDisplacement })}
                />
              </>
            )}

            {response.occupancy !== "legacy" && (
              <>
                <Range
                  label="Exterior shell"
                  value={response.exteriorShell}
                  min={1}
                  max={160}
                  step={1}
                  onChange={(exteriorShell) => patch({ exteriorShell })}
                />
              </>
            )}

            {response.occupancy === "disperse-exterior" && (
              <>
                <Range
                  label="Exterior push"
                  value={response.exteriorPush}
                  min={0}
                  max={100}
                  onChange={(exteriorPush) => patch({ exteriorPush })}
                />
                <Range
                  label="Tangential flow"
                  value={response.tangentialFlow}
                  min={0}
                  max={100}
                  onChange={(tangentialFlow) => patch({ tangentialFlow })}
                />
                <Range
                  label="Divergence"
                  value={response.divergence}
                  min={0}
                  max={100}
                  onChange={(divergence) => patch({ divergence })}
                />
              </>
            )}
          </fieldset>
          {supported && !state.emitter.enabled && (
            <small className="emitter-inline-warning">Enable an emitter to activate this response.</small>
          )}
          {supported && (
            <small className="inactive-hint">
              Active footprint modes always use the final solid glyph silhouette, including enclosed counters and holes. Circle radius and raster tolerance are checked last.
            </small>
          )}
        </div>
      )}
    </div>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const resetValue = defaults[label];
  return (
    <label className="range">
      <span>{label}<output>{value}</output></span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        title="Double-click to reset"
        onDoubleClick={() => onChange(resetValue)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
