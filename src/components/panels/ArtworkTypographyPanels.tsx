import type { ChangeEvent, RefObject } from "react";
import type { ProjectState } from "../../types";
import { ArtworkPanel, TypographyPanel } from "./PanelSection";

interface ArtworkTypographyPanelsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onFontUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearFont: () => void;
  fontLoaded: boolean;
}

export function ArtworkTypographyPanels(props: ArtworkTypographyPanelsProps) {
  const { state, setState, fontFileRef, onFontUpload, onClearFont, fontLoaded } = props;
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next });

  return (
    <>
      <ArtworkPanel className="text-section">
        <div className="section-heading"><span>01</span><h2>Artwork</h2></div>
        <label className="field">
          <span>Text substrate</span>
          <textarea value={state.text} rows={2} maxLength={28} onChange={(event) => patch({ text: event.target.value })} />
        </label>
        <Range label="Size" value={state.fontSize} defaultValue={148} min={64} max={220} onChange={(fontSize) => patch({ fontSize })} />
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
      </ArtworkPanel>

      <TypographyPanel>
        <div className="section-heading"><span>02</span><h2>Typography</h2></div>
        <Range label="Tracking" value={state.tracking} defaultValue={-3} min={-10} max={18} onChange={(tracking) => patch({ tracking })} />
        <div className="split">
          <label className="field compact-field">
            <span>Kerning mode</span>
            <select value={state.kerningMode} onChange={(event) => patch({ kerningMode: event.target.value as ProjectState["kerningMode"] })}>
              <option value="font">Font</option><option value="none">None</option>
            </select>
          </label>
          <label className="field compact-field">
            <span>Text alignment</span>
            <select value={state.textAlign} onChange={(event) => patch({ textAlign: event.target.value as ProjectState["textAlign"] })}>
              <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
            </select>
          </label>
        </div>
        <div className="split">
          <Range label="Kerning strength" value={state.kerningStrength} defaultValue={1} min={0} max={2} step={0.05} onChange={(kerningStrength) => patch({ kerningStrength })} />
          <Range label="Vertical offset" value={state.textOffsetY} defaultValue={0} min={-120} max={120} onChange={(textOffsetY) => patch({ textOffsetY })} />
        </div>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={state.opticalSpacing}
            onChange={(event) => patch({
              opticalSpacing: event.target.checked,
              opticalSpacingStrength: event.target.checked && state.opticalSpacingStrength === 0 ? 0.25 : state.opticalSpacingStrength,
            })}
          />
          <span>Optical spacing</span>
        </label>
        <Range label="Optical strength" value={state.opticalSpacingStrength} defaultValue={0} min={0} max={1} step={0.05} onChange={(opticalSpacingStrength) => patch({ opticalSpacingStrength })} />
      </TypographyPanel>
    </>
  );
}

function Range({ label, value, min, max, step = 1, defaultValue, onChange }: { label: string; value: number; min: number; max: number; step?: number; defaultValue: number; onChange: (value: number) => void }) {
  return (
    <label className="range">
      <span>{label}<output>{value}</output></span>
      <input type="range" value={value} min={min} max={max} step={step} title="Double-click to reset" onDoubleClick={() => onChange(defaultValue)} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
