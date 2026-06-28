# Control Ownership

SUBSTRATE keeps Glyph Modulation and Outline Warp separate. Outline Warp is not multiplied by Glyph Modulation; this avoids two overlapping displacement controls.

| Control | Consumer |
| --- | --- |
| Glyph Modulation Mode | SDF Halftone, SDF Contours, SDF Streamlines |
| Glyph Modulation Influence | SDF Halftone, SDF Contours, SDF Streamlines |
| Glyph Modulation Displacement | SDF Halftone, SDF Contours, SDF Streamlines |
| Density Modulation | SDF Halftone seed/dot acceptance; SDF Streamlines seed acceptance |
| Radius Modulation | SDF Halftone dot radius |
| Opacity Modulation | SDF Halftone dot opacity |
| Diffuser Domain | Glyph Diffuser candidate domain |
| Ring Contrast | Glyph Diffuser crest probability and radius |
| Ring Sharpness | Glyph Diffuser crest shaping; SDF Halftone field-band shaping |
| Band Width | Glyph Diffuser crest band; SDF Halftone field band |
| Edge Erosion | Glyph Diffuser edge-eroded filled overlay; controls bite count/size/opacity |
| Erosion Width | Glyph Diffuser edge-band search width |
| Interior Protection | Glyph Diffuser edge-band depth / stroke-center protection |
| Warp Amount | Parsed-font `warped-outline` displacement |
| Warp Scale | Parsed-font `warped-outline` field sampling scale |
| Warp Smoothing | Parsed-font contour sampling and displacement smoothing |
| Warp Edge Bias | Parsed-font blend between field gradient and SDF normal |
| Max Displacement | Parsed-font per-point warp clamp |
| Preserve Counters | Parsed-font counter-contour displacement reduction |

## Mode-aware UI

- Glyph Diffuser shows Glyph Modulation as inactive because its dots use Diffuser controls and its letterform deformation uses Outline Warp controls.
- SDF Contours enables Mode, Influence, and Displacement.
- SDF Streamlines additionally enables Density Modulation.
- SDF Halftone enables the complete Glyph Modulation group.
- Edge Erosion controls require Glyph Diffuser, Edge-eroded composition, and a filled overlay mode.
- Outline Warp controls require Glyph Diffuser, `warped-outline`, and loaded parsed `.ttf/.otf` paths. Native SVG text reports a solid fallback.

Inactive control values do not enter the static renderer cache key. Active Outline Warp controls use their own overlay cache key; unrelated debug settings do not invalidate either cache.
