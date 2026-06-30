# Gate 7.8A — Edge Current FPS measurement

Measured 2026-06-30 on the Codex in-app Chromium surface on Windows, development
server, DevTools closed, DPR 1, canvas zoom 100%, default **Edge Current** preset,
SVG DOM backend, native-text glyph mask active. Each row is a five-second live
pipeline sample after a 700 ms warm-up. Browser chrome dimensions made the
`outerWidth / innerWidth` zoom estimate report 150%; the application's explicit
canvas zoom control was 100%, so the former is not treated as page zoom.

## Live SVG DOM results

| Target | Budget | Observed FPS | Median interval | Mean interval | p95 interval | Late frames | Frames | Geometry | Path grouping | DOM writes | JS state update | Changed buckets |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 | 41.67 ms | 19.4 | 49.8 ms | 51.5 ms | 67.0 ms | 8 | 97 | 0.47 ms | 2.50 ms | 1.05 ms | 0.073 ms | 10.0 |
| 30 | 33.33 ms | 19.7 | 48.8 ms | 50.9 ms | 76.8 ms | 38 | 99 | 0.43 ms | 2.51 ms | 0.96 ms | 0.084 ms | 10.0 |
| 60 | 16.67 ms | 20.0 | 48.2 ms | 50.0 ms | 77.7 ms | 99 | 100 | 0.39 ms | 2.44 ms | 0.91 ms | 0.096 ms | 10.0 |

Per frame: 1,564 segment inputs, 24 stable path nodes, 10 active/changed path
buckets, approximately 37,708 generated `d` characters, and 10 actual attribute
writes after diffing (48 is the theoretical maximum). The glyph substrate mask
is active on `#generated-artwork`; no `clip-path` is used.

Development React Strict Mode recorded 194/198/200 App render invocations and
the same number of geometry calculations for 97/99/100 committed preview frames:
**two App renders and two geometry calls per visible frame**. Only one result is
committed, but the duplicated render-phase work is real development overhead.
Production must be profiled separately before treating the absolute 20 FPS as a
shipping number.

The directly timed work averages only 3.8–4.1 ms/frame. The remaining
approximately 46–48 ms cannot be split precisely without a Chrome Performance
trace; it includes React tree reconciliation/commit, SVG style/paint, masked
repaint and compositor presentation. It is therefore an estimate, not a claimed
paint-only time.

## Mode comparisons

| Mode | Observation |
| --- | --- |
| Grouped SVG DOM, mask active | Controlled table above; ~20 FPS on this dev surface at every cap. |
| Static/animation disabled | No animation commits, geometry rebuilds, path writes, or animated repaint by design. |
| Canvas 2D preview-only, target 60 | In-app diagnostic stabilized around 17.7 FPS in this constrained dev surface; prior standalone Chrome observations were 25–40 FPS with 1–1.5 ms draw time. Canvas remains explicit preview-only and is not connected to export. |
| 8/12/24/48 buckets | Deterministic cost model ranks 8, 12, 24, 48 by maximum writes (16/24/48/96). Live visual/FPS variants were not run because bucket count is compile-time and changing it would alter normal preview quality. |
| Mask disabled | Not run: there is no existing safe runtime mask bypass. A Chrome trace or dev-only toggle is needed to isolate masked paint without changing export. |
| Zoomed-in | Not run in the controlled matrix; application canvas zoom was held at 100% to avoid mixing compositor scale with scheduler results. |

## Bottleneck and scheduler finding

The primary architectural bottleneck is the SVG clock driving React state every
frame. `useAnimationClock` calls both `setContext` and `setDiagnostics`; that
re-renders App/Viewport, regenerates time-dependent geometry, rebuilds path
strings, mutates SVG paths, and invalidates a large masked SVG paint. In
development Strict Mode the render-phase work is doubled. Path generation and
DOM writes are measurable but secondary; geometry generation is small.

The cap logic is also defective as a frame pacer. It uses rAF plus:

```ts
if (elapsed >= minimumFrameTime) {
  lastCommit = now;
}
```

This is trailing-edge throttling with no remainder carry. It is not `setTimeout`
and does not use modulo. On a 60 Hz display, 24 FPS cannot land evenly on vsync;
discarding the remainder commonly quantizes it to three vsyncs (~50 ms, 20 FPS).
At 30 FPS, timestamp jitter or work crossing the exact two-vsync boundary can
also push a commit to the third vsync. At target 60 there is no deliberate skip,
so a faster machine can commit at every available work-complete vsync, explaining
the reported ~39–40 FPS at target 60 versus ~22 FPS at target 30. In this slower
development surface, the full React + masked SVG pipeline itself takes about
50 ms, so all caps converge near 20 FPS.

The existing Canvas loop uses `consumeFrameBudget`, carries accumulator
remainder, draws imperatively, and reports React diagnostics only every 300 ms.
That architectural difference supports the hypothesis; it does not justify an
automatic Canvas fallback.

## Ranked next gate

1. **Gate 7.8B: fix SVG scheduler pacing and decouple per-frame diagnostics.**
   Use an accumulator/remainder-carry rAF throttle (or equivalent deadline
   advance), and avoid a second diagnostics state commit every frame. Risk:
   changed phase progression/catch-up semantics; cap with one visual update per
   rAF and test pause/resume/hidden-tab behavior.
2. **Move the SVG animation tick off the App-wide React render path.**
   Keep vector SVG nodes and export unchanged; update a preview-local imperative
   clock/geometry path. Risk: duplicated state ownership and harder React
   lifecycle cleanup.
3. **Add a dev-only mask A/B trace toggle, then reduce mask invalidation scope.**
   Risk: grouping/mask changes can alter clipping or vector compatibility; prove
   visual parity before shipping.
4. **Offer 8/12/24 preview bucket quality choices.** Export remains full quality.
   Risk: visible opacity banding at low counts and additional UI complexity.
5. **Keep explicit Canvas preview-only as an opt-in high-FPS reference.** Never
   silently select it for normal vector presets and never connect it to SVG
   export. Risk: preview/export appearance can diverge.
6. **Investigate CSS `stroke-dashoffset` only if a mathematically equivalent
   static path representation exists.** Risk: current endpoint motion is not
   generally equivalent, so this may be inapplicable.

No performance fix, renderer algorithm, export geometry, worker architecture,
raster branch, or WebGPU requirement was introduced in Gate 7.8A.

## Gate 7.8B — scheduler and diagnostics decoupling

Implemented 2026-06-30 without changing renderer geometry or export behavior.
The SVG animation clock now accumulates rAF delta, subtracts one target interval
per visual commit, and carries the fractional remainder. It commits at most once
per rAF. Invalid deltas reset the budget; deltas above 250 ms are clamped and
their backlog is discarded after one update, preventing resume/hidden-tab
catch-up spirals.

Animation timing statistics continue to update in refs on every visual frame,
but React diagnostics state publishes at most once per 300 ms (plus immediate
visibility changes and reset). Visual `RenderContext` updates still occur at the
selected animation cap.

### Browser comparison

Same environment and five-second live-pipeline sampling method as Gate 7.8A:
Codex in-app Chromium on Windows, development server, DevTools closed, DPR 1,
application canvas zoom 100%, Edge Current, SVG DOM, glyph mask active.

| Target | 7.8A FPS | 7.8B FPS | 7.8B median | 7.8B mean | 7.8B p95 | 7.8B late |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 24 | 19.4 | 20.1 | 48.7 ms | 49.8 ms | 69.9 ms | 8 |
| 30 | 19.7 | 20.1 | 48.5 ms | 49.7 ms | 58.4 ms | 26 |
| 60 | 20.0 | 20.0 | 48.3 ms | 50.1 ms | 71.3 ms | 99 |

The result is honest but modest: scheduler correctness improved, and 30 FPS p95
and late-frame count improved, but throughput remains approximately 20 FPS.
Direct work fell slightly to approximately 3.7–3.9 ms/frame. Development Strict
Mode still records two App renders and two geometry calculations per committed
frame because the visual context remains App-owned. React batches the old
per-frame context and diagnostics setters, so throttling diagnostics removes
unnecessary diagnostics computation/publication but cannot remove the App
render already required by `setContext`.

No browser console warnings or errors were observed during the controlled run.
The next performance gate should therefore be either:

1. a small preview-local/imperative SVG animation clock that does not update the
   whole App tree per frame; or
2. a dev-only mask/paint A/B trace to quantify the remaining masked SVG repaint
   before changing ownership.

Gate 7.8B focused validation: 4 test files / 44 tests passed. Tests cover
24/30/60 pacing on 60 Hz rAF, remainder carry, at-most-one commit per rAF,
pause/long-gap backlog reset, diagnostics throttling, live diagnostics capture,
grouped paths, deterministic vector export, and explicit-only Canvas selection.
`rtk npm run lint` (`tsc --noEmit`) passed. The full suite was not rerun because
the worktree contains extensive concurrent/uncommitted changes.

### Production-build control measurement

The previously blocking TypeScript errors were repaired without changing
renderer behavior: navigation blur/keyboard listener types, WebGPU diagnostic
union narrowing and table typings, 2D workgroup typing, and test mock types.
`rtk npm run build` now passes and emits the minified production bundle.

The production bundle was served through `vite preview` with DevTools closed.
At the default 30 FPS cap, its visible animation diagnostic remained
approximately **20–21 FPS** (19.9–20.9 observed while sampling). Removing
development Strict Mode therefore did **not** remove the approximately 50 ms
floor. This rules out Strict Mode duplication as the primary shipping
bottleneck; App-owned context updates plus the large masked SVG repaint/
compositor path remain the leading explanation.

The dev-only detailed meter is intentionally absent from production, so the
production run does not claim median/p95 measurements. A restricted browser
surface also prevented attaching an external `MutationObserver`; the visible
production diagnostic is reported honestly rather than fabricated.

Production build result: **passed**, 100 modules transformed, 18.89 s; main JS
615.58 kB / 181.59 kB gzip. Rollup emitted only its advisory >500 kB chunk
warning. Focused blocker validation executed 60 passing tests across three
started files, but the command exited nonzero because three additional Vitest
fork workers timed out during startup.

## Gate 7.8C — SVG paint / mask A-B trace

Measured 2026-06-30 on the Codex in-app Chromium development surface, Windows,
DevTools closed, DPR 1, Edge Current default preset, target 60 FPS, SVG DOM
backend, application zoom 100%. Each variant used a 700 ms warm-up and five
seconds of live capture.

All variants are dev-only. The shipping/default configuration remains normal
masked SVG with 24 buckets. Final Artwork export, renderer geometry, typography,
Canvas/WebGPU boundaries, and project state are unchanged.

| Variant | FPS | Median | Mean | p95 | Late | Geometry | Grouping | DOM write | `d` chars | Changed buckets | App renders | Rebuilds | Mask | K |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Normal | 20.3 | 48.4 ms | 49.2 ms | 59.9 ms | 101 | 0.38 ms | 2.49 ms | 0.93 ms | 37,708 | 10.0 | 204 | 204 | yes | 24 |
| Mask disabled | 21.1 | 46.0 ms | 47.4 ms | 60.0 ms | 105 | 0.37 ms | 2.41 ms | 0.91 ms | 37,709 | 10.0 | 212 | 212 | no | 24 |
| Static masked content | 26.6 | 37.3 ms | 37.7 ms | 41.3 ms | 133 | 0.45 ms | 2.36 ms | 0.00 ms | 37,708 | 0.0 | 268 | 268 | yes | 24 |
| Local imperative clock | 20.6 | 47.1 ms | 48.6 ms | 71.0 ms | 102 | 0.55 ms | 2.49 ms | 1.07 ms | 37,708 | 10.0 | 0 | 103 | yes | 24 |
| Normal, 12 buckets | 21.4 | 45.5 ms | 46.7 ms | 55.2 ms | 107 | 0.39 ms | 2.55 ms | 0.99 ms | 37,708 | 6.0 | 216 | 216 | yes | 12 |
| Normal, 8 buckets | 20.4 | 47.9 ms | 49.1 ms | 59.5 ms | 101 | 0.38 ms | 2.73 ms | 0.92 ms | 37,709 | 5.0 | 204 | 204 | yes | 8 |

`late` uses the existing target-60 threshold (>25 ms), so every delivered frame
in these below-target variants is late. Development Strict Mode explains the
two App render/rebuild invocations per normal committed frame, but the
local-clock row has zero App renders and essentially unchanged FPS.

### Root-cause ranking

1. **Animated SVG path invalidation and repaint is primary.** Freezing the
   masked `d` attributes increased FPS by 31% and reduced mean interval by
   11.5 ms, despite App rendering and geometry/grouping continuing.
2. **The remaining SVG/browser presentation path is substantial.** Static
   masked content still reached only 26.6 FPS, indicating additional React
   commit/style/presentation cost beyond the directly timed ~3 ms.
3. **App-owned React clocking is not the dominant limiter.** The isolated local
   clock removed all App renders but delivered 20.6 FPS, statistically close to
   normal.
4. **The glyph mask is a secondary cost.** Removing it improved mean interval
   by only 1.8 ms and FPS by 0.8. A mask-specific product rewrite is unlikely to
   justify its vector/compatibility risk.
5. **Bucket/node count is not the main cost in the tested range.** Twelve
   buckets produced a small improvement, while eight regressed to baseline.
   Total path payload remained ~37.7k characters because bucket count changes
   partitioning, not geometry. Lower counts also risk visible opacity banding.

The optional zoom trace did not complete because the browser-control connection
timed out while changing zoom. The dev helper now includes a one-click
**Trace current zoom** action so 100%/200%/fit rows can be repeated without code
changes. No zoom result is inferred or fabricated.

### Recommended next gate

Proceed with **Gate 7.8D: SVG path repaint budget experiment**, not a mask
rewrite and not an App-clock rewrite. Evaluate preview-only temporal/path
budgets that reduce how often or how much `d` data invalidates:

1. update alternating bucket subsets or use a lower preview update cadence
   while preserving animation phase;
2. test whether spatially partitioned paths reduce dirty-region repaint;
3. test static geometry plus CSS stroke motion only where visual equivalence is
   provable;
4. retain an explicit Canvas preview-only option for high-FPS editing if SVG
   path repaint cannot meet the target.

Do not lower the default to 8 buckets based on this trace. Twelve buckets is a
possible quality option, not yet a justified default.

Gate 7.8C validation: 7 focused files / 75 tests passed; `tsc --noEmit` passed;
production build passed (101 modules, 9.83 s). Rollup emitted only the existing
advisory >500 kB chunk warning. Browser console was clean.

## Gate 7.8D — SVG path repaint budget experiment

Measured 2026-06-30 in a fresh Codex in-app Chromium tab on Windows, development
server, DevTools closed, DPR 1, Edge Current default preset, target 60 FPS,
masked SVG DOM backend, application zoom 100%. Each row used a 700 ms warm-up
and five-second capture. Compare rows within this matrix; the fresh browser tab
was faster than the older Gate 7.8C session, so cross-gate absolute FPS is not a
controlled comparison.

| Variant | FPS | Median | Mean | p95 | Late | Geometry | Grouping | DOM write | Updated `d` chars/frame | Changed buckets | SVG DOM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline, 24 opacity buckets | 26.9 | 35.9 ms | 37.2 ms | 45.6 ms | 134 | 0.27 ms | 1.69 ms | 0.75 ms | 37,708 | 10.0 | yes |
| Rotate 12 of 24 | 31.0 | 31.4 ms | 32.2 ms | 39.8 ms | 149 | 0.29 ms | 1.87 ms | 0.47 ms | 18,854 | 5.0 | yes |
| Rotate 8 of 24 | 34.8 | 28.3 ms | 28.7 ms | 36.0 ms | 143 | 0.28 ms | 1.69 ms | 0.32 ms | 12,660 | 3.3 | yes |
| Paint cadence 20 FPS | 16.0 | 59.6 ms | 62.7 ms | 88.5 ms | 79 | 0.30 ms | 1.62 ms | 0.71 ms | 37,708 | 10.0 | yes |
| Paint cadence 15 FPS | 12.5 | 79.7 ms | 79.9 ms | 101.3 ms | 62 | 0.36 ms | 1.48 ms | 0.64 ms | 37,709 | 10.0 | yes |
| Hybrid 12 opacity × 2 spatial columns | 23.2 | 42.5 ms | 43.0 ms | 55.9 ms | 116 | 0.27 ms | 1.71 ms | 0.76 ms | 37,708 | 12.0 | yes |

For cadence variants, observed FPS describes actual SVG path presentation
cadence, while App phase/geometry continues at the uncapped animation clock.
Their lower result is expected and visibly risks stepping; they are not a route
to smoother motion on this machine.

### Visual-quality assessment

- **12-of-24:** every bucket refreshes over two visual frames. Motion remains
  spatially complete, but alternating opacity cohorts can lag one frame,
  producing mild temporal shimmer on high-contrast edges. This is the best
  measured quality/performance compromise and exceeds both 24 and 30 FPS here.
- **8-of-24:** every bucket refreshes over three frames. It is fastest, but
  opacity cohorts can be two frames apart. Shimmer/uneven temporal motion risk
  is materially higher; do not make it the silent default.
- **20/15 cadence:** global motion is coherent but visibly stepped, and the
  measured presentation rates underdeliver their requested cadence. Rejected.
- **12×2 spatial hybrid:** preserves all segments and approximate opacity, but
  creates more active changing paths and regresses below baseline. The browser
  appears to repaint the masked artwork as a group rather than benefiting from
  narrower path bounds. Rejected.
- **CSS motion:** not implemented. Edge Current changes each segment's endpoints
  and orientation over time. `stroke-dashoffset`, transform, or opacity on
  static geometry cannot reproduce that field evolution, so it would be a
  different renderer rather than an optimization.

The prior explicit Canvas preview-only reference remains approximately 17.7 FPS
on this constrained in-app surface at target 60 (older, non-comparable run).
Canvas remains explicit-only and is not connected to export.

### Recommendation

Promote **12-of-24 rotating updates only as an explicit preview-quality option**
after human visual acceptance. Keep full 24-bucket updates as the default until
the shimmer tradeoff is approved. Offer 8-of-24 only as a clearly labeled
performance mode. If perfectly coherent full-quality SVG motion is required,
accept the baseline rate or use the already-explicit Canvas preview-only mode;
do not silently switch backends.

The next gate should be **Gate 7.8E: preview quality control and visual
acceptance**, limited to exposing Full / Balanced (12-of-24) / Performance
(8-of-24) preview budgets with clear labels and no serialization. No further
mask, spatial partition, CSS approximation, or worker work is justified by this
trace.

Gate 7.8D controls are dev/preview-only and are not serialized into project
JSON. Variant switches reset cached path state and deterministically refresh
every path. Primary color, transparent background, and zoom interactions
remained functional during browser QA; console warnings/errors were empty.
The browser export download observation timed out at the automation boundary,
so vector/export integrity is supported by the passing deterministic export and
vector-integrity tests rather than a claimed download observation.

Validation: 5 focused files / 61 tests passed; `tsc --noEmit` passed; production
build passed (101 modules, 7.13 s). Rollup emitted only the existing advisory
>500 kB chunk warning. Export remains CPU-generated, deterministic, fixed-bounds,
vector-only, and full quality.

## Instrumentation and validation

The dev-only meter now captures the live SVG commit timestamps instead of timing
an empty rAF loop. It records clock state-update cost, geometry build count/time,
path grouping, `d` length, active/changed buckets, DOM write count/time, App
render count, and geometry rebuild count. It emits no console logs and is only
mounted behind `import.meta.env.DEV`.

Focused validation: scheduler/flow tests passed (3 files, 36 tests) and the new
runtime-capture tests passed (1 file, 2 tests). The first TypeScript typecheck
passed before concurrent unrelated worktree edits appeared. The final full-suite
attempt completed 21 files / 254 passing tests but exited nonzero because 15
Vitest workers timed out during startup. The final production build is blocked
by pre-existing/concurrent type errors in `CanvasNavigation`, WebGPU diagnostic
files, and their tests; none is in the Gate 7.8A instrumentation listed above.

## Gate 7.8E — Preview quality control and visual acceptance

`Preview Quality` is now an explicit runtime control beside Preview FPS:

| Mode | Deterministic SVG repaint budget | Controlled Gate 7.8D FPS | Refresh span |
| --- | ---: | ---: | ---: |
| Full | 24 of 24 buckets/frame | 26.9 | 1 frame |
| Balanced | rotating 12 of 24 buckets/frame | 31.0 | 2 frames |
| Performance | rotating 8 of 24 buckets/frame | 34.8 | 3 frames |

Full remains the default. Balanced and Performance are opt-in because their
opacity cohorts can be one or two frames apart. Automated browser QA confirmed
that all modes are selectable, switches safely restore Full, transparent
background remains functional, and zoom/fit remains viewport-only. A short
non-controlled UI sample read 27.8 / 32.6 / 30.0 FPS; the five-second Gate 7.8D
matrix above remains the acceptance measurement because a single live meter
reading is noisy.

Balanced has not been declared visually accepted: temporal shimmer requires a
human perceptual judgment. It therefore remains opt-in and Full remains the
default. No blank paths or broken mask behavior were observed in functional
browser QA.

The preference lives only in `PreviewSettings`; it is absent from
`ProjectState`, `.substrate.json`, and SVG export inputs. It only selects the
FlowPreview repaint schedule. Export geometry and artwork remain CPU-generated,
fixed-bounds, deterministic, vector-only, and full quality. Export timestamp
metadata still varies by export time, as before.

Validation: the full suite passed (37 files / 414 tests); lint and
`tsc --noEmit` passed; production build passed (101 modules, 5.25 s). Rollup
emitted only the existing >500 kB chunk advisory. The only browser console
message seen during the edit session was React's expected HMR warning when the
dependency count of an already-mounted hook changed; no application console
logging was added.

## Gate 7.9 — Dual preview backend architecture

Flow Lines now has two explicit runtime presentation backends:

- **Canvas Performance · preview only** owns an imperative rAF loop. It resolves
  the shared `FlowPreviewFrame` and batches approximately 1,564 segments into at
  most 24 opacity stroke submissions.
- **SVG Accuracy · vector DOM** retains the grouped SVG path reference preview
  and its optional Full / Balanced / Performance opacity budgets.

Edge Current starts with Canvas Performance visibly selected and has
runtime-only recommendation metadata. Other renderers resolve visibly to SVG
Accuracy and cannot select the unsupported Canvas backend. Backend and quality
preferences remain outside `ProjectState` and are ignored by project import.

Manual comparison on 2026-06-30 used the Codex in-app Chromium browser on
Windows, DevTools closed, DPR 1, Edge Current default preset, target 60 FPS,
100% application zoom:

| Preview mode | Observed FPS | Presentation |
| --- | ---: | --- |
| Canvas Performance | 60.1 | imperative Canvas 2D, 24 opacity batches |
| SVG Accuracy / Full | 34.4 | masked SVG DOM, 24 grouped paths |

Canvas uses the shared frame's colors, transparent/background state, artboard
bounds, geometry, and animation phase. Zoom/pan remains outside both backends
as a viewport-only transform. Switching backend unmounts Canvas and cancels its
rAF; state/preset replacement cancels the previous loop before starting one.

The browser download observer timed out at the automation boundary, so no
download event is claimed. Export equality and isolation are enforced by
deterministic artwork comparisons, project-schema tests, the serializer
dependency guard, forbidden-raster validation, and the preset vector-integrity
matrix. Final Artwork remains CPU-generated, fixed-bounds, deterministic in
artwork geometry, vector-only, and full quality.

Validation: full suite passed with constrained concurrency (38 files / 418
tests); lint and `tsc --noEmit` passed; production build passed (102 modules,
8.64 s). Rollup emitted only the existing >500 kB chunk advisory. The initial
unconstrained suite attempt hit Windows paging-file exhaustion after one new
assertion failure; the assertion was corrected and the complete two-worker run
passed.
