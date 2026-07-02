import { useState } from "react";
import { resolveEmitterRadiusBounds } from "../../engine/numericBounds";
import { baseState } from "../../engine/presets";
import { addEmitterRow, duplicateEmitterRow, MAX_EMITTER_ROWS, removeEmitterRow, updateEmitterRow } from "../../engine/emitterEditor";
import { getGlyphDisplayLabel, type GlyphEmitterMetadata } from "../../engine/field/glyphEmitters";
import type { ProjectState } from "../../types";

interface EmitterControlsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  emitterGlyphs: GlyphEmitterMetadata[];
  consumerActive: boolean;
  open: boolean;
  onToggle: () => void;
}

const defaults: Record<string, number> = {
  Strength: baseState.emitter.amplitude,
  "Wave frequency": baseState.emitter.frequency,
  Phase: baseState.emitter.phase,
  Radius: baseState.emitter.radius,
  "Self influence": baseState.emitter.selfInfluence,
  "Neighbor influence": baseState.emitter.neighborInfluence,
  Weight: baseState.emitters[0].weight,
  "Radius ×": baseState.emitters[0].radiusMultiplier,
  "Global strength": baseState.emitter.amplitude,
  "Global wave frequency": baseState.emitter.frequency,
  "Global phase": baseState.emitter.phase,
  "Global base radius": baseState.emitter.radius,
  "Global self influence": baseState.emitter.selfInfluence,
  "Global neighbor influence": baseState.emitter.neighborInfluence,
};

export function EmitterControls({ state, setState, emitterGlyphs, consumerActive, open, onToggle }: EmitterControlsProps) {
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const eligibleGlyphs = emitterGlyphs.filter((glyph) => glyph.emitterEligible);
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const patchEmitter = (next: Partial<ProjectState["emitter"]>) => patchField({ emitter: { ...state.emitter, ...next } });
  const patchRow = (id: string, next: Partial<ProjectState["emitters"][number]>) => patchField({ emitters: updateEmitterRow(state.emitters, id, next) });
  const invalidGlyph = (glyphId: string | null) => Boolean(glyphId && !glyphId.startsWith("auto-") && !eligibleGlyphs.some((glyph) => glyph.glyphId === glyphId));
  const title = `Emitters · ${state.emitterMode === "single" ? "single" : `${state.emitters.filter((row) => row.enabled).length}/${state.emitters.length}`}`;

  return (
    <div className="control-group accordion-group emitter-editor">
      <button type="button" className="accordion-summary" onClick={onToggle} aria-expanded={open}><span>{open ? "▼" : "▶"}</span> {title}</button>
      {open && <div className="accordion-content">
        {!state.emitter.enabled && consumerActive && <div className="control-warning"><strong>⚠️ This renderer requires an active emitter field.</strong>{eligibleGlyphs.length > 0 ? <button type="button" onClick={() => patchEmitter({ enabled: true })}>Enable field</button> : <span>No eligible glyph found for current text/font.</span>}</div>}
        <div className="field compact-field">
          <span>Emitter mode</span>
          <div className="mode-switch" aria-label="Emitter mode">
            <button type="button" className={state.emitterMode === "single" ? "active" : ""} onClick={() => patchField({ emitterMode: "single" })}>Single</button>
            <button type="button" className={state.emitterMode === "multiple" ? "active" : ""} onClick={() => patchField({ emitterMode: "multiple" })}>Multiple</button>
          </div>
        </div>
        {state.emitterMode === "single"
          ? <SingleEmitter state={state} eligibleGlyphs={eligibleGlyphs} patchEmitter={patchEmitter} />
          : <>
              {eligibleGlyphs.length === 0 && <small className="emitter-inline-warning">No eligible glyphs in the current text.</small>}
              {consumerActive && state.emitter.enabled && !state.emitters.some((row) => row.enabled) && <small className="emitter-inline-warning">Enable an emitter row to drive this renderer.</small>}
              <div className="emitter-list">
                {state.emitters.map((row, index) => {
                  const expanded = Boolean(expandedRows[row.id]);
                  return <div key={row.id} className={`emitter-row${row.enabled ? "" : " is-disabled"}`}>
                    <div className="emitter-row-head">
                      <label className="emitter-enable"><input type="checkbox" checked={row.enabled} onChange={(event) => patchRow(row.id, { enabled: event.target.checked })} /><span>{String(index + 1).padStart(2, "0")}</span></label>
                      <select aria-label={`Emitter ${index + 1} glyph`} value={row.glyphId ?? "auto-first"} onChange={(event) => patchRow(row.id, { glyphId: event.target.value })}>
                        <option value="auto-first">First glyph</option><option value="auto-last">Last glyph</option><option value="auto-middle">Middle glyph</option><option value="auto-counter">Counter glyph</option>
                        {eligibleGlyphs.map((glyph) => <option key={glyph.glyphId} value={glyph.glyphId}>{getGlyphDisplayLabel(glyph)}</option>)}
                      </select>
                      <button type="button" className="emitter-detail-toggle" aria-label={`${expanded ? "Collapse" : "Expand"} emitter ${index + 1} controls`} aria-expanded={expanded} onClick={() => setExpandedRows((current) => ({ ...current, [row.id]: !current[row.id] }))}>{expanded ? "−" : "+"}</button>
                    </div>
                    {invalidGlyph(row.glyphId) && <small className="emitter-inline-warning">Selected glyph is unavailable; this row will be skipped.</small>}
                    {expanded && <div className="emitter-row-details">
                      <Range label="Weight" value={row.weight} min={0} max={2} step={0.05} onChange={(weight) => patchRow(row.id, { weight })} />
                      <Range label="Phase" value={row.phaseOffset} min={-6.3} max={6.3} step={0.1} onChange={(phaseOffset) => patchRow(row.id, { phaseOffset })} />
                      <Range label="Radius ×" value={row.radiusMultiplier} min={0.25} max={2} step={0.05} onChange={(radiusMultiplier) => patchRow(row.id, { radiusMultiplier })} />
                      <div className="emitter-row-actions">
                        <button type="button" disabled={state.emitters.length >= MAX_EMITTER_ROWS} onClick={() => patchField({ emitters: duplicateEmitterRow(state.emitters, row.id) })}>Duplicate</button>
                        <button type="button" disabled={state.emitters.length <= 1} onClick={() => patchField({ emitters: removeEmitterRow(state.emitters, row.id) })}>Remove</button>
                      </div>
                    </div>}
                  </div>;
                })}
              </div>
              <button type="button" className="emitter-add" disabled={state.emitters.length >= MAX_EMITTER_ROWS || eligibleGlyphs.length === 0} onClick={() => patchField({ emitters: addEmitterRow(state.emitters) })}>Add emitter · {state.emitters.length}/{MAX_EMITTER_ROWS}</button>
              <GlobalEmitter state={state} patchField={patchField} patchEmitter={patchEmitter} />
            </>}
      </div>}
    </div>
  );
}

function SingleEmitter({ state, eligibleGlyphs, patchEmitter }: { state: ProjectState; eligibleGlyphs: GlyphEmitterMetadata[]; patchEmitter: (next: Partial<ProjectState["emitter"]>) => void }) {
  const radiusBounds = resolveEmitterRadiusBounds({
    artboardWidth: state.artboard.width,
    artboardHeight: state.artboard.height,
    typographySize: state.fontSize,
    currentValue: state.emitter.radius,
  });
  return <div className="emitter-row">
    <div className="section-subheading">Single emitter</div>
    <label className="debug-toggle"><input type="checkbox" checked={state.emitter.enabled} onChange={(event) => patchEmitter({ enabled: event.target.checked })} /><span>Emitter enabled</span></label>
    <label className="field compact-field"><span>Source glyph</span><select value={state.emitter.glyphId ?? ""} onChange={(event) => patchEmitter({ glyphId: event.target.value || null })}><option value="">First eligible glyph</option><option value="auto-o-middle">Auto · O/o/0 or middle glyph</option>{eligibleGlyphs.map((glyph) => <option key={glyph.glyphId} value={glyph.glyphId}>{getGlyphDisplayLabel(glyph)}</option>)}</select></label>
    <label className="field compact-field"><span>Source mode</span><select value={state.emitter.sourceMode} onChange={(event) => patchEmitter({ sourceMode: event.target.value as ProjectState["emitter"]["sourceMode"] })}><option value="center">Center</option><option value="centroid">Centroid (approx.)</option><option value="counter-center">Counter center (heuristic)</option><option value="custom">Custom</option></select></label>
    <Range label="Strength" value={state.emitter.amplitude} min={0} max={4} step={0.1} onChange={(amplitude) => patchEmitter({ amplitude })} />
    <Range label="Wave frequency" value={state.emitter.frequency} min={0.005} max={0.5} step={0.005} onChange={(frequency) => patchEmitter({ frequency })} />
    <Range label="Phase" value={state.emitter.phase} min={-6.28} max={6.28} step={0.1} onChange={(phase) => patchEmitter({ phase })} />
    <Range label="Radius" value={state.emitter.radius} min={radiusBounds.min} max={radiusBounds.softMax} step={radiusBounds.step} onChange={(radius) => patchEmitter({ radius })} />
    <label className="field compact-field"><span>Falloff</span><select value={state.emitter.falloff} onChange={(event) => patchEmitter({ falloff: event.target.value as ProjectState["emitter"]["falloff"] })}><option value="smoothstep">Smoothstep</option><option value="gaussian">Gaussian</option><option value="linear">Linear</option></select></label>
    <Range label="Self influence" value={state.emitter.selfInfluence} min={0} max={3} step={0.1} onChange={(selfInfluence) => patchEmitter({ selfInfluence })} />
    <Range label="Neighbor influence" value={state.emitter.neighborInfluence} min={0} max={3} step={0.1} onChange={(neighborInfluence) => patchEmitter({ neighborInfluence })} />
    <label className="field compact-field"><span>Blend</span><select value={state.emitter.blendMode} onChange={(event) => patchEmitter({ blendMode: event.target.value as ProjectState["emitter"]["blendMode"] })}><option value="add">Add</option><option value="max">Max</option></select></label>
  </div>;
}

function GlobalEmitter({ state, patchField, patchEmitter }: { state: ProjectState; patchField: (next: Partial<ProjectState>) => void; patchEmitter: (next: Partial<ProjectState["emitter"]>) => void }) {
  const radiusBounds = resolveEmitterRadiusBounds({
    artboardWidth: state.artboard.width,
    artboardHeight: state.artboard.height,
    typographySize: state.fontSize,
    currentValue: state.emitter.radius,
  });
  return <div className="control-group nested-group">
    <div className="section-subheading">Global field shaping · all emitters</div><small className="inactive-hint">These shared controls intentionally affect every enabled emitter row.</small>
    <label className="debug-toggle"><input type="checkbox" checked={state.emitter.enabled} onChange={(event) => patchEmitter({ enabled: event.target.checked })} /><span>Global field enabled</span></label>
    <label className="field compact-field"><span>Shared source mode</span><select value={state.emitter.sourceMode} onChange={(event) => patchEmitter({ sourceMode: event.target.value as ProjectState["emitter"]["sourceMode"] })}><option value="center">Center</option><option value="centroid">Centroid (approx.)</option><option value="counter-center">Counter center (heuristic)</option><option value="custom">Custom</option></select></label>
    <Range label="Global strength" value={state.emitter.amplitude} min={0} max={4} step={0.1} onChange={(amplitude) => patchEmitter({ amplitude })} />
    <Range label="Global wave frequency" value={state.emitter.frequency} min={0.005} max={0.5} step={0.005} onChange={(frequency) => patchEmitter({ frequency })} />
    <Range label="Global phase" value={state.emitter.phase} min={-6.28} max={6.28} step={0.1} onChange={(phase) => patchEmitter({ phase })} />
    <Range label="Global base radius" value={state.emitter.radius} min={radiusBounds.min} max={radiusBounds.softMax} step={radiusBounds.step} onChange={(radius) => patchEmitter({ radius })} />
    <label className="field compact-field"><span>Global falloff</span><select value={state.emitter.falloff} onChange={(event) => patchEmitter({ falloff: event.target.value as ProjectState["emitter"]["falloff"] })}><option value="smoothstep">Smoothstep</option><option value="gaussian">Gaussian</option><option value="linear">Linear</option></select></label>
    <Range label="Global self influence" value={state.emitter.selfInfluence} min={0} max={3} step={0.1} onChange={(selfInfluence) => patchEmitter({ selfInfluence })} />
    <Range label="Global neighbor influence" value={state.emitter.neighborInfluence} min={0} max={3} step={0.1} onChange={(neighborInfluence) => patchEmitter({ neighborInfluence })} />
    <label className="field compact-field"><span>Global composition</span><select value={state.fieldBlendMode} onChange={(event) => patchField({ fieldBlendMode: event.target.value as ProjectState["fieldBlendMode"] })}><option value="add">Add</option><option value="max">Max</option></select></label>
  </div>;
}

function Range({ label, value, min, max, step = 1, onChange }: { label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void }) {
  const resetValue = defaults[label];
  return <label className="range"><span>{label}<output>{value}</output></span><input type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => resetValue !== undefined && onChange(resetValue)} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}
