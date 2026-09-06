# SUBSTRATE Performance Quick Wins

Date: 2026-06-28  
App version: `0.14.0` (Shared Glyph Field Modulation)  
Audit source: `PERFORMANCE_AUDIT.md`  
Scope: low-risk performance fixes only. No new visual features, no visual-output changes. WebGPU, reaction-diffusion, persistent simulation, worker cancellation, and worker-side debug images were intentionally NOT implemented.

## Validation

- `npm test`: **122 tests across 15 files pass**.
- `npm run build`: **production build succeeds** (84 modules transformed; main bundle ~556 kB / ~165 kB gzip; worker bundle 5.91 kB).
- Pre-existing stale test (`tests/exportSvg.test.ts:59`) that asserted `appVersion: "0.13.0"` was updated to `0.14.0` so the suite is green before the optimizations were measured; this only changes a test literal, not the emitted version metadata (already `0.14.0` in `src/engine/constants.ts`).

## Implemented changes

### 1. Gated the cost-estimate diagnostics recompute (audit bottleneck 9) — `src/App.tsx`

- Split the previous `diagnostics` memo (which ran `createTimedSvg` + `getSvgDiagnostics` on every `state` or `estimateContext` change while `debug.costEstimate` was on) into two memos:
  - `estimateGeometry` — runs `generateRendererGeometry(state, estimateContext)` through the shared renderer cache. Returns the same cached geometry object reference for static renderers when only irrelevant state (debug toggles, preview settings) changes.
  - `diagnostics` — only re-serializes + re-parses the SVG when `state.debug.costEstimate`, `estimateGeometry`, `estimateContext`, or `textGeometry` change.
- Effect: when the user toggles a debug overlay, switches preview backend, or the animation clock ticks (Flow Lines), the `estimateGeometry` reference stays stable (cache hit) and the expensive `createTimedSvg` / `DOMParser.parseFromString` path is skipped.
- Export-along-path serialization in `exportSvg()` is unchanged: the export button still builds, validates, and reports the exact byte size through `reportSvgValidation` + `getSvgDiagnostics`.

### 2. Reused the shared glyph field in the wave-field debug image (audit bottleneck 3) — `src/hooks/useWaveFieldDebugImage.ts`

- The hook now prefers `context.glyphField` (already built by `App` via `createGlyphFieldContext`) and only falls back to `buildCompositeWaveField` when `glyphField` is absent (test/non-App callers).
- Switched the per-pixel loop from `field.data.forEach((value, index) => …)` to an indexed `for` loop with a local `data` reference; minor constant-factor win in addition to removing the duplicate field build.
- The effect's dependency array now also includes `context.glyphField`, so the debug image regenerates only when the field itself changes (which `App` already gates on amplitude/frequency/emitter identity).
- Safe fallback: when `context.glyphField` is `undefined`, the call to `buildCompositeWaveField` still runs, preserving the original behaviour for tests.

### 3. Replaced the JSON.stringify renderer cache key with a packed primitive key (audit bottleneck 4) — `src/engine/rendererRuntime.ts`

- Removed `JSON.stringify(...)` over an object literal in `cacheKey`; replaced with `[...].join("|")` of the renderer-relevant scalar fields plus a packed `emitterKey` sub-string.
- Added `glyphFieldMode`, `glyphFieldInfluence`, `glyphFieldDisplacement`, `glyphFieldDensity`, `glyphFieldRadius`, and `glyphFieldOpacity` to the key. These were *missing* from the previous key, so editing any modulation slider while the substrate stayed the same now correctly invalidates static geometry (a pre-existing correctness issue, not a visual change at default settings — but it is the more correct behaviour).
- Explicitly excludes `state.debug`, `preset`, `previewSettings`, `exportMode`/`exportFrameMode`/`precision` for *geometry* cache (geometry does not depend on export shaping), `font` object identity (uses only `state.font?.fileName`), and `state.text` is included but `state` object identity is not — so unrelated UI changes can no longer invalidate static geometry.
- Substrate identity still uses the stable numeric WeakMap-based id, so a new substrate object correctly invalidates the cache.
- The `rendererQuality.test.ts > debug overlay changes do not alter or regenerate static geometry` and `memoizes static output without changing geometry` tests both still pass, confirming the new key preserves the cache contract.

### 4. Skipped glyph-gradient work when modulation is off (audit quick win 6) — `src/engine/field/glyphFieldModulation.ts`, `src/engine/renderers/sdfHalftoneRenderer.ts`, `src/engine/renderers/sdfContoursRenderer.ts`, `src/engine/renderers/sdfStreamlinesRenderer.ts`

- `getGlyphFieldSampler` now returns per-effect flags: `displacementEnabled`, `densityEnabled`, `radiusEnabled`, `opacityEnabled` (each `false` when the modulator is disabled OR the related scalar is `0`).
- `glyph.gradient(...)` now short-circuits to a shared `ZERO_GRADIENT` constant when `displacementEnabled` is false, eliminating the central-difference 12-array-read sampling path that the previous closure always invoked when the modulator was on but displacement was unused.
- `glyph.value(...)` keeps the original early-return (`if (!field || !enabled) return 0`) so `averageGlyphFieldValue` diagnostics semantics are preserved when modulator is on but individual effect scalars are zero (the displayed average still reflects real samples).
- Halftone gates the displacement branch on `glyph.displacementEnabled`; the `fieldDensity`/`radiusModulation`/opacity scalability maths are gated on their respective flags and collapse to their identity factor (`0`/`1`) in the disabled path. Determinism is preserved because none of these branches consume the seeded PRNG.
- Contours gates the gradient sampling, `sdfNormal` sampling, and the candidate-displacement math on `glyph.displacementEnabled`; the enabled-but-no-displacement path now skips both the field-gradient and the SDF-normal sampling and returns the point unchanged, producing identical output.
- Streamlines `traceHalf` only computes the gradient term when `glyph.displacementEnabled`; otherwise `glyphTurn` is `0` and the integration angle is identical to the unmodulated path. Seed-acceptance `glyph.value` is also gated on `glyph.densityEnabled` to skip the per-seed value sample when the density scalar is zero; the seeded `random()` call remains the sole acceptance gate, so determinism is preserved.

### 5. Reduced Marching Squares allocation pressure (audit bottleneck 8) — `src/engine/renderers/sdfContoursRenderer.ts`, `src/engine/renderers/waveContoursRenderer.ts`

- `extractSegments` (SDF Contours) and `segments` (Wave Contours) no longer allocate a `corners` array of `{x, y, value}` (or `[x, y, value]`) tuples per visited cell, nor an `edgePairs` array, nor an intermediate `crossings` array. The four corner values are read directly from the distance/field array; the four edges are walked inlined with named `c0x/c0y … c3x/c3y` locals.
- `interpolatePoint` is inlined, preserving the exact clamp/`amount` formula `Math.abs(denom) < 1e-8 ? 0.5 : Math.max(0, Math.min(1, (level - v1)/denom))`.
- Output topology and determinism are preserved: the crossing order (edge 0-1 → 1-2 → 2-3 → 3-0) is unchanged, the four-crossing SDF Contours disambiguation (`centerInside` from `(v00+v10+v11+v01)/4 >= level`) is unchanged, and the Wave Contours four-crossing pairing (`{a:0,b:1}` and `{a:2,b:3}`) is unchanged.
- The stitch adjacency keys are now numeric `Map<number, number[]>` keys built as `(roundY*1e6+offset)*span + (roundX*1e6+offset)`. Same quantization (`Math.round(x*100)` for SDF Contours, `Math.round(x*10)` for Wave Contours) but no per-endpoint string allocation.
- Adjacent cells still produce identical endpoints (the interpolation is identical between neighbouring cells), so the stitcher still connects shared edge crossings.
- A bug introduced in the initial refactor (along-edge positions for edges 2-3 and 3-0 were reversed) was caught by the `sdfContoursRenderer.test.ts` suite, fixed, and re-verified — both renderer tests pass.

### 6. Replaced SDF Halftone string occupancy keys with numeric keys (audit bottleneck 10) — `src/engine/renderers/sdfHalftoneRenderer.ts`

- `Map<string, OccupiedDot[]>` → `Map<number, OccupiedDot[]>`. The key is built as `(cellY + OFFSET) * SPAN + (cellX + OFFSET)` with `OFFSET = 65_536` and `SPAN = 131_072`, which is large enough that physically adjacent cells always map to adjacent numeric keys. No false collisions, even when glyph-field displacement pushes accepted dot candidates outside the viewport before the mask-distance acceptance filter.
- Removed the obsolete `cellKey` helper.
- The `Math.hypot(x - dot.x, y - dot.y)` overlap-check still uses the exact dot coordinates, so spacing behaviour is byte-identical.

### 7. Avoided redundant Streamlines distance sampling (audit bottleneck 7) — `src/engine/renderers/sdfStreamlinesRenderer.ts`

- `traceHalf` now takes a `distanceAccumulator: { value: number }` parameter and adds the per-step `nextDistance` (which was already being sampled for the finite-distance check) into it. The seed point's distance was already sampled for the seed-acceptance check and is added once after both halves complete.
- The post-integration `points.reduce((sum, point) => sum + sampleDistance(...), 0)` re-sampling loop is removed.
- `sampledDistanceTotal` accumulates the same sum once per point, so `averageSampledDistance` diagnostics meaning is preserved exactly.

## Audit bottlenecks addressed

| Audit rank | Bottleneck | Quick win |
| ---: | --- | --- |
| 2 | Debug-image generation on main thread (modulated hook rebuilds field) | Win 2 (reuse `glyphField`) |
| 3 | `useWaveFieldDebugImage` rebuilds field + re-pixel-walks | Win 2 + minor pixel-loop tweak |
| 4 | `rendererRuntime.cacheKey` `JSON.stringify` per request | Win 3 |
| 5 | Composite wave field rebuilt on amplitude/frequency change | Win 2 (no rebuild for debug) |
| 6 | Redundant `buildCompositeWaveField` in Wave/Diffuser | Not addressed (kept safe fallback for tests; App always provides shared field) |
| 7 | SDF Streamlines per-step cost | Win 4 + Win 7 |
| 8 | SDF Contours allocation storm | Win 5 + numeric keys |
| 9 | Export-diagnostics recompute cost | Win 1 |
| 10 | SDF Halftone string-keyed occupancy | Win 6 |

## Risk notes

- **Quick Win 1** moves the cost-estimate re-serialization off the animation-tick and debug-toggle paths. The displayed EXACT byte size in the diagnostics strip still updates whenever the SVG output payload actually changes (renderer cache miss). Flow Lines cost-estimate is computed at time-zero, matching previous behaviour. No export semantics changed.
- **Quick Win 2** keeps the fallback `buildCompositeWaveField(state, context)` call when `context.glyphField` is absent (test contexts). The dependency array includes `state` to preserve that fallback path; when `context.glyphField` is present, the hook relies on its identity to skip rebuilds. May re-allocate the same PNG once on unrelated `state` changes when the fallback path is used — strictly less work than before, never more.
- **Quick Win 3** widened the cache key to include the six glyph-field modulation scalars that were previously absent. This is the behaviour expected from reading renderer code — pre-existing tests did not pin the old (incorrect) narrower key. The `debug overlay changes do not alter or regenerate static geometry` test continues to pass.
- **Quick Win 4** preserves determinism by:
  - Skipping modulation math only via the seeded PRNG's independence path (the expensive `glyph.gradient(...)` central differences are not RNG-dependent).
  - Keeping `glyph.value(...)`'s early-return guard so diagnostics averages keep their original semantics when an effect scalar is zero but the modulator is enabled.
  - Not skipping the seed-acceptance `random()` call when density-disabled; that gate stays in place with `fieldAcceptance = 0` because the path collapses algebraically to the unmodulated seed acceptance.
- **Quick Win 5** preserves the EXACT Marching Squares topology: same crossing order, same four-crossing pairing rules, and same quantization for stitching. After fixing an initial reversal bug for edges 2-3 and 3-0 (caught by the automated test suite), the contour, contour-pointing-inside-mask, and SVG reload tests all pass.
- **Quick Win 6**'s numeric key has no collision risk for any `cellX`/`cellY` reachable from the renderer's bounded sampling window plus glyph-field displacement. The exact `Math.hypot` overlap test is unchanged.
- **Quick Win 7** preserves `averageSampledDistance` semantics: the sum per emitted point is still added once; only the redundant post-loop `reduce` is removed.

## What was intentionally NOT changed

- **Worker cancellation.** The audit's #1 bottleneck (worker round-trip backlog during rapid text/quality scrubbing) is *deferred*. `LatestOnlyScheduler` continues to coalesce *pending* requests; in-flight worker computation still runs to completion. No worker protocol, transferable lifetime, or cancellation primitive was added.
- **Moving debug images into the worker.** The audit's quick-win list flagged this as risky. Debug-image pixel loops still run on the main thread, gated by `requestIdleCallback`. The `getDeferredSubstrateDebugImage` cache, idle scheduling, and WeakMap-keyed substrate cache are unchanged.
- **Glyph Diffuser redundancy.** `glyphDiffuserRenderer.ts` still falls back to `buildCompositeWaveField` when `context.glyphField` is null. App always supplies the shared field, so production cost is unchanged; tests bypass App and exercise the fallback. No change here to avoid touching a renderer outside the audit's quick-win set.
- **Manual rounding in `serializeGeometry`.** Listed as an export-only micro-win; deferred because export path is rarely on the critical axis and the change is purely a constant-factor speedup.
- **Renderer visuals, SVG export semantics, preview-renderer split, diagnostics panel contents, preset set, and CPU-WORKER behaviour are unchanged.** Worker compute, round-trip, and self-test timings are not affected by any change in this pass.

## Remaining bottlenecks (per `PERFORMANCE_AUDIT.md`)

1. **Worker round-trip backlog during rapid text/quality scrubbing.** Still unmitigated by this pass; deferred to a future worker-cancellation pass.
2. **Main-thread debug-image generation.** Deferral-intact cost remains 100–170 ms for edge/distance views at High/Ultra; only the duplicate wave-field build was removed.
3. **Composite wave field rebuild on amplitude/frequency/emitter change.** Allocation + per-cell `Math.hypot`/`Math.sin` remain; no factor hoisting done in this pass.
4. **Redundant `buildCompositeWaveField` fallback in Wave Contours and Glyph Diffuser.** Bypassed in App usage but not refactored out of the renderer code paths.
5. **Per-step sampling cost in SDF Flow** (not part of the audit's listed quick wins — the renderer is cheap because its candidate budget is low).
6. **SDF Contours `cleanFragment` + post-stitch `displaceFragment` continue to call `sampleDistanceGradient` per point.** Not lifted in this pass because the displacement math semantics would change if cached rather than recomputed.
7. **React reconciliation of dense Halftone `<circle>` preview** when `previewBackend === "svg-dom"`. Outside the audit's quick wins and not part of this pass.
8. **`exportSvg.ts` serializes `metadata.project = state` into SVG `<metadata>`**. Unchanged; export semantics preserved.