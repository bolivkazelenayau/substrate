import { memo, useState, type ChangeEvent, type RefObject } from "react";
import { applyPreset, baseState, getPresetDisplayLabel, presetIds } from "../../engine/presets";
import { getRenderer, rendererList } from "../../engine/renderers";
import type { ArtboardOverflowMode, DiagnosticsMode, FieldControlId, PreviewSettings, ProjectState } from "../../types";
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
  setState: (state: ProjectState) => void;
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
  artboardOverflowMode?: ArtboardOverflowMode;
  onArtboardOverflowModeChange?: (mode: ArtboardOverflowMode) => void;
  webGpuOverlayOpen?: boolean;
  fpsMeterOpen?: boolean;
  onToggleWebGpuOverlay?: () => void;
  onToggleFpsMeter?: () => void;
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

export const FieldControls = memo(function FieldControls({ state, setState, fileRef, onImport, fontFileRef, onFontUpload, onClearFont, fontLoaded, parsedFontPathsAvailable, previewSettings, onPreviewSettingsChange, emitterGlyphs, textGeometry, diagnosticsMode, onDiagnosticsModeChange, artboardOverflowMode = "clip", onArtboardOverflowModeChange = () => undefined, webGpuOverlayOpen, fpsMeterOpen, onToggleWebGpuOverlay, onToggleFpsMeter }: FieldControlsProps) {
  const renderer = getRenderer(state.renderer);
  const controlActivity = getControlActivity(state, parsedFontPathsAvailable);
  const emitterConsumerActive = state.renderer === "glyph-diffuser"
    || state.renderer === "wave-contours"
    || (controlActivity.glyphModulation && state.glyphFieldMode !== "off");
  const patchField = (next: Partial<ProjectState>) => setState({ ...state, ...next, preset: "Custom" });
  const defaultOpen = {
    advanced: false,
    emitters: false,
    output: false,
    debug: false,
  };

  const [lastRenderer, setLastRenderer] = useState(state.renderer);
  const [userToggles, setUserToggles] = useState<Record<string, boolean>>({});

  if (state.renderer !== lastRenderer) {
    setLastRenderer(state.renderer);
    setUserToggles({});
  }

  const isOpen = (id: keyof typeof defaultOpen) => 
    userToggles[id] !== undefined ? userToggles[id] : defaultOpen[id];

  const toggleGroup = (id: keyof typeof defaultOpen) => 
    setUserToggles(prev => ({ ...prev, [id]: !isOpen(id) }));
  return (
    <aside className="controls">
      <ArtworkTypographyPanels
        state={state}
        setState={setState}
        fontFileRef={fontFileRef}
        onFontUpload={onFontUpload}
        onClearFont={onClearFont}
        fontLoaded={fontLoaded}
        textGeometry={textGeometry}
      />

      <FieldPanel className="preset-renderer-section">
        <div className="section-heading">
          <span>02</span>
          <h2>Preset / Renderer</h2>
        </div>
        <label className="field">
          <span>Preset</span>
          <select value={state.preset} onChange={(event) => setState(applyPreset(state, event.target.value as ProjectState["preset"]))}>
            {presetIds.map((name) => <option key={name} value={name}>{getPresetDisplayLabel(name)}</option>)}
          </select>
        </label>
        <div className="segmented" aria-label="Renderer">
          {rendererList.map((item) => (
            <button key={item.id} className={state.renderer === item.id ? "active" : ""} onClick={() => patchField({ renderer: item.id })}>
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
                value={state[control.id]}
                min={control.min}
                max={control.max}
                step={control.step}
                onChange={(value) => patchField({ [control.id]: value })}
              />
            )
          ))}
        </div>

        <EmitterControls state={state} setState={setState} emitterGlyphs={emitterGlyphs} consumerActive={emitterConsumerActive} open={isOpen("emitters")} onToggle={() => toggleGroup("emitters")} />
      </FieldPanel>

      <AdvancedFieldPanel
        state={state}
        setState={setState}
        parsedFontPathsAvailable={parsedFontPathsAvailable}
        open={isOpen("advanced")}
        onToggle={() => toggleGroup("advanced")}
      />

      <OutputPanels
        key={state.renderer}
        state={state}
        setState={setState}
        previewSettings={previewSettings}
        onPreviewSettingsChange={onPreviewSettingsChange}
        diagnosticsMode={diagnosticsMode}
        onDiagnosticsModeChange={onDiagnosticsModeChange}
        artboardOverflowMode={artboardOverflowMode}
        onArtboardOverflowModeChange={onArtboardOverflowModeChange}
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
  && previous.artboardOverflowMode === next.artboardOverflowMode
  && previous.emitterGlyphs === next.emitterGlyphs
  && previous.textGeometry === next.textGeometry
  && previous.diagnosticsMode === next.diagnosticsMode
  && previous.webGpuOverlayOpen === next.webGpuOverlayOpen
  && previous.fpsMeterOpen === next.fpsMeterOpen
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

