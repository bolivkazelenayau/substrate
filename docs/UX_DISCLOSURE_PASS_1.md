# SUBSTRATE UX Disclosure Pass 1

Date: 2026-07-01  
Status: implemented and verified in the current working tree  
Design QA: `design-qa.md` — passed

## Purpose

This pass shortens the first-run creative path and makes technical diagnostics
opt-in without changing artwork, renderer algorithms, presets, project schema,
preview backend semantics, or SVG export.

The black/acid-lime technical visual identity, custom React controls, and custom
CSS remain intact. No UI library, CSS framework, runtime dependency, or
Intensity macro was added.

## Default creative path

The numbered sidebar path is now fixed and renderer-independent:

1. `01 Artwork`
2. `02 Preset / Renderer`
3. `03 Core Field`
4. `04 Appearance`
5. `05 Preview`
6. `06 Export`
7. `07 Diagnostics`

The previous conditional numbering gaps are removed. Glyph Diffuser no longer
shifts later sections from `04` to `05` or Diagnostics from `07` to `08`.
Preview and Export no longer share the same number, and “Preview · Advanced
Output” is now simply “Preview.”

Tests assert the exact ordered list and require every visible section number to
be unique.

## Control hierarchy changes

### Artwork remains first

Source text, font size, native/custom font status, and font actions remain
immediately visible.

Detailed typography is now under an unnumbered **Advanced typography**
disclosure:

- tracking;
- kerning mode and strength;
- text alignment;
- vertical offset;
- optical spacing and strength.

The controls and their `ProjectState` fields are unchanged.

### Preset and renderer move near the top

Preset and the complete nine-renderer selector now form section `02`, directly
after Artwork. Applying presets and switching renderers still use the existing
state mutation paths. No preset values or renderer registration behavior
changed.

### Core Field is deliberately small

Section `03` keeps Density and Amplitude visible. Emitters remain fully
available but start collapsed, including single/multiple modes, row editing,
global shaping, source selection, falloff, and blend controls.

The existing **Advanced Parameters** disclosure now owns:

- Frequency, Turbulence, and Edge influence;
- renderer-specific contour/modulation/diffuser controls;
- maximum node/mark budget;
- diffuser detail and glyph modulation;
- dotted-wave detail;
- Glyph Diffuser overlay, erosion, outline, and warp controls.

Advanced disclosures are intentionally unnumbered so they do not interrupt the
normal `01`–`07` path.

### Appearance remains normal-path

Section `04` keeps primary, outline, and background colors visible. Existing
color values and appearance-only renderer cache exclusions are unchanged.

### Preview and Export are separate disclosures

Preview is section `05` and starts collapsed. It retains explicit Canvas/SVG
selection, preview quality, FPS cap, static preview, and pause-when-hidden.

The backend helper copy now states:

> Preview only — does not affect SVG export. Canvas: faster / SVG: crisper.

Backend resolution remains explicit and renderer-scoped. Canvas does not become
an export backend.

Export is section `06` and starts collapsed. It retains Final Artwork, Editable
Text, transparency, export frame, numeric precision, and project JSON import.
The persistent header **Export SVG** action remains the primary export action.
SVG serialization and vector-only validation are unchanged.

## Diagnostics and developer tools

New sessions now default `DiagnosticsMode` to `off`. Compact and full modes
remain available through section `07`.

When diagnostics are Off, the canvas shows artwork, applicable warnings,
explicitly enabled legacy debug output, zoom/FIT controls, and transport status.
Backend, renderer, instrument, active-control, and animation telemetry render
only in Compact or Full. Worker/backend failure status and renderer fallback
warnings can still surface when diagnostics are Off.

The dev-only FPS Meter and GPU Field Debug launchers moved from fixed
lower-left buttons into Diagnostics. They no longer overlap sidebar controls.
Their overlays remain lazy-loaded and development-only. WebGPU copy remains
explicitly preview/debug-only and not export.

All legacy `ProjectState.debug` controls remain present and schema-v7
compatible. This pass does not extract, remove, or reinterpret them.

## State, schema, and export invariants

- `PreviewSettings` and `DiagnosticsMode` remain runtime-only.
- `ProjectState.debug` remains serialized for lossless schema-v7 compatibility.
- No schema migration or v8 implementation was added.
- No renderer input, preset value, seed, or project default was changed.
- No renderer algorithm or export serializer was changed.
- No generated geometry or golden SVG fixture was changed.
- Final Artwork remains deterministic, CPU/generated, and vector-only.
- Editable Text SVG behavior is unchanged.

## Tests added or updated

Coverage verifies:

- all typography and emitter controls remain wired;
- numeric reset behavior remains intact;
- preview quality and explicit backend options remain intact;
- helper copy states the preview/export boundary;
- the normal section path is exactly `01` through `07`;
- all section numbers are unique;
- advanced typography, emitters, renderer detail, preview, export, import, and
  diagnostics controls remain reachable;
- the relocated WebGPU launcher remains dev-only;
- new sessions default DiagnosticsMode to Off;
- PreviewSettings and DiagnosticsMode are not serialized;
- schema-v7 debug settings remain serialized.

Existing golden export, preset vector-integrity, schema, renderer, preview, and
vector-only SVG tests remain authoritative.

## Rendered QA

Source evidence:

- `docs/ux-interaction-audit/01-first-run.png`

Implementation evidence:

- `docs/ux-interaction-audit/09-disclosure-pass-1.png`
- `docs/ux-interaction-audit/10-disclosure-diagnostics.png`

At 1280 × 720, Artwork and Preset / Renderer are visible in the first sidebar
viewport. Canvas telemetry is quiet by default, and developer launchers are
contained inside Diagnostics.

`design-qa.md` records the comparison and has `final result: passed`. The only
remaining P3 note is that the complete nine-renderer grid is still tall.

## Related architectural work in the same working tree

### Internal CPU Graph Evaluation Prototype

- Adds typed CPU execution results and issues.
- Builds a minimal one-renderer graph from the active project.
- Resolves the existing synchronous renderer registry and delegates to the
  existing renderer algorithm.
- Reproduces canonical geometry and the six existing golden SVG hashes.
- Remains absent from App, preview, export, schema, and production bundles.

### Renderer runtime ownership consolidation

- `useRendererRuntime` owns live, time-zero/current export, estimate geometry,
  context selection, timing, and geometry summaries.
- `App.tsx` no longer calls lower-level renderer generation/key/summary helpers.
- Static estimate and time-zero export identity remain stable across animation
  ticks.
- Time-dependent Flow geometry still bypasses the static cache.
- Appearance-only changes retain static geometry identity.

### Schema v8 planning

- `docs/SCHEMA_V8_PLANNING.md` proposes grouped document sections, debug
  extraction, preference ownership, migration/downgrade policy, and test gates.
- It does not implement v8, alter v7, remove debug, or serialize graph data.

## Verification

| Check | Result |
| --- | --- |
| ESLint | Pass, zero warnings |
| TypeScript | Pass |
| Vitest | 47 files, 474 tests passed |
| Production build | Pass, 116 modules transformed |
| Analyze build | Pass |
| Initial application JS | 388.08 kB minified / 117.84 kB gzip |
| Lazy OpenType chunk | 243.12 kB minified / 68.16 kB gzip |
| CSS | 15.70 kB minified / 3.78 kB gzip |
| Vite 500 kB warning | Absent |
| Rendered design QA | Passed |

The JSDOM suite still prints two non-failing
`HTMLCanvasElement.getContext()` notices.

## Non-goals and deferred work

- No Intensity macro or renderer-grid redesign.
- No automatic preview-backend switching.
- No graph production integration.
- No schema-v8 implementation or v7 debug extraction.
- No CSS framework, UI library, or new dependency.
- No broad responsive redesign.
