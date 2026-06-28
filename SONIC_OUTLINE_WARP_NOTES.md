# Sonic Outline Warp (v0.16)

`warped-outline` is a Final Artwork overlay mode for parsed OpenType glyphs. It preserves normalized `M`, `L`, `Q`, `C`, and `Z` commands during layout, deterministically samples each contour, displaces sampled points with the shared glyph field, and serializes closed vector paths.

## Controls

- `outlineWarpAmount` sets requested displacement.
- `outlineWarpScale` changes the spatial scale used to sample the shared field.
- `outlineWarpSmoothing` controls curve sampling density and displacement smoothing.
- `outlineWarpEdgeBias` blends field-gradient direction with the SDF edge normal.
- `outlineWarpMaxDisplacement` clamps every sampled point.
- `preserveCounters` reduces displacement on smaller interior contours.

The **Sonic Warp** preset combines readable outline deformation, subtle edge bites, and radial diffuser dots.

## Art direction

Warp displacement is shaped as concentric radial waves around the selected emitter. The analytic crest signal is combined with the shared glyph field and emitter falloff, then applied along a field-gradient direction stabilized toward the emitter-to-point radial axis. `outlineWarpEdgeBias` blends that radial field direction toward the local SDF edge normal.

`outlineWarpScale` changes radial wavelength rather than merely stretching coordinates. `outlineWarpAmount` uses a progressive response across its complete slider range, while `outlineWarpMaxDisplacement` remains an independent safety clamp. Smoothing applies repeated contour-local filtering; protected counter contours receive substantially reduced displacement.

The Sonic Warp defaults use a field-dominant direction, visible mid-range displacement, high smoothing, a 26-unit clamp, and reduced edge-bite density so the deformed letterforms remain the primary visual event.

## Export behavior

Final Artwork emits filled SVG paths with even-odd contour filling. No raster, canvas, image, data URL, PNG, or JPEG is introduced. Editable Text bypasses the warp overlay and remains native SVG `<text>`.

Native text fallback is intentionally not approximated: it renders the existing solid native SVG text and reports that parsed OpenType outlines are required.

Warp controls are disabled when no parsed font is loaded, and the overlay selector labels the requirement instead of silently exposing inactive sliders. Preview warp output has an independent packed cache key containing all warp controls and excluding unrelated debug/preview settings.

## Diagnostics and limits

Diagnostics report overlay mode, warped glyphs, sampled points, average/max displacement, clamped points, active emitter glyph, effective requested warp strength, counter warnings, strong-warp warnings, and the native fallback limitation. Counter preservation is heuristic, based on contour area. Curves are rebuilt as dense line segments, so very high smoothing values increase SVG size.
