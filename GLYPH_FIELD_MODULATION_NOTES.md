# Shared Glyph Field Modulation

Version 0.14 separates two uses of the glyph emitter. Glyph Diffuser turns the emitter into a visible cloud of vector circles. Shared field modulation instead lets an existing substrate renderer sample the emitter's scalar wave and central-difference gradient while it constructs its own geometry. The text outline is not edited; dots and polylines move, change density, or bend inside the text mask so the letterforms appear deformed.

## Shared render context

`RenderContext` can carry `glyphField`, safe scalar and gradient sampler functions, and field diagnostics. `App` builds this static context from text geometry, substrate data, emitter settings, amplitude, and frequency. Animation time and frame are merged afterward, so clock ticks do not rebuild the field. Renderers retain a safe direct-build fallback for tests and non-App callers. Disabled or unresolved emitters produce a null field and zero-valued samplers.

The field is the existing deterministic `CompositeWaveField`. Sampling is bilinear. Its gradient uses central differences in world coordinates and returns a finite flag plus magnitude. Diagnostics include range, resolution, build time, selected glyph, and finite/invalid gradient sample counts.

## Renderer behavior

- SDF Halftone displaces candidates along the field gradient, modulates acceptance, radius, and opacity, then rejects displacement that leaves the mask.
- SDF Contours moves extracted contour points along the SDF normal using the signed glyph-field value and keeps the original point when a candidate leaves the mask.
- SDF Streamlines adds field value and gradient-derived angular perturbation during bounded integration and can bias seed acceptance.
- Glyph Diffuser continues to emit vector circles. It now supports behind-text, through-text, text-reactive edge density/radius, clipped, and lighter edge-eroded vector overlays.
- Wave Contours and Glyph Diffuser consume the shared context field when present and retain safe fallback behavior.

`off`, `subtle`, and `strong` provide coarse modulation modes. Influence scales the whole effect; displacement, density, radius, and opacity stay independent. Existing amplitude and frequency continue to define base wave strength and spacing. Edge influence and turbulence retain their renderer-specific roles.

## Export and limits

Final Artwork remains vector-only: circles for dots, polylines/paths for lines, and vector glyph paths or SVG text for overlays. Editable Text remains native SVG text. No canvas, image, data URL, WebGPU, reaction-diffusion, or persistent simulation is used in export.

This is geometry modulation, not true font-outline deformation. Mask clamping protects readability but can flatten displacement near narrow strokes. The field currently has one active emitter and glyph membership remains bounds-based. A future outline-deformation path could resample actual glyph contours, apply the same field with topology-aware constraints, and rebuild closed paths.
