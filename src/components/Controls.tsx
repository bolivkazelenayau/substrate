import { memo, type ChangeEvent, type RefObject } from "react";
import { applyPreset, presetIds } from "../engine/presets";
import { getRenderer, rendererList } from "../engine/renderers";
import type { DebugSettings, FieldControlId, PreviewSettings, ProjectState } from "../types";
import type { SubstrateDebugMode } from "../engine/substrate";
import { getGlyphDisplayLabel, type GlyphEmitterMetadata } from "../engine/field/glyphEmitters";

interface Props {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onFontUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearFont: () => void;
  fontLoaded: boolean;
  previewSettings: PreviewSettings;
  onPreviewSettingsChange: (settings: PreviewSettings) => void;
  emitterGlyphs: GlyphEmitterMetadata[];
}

const fieldControls: Array<{ id: FieldControlId; label: string; min: number; max: number; step?: number }> = [
  { id: "density", label: "Density", min: 10, max: 80 },
  { id: "amplitude", label: "Amplitude", min: 2, max: 44 },
  { id: "frequency", label: "Frequency", min: 6, max: 34 },
  { id: "turbulence", label: "Turbulence", min: 0, max: 100 },
  { id: "edgeInfluence", label: "Edge influence", min: 0, max: 100 },
];

type BooleanDebugKey = Exclude<keyof DebugSettings, "substrateMode">;

const debugToggles: Array<{ id: BooleanDebugKey; label: string }> = [
  { id: "glyphBounds", label: "Glyph bounds" },
  { id: "maskBounds", label: "Text bounds" },
  { id: "baseline", label: "Baseline" },
  { id: "glyphOrigins", label: "Glyph origins" },
  { id: "markOrigins", label: "Mark origins" },
  { id: "emitter", label: "Emitter anchor / radius" },
  { id: "waveField", label: "Composite wave field" },
  { id: "markCount", label: "Mark count" },
  { id: "frameTime", label: "Frame / time" },
  { id: "costEstimate", label: "Export estimate" },
];

export const Controls = memo(function Controls({ state, setState, fileRef, onImport, fontFileRef, onFontUpload, onClearFont, fontLoaded, previewSettings, onPreviewSettingsChange, emitterGlyphs }: Props) {
  const renderer = getRenderer(state.renderer);
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next });
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const setDebug = <K extends keyof DebugSettings,>(id: K, value: DebugSettings[K]) =>
    patch({ debug: { ...state.debug, [id]: value } });
  const patchEmitter = (next: Partial<ProjectState["emitter"]>) =>
    patchField({ emitter: { ...state.emitter, ...next } });

  return (
    <aside className="controls">
      <section className="control-section text-section">
        <div className="section-heading"><span>01</span><h2>Source</h2></div>
        <label className="field">
          <span>Text substrate</span>
          <textarea value={state.text} rows={2} maxLength={28} onChange={(event) => patch({ text: event.target.value })} />
        </label>
        <div className="split">
          <Range label="Size" value={state.fontSize} min={64} max={220} onChange={(fontSize) => patch({ fontSize })} />
          <Range label="Tracking" value={state.tracking} min={-10} max={18} onChange={(tracking) => patch({ tracking })} />
        </div>
        <div className="font-loader">
          <div>
            <span>Outline font</span>
            <strong>{state.font?.family ?? "Native fallback"}</strong>
            <small>{state.font ? `${state.font.fileName} · ${fontLoaded ? "loaded" : "reference only"}` : "Arial Black / browser text"}</small>
          </div>
          <div className="font-actions">
            <button onClick={() => fontFileRef.current?.click()}>{state.font ? "Replace" : "Load font"}</button>
            {state.font && <button onClick={onClearFont}>Clear</button>}
          </div>
          <input ref={fontFileRef} hidden type="file" accept=".ttf,.otf,font/ttf,font/otf" onChange={onFontUpload} />
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>02</span><h2>Field</h2></div>
        <label className="field">
          <span>Preset</span>
          <select value={state.preset} onChange={(event) => setState(applyPreset(state, event.target.value as ProjectState["preset"]))}>
            {presetIds.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <div className="segmented" aria-label="Renderer">
          {rendererList.map((item) => (
            <button key={item.id} className={state.renderer === item.id ? "active" : ""} onClick={() => patchField({ renderer: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
        {fieldControls.map((control) => (
          <Range
            key={control.id}
            label={control.label}
            value={state[control.id]}
            min={control.min}
            max={control.max}
            step={control.step}
            disabled={!renderer.supportedControls.includes(control.id)}
            onChange={(value) => patchField({ [control.id]: value })}
          />
        ))}
        <div className="emitter-controls">
          <div className="section-subheading">Glyph emitter</div>
          <label className="debug-toggle">
            <input type="checkbox" checked={state.emitter.enabled} disabled={emitterGlyphs.length === 0} onChange={(event) => patchEmitter({ enabled: event.target.checked })} />
            <span>Enable emitter</span>
          </label>
          <label className="field compact-field">
            <span>Source glyph</span>
            <select value={state.emitter.glyphId ?? ""} onChange={(event) => patchEmitter({ glyphId: event.target.value || null })}>
              <option value="">First eligible glyph</option>
              <option value="auto-o-middle">Auto · O/o/0 or middle glyph</option>
              {emitterGlyphs.filter((glyph) => glyph.emitterEligible).map((glyph) => <option key={glyph.glyphId} value={glyph.glyphId}>{getGlyphDisplayLabel(glyph)}</option>)}
            </select>
          </label>
          <label className="field compact-field">
            <span>Source mode</span>
            <select value={state.emitter.sourceMode} onChange={(event) => patchEmitter({ sourceMode: event.target.value as ProjectState["emitter"]["sourceMode"] })}>
              <option value="center">Center</option><option value="centroid">Centroid (approx.)</option><option value="counter-center">Counter center (heuristic)</option><option value="custom">Custom</option>
            </select>
          </label>
          <Range label="Strength" value={state.emitter.amplitude} min={0} max={4} step={0.1} onChange={(amplitude) => patchEmitter({ amplitude })} />
          <Range label="Wave frequency" value={state.emitter.frequency} min={0.005} max={0.5} step={0.005} onChange={(frequency) => patchEmitter({ frequency })} />
          <Range label="Phase" value={state.emitter.phase} min={-6.28} max={6.28} step={0.1} onChange={(phase) => patchEmitter({ phase })} />
          <Range label="Radius" value={state.emitter.radius} min={20} max={1000} step={10} onChange={(radius) => patchEmitter({ radius })} />
          <label className="field compact-field"><span>Falloff</span><select value={state.emitter.falloff} onChange={(event) => patchEmitter({ falloff: event.target.value as ProjectState["emitter"]["falloff"] })}><option value="smoothstep">Smoothstep</option><option value="gaussian">Gaussian</option><option value="linear">Linear</option></select></label>
          <Range label="Self influence" value={state.emitter.selfInfluence} min={0} max={3} step={0.1} onChange={(selfInfluence) => patchEmitter({ selfInfluence })} />
          <Range label="Neighbor influence" value={state.emitter.neighborInfluence} min={0} max={3} step={0.1} onChange={(neighborInfluence) => patchEmitter({ neighborInfluence })} />
          <label className="field compact-field"><span>Blend</span><select value={state.emitter.blendMode} onChange={(event) => patchEmitter({ blendMode: event.target.value as ProjectState["emitter"]["blendMode"] })}><option value="add">Add</option><option value="max">Max</option></select></label>
          {["sdf-halftone", "sdf-contours", "sdf-streamlines", "glyph-diffuser"].includes(state.renderer) && <>
            <div className="section-subheading">Glyph modulation</div>
            <label className="field compact-field"><span>Mode</span><select value={state.glyphFieldMode} onChange={(event) => patchField({ glyphFieldMode: event.target.value as ProjectState["glyphFieldMode"] })}><option value="off">Off</option><option value="subtle">Subtle</option><option value="strong">Strong</option></select></label>
            <Range label="Influence" value={state.glyphFieldInfluence} min={0} max={100} disabled={state.glyphFieldMode === "off"} onChange={(glyphFieldInfluence) => patchField({ glyphFieldInfluence })} />
            <Range label="Displacement" value={state.glyphFieldDisplacement} min={0} max={40} disabled={state.glyphFieldMode === "off"} onChange={(glyphFieldDisplacement) => patchField({ glyphFieldDisplacement })} />
            <Range label="Density modulation" value={state.glyphFieldDensity} min={0} max={100} disabled={state.glyphFieldMode === "off"} onChange={(glyphFieldDensity) => patchField({ glyphFieldDensity })} />
            <Range label="Radius modulation" value={state.glyphFieldRadius} min={0} max={100} disabled={state.glyphFieldMode === "off"} onChange={(glyphFieldRadius) => patchField({ glyphFieldRadius })} />
            <Range label="Opacity modulation" value={state.glyphFieldOpacity} min={0} max={100} disabled={state.glyphFieldMode === "off"} onChange={(glyphFieldOpacity) => patchField({ glyphFieldOpacity })} />
          </>}
          {state.renderer === "wave-contours" && <>
            <label className="field compact-field"><span>Contour mode</span><select value={state.waveContourMode} onChange={(event) => patchField({ waveContourMode: event.target.value as ProjectState["waveContourMode"] })}><option value="continuous">Continuous</option><option value="dotted">Dotted</option></select></label>
            {state.waveContourMode === "dotted" && <>
              <Range label="Dot spacing" value={state.waveDotSpacing} min={3} max={40} onChange={(waveDotSpacing) => patchField({ waveDotSpacing })} />
              <Range label="Dot radius" value={state.waveDotRadius} min={0.4} max={8} step={0.1} onChange={(waveDotRadius) => patchField({ waveDotRadius })} />
            </>}
          </>}
          {state.renderer === "glyph-diffuser" && <>
            <label className="field compact-field"><span>Diffuser domain</span><select value={state.diffuserDomain} onChange={(event) => patchField({ diffuserDomain: event.target.value as ProjectState["diffuserDomain"] })}><option value="inside-text">Inside text</option><option value="halo">Emitter halo</option><option value="text-halo">Text + halo</option></select></label>
            <label className="field compact-field"><span>Composition</span><select value={state.diffuserComposition} onChange={(event) => patchField({ diffuserComposition: event.target.value as ProjectState["diffuserComposition"] })}><option value="behind-text">Behind text</option><option value="through-text">Through text</option><option value="text-reactive">Text-reactive edges</option><option value="edge-eroded">Edge-eroded overlay</option><option value="clipped">Clipped to text</option></select></label>
            <Range label="Dot radius" value={state.diffuserDotRadius} min={0.4} max={8} step={0.1} onChange={(diffuserDotRadius) => patchField({ diffuserDotRadius })} />
            <Range label="Ring contrast" value={state.diffuserRingContrast} min={0} max={1} step={0.05} onChange={(diffuserRingContrast) => patchField({ diffuserRingContrast })} />
            <Range label="Halo padding" value={state.diffuserHaloPadding} min={0} max={400} step={10} onChange={(diffuserHaloPadding) => patchField({ diffuserHaloPadding })} />
          </>}
        </div>
      </section>

      <section className="control-section">
        <div className="section-heading"><span>03</span><h2>Output</h2></div>
        <div className="mode-switch">
          <button className={state.exportMode === "artwork" ? "active" : ""} onClick={() => patch({ exportMode: "artwork" })}>Final artwork</button>
          <button className={state.exportMode === "editable" ? "active" : ""} onClick={() => patch({ exportMode: "editable" })}>Editable text</button>
        </div>
        <label className="field compact-field">
          <span>Preview backend</span>
          <select
            value={previewSettings.backend}
            onChange={(event) => onPreviewSettingsChange({
              ...previewSettings,
              backend: event.target.value as PreviewSettings["backend"],
            })}
          >
            <option value="auto">Auto (Canvas for dense Flow Lines)</option>
            <option value="canvas-2d">Canvas 2D</option>
            <option value="svg-dom">SVG DOM (debug / slow when dense)</option>
          </select>
        </label>
        <label className="field compact-field">
          <span>Export frame</span>
          <select value={state.exportFrameMode} onChange={(event) => patch({ exportFrameMode: event.target.value as ProjectState["exportFrameMode"] })}>
            <option value="current">Current visible frame</option>
            <option value="time-zero">Deterministic time = 0</option>
          </select>
        </label>
        <Range label="Node budget" value={state.maxNodes} min={400} max={5000} step={100} onChange={(maxNodes) => patchField({ maxNodes })} />
        <label className="field compact-field">
          <span>Substrate quality</span>
          <select value={state.substrateQuality} onChange={(event) => patch({ substrateQuality: event.target.value as ProjectState["substrateQuality"] })}>
            <option value="low">Low · 256 px</option>
            <option value="medium">Medium · 384 px</option>
            <option value="high">High · 512 px</option>
            <option value="ultra">Ultra · 768 px (slow)</option>
          </select>
          {state.substrateQuality === "ultra" && <small>Ultra uses the worker when available; CPU fallback may block.</small>}
        </label>
        <label className="field compact-field">
          <span>Preview FPS</span>
          <select
            value={previewSettings.fpsCap}
            onChange={(event) => onPreviewSettingsChange({
              ...previewSettings,
              fpsCap: Number(event.target.value) as PreviewSettings["fpsCap"],
            })}
          >
            <option value={24}>24 FPS</option>
            <option value={30}>30 FPS</option>
            <option value={60}>60 FPS · experimental / high load</option>
          </select>
        </label>
        <div className="toggle-grid preview-toggles">
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={previewSettings.pauseWhenHidden}
              onChange={(event) => onPreviewSettingsChange({ ...previewSettings, pauseWhenHidden: event.target.checked })}
            />
            <span>Pause when hidden</span>
          </label>
          <label className="debug-toggle">
            <input
              type="checkbox"
              checked={previewSettings.reducedMotion}
              onChange={(event) => onPreviewSettingsChange({ ...previewSettings, reducedMotion: event.target.checked })}
            />
            <span>Static preview</span>
          </label>
        </div>
        <div className="file-actions">
          <button onClick={() => fileRef.current?.click()}>Import JSON</button>
          <input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={onImport} />
        </div>
      </section>

      <section className="control-section debug-section">
        <div className="section-heading"><span>04</span><h2>Debug overlay</h2></div>
        <label className="field">
          <span>Substrate view</span>
          <select value={state.debug.substrateMode} onChange={(event) => setDebug("substrateMode", event.target.value as SubstrateDebugMode)}>
            <option value="none">None</option>
            <option value="glyph-outlines">Glyph outlines</option>
            <option value="mask">Raster mask</option>
            <option value="edge">Edge map</option>
            <option value="distance">Signed distance</option>
            <option value="gradient">Distance gradient</option>
          </select>
        </label>
        <div className="toggle-grid">
          {debugToggles.map((toggle) => (
            <label key={toggle.id} className="debug-toggle">
              <input type="checkbox" checked={state.debug[toggle.id]} onChange={(event) => setDebug(toggle.id, event.target.checked)} />
              <span>{toggle.label}</span>
            </label>
          ))}
        </div>
      </section>
    </aside>
  );
}, (previous, next) => (
  previous.state === next.state
  && previous.fontLoaded === next.fontLoaded
  && previous.previewSettings === next.previewSettings
  && previous.emitterGlyphs === next.emitterGlyphs
));

function Range({ label, value, min, max, step = 1, disabled = false, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <label className={`range${disabled ? " disabled" : ""}`}>
      <span>{label}<output>{disabled ? "N/A" : value}</output></span>
      <input disabled={disabled} type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
