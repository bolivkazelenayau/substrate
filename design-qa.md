# SUBSTRATE UX Disclosure Pass 1 — design QA

Source visual truth:
`docs/ux-interaction-audit/01-first-run.png`

Implementation screenshots:

- `docs/ux-interaction-audit/09-disclosure-pass-1.png`
- `docs/ux-interaction-audit/10-disclosure-diagnostics.png`

Viewport: 1280 × 720  
State: default Edge Current project, native font fallback, Diagnostics Off

## Full-view comparison evidence

The source and implementation were inspected together at the same viewport and
project state. The implementation preserves the black/acid-lime palette,
monospace hierarchy, canvas proportions, transport, export warning, and header
actions.

The intended disclosure changes are visible:

- Artwork remains first.
- Preset / Renderer is now in the first sidebar viewport.
- Typography, Emitters, and Advanced Parameters are collapsed.
- Canvas backend/instrument/control/animation telemetry is absent by default.
- Export SVG remains the persistent primary action.
- Floating developer launchers no longer overlap the sidebar.

## Focused region comparison evidence

The Diagnostics region was inspected separately because its controls are too
small to judge reliably in the full view. The focused capture confirms:

- section `07` is collapsed by default;
- Diagnostics visibility defaults to Off;
- FPS Meter and GPU Field Debug live inside the disclosure;
- WebGPU copy remains explicitly preview/debug-only and not export;
- all legacy v7 debug controls remain available.

## Required fidelity surfaces

- **Fonts and typography:** existing typefaces, weights, uppercase labels, and
  numeric treatment are unchanged.
- **Spacing and layout rhythm:** existing section spacing and sidebar width are
  preserved; disclosure reduces first-run vertical density.
- **Colors and visual tokens:** black, charcoal, gray, and acid-lime tokens are
  unchanged.
- **Image quality and assets:** no image or icon assets were introduced or
  replaced; artwork rendering remains the existing SVG/Canvas output.
- **Copy and content:** section labels are now unique (`01`–`07`), Preview is
  distinct from Export, and backend helper copy states the export boundary.

## Findings

No actionable P0, P1, or P2 mismatch remains for the scoped disclosure pass.

- **P3 — renderer grid remains tall**
  - Location: `02 Preset / Renderer`
  - Evidence: all nine renderers remain visible as required; only the first
    rows fit in the initial 720 px viewport.
  - Classification: acceptable for Pass 1 because Preset and renderer entry are
    now near the top and no control may be removed.

## Patches made during QA

- Reset the default diagnostics mode to Off.
- Gated canvas telemetry to Compact/Full, retaining warnings and backend failure
  status.
- Moved developer launchers into Diagnostics.
- Added exact preview/export boundary helper copy.
- Added sequential section and disclosure regression tests.

## Implementation checklist

- [x] Normal creative path appears before advanced controls.
- [x] Sections are unique and sequential.
- [x] All controls remain reachable.
- [x] Diagnostics and developer tools remain available.
- [x] Default canvas is quiet except for artwork, warning, and navigation.
- [x] Existing visual identity is preserved.

final result: passed
