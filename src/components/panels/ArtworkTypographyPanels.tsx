import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type RefObject } from "react";
import {
  LINE_HEIGHT_BOUNDS,
  SIZE_HARD_LIMITS,
  resolveTextOffsetBounds,
  resolveTypographySizeBounds,
} from "../../engine/numericBounds";
import type { TextGeometry } from "../../engine/glyphGeometry";
import type { ProjectState } from "../../types";
import type { SizeRangeHandlers } from "../../hooks/useSizeInteraction";
import { ArtworkPanel, TypographyPanel } from "./PanelSection";

interface ArtworkTypographyPanelsProps {
  state: ProjectState;
  setState: (state: ProjectState | ((current: ProjectState) => ProjectState)) => void;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onFontUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearFont: () => void;
  fontLoaded: boolean;
  textGeometry?: TextGeometry | null;
  sizeDisplayFontSize: number;
  sizeHandlers: SizeRangeHandlers;
}

/** Soft slider band for tracking; typed entry uses the same hard limits as schema. */
const TRACKING_BOUNDS = { softMin: -10, softMax: 18, hardMin: -10, hardMax: 18, step: 1, defaultValue: -3 } as const;
const KERNING_STRENGTH_BOUNDS = { softMin: 0, softMax: 2, hardMin: 0, hardMax: 2, step: 0.05, defaultValue: 1 } as const;

export function ArtworkTypographyPanels(props: ArtworkTypographyPanelsProps) {
  const { state, setState, fontFileRef, onFontUpload, onClearFont, fontLoaded, sizeDisplayFontSize, sizeHandlers } = props;
  // Functional patch so Line height / Tracking edits cannot clobber a concurrent Size commit.
  const patch = (next: Partial<ProjectState>) => setState((current) => ({ ...current, ...next }));
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
          hardMin={sizeBounds.min}
          hardMax={sizeBounds.hardMax}
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
            <Range
              label="Tracking"
              value={state.tracking}
              defaultValue={TRACKING_BOUNDS.defaultValue}
              min={TRACKING_BOUNDS.softMin}
              max={TRACKING_BOUNDS.softMax}
              hardMin={TRACKING_BOUNDS.hardMin}
              hardMax={TRACKING_BOUNDS.hardMax}
              step={TRACKING_BOUNDS.step}
              onChange={(tracking) => patch({ tracking })}
            />
            <Range
              label="Line height"
              value={state.lineHeight}
              defaultValue={LINE_HEIGHT_BOUNDS.defaultValue}
              min={LINE_HEIGHT_BOUNDS.softMin}
              max={LINE_HEIGHT_BOUNDS.softMax}
              hardMin={LINE_HEIGHT_BOUNDS.hardMin}
              hardMax={LINE_HEIGHT_BOUNDS.hardMax}
              step={LINE_HEIGHT_BOUNDS.step}
              onChange={(lineHeight) => patch({ lineHeight })}
            />
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
              <Range
                label="Kerning strength"
                value={state.kerningStrength}
                defaultValue={KERNING_STRENGTH_BOUNDS.defaultValue}
                min={KERNING_STRENGTH_BOUNDS.softMin}
                max={KERNING_STRENGTH_BOUNDS.softMax}
                hardMin={KERNING_STRENGTH_BOUNDS.hardMin}
                hardMax={KERNING_STRENGTH_BOUNDS.hardMax}
                step={KERNING_STRENGTH_BOUNDS.step}
                onChange={(kerningStrength) => patch({ kerningStrength })}
              />
              <Range
                label="Vertical offset"
                value={state.textOffsetY}
                defaultValue={0}
                min={offsetBounds.min}
                max={offsetBounds.softMax}
                hardMin={-SIZE_HARD_LIMITS.textOffset}
                hardMax={SIZE_HARD_LIMITS.textOffset}
                step={offsetBounds.step}
                onChange={(textOffsetY) => patch({ textOffsetY })}
              />
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

function formatRangeValue(value: number, step: number) {
  if (!Number.isFinite(value)) return String(value);
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Double-click the numeric readout to type a value (slider stays soft-bounded). */
function RangeValueField({
  label,
  value,
  step,
  hardMin,
  hardMax,
  testId,
  onCommit,
}: {
  label: string;
  value: number;
  step: number;
  hardMin: number;
  hardMax: number;
  testId?: string;
  onCommit: (next: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatRangeValue(value, step));
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(formatRangeValue(value, step));
  }, [editing, step, value]);

  useEffect(() => {
    if (!editing) return;
    const node = editRef.current;
    if (!node) return;
    node.focus();
    node.select();
  }, [editing]);

  const commitRaw = (raw: string) => {
    const parsed = Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(formatRangeValue(value, step));
      setEditing(false);
      return;
    }
    const next = clampNumber(parsed, hardMin, hardMax);
    onCommit(next);
    setDraft(formatRangeValue(next, step));
    setEditing(false);
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRaw(event.currentTarget.value);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatRangeValue(value, step));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={editRef}
        className="range-value-edit"
        type="text"
        inputMode="decimal"
        data-testid={testId ? `${testId}-edit` : undefined}
        aria-label={`${label} value`}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commitRaw(event.currentTarget.value)}
        onKeyDown={onEditKeyDown}
        onClick={(event) => event.preventDefault()}
      />
    );
  }

  return (
    <output
      data-testid={testId}
      title="Double-click to type a value"
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDraft(formatRangeValue(value, step));
        setEditing(true);
      }}
    >
      {formatRangeValue(value, step)}
    </output>
  );
}

function SizeRange({ label, value, min, max, step = 1, defaultValue, hardMin, hardMax, handlers }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  hardMin: number;
  hardMax: number;
  handlers: SizeRangeHandlers;
}) {
  // Local display value so the thumb tracks the pointer immediately. Parent
  // `value` is draft-coalesced via rAF and can lag (or stick after double-click
  // reset while settling re-renders), which freezes a fully controlled range.
  const [displayValue, setDisplayValue] = useState(value);
  const scrubbingRef = useRef(false);
  // Remount after reset so the browser clears any stuck native range state.
  const [inputEpoch, setInputEpoch] = useState(0);

  useEffect(() => {
    if (!scrubbingRef.current) {
      setDisplayValue(value);
    }
  }, [value]);

  const endScrub = (next: number) => {
    scrubbingRef.current = false;
    setDisplayValue(next);
  };

  const commitTyped = (next: number) => {
    scrubbingRef.current = false;
    setDisplayValue(next);
    setInputEpoch((epoch) => epoch + 1);
    // Idle/settling change path commits fontSize without a pointer gesture.
    handlers.onInput(next, "change");
  };

  const sliderMin = Math.min(min, displayValue, hardMax);
  const sliderMax = Math.max(max, displayValue, hardMin);
  const sliderValue = clampNumber(displayValue, sliderMin, sliderMax);

  return (
    <label className="range">
      <span>
        {label}
        <RangeValueField
          label={label}
          value={displayValue}
          step={step}
          hardMin={hardMin}
          hardMax={hardMax}
          testId="size-value"
          onCommit={commitTyped}
        />
      </span>
      <input
        key={inputEpoch}
        data-testid="size-control"
        type="range"
        value={sliderValue}
        min={sliderMin}
        max={sliderMax}
        step={step}
        title="Double-click to reset"
        onPointerDown={(event) => {
          scrubbingRef.current = true;
          const next = Number(event.currentTarget.value);
          setDisplayValue(next);
          handlers.onPointerDown(next, event.pointerId, event.currentTarget);
        }}
        onKeyDown={(event) => {
          scrubbingRef.current = true;
          handlers.onKeyDown(Number(event.currentTarget.value));
        }}
        onKeyUp={(event) => {
          const next = Number(event.currentTarget.value);
          endScrub(next);
          handlers.onKeyUp(next);
        }}
        onPointerUp={(event) => {
          const next = Number(event.currentTarget.value);
          endScrub(next);
          handlers.onPointerUp(next, event.pointerId);
        }}
        onLostPointerCapture={(event) => {
          const next = Number(event.currentTarget.value);
          endScrub(next);
          handlers.onLostPointerCapture(next);
        }}
        onBlur={(event) => {
          const next = Number(event.currentTarget.value);
          endScrub(next);
          handlers.onBlur(next);
        }}
        onDoubleClick={() => {
          scrubbingRef.current = false;
          setDisplayValue(defaultValue);
          setInputEpoch((epoch) => epoch + 1);
          handlers.onDoubleClickReset(displayValue, defaultValue);
        }}
        onInput={(event) => {
          const next = Number(event.currentTarget.value);
          scrubbingRef.current = true;
          setDisplayValue(next);
          handlers.onInput(next, "input");
        }}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          handlers.onInput(next, "change");
        }}
      />
    </label>
  );
}

function Range({
  label,
  value,
  min,
  max,
  step = 1,
  defaultValue,
  hardMin,
  hardMax,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  defaultValue: number;
  /** Absolute floor for typed entry (defaults to slider min). */
  hardMin?: number;
  /** Absolute ceiling for typed entry (defaults to slider max). */
  hardMax?: number;
  onChange: (value: number) => void;
}) {
  const clampMin = hardMin ?? min;
  const clampMax = hardMax ?? max;
  // Expand the slider track when a typed value sits outside the soft band.
  const sliderMin = Math.min(min, value, clampMax);
  const sliderMax = Math.max(max, value, clampMin);
  const sliderValue = clampNumber(value, sliderMin, sliderMax);

  return (
    <label className="range">
      <span>
        {label}
        <RangeValueField
          label={label}
          value={value}
          step={step}
          hardMin={clampMin}
          hardMax={clampMax}
          onCommit={onChange}
        />
      </span>
      <input
        type="range"
        value={sliderValue}
        min={sliderMin}
        max={sliderMax}
        step={step}
        title="Double-click to reset"
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
