# Glyph Emitters and Composite Wave Fields

Version: 0.12.0  
Schema: 4

## Concept

A glyph may act as a deterministic world-space source. The source creates a bounded radial scalar wave over the existing text substrate. Wave Contours reads that composite field and emits either continuous vector polylines or regularly resampled vector dots.

This is a static procedural field, not reaction-diffusion and not a persistent particle simulation. It has no time-stepping, feedback, diffusion, or evolving state.

## Emitter model

The schema stores one active `GlyphEmitter` while using an ID-based shape that can be extended to multiple emitters later. It records glyph ID, source mode, amplitude, frequency, phase, radius, falloff, self/neighbor influence, blend mode, and optional custom coordinates.

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

`blendMode` is stored in the forward-compatible emitter model for future multi-emitter composition. With one active emitter, `add` and `max` may not visibly differ.

## Preview and export

Wave Contours is static and never starts the animation clock. Its preview uses the existing SVG geometry path. Debug emitter mode shows the chosen anchor and radius.

Final Artwork export uses the unchanged SVG serializer and full text mask. Continuous output is SVG polylines and dotted output is SVG circles. Editable Text remains native SVG text. No field raster, canvas, PNG, or JPEG enters export.

## Future path

Possible later work includes exact per-glyph raster membership, multi-emitter composition, custom viewport anchor picking, improved counter topology, and persistent particles. Reaction-diffusion would be a separate future system with different state and performance requirements.
