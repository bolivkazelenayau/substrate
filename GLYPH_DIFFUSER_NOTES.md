# Glyph Diffuser

Version: 0.13.0  
Project schema: 4

## Purpose

Glyph Diffuser is a deterministic density-based dot renderer. It reuses the existing `GlyphEmitter`, glyph anchors, falloff curves, self/neighbor influence, and `compositeWaveField` source metadata. Unlike Wave Contours, it does not extract isolines or place dots along contour paths.

The pipeline is:

```text
glyph emitter
→ shared radial contribution field
→ bounded jittered candidate grid
→ deterministic probability sampling
→ vector CircleMark dots
```

## Dot model

Candidate spacing comes from Density. Seeded jitter and grain come from Turbulence. The shared emitter contribution supplies radial wave strength; ring contrast weights that signal before deterministic acceptance. Dot radius and opacity combine ring strength, falloff, and seeded grain.

`selfInfluence` affects candidates inside the approximate source-glyph bounds. `neighborInfluence` affects other text and halo candidates. Frequency changes ring spacing, amplitude changes field strength, and halo padding extends the bounded candidate domain.

## Domains and composition

- **Inside text** samples only the text mask.
- **Emitter halo** samples the bounded emitter radius plus halo padding.
- **Text + halo** accepts either region.
- **Field clipped to text** keeps generated dot centers inside the text mask and retains the normal SVG mask.
- **Field behind text** removes the artwork mask for this renderer only and adds a vector text overlay for readability.

Parsed fonts use glyph paths for the overlay. Native fallback uses SVG `<text>`. The overlay and dots are vector-only.

## Static field, not simulation

Glyph Diffuser is static (`usesTime: false`). It has no temporal feedback, diffusion step, persistent particles, or reaction-diffusion state. The existing animation clock does not run for it.

## Export

Final Artwork exports circles plus an optional SVG text/glyph-path overlay. Editable Text behavior is unchanged. Export contains no canvas, image, PNG, JPEG, or data URL.

## Current limitations

- Source-glyph membership is bounds-based.
- Counter-center selection is heuristic, not topology analysis.
- Native-text cells and anchors are approximate and do not perform shaping.
- Candidate sampling is a jittered grid rather than blue noise.
- Dense output is capped by `maxNodes`; row-major traversal can favor earlier cells when clipped.
- Halo contribution uses the shared emitter formula with an expanded bounded radius.
