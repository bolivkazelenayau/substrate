import { useState, type ChangeEvent, type RefObject } from "react";
import { previewBackends, recommendedPreviewBackends } from "../../engine/previewBackend";
import type { SubstrateDebugMode } from "../../engine/substrate";
import type { DebugSettings, DiagnosticsMode, PreviewSettings, ProjectState } from "../../types";
import { AppearancePanel, DiagnosticsPanel, ExportPanel, PreviewPanel } from "./PanelSection";

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

interface OutputPanelsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  previewSettings: PreviewSettings;
  onPreviewSettingsChange: (settings: PreviewSettings) => void;
  diagnosticsMode: DiagnosticsMode;
  onDiagnosticsModeChange: (mode: DiagnosticsMode) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
}

export function OutputPanels(props: OutputPanelsProps) {
  const { state, setState, previewSettings, onPreviewSettingsChange, diagnosticsMode, onDiagnosticsModeChange, fileRef, onImport } = props;
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next });
  const setDebug = <K extends keyof DebugSettings,>(id: K, value: DebugSettings[K]) =>
    patch({ debug: { ...state.debug, [id]: value } });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const displayedPreviewBackend = state.renderer === "flow" ? previewSettings.backend : "svg-dom";
  const recommendedPreviewBackend = recommendedPreviewBackends[state.preset];
  const sectionNumber = state.renderer === "glyph-diffuser" ? "05" : "04";

  return (
    <>
      <AppearancePanel>
        <div className="section-heading"><span>{sectionNumber}</span><h2>Appearance</h2></div>
        <div className="control-group nested-group appearance-controls">
          <div className="color-control-grid">
            <ColorControl label="Primary" value={state.primaryColor} onChange={(primaryColor) => patch({ primaryColor })} />
            <ColorControl label="Outline" value={state.outlineColor} onChange={(outlineColor) => patch({ outlineColor })} />
            <ColorControl label="Background" value={state.backgroundColor} onChange={(backgroundColor) => patch({ backgroundColor })} />
          </div>
        </div>
      </AppearancePanel>

      <PreviewPanel>
        <button type="button" className="section-heading panel-heading-button" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen}>
          <span>{sectionNumber}</span><h2>Preview · Advanced Output</h2>
        </button>
        {previewOpen && (
          <div className="accordion-content">
            <label className="field compact-field">
              <span>Preview Mode</span>
              <select value={displayedPreviewBackend} onChange={(event) => onPreviewSettingsChange({ ...previewSettings, backend: event.target.value as PreviewSettings["backend"] })}>
                <option value="canvas-2d" disabled={state.renderer !== "flow"}>{previewBackends["canvas-2d"].label} · {previewBackends["canvas-2d"].detail}</option>
                <option value="svg-dom">{previewBackends["svg-dom"].label} · {previewBackends["svg-dom"].detail}</option>
              </select>
              <small>{recommendedPreviewBackend === "canvas-2d" ? "Recommended for Edge Current · Export remains full vector SVG." : "Export remains full vector SVG."}</small>
            </label>
            <label className="field compact-field">
              <span>Preview Quality</span>
              <select value={previewSettings.quality} onChange={(event) => onPreviewSettingsChange({ ...previewSettings, quality: event.target.value as PreviewSettings["quality"] })}>
                <option value="full">Full · 24 opacity levels</option><option value="balanced">Balanced · 12 opacity levels</option><option value="performance">Performance · 8 opacity levels</option>
              </select>
              <small>Preview only · every path stays synchronized; SVG export remains full quality.</small>
            </label>
            <label className="field compact-field">
              <span>FPS cap</span>
              <select value={previewSettings.fpsCap} onChange={(event) => onPreviewSettingsChange({ ...previewSettings, fpsCap: Number(event.target.value) as PreviewSettings["fpsCap"] })}>
                <option value={24}>24 FPS</option><option value={30}>30 FPS</option><option value={60}>60 FPS · experimental / high load</option>
              </select>
            </label>
            <div className="toggle-grid preview-toggles">
              <Toggle checked={previewSettings.reducedMotion} label="Static preview" onChange={(checked) => onPreviewSettingsChange({ ...previewSettings, reducedMotion: checked })} />
              <Toggle checked={previewSettings.pauseWhenHidden} label="Pause when hidden" onChange={(checked) => onPreviewSettingsChange({ ...previewSettings, pauseWhenHidden: checked })} />
            </div>
          </div>
        )}
      </PreviewPanel>

      <ExportPanel>
        <div className="section-heading"><span>{sectionNumber}</span><h2>Export</h2></div>
        <div className="mode-switch">
          <button className={state.exportMode === "artwork" ? "active" : ""} onClick={() => patch({ exportMode: "artwork" })}>Final Artwork SVG</button>
          <button className={state.exportMode === "editable" ? "active" : ""} onClick={() => patch({ exportMode: "editable" })}>Editable Text SVG</button>
        </div>
        <Toggle checked={state.transparentBackground} label="Transparent background" onChange={(transparentBackground) => patch({ transparentBackground })} />
        <label className="field compact-field"><span>Export frame</span><select value={state.exportFrameMode} onChange={(event) => patch({ exportFrameMode: event.target.value as ProjectState["exportFrameMode"] })}><option value="current">Current visible frame</option><option value="time-zero">Deterministic time = 0</option></select></label>
        <label className="field compact-field"><span>Numeric precision</span><select value={state.precision} onChange={(event) => patch({ precision: Number(event.target.value) })}><option value={0}>0 decimals</option><option value={1}>1 decimal</option><option value={2}>2 decimals</option><option value={3}>3 decimals</option></select></label>
        <div className="file-actions"><button onClick={() => fileRef.current?.click()}>Import project JSON</button><input ref={fileRef} hidden type="file" accept=".json,application/json" onChange={onImport} /></div>
      </ExportPanel>

      <DiagnosticsPanel>
        <button type="button" className="section-heading panel-heading-button" onClick={() => setDiagnosticsOpen((open) => !open)} aria-expanded={diagnosticsOpen}>
          <span>{state.renderer === "glyph-diffuser" ? "08" : "07"}</span><h2>Diagnostics</h2>
        </button>
        {diagnosticsOpen && (
          <div className="accordion-content">
            <label className="field compact-field"><span>Diagnostics visibility</span><select value={diagnosticsMode} onChange={(event) => onDiagnosticsModeChange(event.target.value as DiagnosticsMode)}><option value="off">Off</option><option value="compact">Compact</option><option value="full">Full</option></select></label>
            <small>WebGPU field tools are preview/debug-only — not export.</small>
            <label className="field"><span>Substrate view</span><select value={state.debug.substrateMode} onChange={(event) => setDebug("substrateMode", event.target.value as SubstrateDebugMode)}><option value="none">None</option><option value="glyph-outlines">Glyph outlines</option><option value="mask">Raster mask</option><option value="edge">Edge map</option><option value="distance">Signed distance</option><option value="gradient">Distance gradient</option></select></label>
            <div className="toggle-grid">{debugToggles.map((toggle) => <Toggle key={toggle.id} checked={state.debug[toggle.id]} label={toggle.label} onChange={(checked) => setDebug(toggle.id, checked)} />)}</div>
          </div>
        )}
      </DiagnosticsPanel>
    </>
  );
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="debug-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}</span></label>;
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="color-control"><span>{label}</span><input type="color" value={value} aria-label={`${label} artwork color`} onChange={(event) => onChange(event.target.value)} /><output>{value.toUpperCase()}</output></label>;
}
