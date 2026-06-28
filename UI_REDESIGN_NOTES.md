# UI Redesign Notes

## Context & Goals
The SUBSTRATE UI has been redesigned to embrace a darker, brutalist, generative instrument aesthetic. The primary goal was to improve the visual hierarchy and rhythm of the interface without altering any of the underlying renderer behaviors or project schemas.

## Token System & Typography
- Extracted CSS values into formal CSS variables (`:root`) for color and scaling.
- Colors were refined into a darker palette (`--ink: #0a0a09`, `--panel: #111110`, `--surface: #1a1a18`), while maintaining `--acid: #dfff3f` as the singular primary accent.
- Adopted strict `0px` border-radius to align with the brutalist aesthetic requirement.
- Added `-webkit-font-smoothing: antialiased` for a sharper, crisp feel across all typography.
- Enforced `font-variant-numeric: tabular-nums` globally on diagnostics and output panels to avoid jitter during real-time value updates.

## Component Refinement
- **Buttons & Toggles**: Improved hit areas to a `40px` minimum for primary actions (`32px` or `34px` for compact contexts). The active state was updated to use a tactile `transform: scale(0.96)`.
- **Inputs & Sliders**: Stripped excessive structural borders in favor of using subtle background contrasts (`--surface`) and explicit acid-colored focus rings. Sliders have had their track aesthetics cleaned up for a minimal appearance.
- **Accordion Groups**: Accordion toggles and groups were visually distinguished to prevent the sidebar from looking like a continuous, unbroken wall of checkboxes.
- **Transitions**: Formalized micro-interactions with a standard `150ms / 160ms ease-out` timing to ensure responsiveness without feeling sluggish.

## Layout Changes
- Removed repetitive boxed outlines in `.control-section` elements. Structure is now provided by consistent whitespace and `1px dashed var(--line)` horizontal dividers.
- The Viewport now uses a deeply muted, grid-like linear-gradient background that recedes visually, allowing the artboard and rendered outputs to remain the dominant visual element.
- The Glyph Diffuser "Missing Emitter" warning was refactored into a semantic `.control-warning` class, stripping away inline React styles.

## Validation
All changes were validated to ensure:
- No visual or technical regression in native SVG exports.
- Flow Lines, Glyph Diffuser, SDF Halftone, and Wave Contours function identically.
- 158 tests passed successfully, verifying that the layout updates caused no disruption to the `RendererRuntime` or export behaviors.
