import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { applyPreset, baseState, getPresetDisplayLabel, presetIds } from "../../engine/presets";
import { getRenderer, rendererList } from "../../engine/renderers";
import type { SizeRangeHandlers } from "../../hooks/useSizeInteraction";
import type { DiagnosticsMode, FieldControlId, PreviewSettings, ProjectState } from "../../types";
import type { GlyphEmitterMetadata } from "../../engine/field/glyphEmitters";
import type { TextGeometry } from "../../engine/glyphGeometry";
import { getControlActivity } from "../../engine/controlOwnership";
import { FieldPanel } from "./PanelSection";
import { OutputPanels } from "./OutputPanels";
import { ArtworkTypographyPanels } from "./ArtworkTypographyPanels";
import { AdvancedFieldPanel } from "./AdvancedFieldPanel";
import { EmitterControls } from "./EmitterControls";

export interface FieldControlsProps {
  state: ProjectState;
  setState: (state: ProjectState | ((current: ProjectState) => ProjectState)) => void;
  fileRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  fontFileRef: RefObject<HTMLInputElement | null>;
  onFontUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onClearFont: () => void;
  fontLoaded: boolean;
  parsedFontPathsAvailable: boolean;
  previewSettings: PreviewSettings;
  onPreviewSettingsChange: (settings: PreviewSettings) => void;
  emitterGlyphs: GlyphEmitterMetadata[];
  textGeometry?: TextGeometry | null;
  diagnosticsMode: DiagnosticsMode;
  onDiagnosticsModeChange: (mode: DiagnosticsMode) => void;
  webGpuOverlayOpen?: boolean;
  fpsMeterOpen?: boolean;
  onToggleWebGpuOverlay?: () => void;
  onToggleFpsMeter?: () => void;
  sizeDisplayFontSize: number;
  sizeHandlers: SizeRangeHandlers;
}

const fieldControls: Array<{ id: FieldControlId; label: string; min: number; max: number; step?: number }> = [
  { id: "density", label: "Density", min: 10, max: 80 },
  { id: "amplitude", label: "Amplitude", min: 2, max: 44 },
  { id: "frequency", label: "Frequency", min: 6, max: 34 },
  { id: "turbulence", label: "Turbulence", min: 0, max: 100 },
  { id: "edgeInfluence", label: "Edge influence", min: 0, max: 100 },
];

const rangeDefaults: Record<string, number> = {
  Size: baseState.fontSize,
  Tracking: baseState.tracking,
  "Kerning strength": baseState.kerningStrength,
  "Vertical offset": baseState.textOffsetY,
  "Optical strength": baseState.opticalSpacingStrength,
  Density: baseState.density,
  Amplitude: baseState.amplitude,
  Frequency: baseState.frequency,
  Turbulence: baseState.turbulence,
  "Edge influence": baseState.edgeInfluence,
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
  "Max nodes / marks": baseState.maxNodes,
  "Ring contrast": baseState.diffuserRingContrast,
  "Ring sharpness": baseState.ringSharpness,
  "Band width": baseState.bandWidth,
  "Halo padding": baseState.diffuserHaloPadding,
  Influence: baseState.glyphFieldInfluence,
  Displacement: baseState.glyphFieldDisplacement,
  "Density modulation": baseState.glyphFieldDensity,
  "Radius modulation": baseState.glyphFieldRadius,
  "Opacity modulation": baseState.glyphFieldOpacity,
  "Dot spacing": baseState.waveDotSpacing,
};

export const FieldControls = memo(function FieldControls({ state, setState, fileRef, onImport, fontFileRef, onFontUpload, onClearFont, fontLoaded, parsedFontPathsAvailable, previewSettings, onPreviewSettingsChange, emitterGlyphs, textGeometry, diagnosticsMode, onDiagnosticsModeChange, webGpuOverlayOpen, fpsMeterOpen, onToggleWebGpuOverlay, onToggleFpsMeter, sizeDisplayFontSize, sizeHandlers }: FieldControlsProps) {
  // Control commit coalescing (P0 perf). Slider/color drags fire `input` events
  // faster than the frame rate; committing each one synchronously re-runs the
  // whole document pipeline (geometry regen + SVG reconcile) several times per
  // frame and the UI falls behind the pointer. Controls instead edit a local
  // draft mirror (instant feedback) and the document commit is coalesced to at
  // most once per animation frame, latest-wins — the same discipline the size
  // interaction and canvas navigation already use. Commit-intent gestures
  // (range release `change`, clicks, dblclick reset, Enter, blur) flush the
  // pending patch synchronously via document-level listeners; the continuous
  // `input` stream is the only coalesced path.
  const [draft, setDraft] = useState(state);
  const draftRef = useRef(state);
  const forwardedRef = useRef(state);
  const pendingRef = useRef<ProjectState | null>(null);
  const rafRef = useRef<number | null>(null);

  // Adopt external document changes (preset apply, import, font, size commit,
  // seed randomize). A draft patch still pending at that moment is superseded
  // by the newer document, matching previous last-writer-wins semantics.
  useEffect(() => {
    if (state === forwardedRef.current) return;
    forwardedRef.current = state;
    draftRef.current = state;
    pendingRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setDraft(state);
  }, [state]);

  const flushPending = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending && pending !== forwardedRef.current) {
      forwardedRef.current = pending;
      setState(pending);
    }
  }, [setState]);

  const forward = useCallback((update: ProjectState | ((current: ProjectState) => ProjectState)) => {
    const resolved = typeof update === "function" ? update(draftRef.current) : update;
    if (resolved === draftRef.current) return;
    draftRef.current = resolved;
    pendingRef.current = resolved;
    setDraft(resolved);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending && pending !== forwardedRef.current) {
          forwardedRef.current = pending;
          setState(pending);
        }
      });
    }
  }, [setState]);

  // Document bubble listeners fire AFTER React's root handlers, so the pending
  // draft patch is already queued when they run.
  useEffect(() => {
    const flush = () => flushPending();
    const flushOnEnter = (event: KeyboardEvent) => {
      if (event.key === "Enter") flushPending();
    };
    document.addEventListener("change", flush);
    document.addEventListener("click", flush);
    document.addEventListener("dblclick", flush);
    document.addEventListener("keydown", flushOnEnter);
    document.addEventListener("focusout", flush);
    return () => {
      document.removeEventListener("change", flush);
      document.removeEventListener("click", flush);
      document.removeEventListener("dblclick", flush);
      document.removeEventListener("keydown", flushOnEnter);
      document.removeEventListener("focusout", flush);
    };
  }, [flushPending]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const renderer = getRenderer(draft.renderer);
  const controlActivity = getControlActivity(draft, parsedFontPathsAvailable);
  const emitterConsumerActive = draft.renderer === "glyph-diffuser"
    || draft.renderer === "wave-contours"
    || controlActivity.emitterDisplay
    || (controlActivity.glyphModulation && draft.glyphFieldMode !== "off");
  const patchField = (next: Partial<ProjectState>) => forward({ ...draftRef.current, ...next, preset: "Custom" });
  const defaultOpen = {
    advanced: false,
    emitters: false,
    output: false,
    debug: false,
  };

  const [lastRenderer, setLastRenderer] = useState(draft.renderer);
  const [userToggles, setUserToggles] = useState<Record<string, boolean>>({});

  if (draft.renderer !== lastRenderer) {
    setLastRenderer(draft.renderer);
    setUserToggles({});
  }

  const isOpen = (id: keyof typeof defaultOpen) => 
    userToggles[id] !== undefined ? userToggles[id] : defaultOpen[id];

  const toggleGroup = (id: keyof typeof defaultOpen) => 
    setUserToggles(prev => ({ ...prev, [id]: !isOpen(id) }));
  return (
    <aside className="controls" data-testid="controls-pane">
      <ArtworkTypographyPanels
        state={draft}
        setState={forward}
        fontFileRef={fontFileRef}
        onFontUpload={onFontUpload}
        onClearFont={onClearFont}
        fontLoaded={fontLoaded}
        textGeometry={textGeometry}
        sizeDisplayFontSize={sizeDisplayFontSize}
        sizeHandlers={sizeHandlers}
      />

      <FieldPanel className="preset-renderer-section">
        <div className="section-heading">
          <span>02</span>
          <h2>Preset / Renderer</h2>
        </div>
        <label className="field">
          <span>Preset</span>
          <select value={draft.preset} onChange={(event) => forward(applyPreset(draftRef.current, event.target.value as ProjectState["preset"]))}>
            {presetIds.map((name) => <option key={name} value={name}>{getPresetDisplayLabel(name)}</option>)}
          </select>
        </label>
        <div className="segmented" aria-label="Renderer">
          {rendererList.map((item) => (
            <button key={item.id} className={draft.renderer === item.id ? "active" : ""} onClick={() => patchField({ renderer: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </FieldPanel>

      <FieldPanel>
        <div className="section-heading"><span>03</span><h2>Core Field</h2></div>
        <div>
          {fieldControls.filter(({ id }) => id === "density" || id === "amplitude").map((control) => (
            renderer.supportedControls.includes(control.id) && (
              <Range
                key={control.id}
                label={control.label}
                value={draft[control.id]}
                min={control.min}
                max={control.max}
                step={control.step}
                onChange={(value) => patchField({ [control.id]: value })}
              />
            )
          ))}
        </div>

        <EmitterControls state={draft} setState={forward} emitterGlyphs={emitterGlyphs} consumerActive={emitterConsumerActive} displayBehaviorSupported={controlActivity.emitterDisplay} open={isOpen("emitters")} onToggle={() => toggleGroup("emitters")} />
      </FieldPanel>

      <AdvancedFieldPanel
        state={draft}
        setState={forward}
        parsedFontPathsAvailable={parsedFontPathsAvailable}
        open={isOpen("advanced")}
        onToggle={() => toggleGroup("advanced")}
      />

      <OutputPanels
        key={draft.renderer}
        state={draft}
        setState={forward}
        previewSettings={previewSettings}
        onPreviewSettingsChange={onPreviewSettingsChange}
        diagnosticsMode={diagnosticsMode}
        onDiagnosticsModeChange={onDiagnosticsModeChange}
        fileRef={fileRef}
        onImport={onImport}
        webGpuOverlayOpen={webGpuOverlayOpen}
        fpsMeterOpen={fpsMeterOpen}
        onToggleWebGpuOverlay={onToggleWebGpuOverlay}
        onToggleFpsMeter={onToggleFpsMeter}
      />
    </aside>
  );
}, (previous, next) => (
  previous.state === next.state
  && previous.fontLoaded === next.fontLoaded
  && previous.parsedFontPathsAvailable === next.parsedFontPathsAvailable
  && previous.previewSettings === next.previewSettings
  && previous.emitterGlyphs === next.emitterGlyphs
  && previous.textGeometry === next.textGeometry
  && previous.diagnosticsMode === next.diagnosticsMode
  && previous.webGpuOverlayOpen === next.webGpuOverlayOpen
  && previous.fpsMeterOpen === next.fpsMeterOpen
  && previous.sizeDisplayFontSize === next.sizeDisplayFontSize
  && previous.sizeHandlers === next.sizeHandlers
));

function Range({ label, value, min, max, step = 1, disabled = false, defaultValue, onChange }: { label: string; value: number; min: number; max: number; step?: number; disabled?: boolean; defaultValue?: number; onChange: (value: number) => void }) {
  const resetValue = defaultValue ?? rangeDefaults[label];
  return (
    <label className={`range${disabled ? " disabled" : ""}`}>
      <span>{label}<output>{disabled ? "N/A" : value}</output></span>
      <input
        disabled={disabled}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        title={resetValue === undefined ? undefined : "Double-click to reset"}
        onDoubleClick={() => {
          if (!disabled && resetValue !== undefined) onChange(resetValue);
        }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

