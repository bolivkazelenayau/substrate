import { useState, type ChangeEvent, type RefObject } from "react";
import { resolveTextOffsetBounds, resolveTypographySizeBounds } from "../../engine/numericBounds";
import type { TextGeometry } from "../../engine/glyphGeometry";
import type { ProjectState } from "../../types";
import type { SizeRangeHandlers } from "../../hooks/useSizeInteraction";
import { ArtworkPanel, TypographyPanel } from "./PanelSection";

interface ArtworkTypographyPanelsProps {
  state: ProjectState;
  setState: (state: ProjectState) => void;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onFontUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearFont: () => void;
  fontLoaded: boolean;
  textGeometry?: TextGeometry | null;
  sizeDisplayFontSize: number;
  sizeHandlers: SizeRangeHandlers;
}

export function ArtworkTypographyPanels(props: ArtworkTypographyPanelsProps) {
  const { state, setState, fontFileRef, onFontUpload, onClearFont, fontLoaded, sizeDisplayFontSize, sizeHandlers } = props;
  const patch = (next: Partial<ProjectState>) => setState({ ...state, ...next });
  const [typographyOpen, setTypographyOpen] = useState(false);
  const sizeBounds = resolveTypographySizeBounds({
    artboardWidth: state.artboard.width,
    artboardHeight: state.artboard.height,
    typographySize: state.fontSize,
    currentValue: sizeDisplayFontSize,
  });
  const offsetBounds = resolveTextOffsetBounds({
    artboardWidth: state.artboard.width,
    artboardHeight: state.artboard.height,
    typographySize: state.fontSize,
    currentValue: state.textOffsetY,
  });

  return (
    <>
      <ArtworkPanel className="text-section">
        <div className="section-heading"><span>01</span><h2>Artwork</h2></div>
        <label className="field">
          <span>Text substrate</span>
          <textarea value={state.text} rows={3} maxLength={280} onChange={(event) => patch({ text: event.target.value })} />
        </label>
        <SizeRange
          label="Size"
          value={sizeDisplayFontSize}
          defaultValue={148}
          min={sizeBounds.min}
          max={sizeBounds.softMax}
          step={sizeBounds.step}
          handlers={sizeHandlers}
        />
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

      <TypographyPanel className="advanced-disclosure-section">
        <button type="button" className="accordion-summary" onClick={() => setTypographyOpen((open) => !open)} aria-expanded={typographyOpen}>
          <span>{typographyOpen ? "▼" : "▶"}</span> Advanced typography
        </button>
        {typographyOpen && (
          <div className="accordion-content">
            <Range label="Tracking" value={state.tracking} defaultValue={-3} min={-10} max={18} onChange={(tracking) => patch({ tracking })} />
            <Range label="Line height" value={state.lineHeight} defaultValue={1} min={0.8} max={2.5} step={0.05} onChange={(lineHeight) => patch({ lineHeight })} />
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
              <Range label="Vertical offset" value={state.textOffsetY} defaultValue={0} min={offsetBounds.min} max={offsetBounds.softMax} step={offsetBounds.step} onChange={(textOffsetY) => patch({ textOffsetY })} />
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
          </div>
        )}
      </TypographyPanel>
    </>
  );
}

function SizeRange({ label, value, min, max, step = 1, defaultValue, handlers }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  handlers: SizeRangeHandlers;
}) {
  return (
    <label className="range">
      <span>{label}<output data-testid="size-value">{value}</output></span>
      <input
        data-testid="size-control"
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        title="Double-click to reset"
        onPointerDown={(event) => handlers.onPointerDown(Number(event.currentTarget.value), event.pointerId, event.currentTarget)}
        onKeyDown={(event) => handlers.onKeyDown(Number(event.currentTarget.value))}
        onKeyUp={(event) => handlers.onKeyUp(Number(event.currentTarget.value))}
        onPointerUp={(event) => handlers.onPointerUp(Number(event.currentTarget.value), event.pointerId)}
        onLostPointerCapture={(event) => handlers.onLostPointerCapture(Number(event.currentTarget.value))}
        onBlur={(event) => handlers.onBlur(Number(event.currentTarget.value))}
        onDoubleClick={() => handlers.onDoubleClickReset(value, defaultValue)}
        onInput={(event) => handlers.onInput(Number(event.currentTarget.value), "input")}
        onChange={(event) => handlers.onInput(Number(event.currentTarget.value), "change")}
      />
    </label>
  );
}

function Range({ label, value, min, max, step = 1, defaultValue, onChange }: { label: string; value: number; min: number; max: number; step?: number; defaultValue: number; onChange: (value: number) => void }) {
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
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}