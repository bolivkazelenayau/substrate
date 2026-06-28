# SUBSTRATE Performance Audit

Audit date: 2026-06-28  
App version: `0.14.0` (Shared Glyph Field Modulation)  
Scope: identify the largest current bottlenecks before any optimization work. No code was changed in this pass.

The report ranks bottlenecks by **likely interaction/throughput impact**, based on existing code paths in `src/` and the timings already recorded in `WORKER_PERFORMANCE_RESULTS.md` and `PROJECT_STATUS.md`. Anything below the top 10 is summarized at the end.

---

## 1. Top 10 bottlenecks

### 1. Worker round-trip backlog during rapid input changes — *scheduling / main-thread coordination*
Evidence: `WORKER_PERFORMANCE_RESULTS.md:76-80` records a Low → Ultra → Medium burst producing **596.2 ms final round trip while final worker compute was only 25.8 ms**, with 570.4 ms attributed to "main / coordination."

Root cause in code:
- `cpuWorkerBackend.ts:294-320` posts a `build` message and resolves only on the worker `result`; there is no cancellation primitive.
- `latestOnlyScheduler.ts` coalesces *pending* requests, but once `start()` has begun the worker still executes the now-obsolete Low build, then Ultra (or Medium), then the newest Medium, in order. `requestId` guards stale commits; they do not abort in-flight work.
- The worker has just one `onmessage` handler (`substrate.worker.ts:16`); each build runs to completion before the next dequeue.

Type: scheduling + main-thread coordination. Not algorithmic.
Cost profile: hit during rapid text/quality scrubbing — the most common interaction.

### 2. Debug-image generation on the main thread — *main-thread / algorithmic*
Evidence: `WORKER_PERFORMANCE_RESULTS.md` tables show **117.8–167.9 ms** for native/text edge images and **101.3 ms** for the Ultra glyph-path distance image. `PROJECT_STATUS.md:805` still lists "Debug-image generation remains synchronous on the main thread."

Root cause in code:
- `debugImage.ts:14-51` allocates a `document.createElement("canvas")`, constructs an `ImageData`, runs a per-pixel Python-style loop over `substrate.width*substrate.height`, and then `canvas.toDataURL("image/png")` (PNG encode) — all on the main thread.
- `getDeferredSubstrateDebugImage` defers via `requestIdleCallback` (or `setTimeout`), but the *task itself* is still blocking when it runs. The cache WeakMap prevents repeats per substrate/mode but does not move the work off-thread.

Type: algorithmic + PNG encode. Lane: idle-time main thread, but visible on rapid debug-mode toggle.
Cost profile: 30–170 ms per substrate/mode pair.

### 3.-waveFieldDebugImage rebuilds the composite field + pixel-walks it *again* — *main-thread / duplicated work*
Evidence: `useWaveFieldDebugImage.ts:11-33` calls `buildCompositeWaveField(state, context)` independently of `App`'s memoized field, then runs its own pixel loop over `field.data`.

Root cause:
- `App.tsx:90` already builds and stashes `glyphField` on `RenderContext` via `createGlyphFieldContext`. `useWaveFieldDebugImage` ignores it and re-runs the full field builder + min/max + another `createImageData` pass on every toggle.
- For Ultra (768×461 ≈ 354k cells), this is both a Float32Array allocation + `Math.hypot`/`Math.sin`/`Math.exp` per cell plus a second per-pixel RGBA loop and PNG encode — a strict superset of debug-image cost in (2).

Type: duplicated algorithmic work + serialization. Lane: main thread, gated by `state.debug.waveField`.

### 4. Renderer cache-key built via `JSON.stringify` on every geometry request — *main-thread / serialization*
Evidence: `rendererRuntime.ts:24-53` returns `JSON.stringify({ renderer, text, …, emitter: state.emitter, … })`. `App.tsx:102-104` calls `generateRendererGeometry(state, renderContext)` inside `useMemo([state, renderContext])`.

Root cause:
- The object passed to `JSON.stringify` includes nested `state.emitter` objects, the substrate key stub, and `waveContourMode`, `diffuserDomain`, etc. Every parameter tweak produces a fresh object, a fresh key string, and a fresh `Map.get` lookup.
- Static renderers (everything except Flow Lines) hit this path on every `App` re-render that recreates `renderContext` (e.g. when `substrateBuild.data` swaps even when substrate content is identical).
- This is fixed work per render and runs *before* the actual cache decision, so even cache hits pay the JSON cost.

Type: serialization. Lane: main thread.
Cost profile: small per call (microseconds to low ms for large emitter config), but runs on every state/animation-frame re-render in some flows.

### 5. Composite wave field rebuilt whenever amplitude/frequency/emitter change — *main-thread / algorithmic*
Evidence: `App.tsx:90-91` deps `useMemo` include `state.amplitude`, `state.frequency`, `state.emitter`. `compositeWaveField.ts:67-81` allocates a `new Float32Array(substrate.width * substrate.height)` and per cell calls `getEmitterContributionAtPoint` → `Math.hypot`, `getFalloffWeight`, `Math.sin`.

Root cause:
- `getEmitterContributionAtPoint` (`compositeWaveField.ts:36-54`) is called once per occupied substrate pixel and recomputes `state.amplitude/22`, `state.frequency/18`, `Math.sin(distance * frequency * rendererFrequency + phase)` per pixel with no precomputed factor hoisting.
- Deps include the whole `state.emitter` object identity, so any nested emitter tweak (e.g. changing the source glyph selector) invalidates the memo even when amplitude/frequency/anchor are unchanged.

Type: algorithmic. Lane: main thread.
Cost profile: scales with substrate resolution; the WORKER_PERFORMANCE_RESULTS substrate field is identical in size to the SDF, so single-digit ms at Medium, tens of ms at Ultra.

### 6. Redundant `buildCompositeWaveField` calls inside Wave Contours and Glyph Diffuser — *main-thread / duplicated work*
Evidence:
- `waveContoursRenderer.ts:88` — `const field = context.glyphField ?? buildCompositeWaveField(state, context);`
- `glyphDiffuserRenderer.ts:42` — same pattern.
- `glyphFieldModulation.ts:5` — `getGlyphFieldSampler` *also* calls `buildCompositeWaveField` as a fallback when `context.glyphField` is null.

Root cause: when `App` constructs the `RenderContext` it always supplies `glyphField`, but any consumer that bypasses `App` (export, tests, the `exportContext` path that swaps `timeMs`/`frame` but spreads `...staticRenderContext` which already includes the field) creates a context whose `glyphField` may have been built for a different state snapshot than the renderer is called with, or `null` in test paths. Result: the same field is built once in `App` and the renderer may build another. Each call is O(substrate). The fallback is "safe," not free.

Type: duplicated algorithmic work. Lane: main thread.

### 7. SDF Streamlines per-step sampling cost — *main-thread / algorithmic*
Evidence: `sdfStreamlinesRenderer.ts:46-104` per integration step calculates:
- `sampleDistanceGradient` (4 `sampleDistance` calls × 4 reads each = 16 array reads + `Math.hypot`)
- `glyph.value` (4 array reads)
- `glyph.gradient` (4 × `sampleGlyphField` × 4 reads = 16 array reads + `Math.hypot`)
- `sampleMask`, `sampleDistance`, `isOccupiedNearby` (9 reads)

Root cause:
- Up to `Math.min(48, …)` steps per half × 2 halves × `requestedStreamlines = density × 0.75` candidates. At density 80 that's ~60 streamlines × 96 steps × ~50+ array reads each, on every static render after a cache miss.
- `points.reduce((sum, point) => sum + sampleDistance(substrate, point.x, point.y), 0)` at line 209 samples distance again for every emitted point *after* integration already sampled it.
- `glyph.gradient` and `sampleDistanceGradient` each repeat the central-difference pattern with no shared work.

Type: algorithmic. Lane: main thread (static renderer).

### 8. SDF Contours allocation storm + double gradient sampling — *main-thread / algorithmic / GC*
Evidence:
- `sdfContoursRenderer.ts:31-65` `extractSegments` builds a `corners` array of 4 objects and a `crossings` array per visited cell. For Ultra (768 × 461 ≈ 353k cells) × level count (up to 14) this is ~5 million short-lived objects.
- `displaceFragment` (line 138-151) calls `sampleDistanceGradient` per point. The `generateGeometry` map at line 214 *then* calls `sampleDistanceGradient` *again* as `sdfNormal` (line 220) plus `glyph.gradient` + `sampleMask`.
- `pointKey`/`adjacency` use string keys (`Math.round(point.x*100)+","+Math.round(point.y*100)`), one `Map.set` per segment endpoint.

Type: algorithmic + GC pressure. Lane: main thread.
Wave Contours `segments`/`stitch` (`waveContoursRenderer.ts:16-57`) repeats the exact same pattern, so any future field-based contour work hits the same cost.

### 9. Export diagnostics re-serialize the entire SVG on every parameter tweak — *main-thread / serialization + parsing*
Evidence: `App.tsx:126-131` — when `state.debug.costEstimate` is on, `useMemo` re-runs `createTimedSvg(state, estimateContext, textGeometry, estimateGeometry)` + `getSvgDiagnostics(svg, …)` whenever `state`, `estimateContext`, or `textGeometry` change.

Root cause:
- `createTimedSvg` (`exportSvg.ts:42-83`) builds the full standalone SVG string, including `JSON.stringify(metadata)` with the entire `ProjectState` embedded, then escapes it.
- `getSvgDiagnostics` (`svgValidation.ts:45-65`) runs `new DOMParser().parseFromString(svg, "image/svg+xml")`, `querySelectorAll("*")`, and iterates `artwork.children` to count polylines/path points.
- For Flow Lines (animated) this fires on every clock tick since `estimateContext`'s `timeMs`/`frame` swap forces a recompute.

Type: serialization + DOM parsing. Lane: main thread.
Cost profile: grows with element count. `PROJECT_STATUS.md:725` records 6.1 ms serialization for the 77.5 KB diagnostic case at Ultra; large halftone outputs will be materially higher.

### 10. SDF Halftone string-keyed occupancy + per-candidate 5-sample cost — *main-thread / algorithmic*
Evidence: `sdfHalftoneRenderer.ts:33-35` `cellKey` uses `` `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}` `` and stores `OccupiedDot[]` arrays in a Map keyed by string. Each candidate samples `sampleMask`, `sampleDistance`, (sometimes twice for fallback), `glyph.value`, `glyph.gradient`, `sampleEdge`, `sampleDistanceGradient` (16 reads), plus `sampleMask`/`sampleDistance` again on displacement.

Root cause:
- The per-candidate path is ~30+ array reads *before* overlap testing.
- The 3×3 neighbor loop allocates a `${cellX+ox},${cellY+oy}` string per neighbor per accepted candidate and does a `nearby.some(...)` with `Math.hypot` — string-key Map is GC-heavy at high density.

Type: algorithmic + GC. Lane: main thread (static renderer).

---

## 2. Evidence summary by area

### Substrate build
- `rasterizeGlyphs.ts:61-66` reads back the entire image (`getImageData`) and allocates a `Float32Array(width*height)` then loops again. Cost lives in worker (`substrate.worker.ts:60-89`); the `WORKER_PERFORMANCE_RESULTS.md` matrix shows rasterize as 2.8–51.1 ms and never the dominant phase.
- `edgeMap.ts:6-24` does an 8-neighbor scan per pixel; measured 7.1–45.1 ms. Pure JS nested loops, easy to vectorize later but adequate.
- `distanceField.ts:20-43` two-pass chamfer; measured 9.1–22.2 ms except Ultra glyph paths (19.7 ms). Not a current bottleneck; exact EDT is not justified by current sampling needs.
- `buildSubstrate.ts:71-80` runs an extra full pass over `raster.mask.data` for diagnostics (coverage/edge/minDistance/maxDistance). One extra O(N) pass per build; small constant.
- Worker round-trip is the dominant cost — see bottlenecks 1 and the 596 ms observation.

### Static renderer generation
- `sdfHalftoneRenderer.ts` — bottleneck 10.
- `sdfContoursRenderer.ts` — bottleneck 8; `extractSegments` allocation-dominated.
- `sdfStreamlinesRenderer.ts` — bottleneck 7; ~50 array reads per integration step.
- `waveContoursRenderer.ts` — shares the same segment/stitch pattern as SDF Contours plus calls `buildCompositeWaveField` redundantly (bottleneck 6). `contourExtractionTimeMs` is reported in diagnostics.
- `glyphDiffuserRenderer.ts` — also redundantly rebuilds the field (bottleneck 6). Otherwise cheap (no SDF gradient work).
- Modulated Sonic presets — these are configurations; their cost equals whichever renderer they activate.

### Glyph field modulation
- Composite field build (`compositeWaveField.ts:67-81`): one allocation + one `Math.hypot`/`Math.sin` per occupied cell. See bottleneck 5.
- `sampleGlyphField` (`compositeWaveField.ts:96-109`) is bilinear — 4 reads per call.
- `sampleGlyphFieldGradient` (`compositeWaveField.ts:113-121`) calls `sampleGlyphField` 4 times = 16 reads per gradient. Renderers call this in addition to `sampleDistanceGradient` (another 16 reads) per step, doubling gradient cost.
- `createGlyphFieldContext` (`compositeWaveField.ts:123-153`) wraps the samplers in closures that update diagnostics counters on every gradient call — cheap but two extra property writes per step.
- Cache keys: the renderer cache does *not* key on `glyphField` directly, only on the substrate object identity + emitter config, so a redundant field build can still produce a cache *hit* on the geometry side. The cost is the field build itself, not the cache decision.

### Preview / render cost
- `Viewport.tsx:97` — static (non-Flow) renderers render `geometry.geometries.map((item, index) => <GeometryElement key={index} … />)`; dense Halftone can produce thousands of `<circle>` elements that React fully reconciles. Only `FlowPreview` uses the refs + `setAttribute` escape hatch (`FlowPreview.tsx`).
- `Viewport.tsx:32` recomputes `summarizeGeometry(geometry)` on every render. Already `useMemo`'d, but depends on `geometry` identity, which changes every committed frame for Flow Lines.
- `Viewport.tsx:155-272` renders ~50 `<span>` diagnostic chips with `.toFixed` calls per commit.
- `Viewport.tsx:106-107` may mount *both* the substrate debug raster and `waveFieldDebugUrl` — two `<image>` elements; the data URLs themselves are the cost (bottleneck 2 and 3).
- `App.tsx:102-109` generates `geometry` and `exportGeometry` separately; `exportFrameMode === "current"` avoids it, otherwise it runs `generateRendererGeometry` twice.
- React: the full `state` object is passed as `geometry`'s `useMemo` dep. Any single field change (e.g. `seed`) invalidates the memo even when the renderer only reads a subset.

### Export
- `exportSvg.ts:9-26` `serializeGeometry` uses `Number(value.toFixed(precision))` per coordinate — `toFixed` is slower than manual rounding, and called per point on export.
- `exportSvg.ts:82` embeds `JSON.stringify(metadata)` where `metadata.project = state` — full project state serialized into the SVG `<metadata>`. On large halftone exports this is a non-trivial fraction of serial time.
- `svgValidation.ts:19-65` `validateSvgReload` constructs `new DOMParser().parseFromString` + `querySelectorAll("*")`; `getSvgDiagnostics` is called on every export and (via bottleneck 9) on every cost-estimate recompute.
- Exact byte-size measurement (`getExactSvgByteSize` → `new TextEncoder().encode(svg).byteLength`) allocates and encodes the full string; the result is already in memory from `createTimedSvg`.
- Large vector output: `App.tsx:153-173` builds the SVG once for validation, downloads once, computes exact diagnostics once — single export path is fine; repeated export is dominated by serialization + DOMParser.

---

## 3. Quick wins (low risk, no visual change)

1. **Gate the `costEstimate` diagnostics recompute.** Rebuild the SVG estimate only when the user toggles `costEstimate` on, opens export, or during `requestIdleCallback`; not on every `state` change. Eliminates bottleneck 9 in the animation path entirely.
2. **Replace `JSON.stringify` cache key with a packed concatenated string** of primitive fields plus stable substrate field id; drop `state.emitter` object from the key and only include the scalar fields actually read by the renderer. Eliminates bottleneck 4.
3. **Reuse `RenderContext.glyphField` in `useWaveFieldDebugImage`** instead of rebuilding it. Halves the cost of bottleneck 3.
4. **Hoist the `corners`/`edgePairs` allocations out of `extractSegments`/`segments`** inner loops; index the distance array directly with `i + y*width` instead of allocating `{x, y, value}` objects per corner. Targets bottleneck 8.
5. **Replace `sample.value` + `reduce` redundant `sampleDistance` pass in `sdfStreamlinesRenderer.ts:209`** with running accumulator during `traceHalf`. Targets bottleneck 7.
6. **Skip glyph-gradient sampling in `glyphFieldModulation.ts` when `state.glyphFieldMode === "off"` or `glyphFieldDisplacement === 0`.** Saves 16 array reads per step in all three modulated renderers.
7. **Replace string-keyed occupancy Maps** (`sdfHalftoneRenderer.ts:33-35`) with numeric `cellY * gridWidth + cellX` keys stored in a flat array or `Map<number, …>`. Targets bottleneck 10 GC cost.
8. **Memoize `extractSegments` per `(substrate, level)`** in SDF Contours; the same substrate is extracted for many levels and the pre-stitch segment array is reusable.
9. **Manual rounding in `serializeGeometry`** instead of `Number(value.toFixed(precision))`. Small export speedup.

### Risky optimizations to avoid for now
- Worker cancellation / cooperative interrupt: requires protocol + worker cooperation; risk of half-built typed arrays transferring. Defer until rapid scrubbing is profiled after the quick wins.
- Moving debug-image generation into the worker: would need `OffscreenCanvas` + `transferToImageBitmap` and changed cache keys; debug views are not in the export path, so the labor is not yet justified.
- Exact Euclidean distance transform replacing chamfer: changes downstream sampling; visible deltas not profiled.
- Outline/exterior deformation: out of scope per project direction.
- React virtualization of dense `<circle>` preview: high effort, only worth after measuring DOM commit time in DevTools.

---

## 4. Recommended implementation order

1. Gate `costEstimate` diagnostics recompute (quick win 1) — biggest animation-path win, zero visuals.
2. Stop rebuilding the wave-field debug image (quick win 3) — duplicated work, easy to wire through `context.glyphField`.
3. Packed cache key (quick win 2).
4. Skip glyph gradient work when disabled (quick win 6).
5. Hoist `corners` allocations in Marching Squares (quick win 4/8) — affects both contour renderers.
6. Halftone numeric occupancy + streamline accumulator (quick wins 5/7).
7. Manual rounding in `serializeGeometry` (quick win 9).
8. After the above: re-profile in Chrome, then decide whether worker cancellation or worker-side debug images are still worth it.

---

## 5. What to measure manually in Chrome DevTools

- **Performance → Record** a Low → Ultra → Medium substrate quality scrub. Confirm bottleneck 1: long tasks crossing into the worker, `roundTripMs` ≫ `workerComputeMs` in the BACKEND diagnostics strip.
- **Performance → Record** toggling `composite wave field` debug with Halftone Press preset at High. Capture the `useWaveFieldDebugImage` + `getDeferredSubstrateDebugImage` tasks; expect 100–170 ms idle-callback work.
- **Performance → Record** rendering the Halftone Press preset with `costEstimate` on. Find `createTimedSvg` + `getSvgDiagnostics` tasks; expected to be the dominant main-thread cost during parameter drag.
- **Memory → Heap snapshot** before/after 10 rapid text edits. Look for retained `Float32Array` of size 768×461×4 across retained substrates (WeakMap + scheduler state should release them).
- **React DevTools Profiler**:
  - Confirm `App` commit cost vs `Viewport` commit cost; check whether `state`-only changes (e.g. toggling `debug.baseline`) cause the static renderer memo to invalidate (today they do, because `state` itself is a dep).
  - Profile dense Halftone: estimated `<circle>` count vs React commit time per node.
- **Console timing**: wrap `rendererRuntime.cacheKey` in `performance.mark/measure` during a Halftone drag to confirm whether the JSON.stringify path is materially above noise.
- **Main thread blocking**: `performance.measureUserAgentSpecificMemory?.()` after rapid scrubbing to verify substrate buffers are reclaimed.
- **Worker channel**: observe the BACKEND diagnostics strip `COORD` vs `WORKER` columns during a moderate-density Halftone render at High to separate renderer cost (main) from substrate cost (worker).
- **Export**: Record a high-mark-count export in Performance; identify `serializeGeometry` and `DOMParser.parseFromString` slices, compare against the exact-byte-size diagnostics in the message bar.