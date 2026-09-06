# SUBSTRATE Animation and Interaction Performance

App version: `0.11.0`  
Date: 2026-06-28

## Canvas preview follow-up

A standalone Chrome production preview exposed the limit of the refs-based SVG path: 1,564 animated `<line>` elements (3,128 endpoints) took about 149 ms per frame, for roughly 6–7 effective FPS. The diagnostic also showed a negative FPS value.

Dense animated Flow Lines now default to a preview-only Canvas 2D backend. Its local requestAnimationFrame loop regenerates the same seeded geometry and draws it on one canvas without mutating the SVG DOM. React receives current-frame export context and timing diagnostics only about every 300 ms. Parsed glyph outlines use `Path2D` clipping; native text fallback uses destination-in canvas text compositing.

The SVG DOM preview remains selectable for debugging/comparison and becomes the automatic fallback if Canvas 2D is unavailable. The existing SVG serializer is unchanged: Final Artwork remains vector SVG, Editable Text remains native SVG text, and exports contain no canvas or raster image.

Animation timing now ignores non-finite, negative, and zero deltas, bounds long elapsed intervals, and calculates FPS only as `1000 / averageFrameMs`. Diagnostics report `unstable` or `invalid` only for corresponding timing samples and can never report negative FPS.

New preview diagnostics include backend (`canvas-2d` or `svg-dom`), canvas draw time, active SVG DOM mark count, clipping state, and SVG fallback state. The 24/30/60 FPS caps, reduced-motion/static stop, hidden-tab pause, and export pause all apply to the canvas loop.

The available after-change result is a user-observed range rather than a controlled median profile. Native canvas text clipping follows browser font metrics and cannot reproduce custom letter spacing exactly; loaded glyph outlines provide the precise clipping path.

## Standalone Chrome stabilization observation

User-observed production results show dense SVG DOM Flow Lines at about 5 FPS. Canvas 2D is substantially better, fluctuating around 25–40 FPS when the experimental 60 FPS cap is selected, while canvas drawing itself costs only about 1–1.5 ms. This indicates that draw calls are not the dominant constraint; browser scheduling, presentation cadence, and surrounding main-thread work account for most of the interval variance.

Dense Flow Lines therefore retain 30 FPS as the default cap for steadier pacing. The 60 FPS option remains available but is labeled experimental/high-load. Auto mode continues to select Canvas 2D for dense animated Flow Lines, while dense SVG DOM mode is labeled debug/slow. Diagnostics show the selected cap, positive reciprocal average FPS, average draw interval, canvas draw time, and stable/unstable pacing status.

## Scope

This pass improves preview responsiveness without changing export geometry or adding visual systems. No WebGPU, reaction-diffusion, renderer, or raster export was added.

## Before

The previous preview path had several independent costs:

- The animation clock committed at approximately 90 ms intervals, limiting Flow Lines to roughly 11 updates per second.
- Every Flow Lines tick generated a new geometry group and sent more than 1,500 new `<line>` property sets through React reconciliation.
- The animation context lived in `App`, so each tick also rerendered controls and recomputed unrelated diagnostics.
- Substrate requests were protected from stale commits but every intermediate request was still sent to the worker.
- Mask, edge, and distance debug PNGs were generated synchronously during render on the main thread.

Prior profiling showed Flow Lines geometry generation itself at roughly 0.9 ms for 1,564 marks. That made renderer math a minor cost compared with the intentionally slow clock, React/SVG updates, debug-image work, and queued substrate requests.

The previous rapid Low → Ultra → Medium profile reached:

| Metric | Before |
| --- | ---: |
| Final round trip | 596.2 ms |
| Final worker compute | 25.8 ms |
| Main / coordination | 570.4 ms |
| Intermediate requests | All serialized |

## Implemented changes

### Latest-only substrate scheduler

The scheduler allows one active build and at most one pending build:

1. The active request is allowed to finish because browser workers cannot safely interrupt the synchronous substrate builder mid-call.
2. New input replaces any older pending input.
3. A stale active result never commits.
4. After the active build finishes, only the newest pending request starts.

Low → Ultra → Medium therefore runs at most the active Low build and latest Medium build; the pending Ultra build is dropped before worker execution when the changes arrive during the active request.

Diagnostics now show active/latest IDs, pending count, coalesced count, dropped count, whether an obsolete result was skipped, active backend, and worker/main/round-trip timings.

### Deferred debug images

Option C was chosen: keep the existing main-thread renderer, but defer and cache it aggressively.

- Raster debug generation starts through `requestIdleCallback` with a 250 ms timeout.
- Browsers without idle callbacks use a deferred zero-delay task.
- Substrate commit never waits for a debug image.
- The cache is keyed by substrate object and debug mode.
- Duplicate in-flight requests share one promise.
- Animation ticks and unrelated controls do not regenerate images.
- Normal SVG export remains vector-only and never consumes this cache.

This is lower risk than moving Canvas encoding into the substrate worker during the same animation refactor. Debug encoding is still main-thread work once the deferred task runs.

### Animation clock

- Preview FPS is selectable at 24, 30, or 60; default is 30.
- The clock uses elapsed time between committed frames, fixing the prior under-counted animation time.
- Animation pauses when the tab is hidden by default.
- Static preview respects `prefers-reduced-motion` and has an explicit toggle.
- Export pauses the clock before serialization.
- Static renderers do not start the animation clock.

Flow Lines remains the only renderer declaring `usesTime: true`.

### Flow Lines preview

Flow Lines retains identical deterministic geometry and vector export semantics.

- Seeded base values are cached by seed and mark count.
- Per-frame work only recalculates the wave angle and endpoints.
- The preview creates its SVG `<line>` nodes only when mark count changes.
- Animation frames update the existing nodes through refs instead of replacing/reconciling the complete child tree.
- Final/current-frame SVG export still serializes the shared `LineSegment` geometry normally.

### Render isolation

- `Controls` is memoized and does not rerender on clock-only updates.
- Static renderers receive no clock ticks, so their viewport and diagnostics remain stable.
- Export estimates use a deterministic time-zero context instead of being serialized on every Flow Lines frame.
- Substrate input remains independent of animation time/frame.

## Preview diagnostics

The viewport now reports:

- Estimated FPS
- Averaged frame time
- Renderer generation time
- SVG element and point count
- Geometry regeneration this frame
- Substrate rebuild this frame
- Debug-image regeneration this frame
- Clock state

These diagnostics are preview-only.

## Bottleneck conclusion

The renderer math was not the primary bottleneck. The main problems were:

1. Deliberately low clock cadence.
2. React reconciliation and SVG attribute updates across 1,000+ line nodes.
3. Synchronous debug-image creation.
4. Obsolete substrate builds occupying the worker queue.
5. App-wide rerenders from clock state.

The new architecture directly addresses all five. The remaining unavoidable Flow Lines cost is updating every visible line endpoint each committed frame; the renderer intentionally animates every mark.

## Validation status

Validation confirms:

- Production TypeScript compilation succeeds.
- Production Vite bundling succeeds.
- All 85 tests pass across 11 test files.
- The latest-only scheduler unit contract runs only active + newest pending requests.
- Static renderer cache keys ignore time.
- Flow Lines remains the only time-aware renderer.
- Debug-image cache identity is stable across animation-only reads.

The browser surface declined local-app navigation during this pass, so a controlled after-change FPS measurement remains pending. The prior standalone Chrome confirmation remains `CPU-WORKER / READY / SUPPORT SUPPORTED / FALLBACK NO`.

## Recommended next step

Run a short standalone Chrome profile at 24/30/60 FPS and record median frame time plus DevTools scripting/rendering/painting shares. If endpoint mutation still misses 30 FPS, the next optimization should be a preview-only Canvas or WebGL presentation layer backed by the same vector geometry—not a new renderer and not a change to SVG export.
