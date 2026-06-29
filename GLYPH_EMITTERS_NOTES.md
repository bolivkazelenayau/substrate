# Glyph Emitters and Composite Wave Fields

Current architecture: v0.17 release candidate  
Schema: 6

## Concept

A glyph may act as a deterministic world-space source. The source creates a bounded radial scalar wave over the existing text substrate. Wave Contours reads that composite field and emits either continuous vector polylines or regularly resampled vector dots.

This is a static procedural field, not reaction-diffusion and not a persistent particle simulation. It has no time-stepping, feedback, diffusion, or evolving state.

## Emitter model

The legacy `GlyphEmitter` stores shared amplitude, frequency, phase, radius, falloff, self/neighbor influence, source mode, and custom coordinates. It remains the source in `emitterMode: "single"` so old projects and presets retain their historical path.

`emitterMode: "multiple"` opts into an array of at most eight emitter instances. Each row has a stable ID, automatic or explicit glyph selection, enabled state, weight, phase offset, radius multiplier, and label. Enabled valid rows resolve once into shared field sources. Disabled rows and invalid explicit glyph IDs are skipped with diagnostics.

For point `p` and anchor `a`:

```text
distance = length(p - a)
t = clamp(distance / radius, 0, 1)
wave = sin(distance * frequency + phase)
contribution = wave * amplitude * falloff(t) * influence
```

Falloff options are linear, smoothstep, and bounded Gaussian. `selfInfluence` applies inside the selected glyph's approximate bounds; `neighborInfluence` applies elsewhere inside the full text mask.

## Glyph anchors

Glyph IDs combine source position and font glyph index. Parsed glyphs expose bounds center, centroid approximation, source anchor, and an optional counter-center heuristic. O, o, 0, Q, P, R, B, and A use a conservative bounds-based counter heuristic. It is not font-topology analysis. Unsupported shapes fall back to bounds center.

Native-text fallback divides estimated text bounds into per-character cells. These anchors are useful and stable for selection but less exact than parsed font geometry.

The counter-center is only a character-gated bounds heuristic, not counter detection or topology analysis. The centroid is likewise a bounds-center approximation in this version.

## Field and contours

The field uses the existing bounded substrate resolution. Points outside the text mask remain zero. Marching Squares extracts static isolines; continuous mode emits `Polyline`, while dotted mode resamples accepted lines by arclength into positive-radius `CircleMark` geometry. `maxNodes` bounds point or dot output.

Source-glyph membership is currently a glyph-bounds approximation. This can classify counters and overlapping glyph extents imperfectly; diagnostics report the approximation explicitly.

Multiple sources use the shared field blend mode and bounded normalization. A single unit-weight source retains the legacy field calculation.

## Consumers and presets

The same resolved field is consumed by Wave Contours, Glyph Diffuser, SDF Halftone/Contours/Streamlines glyph modulation, and warped-outline geometry where those modes are active.

Three presets opt into multiple mode:

- **Sonic Interference** uses middle, first, and last automatic selectors.
- **Counter Resonance** prefers a counter-bearing glyph and adds a middle response.
- **Split Field** uses asymmetric first/last weights, phases, and radii.

All older presets explicitly restore `emitterMode: "single"`.

## Safe fallback

- Short text remains valid; automatic rows can resolve to the same available glyph.
- Empty or whitespace-only text resolves no active sources and produces a zero-safe field.
- `auto-counter` falls back to the middle eligible glyph when no supported counter glyph is available.
- Native fallback uses deterministic approximate character cells when parsed OpenType geometry is unavailable.

Native cells do not perform shaping, and counter detection remains a conservative character/bounds heuristic.

## Preview and export

Wave Contours is static and never starts the animation clock. Its preview uses the existing SVG geometry path. Debug emitter mode shows the chosen anchor and radius.

Final Artwork export uses the unchanged SVG serializer and full text mask. Continuous output is SVG polylines and dotted output is SVG circles. Editable Text remains native SVG text. No field raster, canvas, PNG, or JPEG enters export.

True outline deformation and falloff-deformed glyph geometry require parsed outlines and Final Artwork. Editable Text remains one native `<text>` element and cannot faithfully encode scaled kerning, optical spacing, or deformed outlines. Preserve `.substrate.json` as the procedural source of truth.

## Deferred work

Exact per-glyph raster membership, custom viewport anchor picking, improved counter topology, persistent particles, and reaction-diffusion are not part of this architecture.
