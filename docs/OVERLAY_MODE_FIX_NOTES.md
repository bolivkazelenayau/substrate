# Overlay Mode Bugfix — Regular Outline Rendering

Date: 2026-06-29  
App version: `0.16.0`  
Scope: bugfix for regular `Text Overlay = Outline` rendering. Not a feature pass; no WebGPU, no reaction-diffusion, no persistent simulation, no worker cancellation, no export-semantics changes. Final Artwork export remains vector-only; Editable Text export remains native SVG text.

## Root cause of the Outline bug

The regular `outline` overlay mode was reusing `state.edgeErosionWidth` (default **16**, intended for erosion masks) as the outline stroke width in both the React preview and the SVG export:

```js
// Viewport.tsx (before) and exportSvg.ts (before)
strokeWidth={state.overlayMode === "outline" ? Math.max(1, state.edgeErosionWidth) : undefined}
```

A stroke-width of 16 SVG units on 148px glyphs is far too thick — the 8-unit half-stroke on each side of the path centerline fills thin strokes entirely and visually merges adjacent glyph paths, making the outline look "collapsed/filled/merged" rather than clean. The actual glyph path data, contouring, and per-glyph path emission were already correct — the bug was purely a wrong stroke-width source crossing the mode boundary between the erosion feature and the outline feature.

## Files changed

### Source

* `src/types.ts` — added `outlineStrokeWidth: number` to `ProjectState`.
* `src/engine/presets.ts` — `baseState.outlineStrokeWidth = 1.5` (sane default; matches the existing artwork `stroke-width: 1.15–1.4` band).
* `src/engine/projectSchema.ts` — added `outlineStrokeWidth` clamped to `[0.25, 16]` in `validateProject`, so imported/old projects get a safe default.
* `src/engine/exportSvg.ts` — replaced `Math.max(1, state.edgeErosionWidth)` with `Number.isFinite(state.outlineStrokeWidth) ? Math.max(0.25, state.outlineStrokeWidth) : 1.5` in the outline `overlayStyle` for both the parsed-glyph and native-text branches.
* `src/components/Viewport.tsx` — same fix for the React preview's inline style, plus new diagnostics lines.
* `src/components/Controls.tsx` — added an "Outline width" slider (range `0.25–16`, step `0.25`, disabled unless the overlay is `outline`); also restated the erosion controls hint so it explicitly calls out that edge erosion applies to filled overlays (Solid / Warped outline), not regular Outline.
* `src/engine/controlOwnership.ts` — added `outlineActive`, `outlineStrokeWidth`, `overlaySource` ("parsed-font" | "native-fallback" | "none") to `ControlActivity`; updated `affectingOutput` to include "outline controls" when the outline is active.

### Tests

* `tests/overlayMode.test.ts` (new) — 13 tests covering all overlay modes plus the fixed outline behavior.

## Expected behavior of each overlay mode

* **`solid`** — filled glyph paths or native SVG text. `fill` = artwork/background color, `stroke="none"`. Unchanged by this bugfix.
* **`outline`** — same positioned glyph outlines, rendered stroke-only: `fill="none"`, `stroke` = artwork color, `stroke-width` = `outlineStrokeWidth` (default 1.5, user-tunable), no `fill-rule="evenodd"` (regular outline never mixes contours from different glyphs and does not deform path data), no erosion mask, no warped-path reconstruction. Each glyph remains a separate `<path>` element.
* **`knockout`** — fills the overlay with the background color so marks disappear behind text on translucent backgrounds. Unchanged.
* **`hidden`** — no overlay group rendered. Unchanged.
* **`warped-outline`** — separate path: only available with parsed font paths; produces deformed filled vector paths (`fill-rule="evenodd"` for counter preservation) carrying `data-warped-glyph` attributes. Native fallback returns a solid native SVG text overlay with a "solid fallback" warning. Unchanged; explicitly kept separate from regular outline.

## How Outline is separated from Edge Erosion and Warped Outline

* **Edge Erosion** (`src/engine/edgeErosion.ts`) already short-circuits to an empty mark list when `state.overlayMode === "outline"`. The Viewport/export overlay code additionally skips applying the `mask="url(#diffuser-overlay-mask)"` attribute whenever `state.overlayMode === "outline"`, so even if erosion marks exist for some reason the outline stroke is never raster-cut. The Controls hint now reads: "Edge erosion applies to filled overlays (Solid / Warped outline), not regular Outline. Switch composition to Edge-eroded overlay and use Solid overlay to enable erosion."
* **Warped Outline** (`src/engine/outlineWarp.ts`) only activates for `state.overlayMode === "warped-outline"`. The regular `outline` branch never calls `generateWarpedOutline`'s sampling/rebuild — the overlay uses the original `serializeGlyphPaths(textGeometry)` paths, preserving all glyph positions, advances, tracking, and baseline. There is no contour merging, no sampling, and no `data-warped-glyph` attribute on regular outline paths.
* **Project state separation** — `outlineStrokeWidth` is a dedicated scalar divorced from `edgeErosionWidth`. Changing the erosion slider no longer changes the outline stroke width (and vice versa).

## Tests added

`tests/overlayMode.test.ts`:

1. regular outline with parsed font emits stroke-only vector glyph paths with `fill="none"`
2. regular outline emits a visible `stroke` and does not collapse glyph fills
3. regular outline does not emit warped-outline geometry (`data-warped-glyph`)
4. regular outline does not use the edge-erosion mask, even when composition is `edge-eroded`
5. does not merge glyph contours across glyphs into a single path
6. uses the dedicated `outlineStrokeWidth`, not the erosion width, as the stroke width
7. native SVG fallback outline emits stroke-only `<text>` (stroke on the wrapping group, inherited by `<text>`)
8. `solid` overlay remains filled and unstroked
9. `hidden` overlay emits no text overlay group
10. `warped-outline` still works separately and emits `data-warped-glyph` attributes with `fill-rule="evenodd"`
11. Final Artwork export remains vector-only and `DOMParser` validation passes
12. Editable Text export remains native SVG text without warped or outline geometry
13. outline stroke-width uses the project schema default (1.5) when not set

## Risk notes

* Storing `outlineStrokeWidth` adds one scalar to the project schema; imports validate via the existing clamp so `outlineStrokeWidth` defaults to `1.5` for older projects. Schema version remains `4`.
* The Warp cache key (`outlineWarpCacheKey`) is unaffected — warped-outline uses fill, not stroke, so `outlineStrokeWidth` correctly does not invalidate warp geometry.
* The renderer geometry cache key (`rendererRuntime.cacheKey`) is unaffected — overlay stroke width does not change the generated dot/line/polyline artwork, only the text overlay layer.
* Preview and export now match exactly: both compute `outlineStrokeWidth` from the same project state with the same fallback.
* The Viewport diagnostics panel now surfaces outline/warp/erosion status explicitly so the effective overlay behavior is observable without opening DevTools.

## What was intentionally NOT changed

* No WebGPU.
* No reaction-diffusion.
* No persistent simulation.
* No worker cancellation.
* No rasterization of any kind.
* No Final Artwork export semantics changes; Final Artwork remains vector-only.
* No Editable Text export changes; Editable Text remains native SVG text.
* No `warped-outline` path reconstruction; the warp pipeline and native-fallback warning are untouched.
* The glyph path coordinate space, glyph layout, baseline, tracking, and advances are untouched.
* The CSS `.diffuser-text-overlay` rule and inline-style specificity are untouched — the bug was not a CSS-rule/specificity issue.

## Remaining limitations

* The overlay is only rendered for the Glyph Diffuser renderer (via `showTextOverlay`). Other renderers do not display a text overlay; this is pre-existing design and is not changed by this bugfix.
* The native SVG text outline inherits the stroke from the wrapping group (the `stroke` attribute is on the group, not the `<text>` element). This is standard SVG inheritance and renders correctly in browsers; tests assert the inner-group attribute explicitly.
* The `outlineStrokeWidth` control has no separate animation/preset directive beyond the slider; presets that opt into outline mode can still override `outlineStrokeWidth` from `presets.ts` if desired, but no preset currently sets it.
* Glyph outline deformation is still exclusive to `warped-outline`; regular outline does not sample the glyph field or the SDF, by design.