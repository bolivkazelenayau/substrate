import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type NumericRangeMapping = "linear" | "logarithmic";

export interface NumericRangeProps {
  /** Stable semantic identity. Reset behavior must not depend on visible copy. */
  parameter: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  resetValue: number;
  hardMin?: number;
  hardMax?: number;
  testId?: string;
  disabled?: boolean;
  description?: ReactNode;
  /** Display-only suffix. The ProjectState value remains unchanged. */
  unit?: string;
  /** Display-only scale for implementation values (for example radians → degrees). */
  displayScale?: number;
  displayStep?: number;
  mapping?: NumericRangeMapping;
  onChange: (value: number) => void;
}

function formatValue(value: number, step: number) {
  if (!Number.isFinite(value)) return String(value);
  if (step >= 1) return String(Math.round(value));
  const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function mapToSlider(value: number, min: number, max: number, mapping: NumericRangeMapping) {
  if (mapping === "linear" || min <= 0 || max <= 0) return value;
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return ((Math.log(clamp(value, min, max)) - logMin) / (logMax - logMin)) * 100;
}

function mapFromSlider(position: number, min: number, max: number, mapping: NumericRangeMapping) {
  if (mapping === "linear" || min <= 0 || max <= 0) return position;
  const logMin = Math.log(min);
  const logMax = Math.log(max);
  return Math.exp(logMin + (clamp(position, 0, 100) / 100) * (logMax - logMin));
}

function formatWithUnit(value: number, step: number, unit?: string) {
  return `${formatValue(value, step)}${unit ? ` ${unit}` : ""}`;
}

/**
 * Shared authoring control for numeric ProjectState values.
 *
 * The slider can have a useful UI mapping without changing the stored value.
 * Exact entry always uses the document hard bounds, so imported values outside
 * the normal slider band remain visible and editable instead of being clamped.
 */
export function NumericRange({
  parameter,
  label,
  value,
  min,
  max,
  step = 1,
  resetValue,
  hardMin = min,
  hardMax = max,
  testId,
  disabled = false,
  description,
  unit,
  displayScale = 1,
  displayStep,
  mapping = "linear",
  onChange,
}: NumericRangeProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatValue(value, step));
  const editRef = useRef<HTMLInputElement>(null);
  const descriptionId = useId();
  const shownStep = displayStep ?? Math.abs(step * displayScale);
  const shownValue = value * displayScale;
  const shownResetValue = resetValue * displayScale;
  const outOfSoftRange = value < min || value > max;
  const sliderMin = mapping === "logarithmic" ? 0 : Math.min(min, value, hardMax);
  const sliderMax = mapping === "logarithmic" ? 100 : Math.max(max, value, hardMin);
  const sliderValue = mapping === "logarithmic"
    ? mapToSlider(value, min, max, mapping)
    : clamp(value, sliderMin, sliderMax);
  const sliderStep = mapping === "logarithmic" ? 1 : step;
  const helpText = [
    description,
    `Range ${formatWithUnit(min * displayScale, shownStep, unit)} to ${formatWithUnit(max * displayScale, shownStep, unit)}.`,
    outOfSoftRange ? "Retained imported value is outside the normal slider range." : undefined,
    "Arrow adjusts by one step; Shift+Arrow adjusts coarsely; Alt+Arrow adjusts finely.",
  ].filter(Boolean);

  useEffect(() => {
    if (!editing) setDraft(formatValue(shownValue, shownStep));
  }, [editing, shownStep, shownValue]);

  useEffect(() => {
    if (!editing) return;
    editRef.current?.focus();
    editRef.current?.select();
  }, [editing]);

  const beginEditing = () => {
    if (disabled) return;
    setDraft(formatValue(shownValue, shownStep));
    setEditing(true);
  };

  const commitRaw = (raw: string) => {
    const parsed = Number(String(raw).trim().replace(",", "."));
    if (!Number.isFinite(parsed)) {
      setDraft(formatValue(shownValue, shownStep));
      setEditing(false);
      return;
    }
    const next = clamp(parsed / displayScale, hardMin, hardMax);
    onChange(next);
    setDraft(formatValue(next * displayScale, shownStep));
    setEditing(false);
  };

  const onEditKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitRaw(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(formatValue(shownValue, shownStep));
      setEditing(false);
    }
  };

  const onSliderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Keyboard tuning is intentionally handled here instead of relying on browser-specific modifier behavior.
    if (disabled || mapping !== "linear" || (!event.shiftKey && !event.altKey)) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    const multiplier = event.shiftKey ? 5 : 0.1;
    const fineStep = step >= 1 ? step : step * multiplier;
    const next = clamp(value + direction * (event.altKey ? fineStep : step * multiplier), hardMin, hardMax);
    event.preventDefault();
    onChange(next);
  };

  const display = formatWithUnit(shownValue, shownStep, unit);
  const resetLabel = `Reset ${label} to ${formatWithUnit(shownResetValue, shownStep, unit)}`;

  return (
    <label className={`range${disabled ? " disabled" : ""}${outOfSoftRange ? " out-of-soft-range" : ""}`} data-parameter={parameter} data-out-of-soft-range={outOfSoftRange ? "true" : "false"}>
      <span>
        {label}
        {editing ? (
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
          />
        ) : (
          <output
            title={`Click or double-click to edit ${label}`}
            onClick={beginEditing}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              beginEditing();
            }}
          >
            <button type="button" className="range-value-button" aria-label={`${label} value, ${display}. Activate to edit`} onClick={beginEditing}>
              {display}
            </button>
          </output>
        )}
        {!disabled && value !== resetValue && (
          <button
            type="button"
            className="range-reset"
            aria-label={resetLabel}
            title={resetLabel}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              onChange(resetValue);
            }}
          >
            ↺
          </button>
        )}
      </span>
      <input
        data-testid={testId}
        data-parameter={parameter}
        aria-label={label}
        aria-describedby={descriptionId}
        aria-valuetext={display}
        disabled={disabled}
        type="range"
        value={sliderValue}
        min={sliderMin}
        max={sliderMax}
        step={sliderStep}
        onKeyDown={onSliderKeyDown}
        onDoubleClick={() => !disabled && onChange(resetValue)}
        onChange={(event) => onChange(mapFromSlider(Number(event.target.value), min, max, mapping))}
      />
      <small id={descriptionId} className="range-help">
        {helpText.map((item, index) => <span key={index}>{item}{index < helpText.length - 1 ? " " : ""}</span>)}
      </small>
    </label>
  );
}
