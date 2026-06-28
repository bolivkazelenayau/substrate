# Sonic Visual Quality / Composition Pass (v0.15)

## Problems addressed

Sonic Diffuser previously used the falloff-weighted field contribution as both its ring signal and its global density envelope. That blurred wave crests into a broadly distributed particle cloud and left too many weak far-field dots. Sonic Halftone reacted to the shared field, but its acceptance remained close to a uniform interior fill. The edge-eroded text composition also reduced opacity across the complete glyph overlay.

## Controls

- `ringSharpness` controls how tightly probability concentrates at a radial crest.
- `bandWidth` controls the portion of each wave cycle treated as a crest band.
- `textOverlayOpacity` controls the overlay as a whole and defaults to `1`.
- `edgeErosionAmount` controls the count, size, and opacity of localized subtractive bite marks.
- `edgeErosionWidth` controls the SDF edge band searched for bite candidates.
- `interiorProtection` narrows that edge band and keeps marks away from stroke centers.
- `overlayMode` supports `solid`, `outline`, `knockout`, and `hidden`.

Imported older projects receive safe defaults through the existing schema parser.

## Shaping and diagnostics

Glyph Diffuser now derives crest strength directly from the deterministic radial phase. Crest strength and global falloff are evaluated separately; a steeper falloff exponent suppresses distant dust. Diagnostics report average crest strength, average falloff, rejected far-field candidates, and accepted crest dots.

SDF Halftone uses the same band controls to favor high-energy portions of the normalized shared glyph field while keeping all accepted and displaced dots inside the text mask. It reports average crest strength and accepted crest dots.

## Composition model

The default Sonic Diffuser overlay is solid artwork color at full opacity. Edge erosion uses deterministic black vector circles inside the SVG mask, selected only near SDF glyph edges and biased by the shared sonic field. There is no continuous subtractive stroke. Parsed glyph paths and native SVG text share the same bite marks. Outline uses a vector stroke, knockout uses the background color, and hidden omits the overlay.

Final Artwork remains circles/paths/polylines plus vector glyph paths or native SVG text. Editable Text remains native SVG text. No canvas, image, bitmap, or data URL is introduced into export.

## Presets

- **Sonic Diffuser**: smaller dots, higher density, narrow sharp bands, reduced far-field halo, solid overlay, and subtle localized erosion.
- **Sonic Halftone**: stronger field density/displacement with less neighbor dominance and visible interior band structure.
- **Sonic Contours**: lower displacement and neighbor influence for readable ripple deformation.
- **Sonic Stream**: subtle modulation and lower turbulence for gentle directional bending.

## Limitations and future work

Band shaping is analytic and tied to the existing radial-wave emitter; it is not a simulation. Halftone bands and erosion placement are limited by glyph interior area and substrate resolution. Bite marks are circles rather than arbitrary boolean path fragments, and are capped at 320 per overlay. Multiple emitters, worker cancellation, worker-side debug image generation, persistent simulation, and export-pipeline changes remain out of scope.
