import { useState } from "react";
import { baseState } from "../../engine/presets";
import { SIZE_HARD_LIMITS } from "../../engine/numericBounds";
import { getControlActivity } from "../../engine/controlOwnership";
import { getProductFeatureState } from "../../engine/parameterOwnership";
import type { ProjectState } from "../../types";
import { NumericRange } from "./NumericRange";
import { ProductSurfaceDisclosure } from "./ProductSurfaceDisclosure";
import { featureSummary, productStateLabel } from "./productSurfaceState";

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
  const activity = getControlActivity(state, true).emitterMicroResponseActivity;
  const featureState = getProductFeatureState(state, "emitter-micro-response");
  const [tuningOpen, setTuningOpen] = useState(false);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const patch = (next: Partial<ProjectState["emitterMicroResponse"]>) => setState({
    ...state,
    emitterMicroResponse: { ...response, ...next },
    preset: "Custom",
  });
  const responseActive = activity.active;
  const unsupportedMessage = capability === "unaffected"
    ? "This renderer is intentionally unaffected; its existing geometry remains unchanged."
    : "This renderer has no compatible final-circle and authoritative-SDF contract.";

  return (
    <div className={`control-group accordion-group emitter-micro-response${activity.retained ? " retained-group" : !supported ? " disabled-group" : ""}`} data-testid="emitter-micro-response" data-owner="Emitter Micro Response">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}>
        <span aria-hidden="true">{open ? "▼" : "▶"}</span>
        {activity.retained ? "Emitter Micro Response · retained / inactive" : supported ? featureSummary("Emitter Micro Response", featureState) : "Emitter Micro Response · unavailable"}
      </button>
      {open && (
        <div className="accordion-content">
          <small className={activity.retained || !supported ? "control-warning" : "inactive-hint"}>
            {activity.retained
              ? `Retained but inactive: ${activity.reason}.`
              : supported
                ? "Fine mark response after the authoritative glyph SDF and any Display Dislocation transform."
                : unsupportedMessage}
          </small>
          {activity.retained && <small className="retained-state-summary">
            Retained settings: Micro Response {response.enabled ? "on" : "off"} · Occupancy {response.occupancy === "disperse-exterior" ? "Disperse exterior" : response.occupancy === "exclude-interior" ? "Exclude interior" : "Legacy"}.
          </small>}
          {supported && <fieldset>
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
              <small>Applied after falloff and micro displacement; Exclude rejects intersections, Disperse relocates them outside.</small>
            </label>

            {responseActive && (
              <>
                <Range
                  label="Response radius"
                  value={response.responseRadius}
                  min={8}
                  max={720}
                  step={4}
                  hardMax={SIZE_HARD_LIMITS.emitterRadius}
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
          </fieldset>}
          <ProductSurfaceDisclosure label="Custom tuning…" open={tuningOpen} onToggle={() => setTuningOpen((value) => !value)} status={productStateLabel(featureState)} testId="emitter-micro-tuning">
            <Range label="Position detail" value={response.positionDetail} min={0} max={100} onChange={(positionDetail) => patch({ positionDetail })} controlId="emitterMicroResponse.positionDetail" />
            <Range label="Density breakup" value={response.densityBreakup} min={0} max={100} onChange={(densityBreakup) => patch({ densityBreakup })} controlId="emitterMicroResponse.densityBreakup" />
            <Range label="Detail scale" value={response.detailScale} min={2} max={96} step={2} onChange={(detailScale) => patch({ detailScale })} controlId="emitterMicroResponse.detailScale" />
          </ProductSurfaceDisclosure>
          <ProductSurfaceDisclosure label="Safety" surface="SAFETY" open={safetyOpen} onToggle={() => setSafetyOpen((value) => !value)} testId="emitter-micro-safety">
            <Range label="Max displacement" value={response.maxDisplacement} min={0} max={96} onChange={(maxDisplacement) => patch({ maxDisplacement })} controlId="emitterMicroResponse.maxDisplacement" />
          </ProductSurfaceDisclosure>
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
  hardMax,
  step = 1,
  onChange,
  controlId,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hardMax?: number;
  step?: number;
  onChange: (value: number) => void;
  controlId?: string;
}) {
  const resetValue = defaults[label];
  return <NumericRange parameter={`mark-response.emitter-micro.${label.toLowerCase().replaceAll(" ", "-")}`} controlId={controlId} label={label} value={value} min={min} max={max} hardMax={hardMax} step={step} resetValue={resetValue ?? value} onChange={onChange} />;
}
