# SUBSTRATE - Implementation Status

Updated for the v0.17 Multi-Emitter + Safe Typography release.

## Release state

- Current release: `0.17.0`
- Project schema: `7`
- Package, app, and exported SVG metadata report `0.17.0`.

## v0.17 Multi-Emitter + Safe Typography

The legacy `emitter` object remains the shared field configuration and the source used by `emitterMode: "single"`. Every pre-v0.17 preset explicitly selects single mode, so applying it after a multi-emitter preset restores its historical effective state. `emitterMode: "multiple"` is opt-in and accepts at most eight rows, resolving enabled valid rows into glyph, anchor, weight, phase offset, and radius multiplier data.

The memoized shared field is consumed by Glyph Diffuser, Wave Contours, SDF Halftone/Contours/Streamlines glyph modulation, and Glyph Diffuser warped outlines where those modes apply. Multi-source composition is deterministic and bounded; disabled or invalid explicit rows are skipped.

The multi-emitter presets are:

- **Sonic Interference**: middle, first, and last automatic sources with phase-separated weights.
- **Counter Resonance**: prefers a counter-bearing glyph and adds a middle response.
- **Split Field**: asymmetric first/last sources with different weights, phases, and radii.

Automatic selectors degrade without throwing. Short text may resolve multiple rows to the same available glyph. Empty or whitespace-only text produces no active sources and a zero-safe field. Counter selection falls back to the middle eligible glyph when no supported counter glyph exists. Without a parsed font, deterministic approximate native character cells provide anchors; they do not perform font shaping or topology analysis.

Typography state now includes font/disabled kerning, kerning strength, optional optical spacing, left/center/right alignment, and bounded vertical offset. Parsed OpenType layout supports scaled kerning and optical compensation. Native fallback and Editable Text SVG preserve only attributes representable by one native `<text>` element.

Export limitations:

- Editable Text SVG remains one native `<text>` element.
- True glyph deformation, outline warp, and falloff-deformed outline geometry are available only in Final Artwork SVG with parsed outlines.
- Scaled kerning and optical spacing cannot be represented faithfully in native Editable Text and may not be preserved.
- `.substrate.json` is the procedural source of truth. Editable Text SVG is an interoperable text export, not a lossless project format.
- Final Artwork remains vector-only; no field raster, canvas, PNG, or JPEG is serialized.

## Gate 7.7 Preset vector integrity

All normal presets, including the first preset **Edge Current**, have an explicit
`exportKind: vector` contract outside project JSON. Edge Current uses the Flow Lines
renderer and now defaults to the SVG DOM preview. Its previous Canvas 2D surface was
preview-only, even though Final Artwork serialization already regenerated the same
frame as vector paths.

Canvas 2D remains available only as an explicitly selected, labeled preview backend.
It is never passed to Final Artwork export. The SVG serializer rejects `<image>`,
`<canvas>`, `<foreignObject>`, image data URLs, and embedded base64 payloads. A
preview-only preset added in the future is refused for Final Artwork with:
`This preset is preview-only and cannot be exported as Final Artwork SVG.`
Editable Text SVG remains unchanged.

## Gate 7.8 Edge Current SVG preview performance

Manual QA after Gate 7.7 collapsed Edge Current / Flow Lines interactive preview
FPS to ≈ 6 once the Canvas 2D auto-selection above 500 elements was removed and
SVG DOM became the only normal preview surface.

Root cause (Scope A — Diagnose Edge Current performance):
- The Flow Preview component emitted ~1.5k `<line>` elements and called
  `setAttribute` for x1/y1/x2/y2/opacity on each one every animation frame
  (≈ 5 * 1564 ≈ 7800 live DOM attribute mutations per frame). Each mutation
  re-coordinates the masked `<g>` paint and re-runs the glyph clip path, which
  quickly saturates the browser's SVG repainting and collapsed the preview.
- The renderer regenerated once per animation tick (cheap, single-pass math),
  and React only re-ran the small memoized element array, so the bottleneck was
  per-segment DOM attribute thrash, not React reconciliation or geometry build.

Optimization (Scope B — Optimize SVG DOM preview):
- `src/engine/flowPreviewOptimization.ts` partitions the LineSegments into a
  fixed pool of `FLOW_PREVIEW_BUCKET_COUNT = 24` opacity buckets and produces
  one concatenated `d` attribute per bucket (`M… L… M… L…` multi-subpath).
- `src/components/FlowPreview.tsx` now mounts the bucket `<path>` pool once and
  updates them imperatively in a `useLayoutEffect`. Per-frame DOM mutations
  drop from ≈ N * 5 to ≤ `2 * FLOW_PREVIEW_BUCKET_COUNT` `setAttribute` calls,
  and the SVG node tree is never recreated across animation frames
  (`stats.nodeIdentityReused` is asserted true by tests).
- Multi-subpath stroke painting on grouped paths is visually equivalent to the
  previous `<line>` set because the parent `<g>` already supplies a single
  stroke style, mask, and stroke width.
- Canvas 2D remains available only as an explicitly selected, labeled preview
  backend; the automatic vector preview backend (`auto`) stays SVG DOM. Canvas
  / WebGPU / raster paths remain absent from the Final Artwork serializer.

Appearance and zoom/pan invariants (Scope C and Scope D — verified by tests):
- `primaryColor`, `outlineColor`, `backgroundColor`, and
  `transparentBackground` changes are paint-only — they do not enter
  `rendererGeometryStateKey`, do not regenerate geometry, do not modify path
  `d`, line count, bucket counts, or bucket opacities. The color picker drag
  therefore cannot trigger a full geometry rebuild.
- Zoom and pan live entirely in `CanvasNavigation` component state
  (`ViewportNavigationState`) and only mutate the CSS transform on the
  navigation wrapper; `ProjectState`, `RenderContext`,
  `rendererGeometryStateKey`, `generateRendererGeometry`, and the bucketed
  flow path strings are unaffected by zoom level or pan offset.

Deterministic Final Artwork:
- `src/engine/exportSvg.ts` is unchanged: it still serializes one vector
  `<path d="M… L…">` per LineSegment with its true per-segment opacity, inside
  the masked `<g id="generated-artwork">`. The Flow Preview optimization is
  preview-only and never feeds Final Artwork export.

### Changes in v0.16.1
- **Performance Quick Wins (Phase 1)**: Debounced synchronous `costEstimate` generation during slider scrubs, hoisted invariant math out of `glyphDiffuserRenderer` inner loops, and added a 50ms debounce to `SubstrateBuildInput` to prevent stale Web Worker queueing during rapid text edits. Visual output, export semantics, and deterministic seeds remain unchanged.
- **Visual Design System Pass**: Redesigned the SUBSTRATE UI with a refined dark brutalist/generative instrument aesthetic. Removed unnecessary borders, implemented a structured typography scale with tabular numbers for diagnostics, enforced a consistent 40px hit area for primary controls, and improved the active/hover states with subtle scaling (`scale(0.96)`) and snappy 150ms `ease-out` transitions.
- **UI Polish: Control Panel Cleanup**: Reorganized the control panel for clarity. Implemented a fixed 100vh workbench layout so the canvas stays locked while controls scroll independently.
- **Accordion Inspector**: Advanced controls are now cleanly hidden inside accordions, keeping the main flow compact. Inactive renderer-specific sections are delegated to an "Other controls" accordion.
- **Glyph Diffuser UX**: Fixed the Glyph Diffuser empty state. When disabled, the Emitter accordion now presents a prominent warning callout and action button ("Enable first eligible emitter"), preventing hidden failures.

### Active Priorities

1. Final manual visual QA for v0.17 across parsed fonts and native fallback.

# 1. Project Overview

SUBSTRATE is a browser-based generative typography tool. Text supplies the domain in which deterministic procedural vector marks are shown.

The application now has three distinct representations:

1. Native SVG text as the safe fallback and Editable Text output.
2. Parsed OpenType glyph paths for font-independent masks and artwork export.
3. An internal raster substrate containing a soft mask, edge map, and approximate signed distance field.

The interface remains a dark generative-instrument console with a large viewport, compact parameter groups, presets, transport controls, export controls, font loading, and debug views.

Existing visual renderers remain unchanged:

- Flow lines
- Ripple lines
- Dot field
- SDF Flow
- SDF Streamlines
- SDF Contours
- SDF Halftone
- Wave Contours
- Glyph Diffuser

No reaction-diffusion or persistent simulation system has been added.

## v0.16 Sonic Outline Warp

Final Artwork now supports a `warped-outline` overlay for parsed OpenType fonts. Glyph layout preserves normalized path commands; the warp pipeline samples closed contours, reads the shared glyph field value/gradient, optionally blends the SDF edge normal, smooths displacement, protects smaller counter contours, clamps every point, and emits filled vector paths.

Controls are `outlineWarpAmount`, `outlineWarpScale`, `outlineWarpSmoothing`, `outlineWarpEdgeBias`, `outlineWarpMaxDisplacement`, and `preserveCounters`. The new **Sonic Warp** preset combines readable outline deformation with subtle edge bites and radial diffuser dots.

Native text fallback remains solid native SVG text and reports the parsed-outline limitation. Editable Text export is unchanged and contains no warped paths. Final Artwork remains vector-only.

Diagnostics report overlay mode, warped glyph count, sampled points, average/max displacement, clamp count, counter warnings, strong-warp warning, and native fallback limitation. Details are in `SONIC_OUTLINE_WARP_NOTES.md`.

Warp controls use a dedicated overlay cache key. Amount, scale, smoothing, edge bias, maximum displacement, and counter preservation invalidate the warped outline; unrelated debug/preview settings do not. Native fallback labels and disables the inactive controls. Diagnostics now expose active state, parsed/native source, and overlay cache hit/miss.

Control ownership is mode-aware and documented in `CONTROL_OWNERSHIP.md`. Glyph Modulation remains exclusive to SDF Halftone, SDF Contours, and SDF Streamlines; Glyph Diffuser uses its own Diffuser, Edge Erosion, and Outline Warp controls. Inactive modulation values no longer invalidate Glyph Diffuser geometry.

Sonic Warp art direction uses emitter-centered analytic radial crests combined with the shared field and falloff. Field-gradient motion is stabilized radially before Edge Bias blends toward the SDF normal. Scale controls wavelength, smoothing applies repeated contour filtering, Amount has a progressive full-range response, and Max Displacement remains an independent clamp. The preset emphasizes readable warped letterforms over erosion noise.

Validation: 143 tests across 15 files pass. TypeScript and the production build pass.

### v0.16.1 Control Panel Cleanup

A UI polish pass was completed to make the control panel less confusing. The visual output, preset values, export semantics, and project schema remain unchanged. 

- Grouped related controls into clear `.control-group` blocks: Text Overlay, Edge Erosion, Diffuser Field, Glyph Modulation, and Wave Contours.
- Used the `controlActivity` state to conditionally apply a `.disabled-group` class to inactive blocks, keeping them in the DOM to avoid layout jumps while visually fading them.
- Added brief inactive hints (e.g. `Inactive for current renderer`) to disabled groups.
- Individual controls inside disabled groups remain functionally `disabled`.
- Introduced a `diagnosticsExpanded` state to collapse the detailed numbers in the `Viewport` diagnostics panels.
- Ensured critical diagnostics (native fallback, warped-outline unavailable, export warning, maxNodes clipping, worker fallback/error) remain visible even when the detailed panels are collapsed.
- TypeScript and production build pass successfully. App version remains 0.16.0.

### v0.16.1 UI Polish Regression Fix

A targeted bugfix addressed layout and functionality regressions introduced in v0.16.1:
- Restored editability of the `Outline width` slider when `Text Overlay = Outline` is active.
- Ensured the `Overlay mode` select remains available to the Glyph Diffuser when set to `Hidden`, preventing lockouts.
- Compressed inactive control groups by hiding all controls within them and displaying only the group header and a compact, one-line hint. This drastically reduces the vertical footprint of the control panel and returns dominance to the canvas/viewport.
- Updated `styles.css` spacing (`.control-group`, `.nested-group`, `.inactive-hint`) to tighten the interface.
- Updated tests and confirmed 156 tests pass with no build issues.
### v0.16.1 Fixed Workbench Layout

A structural CSS layout fix was applied to prevent the control panel from pushing the document height beyond `100vh` and creating a scrolling webpage:
- Forced `html`, `body`, and `main` to `overflow: hidden; height: 100%`.
- Reconfigured the `.workspace` grid and made the left `.controls` panel scroll independently (`overflow-y: auto`, `overscroll-behavior: contain`).
- Bounded the `.viewport-shell` as a strict flex column.
- Added a `.stage-frame` wrapper to center the SVG `.stage` and strictly enforce its aspect ratio without breaking boundaries.
- Validated manually across small viewport sizes (1366x768, 1440x900, 1920x1080) and narrow browser widths, ensuring the transport bar, canvas, and controls remain visible and functional.

### v0.16 Overlay bugfix — regular Outline

A bugfix pass corrected the rendering of regular `Text Overlay = Outline`. The regular Outline mode had been reusing `state.edgeErosionWidth` (default 16) as its stroke width in both the React preview and the SVG export, producing over-thick (8 SVG units per side) strokes that visually collapsed and merged 148px glyph fills. The fix adds a dedicated `outlineStrokeWidth` control (default `1.5`, clamped to `[0.25, 16]`) so each positioned glyph path renders as a clean stroke-only outline (`fill="none"`, `stroke` = artwork color) instead. Glyph positions, advances, tracking, baseline, and per-glyph path separation are preserved; the path data is unchanged.

The fix keeps regular Outline fully separate from Edge Erosion (which continues to skip outline mode and only applies its mask to filled overlays) and from `warped-outline` (which continues to require parsed font paths, native-falls-back to solid with a warning, and emits `data-warped-glyph` filled paths with `fill-rule="evenodd"`). Editable Text export remains native SVG text. Final Artwork export remains vector-only. No WebGPU, no reaction-diffusion, no persistent simulation, no worker cancellation, no export-semantics changes. Details are in `OVERLAY_MODE_FIX_NOTES.md`.

Diagnostics now surface the requested and effective overlay mode, overlay source (parsed-font / native-fallback / none), outline active flag, warp active flag, erosion inactive/active flag, and the outline stroke width. A new "Outline width" slider and an updated erosion-controls hint appear in the controls panel.

Validation: **156 tests across 16 files pass** (13 new overlay-mode tests added in `tests/overlayMode.test.ts`). TypeScript and the production build pass. The app version remains `0.16.0`.

## v0.15 Sonic Visual Quality / Composition

Sonic Diffuser now separates analytic radial crest strength from global emitter falloff. `ringSharpness` and `bandWidth` concentrate accepted vector dots around readable wave crests, while steeper falloff shaping reduces weak far-field dust. Diagnostics include average ring strength, average falloff, far-field rejection, and crest-dot counts.

Sonic Halftone uses the same band controls to bias field-reactive density inside the text mask. Sonic Diffuser, Sonic Halftone, Sonic Contours, and Sonic Stream presets were retuned for clearer structure, more restrained neighbor influence, readable contour deformation, and gentler streamline bending.

Text composition is solid by default. `textOverlayOpacity`, `edgeErosionAmount`, `edgeErosionWidth`, `interiorProtection`, and `overlayMode` control a vector-only overlay. Edge erosion uses deterministic, field-biased subtractive circles near SDF glyph edges; no continuous erosion stroke or global glyph opacity reduction is used.

Detailed behavior, preset notes, limitations, and deferred work are recorded in `SONIC_VISUAL_QUALITY_NOTES.md`.

## v0.14 Shared Glyph Field Modulation

`RenderContext` now exposes the memoized composite glyph field, safe scalar and central-difference gradient samplers, and field diagnostics. The field build is isolated from animation time/frame changes. Missing or disabled emitters remain a zero-safe no-op.

SDF Halftone now supports mask-safe candidate displacement plus field-driven density, radius, and opacity. SDF Contours displaces points along the SDF normal, and SDF Streamlines applies bounded angular modulation during integration. All three remain deterministic, enforce `maxNodes`, and report field mode, selected glyph, average sampled value/displacement, rejected displacement, and field-influenced acceptance.

The compact shared controls are mode, influence, displacement, density, radius, and opacity. New presets are **Sonic Halftone**, **Sonic Contours**, and **Sonic Stream**. **Sonic Diffuser** remains the halo/cloud preset; Wave Contours remains available for isolines.

Glyph Diffuser composition now includes through-text, text-reactive edge behavior, and an edge-eroded lighter vector overlay in addition to existing behind-text and clipped modes.

Known limitations: modulation deforms generated marks rather than font outlines; narrow strokes can clamp strong displacement; native glyph cells and emitter membership remain approximate.

## v0.13 Glyph Diffuser

`engine/renderers/glyphDiffuserRenderer.ts` adds a static emitter-aware density field. It reuses the v0.12 emitter anchor and contribution functions, samples a deterministic jittered grid, and emits vector `CircleMark` dots. Domains include inside-text, emitter halo, and text+halo.

Composition supports text-clipped dots and an unmasked vector halo behind a vector text overlay. Parsed fonts overlay glyph paths; native fallback overlays SVG text. Editable Text export is unchanged.

The **Sonic Diffuser** preset enables an O/o/0 emitter when available, otherwise a middle eligible glyph. It uses a bounded text+halo domain, moderate rings, vector dots, and text overlay.

## v0.12 Glyph emitters

Schema v4 adds a forward-compatible glyph emitter object plus continuous/dotted Wave Contours settings. Parsed glyph metadata now includes stable IDs, character/index, bounds, center, centroid approximation, optional counter-center heuristic, source anchor, and emitter eligibility. Native text receives approximate per-character cells.

`engine/field/glyphEmitters.ts` resolves glyph identity, display labels, and source anchors. `engine/field/compositeWaveField.ts` builds the deterministic bounded radial field over the current substrate. `engine/renderers/waveContoursRenderer.ts` extracts static Marching Squares contours and emits vector polylines or arclength-resampled circles.

The Glyph Ripple and Dotted Diffuser presets demonstrate continuous and dotted output. Wave Contours is static (`usesTime: false`), uses the existing substrate/backend result, and is cached by the static renderer runtime. CPU-WORKER behavior is unchanged.

Final Artwork remains mask-clipped vector SVG; Editable Text remains native SVG text. No field preview raster or canvas is serialized.

Known limitations: centroid and counter centers are bounds-based approximations; source-glyph membership uses glyph bounds; native-text glyph cells do not perform font shaping; contour stitching uses quantized endpoints. The legacy single-emitter path remains available and unchanged.

This remains deterministic static scalar-field rendering. It is not reaction-diffusion, does not retain simulation state, and does not add a persistent particle system. Detailed validation status is recorded in `WAVE_CONTOURS_QA.md`.

# 2. Current Tech Stack

| Area | Implementation |
| --- | --- |
| Framework | React 19 |
| Language | TypeScript 5.7 |
| Build | Vite 6 |
| Tests | Vitest 4 with jsdom |
| Font parsing | `opentype.js` |
| Glyph tests | OFL-licensed Basic Regular TTF fixture |
| Browser rasterization | Offscreen HTML 2D canvas |
| Test rasterization | `@napi-rs/canvas` |
| Preview | Inline SVG plus optional raster debug image |
| Vector export | Hand-built standalone SVG |
| State | Versioned JSON-compatible React state |

Production dependencies remain small. `@napi-rs/canvas`, Vitest, and jsdom are development/test dependencies only.

# 3. Current File / Module Structure

```text
src/
|-- App.tsx
|-- main.tsx
|-- styles.css
|-- types.ts
|-- components/
|   |-- CanvasFlowPreview.tsx
|   |-- Controls.tsx
|   |-- FlowPreview.tsx
|   `-- Viewport.tsx
|-- hooks/
|   |-- useAnimationClock.ts
|   |-- useDeferredDebugImage.ts
|   |-- useSubstrateBackend.ts
|   `-- useWaveFieldDebugImage.ts
`-- engine/
    |-- constants.ts
    |-- textLayout.ts
    |-- fontLoader.ts
    |-- glyphLayout.ts
    |-- glyphGeometry.ts
    |-- geometry.ts
    |-- rendererRuntime.ts
    |-- exportBudget.ts
    |-- performance.ts
    |-- compatibilityExports.ts
    |-- random.ts
    |-- presets.ts
    |-- projectSchema.ts
    |-- exportSvg.ts
    |-- svgValidation.ts
    |-- animationTiming.ts
    |-- previewBackend.ts
    |-- field/
    |   |-- glyphEmitters.ts
    |   `-- compositeWaveField.ts
    |-- substrate/
    |   |-- types.ts
    |   |-- rasterizeGlyphs.ts
    |   |-- edgeMap.ts
    |   |-- distanceField.ts
    |   |-- sampling.ts
    |   |-- debugImage.ts
    |   |-- buildSubstrate.ts
    |   |-- substrate.worker.ts
    |   |-- backends/
    |   |   |-- types.ts
    |   |   |-- workerMessages.ts
    |   |   |-- cpuMainBackend.ts
    |   |   |-- cpuWorkerBackend.ts
    |   |   |-- fallback.ts
    |   |   |-- diagnostics.ts
    |   |   `-- index.ts
    |   `-- index.ts
    `-- renderers/
        |-- types.ts
        |-- index.ts
        |-- flowLinesRenderer.ts
        |-- rippleLinesRenderer.ts
        |-- sdfFlowRenderer.ts
        |-- sdfStreamlinesRenderer.ts
        |-- sdfContoursRenderer.ts
        |-- sdfHalftoneRenderer.ts
        |-- waveContoursRenderer.ts
        |-- glyphDiffuserRenderer.ts
        `-- dotFieldRenderer.ts

tests/
|-- projectSchema.test.ts
|-- glyphLayout.test.ts
|-- glyphEmitters.test.ts
|-- exportSvg.test.ts
|-- substrate.test.ts
|-- sdfFlowRenderer.test.ts
|-- sdfStreamlinesRenderer.test.ts
|-- sdfContoursRenderer.test.ts
|-- sdfHalftoneRenderer.test.ts
|-- rendererQuality.test.ts
|-- compatibilityExports.test.ts
|-- substrateBackends.test.ts
|-- animationPreview.test.ts
|-- waveContoursRenderer.test.ts
|-- glyphDiffuserRenderer.test.ts
`-- fixtures/
    |-- Basic-Regular.ttf
    `-- OFL-Basic.txt
```

Important substrate modules:

- `substrate/types.ts` defines mask, edge, distance, gradient, diagnostics, result, resolution, and debug-mode contracts.
- `substrate/rasterizeGlyphs.ts` maps the 1200 x 720 SVG world into a resolution-capped canvas and reads a soft mask.
- `substrate/edgeMap.ts` detects threshold crossings over eight neighboring pixels.
- `substrate/distanceField.ts` performs deterministic forward/backward chamfer passes.
- `substrate/sampling.ts` exposes bilinear mask, edge, and distance sampling plus central-difference gradients in world coordinates.
- `substrate/debugImage.ts` creates preview-only mask, edge, and distance PNG data URLs.
- `substrate/buildSubstrate.ts` orchestrates construction, diagnostics, timing, and safe error fallback.
- `substrate/backends/types.ts` defines the pluggable backend, result, timing, and build-status contracts.
- `substrate/backends/cpuMainBackend.ts` wraps the existing synchronous builder behind the async backend interface.
- `substrate/backends/cpuWorkerBackend.ts` manages worker lifetime, typed requests, pending promises, request IDs, round-trip timing, and worker errors.
- `substrate/backends/fallback.ts` applies worker-to-main fallback and exposes stale-request comparison.
- `substrate/substrate.worker.ts` builds mask, edge, and distance data with `OffscreenCanvas` and transfers typed-array buffers back to the UI thread.

# 4. Implemented Features

## Font and glyph pipeline

- Upload `.ttf` and `.otf` files.
- Parse font metadata and glyphs with `opentype.js`.
- Manually position one glyph per Unicode code point using advance width, kerning, tracking, font size, baseline, and horizontal centering.
- Produce per-glyph SVG paths and actual glyph/text bounds.
- Use path masks for Final Artwork when a parsed font is loaded.
- Preserve native SVG text for Editable Text and fallback behavior.

## Raster substrate

Substrate resolution is stored in project state as a bounded quality setting:

```text
Low      256 x 154
Medium   384 x 230
High     512 x 307
Ultra    768 x 461
```

Height is derived from the existing `1200 x 720` viewport aspect ratio. Medium is the default. Ultra is explicitly labeled as expensive; it runs in the worker when supported, while `cpu-main` fallback may still block interaction.

Rasterization behavior:

- Glyph paths are filled white over a black canvas.
- World coordinates are transformed consistently into the raster buffer.
- Mask values use red-channel luminance:
  - inside = `1`
  - outside = `0`
  - antialiased boundary = soft values between `0` and `1`
- If glyph paths are unavailable, native canvas text is rasterized and labeled `native-text-fallback`.
- Empty text produces an `empty` substrate and finite distance data.

## Edge map

- Mask is classified at threshold `0.5`.
- A pixel is marked as an edge when any of its eight neighbors crosses the inside/outside threshold.
- Edge data is stored in a `Float32Array`.
- Edge-pixel count is recorded.

## Approximate signed distance field

- A two-pass chamfer distance transform computes distance to the nearest edge.
- Orthogonal steps cost `1`; diagonal steps cost `sqrt(2)`.
- Raster-pixel distances are converted to approximate SVG/world units.
- Sign convention:
  - positive inside
  - negative outside
  - zero at detected edges
- Empty/no-edge cases use a finite diagonal fallback rather than infinity.

This is an approximate SDF substrate, not a new visual renderer.

## Sampling API

Public sampling helpers accept SVG/world coordinates:

- `sampleMask(substrate, x, y)`
- `sampleEdge(substrate, x, y)`
- `sampleDistance(substrate, x, y)`
- `sampleDistanceGradient(substrate, x, y)`

Mask, edge, and distance use bilinear interpolation. Gradients use central differences measured at one raster-cell world step.

## Render context integration

`RenderContext` now optionally includes:

- `textGeometry`
- `substrateData`
- viewport dimensions/center
- `timeMs`
- `frame`

Flow, ripple, and dot renderers receive this context but intentionally do not consume substrate values yet. Their visible behavior is unchanged.

## SDF Flow renderer

`SDF Flow` is the first renderer that consumes the substrate instead of relying only on the final SVG mask.

Candidate generation:

- Uses the project seed and deterministic PRNG.
- Generates candidates within the substrate/text bounds.
- Samples mask, edge, signed distance, and distance gradient in world coordinates.
- Rejects candidates outside the mask.
- Rejects invalid or near-zero gradients.
- Uses a bounded attempt budget.

Orientation and marks:

- Normalizes the signed-distance gradient.
- Rotates the normal by 90 degrees to obtain the contour tangent.
- Perturbs the tangent angle with seeded turbulence.
- Uses amplitude to control vector line length.
- Emits shared `LineSegment` vector geometry.

`edgeInfluence` has renderer-specific field meaning here:

- Low values allow marks throughout the glyph interior.
- High values increase rejection away from the contour using exponential distance falloff and sampled edge strength.
- It does not use the older horizontal-band heuristic.

Renderer diagnostics are attached to the generated geometry group and displayed live:

- Accepted candidates
- Rejected candidates
- Average accepted signed distance
- Substrate availability
- Fallback state
- Candidate-budget warning when applicable

If substrate data is absent or empty, SDF Flow returns an empty geometry group with an explicit warning. It does not silently imitate substrate-aware output.

## SDF Streamlines renderer

`SDF Streamlines` is the first integrated field-line renderer. It emits one shared `Polyline` per accepted streamline rather than one element per integration segment.

Seed selection:

- Uses deterministic seeded candidate points within text/substrate bounds.
- Requires inside-mask coverage, finite positive distance, and a usable distance gradient.
- Applies the same real distance/edge bias principle as SDF Flow.
- Rejects seeds near occupied cells.

Integration:

- Uses a fixed world-space step.
- Samples and normalizes the distance gradient at every step.
- Rotates the normal 90 degrees into the tangent direction.
- Adds deterministic position/seed-based angular turbulence.
- Traces forward and backward from each seed, then joins both halves around the seed.
- Alternates tangent sign between streamlines.

Stopping conditions:

- Leaves the viewport
- Leaves the glyph mask
- Encounters an invalid or near-zero gradient
- Enters occupied space from a prior streamline
- Reaches the amplitude-derived step limit
- Reaches the global `maxNodes` point budget

Spacing uses an 11-world-unit occupancy grid. Accepted streamline points mark cells, and new seeds check neighboring cells, reducing clumping while remaining deterministic.

Controls:

- Density requests streamline count.
- Amplitude controls integration step count and step length.
- Turbulence perturbs the tangent field deterministically.
- Edge influence concentrates seeds toward contours/distance bands.
- `maxNodes` caps total emitted polyline points, not only SVG element count.

Diagnostics include requested/accepted streamlines, rejected seeds, total points, average points, average distance, mask exits, invalid gradients, occupancy rejections, substrate availability, and fallback state.

Missing or empty substrate returns empty geometry with an explicit warning; it never falls back to independent flow marks.

## SDF Contours renderer

`SDF Contours` extracts positive-distance isolines from the internal signed distance field using Marching Squares.

Level strategy:

- Density controls the requested level count, clamped to 2-14.
- The minimum level begins slightly inside the glyph edge.
- Amplitude expands or contracts the maximum interior distance sampled.
- High edge influence reduces the maximum level and applies a nonlinear distribution that clusters levels nearer the glyph boundary.
- Only positive inside-distance values are contoured.

Extraction and cleanup:

- Each raster cell tests its four edges against the current level.
- Linear interpolation places crossings in SVG/world coordinates.
- Two-crossing cells emit one segment.
- Four-crossing ambiguous cells use the cell-center value for a deterministic pairing.
- Shared quantized endpoints are stitched into polyline fragments.
- Adjacent duplicate points are removed.
- Nearly collinear points are simplified with a small perpendicular-distance threshold.
- Fragments with fewer than three points or negligible world length are skipped.
- Optional deterministic turbulence displaces points subtly along the SDF normal and keeps the original point when displacement would leave the mask.
- `maxNodes` is enforced as a global contour-point budget.

Output uses shared `Polyline` geometry and explicitly sets `fill="none"` in preview and SVG serialization. No raster mask, edge map, SDF image, or debug PNG enters exported artwork.

Diagnostics include contour levels, extracted fragments, accepted points, skipped fragments, maximum positive distance, average fragment length, point-budget clipping, substrate availability, and fallback state.

Missing or empty signed-distance substrate returns empty geometry with an explicit warning.

## SDF Halftone renderer

`SDF Halftone` is the first substrate-aware particle/fill renderer. It emits shared `CircleMark` geometry and uses field sampling for placement instead of scattering dots across the viewport and relying on the final SVG mask.

Placement:

- Builds a deterministic grid over the substrate/text bounds.
- Density maps to grid spacing and therefore candidate count.
- Turbulence applies bounded seeded jitter inside each grid cell.
- Each jittered candidate samples mask and signed distance; when jitter leaves the substrate, the unjittered cell center is tried before rejection.
- Accepted points also sample edge strength and distance gradient.
- Centers with insufficient mask coverage or non-positive inside distance are rejected.
- A spatial hash rejects nearby dots when their radii would overlap too heavily.
- `maxNodes` directly caps the exported circle count.

Radius and field behavior:

- Amplitude controls the safe maximum radius.
- Signed distance grows dots from a small edge radius toward a larger interior radius.
- Radius is clamped by grid spacing to prevent uncontrolled overlap.
- Turbulence adds a small deterministic radius variation.
- Low edge influence fills the interior broadly.
- High edge influence increases probabilistic rejection away from real SDF/edge bands and blends edge signal more strongly into radius and opacity.

Diagnostics include requested grid candidates, accepted dots, outside-mask rejections, spacing rejections, average/minimum/maximum radius, average accepted signed distance, substrate availability, fallback state, and node-budget clipping.

Missing or empty substrate returns an empty group with an explicit warning. It never falls back to the legacy Dot Field renderer.

## Renderer capability audit

All renderers now declare `usesTime`, `usesSubstrate`, `svgElementType`, and `supportedControls`. Shared controls follow a common instrument vocabulary while retaining renderer-specific field meanings.

| Renderer | Geometry | Density | Amplitude | Turbulence | Edge influence | `maxNodes` | Substrate | Time |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Flow lines | Line segments | Independent line count | Segment length | Angular noise | Legacy horizontal text-band opacity | Maximum segments | No; final SVG mask only | Yes |
| Ripple lines | Line segments | Independent tangent count | Segment length | Angular noise | Legacy horizontal text-band opacity | Maximum segments | No; final SVG mask only | No |
| Dot field | Circles | Independent circle count | Not supported | Not supported | Legacy horizontal text-band size/opacity | Maximum circles | No; final SVG mask only | No |
| SDF Flow | Line segments | Accepted tangent-mark target | Segment length | Seeded tangent-angle perturbation | Rejects marks away from sampled contours | Maximum segments | Mask, edge, distance, gradient | No |
| SDF Streamlines | Polylines | Requested streamline count | Integration length and step | Deterministic tangent-field perturbation | Biases seed acceptance toward contours | Maximum total polyline points | Mask, edge, distance, gradient | No |
| SDF Contours | Polylines | Isoline level count | Maximum interior contour depth | Small deterministic normal displacement | Compresses levels toward the boundary | Maximum total contour points | Distance, mask, gradient | No |
| SDF Halftone | Circles | Grid density/candidate count | Maximum dot radius | Position/radius jitter | Biases acceptance toward edge bands | Maximum circles | Mask, edge, distance, gradient | No |

Normalization decisions:

- Density increases requested elements, levels, or sampling candidates.
- Amplitude increases mark length, integration extent, contour depth, or circle radius.
- Turbulence always adds seeded deterministic variation and never changes the random seed itself.
- Edge influence increases edge/contour bias in SDF renderers. The three legacy renderers retain their older horizontal-band heuristic and are documented as such rather than misrepresented as substrate-aware.
- Segment/circle renderers cap SVG elements. Polyline renderers cap total emitted points. The diagnostics panel states the applicable count and clipping state.

## Renderer diagnostics and export budgets

Every renderer is summarized in a consistent instrument panel:

- Geometry type
- SVG element count
- Vector point count
- Estimated node cost
- Approximate serialized byte size
- Substrate type
- Accepted/rejected renderer-specific counts where available
- `maxNodes` clipping state

The existing detailed SDF diagnostics remain visible alongside this shared summary. Substrate debug diagnostics continue to report raster dimensions and measured build time.

Non-blocking export warnings are shown before export and repeated in the status message after download when:

- Estimated size is at least 500 KB
- Element count is at least 2,500
- Point count is at least 8,000
- Renderer output reports `maxNodes` clipping
- Final Artwork uses native-text fallback rather than parsed glyph paths

Malformed SVG remains the only condition that blocks export.

## Static renderer memoization

`rendererRuntime.ts` is now the shared geometry generation entry point for preview/export orchestration.

- Static renderers use a small 24-entry in-memory cache.
- The key includes renderer, text/font identity, typography, field controls, seed, substrate quality, node budget, and substrate object identity when required.
- Time/frame are excluded for static renderers.
- Flow Lines declares `usesTime: true` and bypasses the static cache.
- Export reuses the already generated geometry when exporting the current frame.

This is intentionally basic memoization, not persistent storage or a generalized dependency graph.

## Substrate-aware presets

Four presets now demonstrate actual field behavior:

- `SDF Current` — short edge-biased SDF tangent marks
- `Contour Thread` — integrated SDF streamlines
- `Topographic Type` — layered Marching Squares contours
- `Halftone Press` — SDF-scaled circle fill

## Debug views and diagnostics

The connected substrate selector provides:

- None
- Glyph outlines
- Raster mask
- Edge map
- Signed distance
- Distance gradient vectors

Mask, edge, and distance views are preview-only raster `<image>` layers. Gradient vectors are sampled in world space and rendered as SVG debug lines. Normal SVG export remains vector-only.

When a substrate debug view is active, the viewport reports:

- Substrate type
- Raster resolution
- Mask coverage percentage
- Edge-pixel count
- Minimum/maximum signed distance
- Build time

Substrate failures return a safe empty result and display an error without blocking vector export.

# 5. Milestone Mapping

| Milestone | Status | Reason |
| --- | --- | --- |
| 1 - Project foundation | **Done** | Versioned state, controls, viewport, JSON, deterministic preview, and SVG export exist. |
| 2 - Font and glyph pipeline | **Done** | TTF/OTF loading, metadata, manual layout, glyph paths, bounds, path masks, and fallback behavior exist. |
| 3 - Text mask and SDF substrate | **Done** | Resolution-capped glyph rasterization, native fallback, edge map, approximate signed distance field, world sampling, debug views, diagnostics, and tests exist. |
| 4 - Reaction-diffusion | **Not started** | Deliberately deferred until the substrate layer is reviewed. |
| 5 - Particle/field simulation | **Partially done** | SDF Flow, integrated SDF Streamlines, and SDF Halftone consume the real field, but there is no persistent particle or time-evolving simulation state. |
| 6 - Vector renderers | **Partially done** | Seven modular renderers exist, including tangent marks, integrated streamlines, Marching Squares contours, and an SDF-aware circle fill; general path simplification remains limited. |
| 7 - SVG export | **Partially done** | Structured path-mask export and reload validation exist; external vector-app compatibility remains manual. |
| 8 - Instrument UX | **Partially done** | Presets, playback, font loading, bounded substrate quality, export warnings, and consistent renderer diagnostics exist. |
| 9 - Performance/cleanup | **Partially done** | Substrate construction defaults to a Web Worker, with phase/backend timings, stale-result protection, explicit main-thread fallback, debug-image caching, and static renderer caching. Debug-image generation and fallback computation can still block the UI. |
| 10 - Polish/extensions | **Partially done** | Typed substrate and renderer contracts are credible extension points; complex shaping and any WebGPU backend remain future work. |

# 6. Rendering and Substrate Architecture

```text
Source text + loaded font
  -> TextGeometry (positioned glyph SVG paths)
  -> SubstrateComputeBackend
      -> cpu-worker (default)
      -> cpu-main (fallback)
  -> RasterMask + EdgeMap + DistanceField
  -> RenderContext
  -> future fields/particles/contours/simulations
```

The substrate input is memoized in `App.tsx` from layout-affecting inputs:

- Source text
- Runtime text geometry/font identity
- Font size
- Tracking
- Font metadata
- Selected bounded substrate resolution

Animation frame/time does not rebuild the substrate. `useSubstrateBackend` submits each changed input asynchronously with a monotonically increasing local request ID. A completion is committed only when its request ID is still current, so slow prior builds cannot overwrite newer text/font/quality state.

## Substrate compute backends

`cpu-main` wraps the original synchronous `buildSubstrate()` implementation behind the async `SubstrateComputeBackend` interface. It remains the compatibility fallback and reports its work as main-thread time.

`cpu-worker` is the default backend:

- Uses a Vite module worker.
- Receives typed `build` messages containing structured-clone-safe `SubstrateBuildInput`.
- Uses `OffscreenCanvas` and worker `Path2D` for glyph/native fallback rasterization.
- Runs rasterization, edge-map construction, and signed-distance construction in the worker.
- Returns typed result/error messages correlated by backend request ID.
- Transfers mask, edge, and distance `ArrayBuffer` instances instead of cloning them.
- Reports worker compute, round-trip, total, and estimated main-thread coordination time.

Before its first build, `cpu-worker` performs a runtime self-test:

- Module Worker creation
- A separate typed `ping` / `pong` startup probe
- Worker `OffscreenCanvas`
- Worker `Path2D`
- 16 × 16 simple-path rasterization and pixel readback
- Transferable `Float32Array` sentinel round trip

Self-test status is `supported`, `partially-supported`, or `unavailable`. Failures distinguish `worker-unavailable`, `worker-constructor-failed`, `worker-timeout`, `worker-self-test-failed`, `worker-build-failed`, `offscreen-canvas-unavailable`, `path2d-unavailable`, `rasterization-failed`, `worker-crashed`, and `unknown`.

Every startup/self-test/build request has an 8,000 ms timeout. Timeout removes the pending entry before fallback, so a late worker response is ignored. React's independent request-generation check prevents an older build from committing after newer text or quality state.

If worker creation, `OffscreenCanvas`, `Path2D`, or worker computation fails, the same input is retried through `cpu-main`. Constructor failures retain the exception name, message, stack, resolved worker URL, and main-thread `typeof Worker` / `OffscreenCanvas` / `Path2D` values. The UI reports the precise failure category and message; fallback is never silently presented as worker output.

The Chrome development startup bug was caused by React Strict Mode, not an incorrect Vite URL. Strict Mode's effect rehearsal disposed the state-held worker and then reused that dead backend. Worker disposal is now delayed by one task and cancelled when the rehearsal setup runs; actual unmount still terminates it. The Vite worker construction remains the correct `new URL("../substrate.worker.ts", import.meta.url)` relative path from `backends/cpuWorkerBackend.ts`.

The rasterizer retains an injectable canvas factory. The worker uses `OffscreenCanvas`; main-thread browsers use an HTML canvas; tests use `@napi-rs/canvas`.

`WEBGPU_NOTES.md` documents how a future backend could satisfy this contract. It contains no WebGPU implementation.

# 7. SVG Export

SVG export remains vector-only:

- No raster mask, edge map, SDF texture, or debug PNG is embedded.
- Parsed-font artwork continues to use glyph `<path>` elements inside `glyph-mask`.
- Native fallback continues to use SVG `<text>`.
- Editable Text remains native text.
- Existing metadata and required group validation remain intact.

The export action reparses generated XML with `DOMParser` before download and blocks malformed output.

Exact UTF-8 byte size is measured after serialization with `TextEncoder`. Export status reports both exact size and serialization time. Pre-export diagnostics retain an estimate because exact size does not exist until the SVG string is built; exact-size warnings are recalculated immediately after serialization.

`generateCompatibilityExportSet()` creates eight representative in-memory SVGs without requiring browser download interaction:

- Editable Text
- Final Artwork with glyph-path mask
- SDF Flow
- SDF Streamlines
- SDF Contours
- SDF Halftone
- High mark-count stress output
- XML-sensitive text containing `&`, `<`, `>`, and quotes

Every fixture records renderer, substrate type, glyph paths, generated elements, point count, exact bytes, serialization time, and warnings. `npm run compatibility:check` runs the focused automated compatibility suite.

Only Standard SVG is implemented. A flattened-mask compatibility mode was deliberately not faked: dependable vector boolean clipping would require a larger geometry operation layer and external-editor validation. Final Artwork remains vector-only and never embeds raster debug images.

## Performance instrumentation

Debug diagnostics now expose:

- Glyph layout time
- Substrate rasterization time
- Edge-map time
- Signed-distance-field time
- Total substrate build time
- Debug-image generation time
- Renderer generation time and cache-hit status
- SVG serialization time when export diagnostics are enabled

Shared performance classification:

| Duration | Classification |
| --- | --- |
| Below 100 ms | OK |
| 100-249.9 ms | Noticeable |
| 250-499.9 ms | Slow |
| 500 ms or more | Severe |

Slow substrate warnings are non-blocking. Ultra warns that `cpu-main` fallback may block interaction. Worker timings separate compute from round-trip/coordination time. Debug-image generation remains on the main thread.

Debug raster images are cached by substrate object and debug mode. Toggling unrelated debug overlays does not affect the renderer cache key or regenerate static geometry.

# 8. Automated Validation

Current result:

```text
Test Files  15 passed (15)
Tests       143 passed (143)
```

Coverage includes:

- Version 1/2 project migration and version rejection
- Numeric clamping and enum validation
- Font metadata safety
- Licensed fixture font parsing and metadata
- Glyph paths, bounds, tracking, scaling, whitespace, and missing glyphs
- Path-mask and native-text SVG export
- Editable text export
- Metadata, XML escaping, and DOMParser reload
- Raster dimensions
- Non-empty visible-text mask
- Empty text safety
- Nonzero edge map
- Finite distance values
- Positive-inside/negative-outside signs
- World-coordinate mask/distance sampling
- Glyph-path substrate selection
- Safe native-text fallback
- SDF Flow registry presence
- Finite line geometry
- Determinism for identical seed/context
- Seed-dependent output changes
- Explicit missing-substrate fallback
- Candidate origins inside the sampled mask
- SDF Flow vector SVG serialization and DOMParser validation
- SDF Streamlines registry presence
- Continuous finite polyline geometry
- Streamline determinism and seed variation
- Explicit empty-substrate fallback
- Integrated points inside the sampled mask
- Strict total-point `maxNodes` enforcement
- Vector polyline SVG serialization and DOMParser validation
- SDF Contours registry presence
- Finite stitched contour polylines
- Deterministic contour extraction
- Density-dependent level/point changes
- Strict contour-point budget enforcement
- Explicit empty-substrate fallback
- Contour points inside the mask within boundary tolerance
- Unfilled vector polyline SVG serialization and DOMParser validation
- SDF Halftone registry presence
- Finite positive-radius circle geometry
- Accepted dot centers inside the sampled mask
- Determinism for identical seed/context and seed-dependent placement changes
- Density-dependent candidate/dot counts
- Amplitude-dependent average radius
- Strict circle-count `maxNodes` enforcement
- Explicit missing-substrate fallback
- Vector circle SVG serialization and DOMParser validation
- Complete renderer capability metadata
- Supported-control declaration for every renderer
- Cross-renderer geometry-appropriate `maxNodes` enforcement
- Substrate quality validation and defaulting
- High element/point/byte, clipping, and native-fallback export warnings
- Static renderer cache reuse without output changes
- Eight-case compatibility export generation
- Exact UTF-8 serialized byte-size calculation
- XML-safe special-character compatibility output
- Final Artwork compatibility fixtures contain no raster `<image>`
- Finite substrate phase timing diagnostics
- 100/250/500 ms performance warning thresholds
- Ultra main-thread warning
- Debug overlay changes preserve cached static geometry
- `cpu-main` wraps the existing builder and reports backend timings
- Typed `cpu-worker` requests/replies correlate by request ID even when replies arrive out of order
- Worker failure falls back to `cpu-main` with an explicit reason
- Stale request IDs are rejected
- Worker self-test result parsing for supported/partial capability sets
- Explicit fallback-code mapping
- Timeout rejection and stale late-response protection
- Stable backend diagnostics display shape
- Vector-only SVG export after `cpu-main` fallback
- Worker constructor exception and resolved-URL preservation
- Typed ping/pong startup before substrate self-test
- Self-test timeout classification distinct from constructor failure
- Runtime crash classification distinct from constructor failure
- Precise constructor-failure fallback through `cpu-main`
- Latest-only substrate request coalescing and pending replacement
- `cpu-main` fallback through the coalescing scheduler
- Flow Lines as the sole time-aware renderer
- Deterministic animated Flow Lines frame regeneration
- Deferred debug-image cache reuse across animation-only reads

Browser verification confirmed the quality selector, Halftone Press preset, shared renderer diagnostics, a 512 x 307 High-quality native fallback substrate, 290 generated vector circles, and no console warnings/errors. The observed High-quality substrate build took approximately 286 ms on the QA run, reinforcing the explicit Ultra main-thread warning.

The v0.10 browser QA pass also verified Ultra at 768 x 461: 654 ms total build time, 12.2 ms rasterization, 515.8 ms edge-map construction, 93.7 ms distance-field construction, 119.4 ms debug-image generation, and 6.1 ms SVG serialization for a 77.5 KB exact-size diagnostic. The severe threshold and Ultra warning both appeared, with no console warnings/errors.

The v0.11 worker bundle is production-built and its startup probe, self-test, request correlation, timeout, precise failure reporting, and fallback behavior are covered by automated fake-worker tests.

Post-fix real-browser QA in the Codex in-app Chromium surface reached `CPU-WORKER`, `READY`, and `SUPPORT SUPPORTED`, with no fallback and no console warnings/errors. The observed build reported 157.8 ms total/round-trip time and 38.4 ms worker compute time.

The user separately confirmed that standalone Chrome passed a manual module-worker capability and message probe before the fix, while SUBSTRATE failed because of the Strict Mode lifecycle bug. The post-fix standalone Chrome app now succeeds; Edge, Firefox, and Safari remain pending. The worker path is credible for continued substrate work, but cross-browser stability still requires those runs.

Standalone Chrome now also confirms the repaired application path itself: `CPU-WORKER`, `READY`, `SUPPORT SUPPORTED`, and no fallback.

## Worker performance profile

A focused real-Chromium profile covered Low, Medium, High, and Ultra with native text and the OFL Basic-Regular TTF fixture. Debug views were off during substrate builds, then mask/edge/distance images were measured separately.

| Substrate | Quality | Total | Worker | Main / coordination | Raster | Edge | SDF |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Native text | Low | 209.5 ms | 84.0 ms | 125.5 ms | 6.3 ms | 45.1 ms | 24.0 ms |
| Native text | Medium | 58.0 ms | 43.6 ms | 14.4 ms | 4.7 ms | 21.7 ms | 14.9 ms |
| Native text | High | 104.2 ms | 64.8 ms | 39.4 ms | 4.7 ms | 33.3 ms | 22.0 ms |
| Native text | Ultra | 71.1 ms | 64.2 ms | 6.9 ms | 16.1 ms | 20.9 ms | 12.5 ms |
| Glyph paths | Low | 145.5 ms | 32.9 ms | 112.6 ms | 3.8 ms | 14.6 ms | 9.1 ms |
| Glyph paths | Medium | 69.5 ms | 61.4 ms | 8.1 ms | 2.8 ms | 22.2 ms | 15.3 ms |
| Glyph paths | High | 197.1 ms | 34.4 ms | 162.7 ms | 5.4 ms | 7.1 ms | 11.6 ms |
| Glyph paths | Ultra | 189.6 ms | 119.7 ms | 69.9 ms | 51.1 ms | 30.4 ms | 19.7 ms |

These are single observed development-server runs, not statistical medians; warm-up and coordination noise explain non-monotonic rows. Medium is a sound default. High is acceptable for deliberate changes through `cpu-worker`. Ultra is acceptable as an opt-in static-quality mode, but not for rapid scrubbing.

Debug-image generation is still material because it remains on the main thread. High/Ultra edge views reached approximately 104–168 ms, and the Ultra glyph distance view reached 101.3 ms. Rapid Low → Ultra → Medium changes correctly committed only Medium without fallback, but the final round trip reached 596.2 ms while final worker compute was only 25.8 ms. This indicates queued obsolete work/coordination rather than expensive final computation.

The recommended next step is lightweight latest-request coalescing or cancellation, followed by moving debug-image generation off the main-thread interaction path. Full measurements are in `WORKER_PERFORMANCE_RESULTS.md`.

## Animation and interaction optimization

The latest-request scheduler is now implemented. It runs one substrate build at a time and retains at most the newest pending input. Replaced pending requests and stale active results are counted and never commit. Existing worker timeouts, request IDs, and `cpu-main` fallback remain intact.

Backend diagnostics now include active/latest request IDs, pending count, coalesced count, dropped obsolete count, skipped status, backend, and worker/main/round-trip timing.

Debug mask/edge/distance images use deferred main-thread generation with `requestIdleCallback` where available and a deferred-task fallback. The cache is keyed by substrate object and mode, including shared in-flight promises. Substrate commit and animation frames no longer wait for or regenerate debug PNGs. SVG export remains vector-only.

Flow Lines now caches its deterministic seeded base values and defaults to a preview-only Canvas 2D path at high element counts. The canvas loop draws shared geometry without mutating 1,500+ SVG nodes and reports diagnostics to React at low frequency. Parsed glyph outlines use `Path2D` clipping; native text uses canvas compositing. The refs-based SVG DOM preview remains selectable and is the automatic canvas-failure fallback.

Export continues to use the exact shared line geometry through the existing SVG serializer. Final Artwork remains vector SVG, Editable Text remains native SVG text, and neither export mode contains canvas or raster image data.

Preview-only controls provide Auto/Canvas 2D/SVG DOM selection, 24/30/60 FPS caps, hidden-tab pause, and static/reduced-motion mode. Export pauses animation. Live diagnostics report valid non-negative FPS, frame time, backend, canvas draw time, SVG DOM count, clipping/fallback state, renderer time, element/point counts, regeneration flags, and clock state.

The stabilized default for dense Flow Lines is Auto + Canvas 2D at 30 FPS. The 60 FPS cap remains available as an experimental/high-load option, and dense SVG DOM preview is explicitly labeled debug/slow. Standalone Chrome observations put Canvas 2D around 25–40 FPS at the 60 cap with only 1–1.5 ms canvas draw time, versus roughly 5 FPS for dense SVG DOM. Pacing diagnostics now distinguish the selected cap, average FPS, frame interval, draw cost, and stable/unstable cadence.

Focused animation, glyph-emitter, composite-field, Wave Contours, schema, compatibility, and export tests are included. The current verified count is recorded in the Automated Validation section.

External compatibility status is recorded in `VECTOR_COMPATIBILITY_RESULTS.md`. Browser behavior is tested; Figma, Illustrator, Inkscape, and Affinity Designer remain honestly marked **Not tested**.

## Performance audit

A read-only audit pass identified the largest current bottlenecks after v0.14 Shared Glyph Field Modulation; no code was changed. Detailed evidence, ranking, and DevTools measurement guidance live in `PERFORMANCE_AUDIT.md`.

Top findings, in likely impact order:

1. Worker round-trip backlog during rapid text/quality scrubbing (observed 596.2 ms round trip vs 25.8 ms final compute); `LatestOnlyScheduler` coalesces pending requests but cannot cancel in-flight worker builds.
2. Substrate debug-image generation still on the main thread (117.8–167.9 ms for edge views; 101.3 ms for Ultra glyph distance) despite deferred idle scheduling.
3. `useWaveFieldDebugImage` rebuilds the composite wave field and runs a second pixel-walk, ignoring `RenderContext.glyphField`.
4. `rendererRuntime.cacheKey` builds a `JSON.stringify` key on every static geometry request, including the full `state.emitter` object.
5. Composite wave field rebuilds whenever `amplitude`/`frequency`/emitter identity change; per-cell `Math.hypot`/`Math.sin`/`Math.exp` with no hoisted factors.
6. Redundant `buildCompositeWaveField` fallbacks in Wave Contours and Glyph Diffuser despite the field already being on the context.
7. SDF Streamlines per-step redundancy: distance-gradient (16 reads) plus glyph gradient (16 reads) plus post-loop `reduce` re-sampling every emitted point.
8. SDF Contours allocation storm (`corners`/`crossings` objects per Marching Squares cell × substrate × level count) and double `sampleDistanceGradient` calls per contour point; Wave Contours shares the same pattern.
9. Export-diagnostics panel re-serializes the full SVG + runs `DOMParser.parseFromString` + `querySelectorAll("*")` on every parameter tweak while `costEstimate` is enabled.
10. SDF Halftone string-keyed `Map` occupancy + 5-sample candidate path.

Suggested quick wins (no visual changes, no large refactors): gate `costEstimate` recompute to export/idle, pack the renderer cache key from primitives only, reuse `context.glyphField` in `useWaveFieldDebugImage`, hoist Marching Squares corner allocations out of inner loops, skip disabled modulation gradients, replace string occupancy keys with numeric ones, and round coordinates manually in `serializeGeometry`. Risky options (worker cancellation, worker-side debug images, exact Euclidean distance, outline deformation) are deferred and documented in the audit.

## Performance quick wins

A focused pass applied the seven low-risk quick wins from `PERFORMANCE_AUDIT.md`; full details live in `PERFORMANCE_QUICK_WINS.md`. No new visual features, no visual-output changes, and no changes to SVG export semantics. WebGPU, reaction-diffusion, persistent simulation, worker cancellation, and worker-side debug images remain intentionally NOT implemented.

Implemented changes:

1. **Cost-estimate gating (`src/App.tsx`)** — `createTimedSvg` + `DOMParser` validation now only runs when the cached estimate geometry identity actually changes, not on every slider/animation-tick while `debug.costEstimate` is on.
2. **Reuse shared glyph field (`src/hooks/useWaveFieldDebugImage.ts`)** — the wave-field debug hook now prefers `context.glyphField` (built once by `App`) and falls back to `buildCompositeWaveField` only for tests/non-App callers.
3. **Packed primitive cache key (`src/engine/rendererRuntime.ts`)** — replaced `JSON.stringify` with a `|`-joined packed string of renderer-relevant scalars plus a packed emitter sub-key. Debug/preview-only changes no longer invalidate static geometry.
4. **Skip disabled modulation gradients (`src/engine/field/glyphFieldModulation.ts` + Halftone/Contours/Streamlines)** — `getGlyphFieldSampler` exposes per-effect flags; `glyph.gradient` short-circuits to a zero gradient when displacement is disabled; renderers gate their modulation math on the relevant flag.
5. **Reduce Marching Squares allocation (`src/engine/renderers/sdfContoursRenderer.ts`, `waveContoursRenderer.ts`)** — eliminated per-cell `corners`/`edgePairs`/`crossings` allocations by reading corner values directly and inlining the interpolation; stitcher adjacency Maps now use numeric keys (preserved quantization).
6. **Numeric halftone occupancy keys (`src/engine/renderers/sdfHalftoneRenderer.ts`)** — `Map<string, …>` → `Map<number, …>` with a packed `(cellY + offset) * span + (cellX + offset)` key; spacing behaviour unchanged.
7. **Streamlines in-line distance accumulation (`src/engine/renderers/sdfStreamlinesRenderer.ts`)** — the per-step `sampleDistance` already sampled for the finite-distance check is now accumulated into a `distanceAccumulator`; the post-integration `points.reduce` re-sampling loop is removed.

Remaining bottlenecks: **worker round-trip backlog during rapid text/quality scrubbing** remains the top responsive risk; it requires actual worker cancellation, which **remains deferred** in this pass. Main-thread debug-image generation (Deferred/idle-bound but still 100–170 ms for High/Ultra edge views), composite wave field rebuild on amplitude/frequency change, redundant `buildCompositeWaveField` fallbacks in Wave/Diffuser, post-stitch per-point `sampleDistanceGradient` in Contours, dense SVG-DOM preview reconciliation, and large `<metadata>` project serialization in export remain unchanged and visible in `PERFORMANCE_AUDIT.md`.

## Preview quality control

Flow Lines now exposes a runtime-only **Preview Quality** selector beside its
backend/FPS controls:

- **Full** (default): refreshes all 24 opacity paths each frame.
- **Balanced**: refreshes 12 opacity paths together each frame.
- **Performance**: refreshes 8 opacity paths together each frame.

The setting is preview-only UI state. It is not part of `ProjectState`, project
JSON, renderer geometry, or SVG serialization. Final Artwork SVG always remains
full-quality deterministic vector output. All product modes now present a
coherent animation time; lower modes trade only preview opacity resolution,
not temporal synchronization. Balanced remains opt-in pending human visual
acceptance; no Canvas/WebGPU fallback is introduced.

## Gate 7.9 Dual preview pipeline

Dense animated Flow previews now use an explicit, visible backend contract:

- **Canvas Performance · preview only** is the recommended and initial mode for
  Edge Current. It owns its animation loop and batches shared Flow line geometry
  into at most 24 Canvas stroke submissions.
- **SVG Accuracy · vector DOM** remains available as the reference preview and
  retains its SVG quality controls.

Both backends consume the same renderer math and presentation-neutral Flow
frame data. Preview backend state and recommendation metadata remain outside
`ProjectState` and `.substrate.json`. Unsupported renderers visibly resolve to
SVG Accuracy rather than silently presenting Canvas.

Final Artwork SVG has no dependency on either preview backend. It continues to
use the CPU renderer and existing SVG serializer with full geometry and
forbidden-raster validation.

# 9. Known Issues / Limitations

- The SDF is an approximate chamfer field, not an exact Euclidean distance transform.
- SDF Flow uses short independent tangent segments, not integrated streamlines.
- Streamline integration uses first-order fixed steps rather than RK2/RK4.
- Occupancy is a coarse grid, so spacing is approximate and may reject more lines than requested.
- Streamlines are computed from a static field every render; geometry is not yet cached by renderer inputs.
- Turbulence can shorten lines by pushing them toward mask or occupancy boundaries.
- Marching Squares topology is resolution-dependent and uses a simple center-value rule for ambiguous cells.
- Quantized endpoint stitching can split contours when numerically close endpoints fall outside the key tolerance.
- Collinearity cleanup is intentionally lightweight and is not a general-purpose path simplifier.
- High density can reach `maxNodes`, causing whole later fragments to be skipped rather than partially truncating a contour.
- Low/Medium substrate quality may support only a few positive contour bands in narrow glyph strokes.
- Ultra quality can cause noticeable main-thread stalls on complex text or slower devices.
- Halftone spacing uses an approximate spatial hash and overlap threshold, not exact circle packing or blue noise.
- Halftone candidate order is row-major, so severe `maxNodes` clipping favors earlier rows rather than distributing the budget globally.
- High halftone edge influence is probabilistic and may leave sparse interiors or uneven contour bands on narrow glyphs.
- Candidate rejection is bounded, so extreme edge bias or unusual substrates may produce fewer marks than requested.
- Line endpoints can cross the sampled boundary even though candidate origins are inside; the final vector glyph mask still clips them.
- Distance scale uses the average X/Y world scale. The rounded 384 x 230 resolution creates slight anisotropy.
- Native fallback rasterization depends on browser/canvas font availability and does not apply custom tracking per glyph.
- Complex-script shaping, ligatures, bidi, combining-mark positioning, and variable-font axes are not supported.
- `cpu-worker` depends on module Worker, `OffscreenCanvas`, and worker `Path2D` support; unsupported browsers use `cpu-main`.
- Successful worker startup is recorded in real Chromium and standalone Chrome; a repeatable standalone timing matrix plus Edge, Firefox, and Safari application runs remain pending.
- Font upload through the worker/glyph-path path was not manually tested in the available browser automation surface.
- Worker timeout is conservative at 8 seconds and is not currently user-configurable.
- `cpu-main` fallback still performs rasterization, edge mapping, and distance construction synchronously and can block interaction.
- Debug-image generation remains synchronous on the main thread.
- A new substrate request temporarily clears substrate data rather than rendering mismatched stale geometry.
- Debug PNG generation is not cached across repeated switches beyond React memoization for the selected mode.
- Build-time measurements vary by browser and warm-up state.
- Geometry byte size is an estimate based on element/point counts; exact serialized size is available only after SVG construction.
- Exact size requires constructing the complete SVG string on the main thread.
- The 24-entry renderer cache is process-local and uses insertion-order eviction rather than true LRU accounting.
- Flow Lines regenerates every animation tick by design; the other six renderers are static for a fixed state/context substrate.
- Native-text Canvas clipping uses browser font metrics and does not reproduce custom letter spacing exactly; loaded glyph `Path2D` outlines provide precise clipping.
- Standalone Chrome observation: Canvas 2D fluctuates around 25–40 FPS at the experimental 60 cap with 1–1.5 ms canvas draw time; dense SVG DOM is around 5 FPS.
- Gradient debug vectors are coarse samples, not exported geometry.
- Only the existing glyph bounds are stored; connected-component or per-glyph raster labels do not exist.
- External Figma, Illustrator, Inkscape, and Affinity compatibility checks remain manual.
- SVG masks remain the main compatibility risk because no flattened vector-mask export exists.
- There is no reaction-diffusion implementation.

# 10. Recommended Next Steps

1. Review mask, edge, and distance debug views with several fonts, sizes, counters, and thin strokes.
2. Add an exact or higher-quality Euclidean distance transform only if chamfer error is materially visible in downstream sampling.
3. Profile Low/Medium/High/Ultra substrate build times across representative devices and fonts.
4. Repeat the full quality/font timing matrix in standalone Chrome or Edge, including font upload and all quality levels.
5. Validate `cpu-worker` in Firefox and Safari, especially worker `Path2D` behavior and native-text fallback.
6. Profile the renderer cache hit rate and replace insertion-order eviction only if the small cache proves insufficient.
7. Execute `VECTOR_COMPATIBILITY_CHECKLIST.md` in available external vector editors.
8. Profile SDF renderer candidate rejection and cache static geometry when time does not affect a renderer.
9. Compare Euler integration with midpoint/RK2 only if field-line smoothness materially needs it.
10. Tune occupancy-cell size, streamline step size, contour thresholds, and simplification against multiple fonts and substrate resolutions.
11. Consider fragment/candidate prioritization when `maxNodes` clips contour or halftone output.
12. Profile and tune halftone spacing/radius behavior across thin, heavy, serif, and display fonts.
13. Consider moving debug-image generation into the worker if its measured main-thread cost remains material.
14. Keep reaction-diffusion deferred until worker backend behavior and performance are accepted.
15. Run the generated compatibility set through Figma, Illustrator, Inkscape, and Affinity Designer where available, then replace `Not tested` entries with measured results.

# 11. How to Run

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run build
```

Requirements:

- Node.js compatible with Vite 6
- npm
- Modern browser with Canvas 2D, SVG mask, `Path2D`, File API, and typed arrays

# 12. Reviewer Questions

1. Is 384 x 230 sufficient for the first substrate-driven renderer?
2. Is chamfer-distance accuracy acceptable, or should exact Euclidean distance be implemented before downstream work?
3. Should Ultra quality remain available when only `cpu-main` fallback is active?
4. Should native-text fallback produce full substrate data or be treated as explicitly limited?
5. Is the halftone's jittered-grid texture sufficient, or is a more expensive blue-noise pass justified?
6. Should severe `maxNodes` clipping distribute halftone candidates globally instead of preserving row-major order?
7. Which browser support floor is required for worker `OffscreenCanvas` and `Path2D` before `cpu-main` becomes a legacy-only path?
