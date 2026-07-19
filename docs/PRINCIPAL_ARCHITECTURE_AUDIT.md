# SUBSTRATE — Principal Architecture Audit

Scope: read-only architectural audit after the geometry-authority, size-interaction,
memo-identity, and semantic-identity stabilization passes. No code was modified.
Method: direct source reading of ~70 files across `src/engine`, `src/hooks`,
`src/components`, `src/graph`, plus targeted grep sweeps (`state.` reads per renderer,
`Math.random`, `console.*`, cache declarations). No tests or builds were executed
during the audit; the green baseline (lint, typecheck, Vitest, production build,
production E2E, schema v8, golden fixtures) is taken from the task brief.

Verification legend: each finding cites the exact file:line evidence it rests on.

---

## Executive summary

The core architecture is sound and the previous fixes hold. The stage-key chain
(typography → scene → substrate → renderer), the frozen-snapshot export path, the
latest-only substrate scheduler with full terminal states, and the semantic
substrate request keys are all structurally correct and mutually consistent.
Export determinism is enforced by construction, not by convention, for the
renderers that dominate usage.

Three correctness defects remain, all of the same family the previous passes were
fixing — semantic inputs that fail to reach an identity boundary:

1. **Export snapshot contexts drop geometry identity keys** (`C1`). Two sequential
   exports that differ only in kerning/optical-spacing/textAlign/textOffsetY/
   precision can produce byte-identical stale SVG for the second export.
2. **Native-fallback substrate rasterization re-derives text placement from legacy
   constants instead of the resolved scene layout** (`C2`). The raster is
   systematically offset from the authoritative placement — ≈+15.7px vertically at
   factory defaults, worse with font size, line count, and artboard expansion.
3. **`state.precision` is missing from both typography identity keys** (`C3`). A
   precision-only change leaves stale glyph outlines in preview and export until
   some other keyed input changes.

All three fixes are small and localized. With them landed (plus the `M1` export
clock fix), the system is ready for feature development. The performance findings
(`M2`, `M3`, eager trace serialization) are real but secondary; no unbounded
memory growth, no GPU lifecycle issues (the render path is Canvas2D/SVG only), and
no async path that can update after disposal was found.

---

## 1. Architecture map

```
ProjectState (useProjectDocument, schema v8)
  │  document identity: structural keys per stage (pipelineStageKeys.ts, exportAuthority.ts)
  ▼
Typography identity ── typographyInputKey / typographyStageKey
  ▼
Glyph geometry ── useTypographyGeometry → layoutGlyphs (font outlines → Path2D + d)
  ▼
Scene layout ── useSceneLayout → resolveSceneLayout (authored artboard + typography
  │                bounds → effective artboard, placement, safety clamp) — single
  │                pure authority, keyed by sceneLayout.key
  ▼
Substrate generation ── useSubstratePipeline → useSubstrateBackend
  │  LatestOnlyScheduler; backend chain cpu-worker → cpu-main (fallback.ts)
  │  request key: substrateBuildInputKey; outputKey = inputKey when settled
  ▼
Renderer geometry ── createStaticRenderContext + generateRendererGeometry
  │  module-level Map cache (limit 24) for static renderers; flow uncached
  ▼
Presentation ── Viewport (camera) → FlowPreview (SVG, bucket pool) /
  │             CanvasFlowPreview (Canvas2D, flow only) — same geometry authority
  ▼
Export ── exportReadiness gate → captureExportSnapshot (frozen) →
          createTimedSvgFromSnapshot → exportSvg (vector-only, golden fixtures)
```

### Layer ownership table

| Layer | Owner | Mutated by | Identity | Invalidation |
|---|---|---|---|---|
| ProjectState | `useProjectDocument` | user edits, project import, presets | schema v8 document | every edit (structural) |
| Typography geometry | `useTypographyGeometry` memo | typography inputs only | `typographyInputKey` (exportAuthority.ts:75) / `typographyStageKey` (pipelineStageKeys.ts:16) — **both omit `precision`** | key change |
| Glyph layout | `layoutGlyphs` (pure) | called from typography memo | output of typography stage | with typography |
| Scene layout | `useSceneLayout` → `resolveSceneLayout` (pure) | typography bounds + authored artboard | `sceneLayout.key` | typography key or artboard key change |
| Substrate | `useSubstrateBackend` + `LatestOnlyScheduler` | build inputs from pipeline hook | `substrateBuildInputKey` (exportAuthority.ts:98); output key = input key on settle | semantic input change; latest-only supersession |
| Static field / context | `createStaticRenderContext` memo | renderer requirements + scene + typography + substrate | `staticRenderContextStageKey` (pipelineStageKeys.ts:84) | stage key change |
| Renderer geometry | `generateRendererGeometry` module cache | renderer + packed state slice + geometry keys | `rendererGeometryCacheKey` (rendererRuntime.ts:88) | key change; FIFO eviction at 24 |
| Viewport / camera | `Viewport` component | pan/zoom gestures | none (presentation-only, correctly excluded from all semantic keys) | n/a |
| Export | `captureExportSnapshot` → frozen `ExportSnapshot` | readiness-gated capture | `rendererInputKey` (exportAuthority.ts:118) | readiness recompute per edit |

Derived state that is correctly derived (not duplicated): effective artboard,
placement, raster plan, sampling domains, safety budgets. No second source of
truth for any of these was found.

Workers: one substrate cpu-worker (lazy, self-tested at init, 8s request timeout,
reinit on crash). Async boundaries: substrate build (scheduler), font loading
(lazy boundary), export capture (synchronous from settled state), animation clock
(rAF, flow renderer only).

---

## 2. Geometry authority audit

**Is there exactly one authoritative typography geometry output?** Yes —
`useTypographyGeometry` is the only producer; preview, debug overlays, substrate
input, and export all consume the same memo. `resolveSceneLayout` is the only
scene authority and is pure.

**Can Canvas and SVG consume different geometry?** For static renderers, no —
both consume the same `GeometryGroup`. For `flow` (the only `usesTime` renderer)
there are deliberately two engines: the SVG preview bucket pool and the Canvas2D
preview draw the same per-frame geometry through different paths. This is a
documented, tested divergence, but see `M6`: the canvas preview rebuilds its
whole scene per edit and ignores the live geometry memo.

**Can export produce different geometry from preview?** By design no: export
captures a frozen snapshot built from the same settled stage outputs, gated by
`resolveExportReadiness` (exportAuthority.ts:148-168), which refuses to capture
until every stage output key matches its input key. **Except** `C1`: the
snapshot's render context omits `textGeometryKey`/`substrateKey`, so the module
geometry cache can return a previous export's geometry while the readiness gate
(computing keys independently and correctly) reports ready.

**Can a renderer receive geometry generated from an older typography state?**
Live preview: no — the packed cache key includes the typography output key.
Export path: yes, via `C1`.

**Duplicate geometry calculations:** the composite wave field is rebuilt inside
the static-context memo whose deps include all of `state` (`M2`); flow geometry
is generated in up to three memo sites per change (`M3`). No correctness impact,
both are the same pure function.

**Hidden coordinate transforms:** one remaining — the native-fallback raster
path reconstructs placement through `getTextLayout` with a synthetic
`textOffsetY: input.baselineY - TEXT_LAYOUT.baselineY` (rasterizeGlyphs.ts:69,
legacy constant 405 from constants.ts:15) instead of using the resolved
`input.baselineY` / `input.textX` that the pipeline already provides in scene
space (useSubstratePipeline.ts:45-46). This is `C2`.

**Stale bounds / implicit scaling / mismatched spaces:** none found elsewhere.
The raster transform (rasterizeGlyphs.ts:44-50) maps the authoritative domain
rect to pixels explicitly; sampling domains derive from the same scene layout.

**Remaining object-reference identities:** none in semantic keys. Debug-image
caches are `WeakMap`s keyed on resolved font-data objects — trace-only,
deliberate, leak-free.

---

## 3. Semantic identity audit

Every cache found, with key coverage. "Missing inputs" = semantic inputs that can
change output but are absent from the key.

| Cache | Owner | Key | Missing inputs | Risk |
|---|---|---|---|---|
| Typography geometry memo | `useTypographyGeometry` | `typographyInputKey` / `typographyStageKey` | `state.precision` (consumed at glyphLayout.ts:60) | **C3** — stale outlines on precision-only change |
| Scene layout memo | `useSceneLayout` | typography key + artboard key + bounds | none | — |
| Substrate input memo | `useSubstratePipeline.ts:21-62` | project slice + scene key | `amplitude`, `overlayMode`, `outlineWarp*` (consumed by contourDomain.ts:83-86) | **M5** — stale domain bounds at fontSize>220 / overscanned renderers |
| Substrate request | `useSubstrateBackend` | `substrateBuildInputKey` | none (resolution, bounds, domain, viewport, typography key all present) | — |
| Static render context memo | App.tsx | stage keys | deps include whole `state` → over-invalidation | **M2** (perf only, never stale) |
| Renderer geometry module cache | rendererRuntime.ts:11, 88-128 | packed scalar slice + `textGeometryKey` + `substrateKey` + emitter + glyph-modulation keys | live path: none — all 9 renderers' `state.*` reads verified covered. Export snapshot path: both geometry keys are `null` → `"none"` | **C1** — stale export geometry |
| Glyph modulation cache key | controlOwnership.ts | packed scalar slice | none (grep-verified against renderer reads) | — |
| Emitter geometry key | rendererRuntime.ts:24-71 | packed emitter slice + resolved sources | none | — |
| Debug image caches | `src/engine/debug/` | `WeakMap` on font-data objects | n/a (trace-only) | — |
| Export readiness | `resolveExportReadiness` | stage input/output key comparison | none — but it cannot see `C1`/`C3` because the cache and the memo live below it | gate passes, cache stale |
| Flow frame geometry | none (intentionally uncached) | — | — | — |

Specifically checked, per the audit brief:

- **Keys containing presentation state:** none. Viewport/camera is excluded from
  every semantic key (verified in `rendererGeometryStateKey`, rendererRuntime.ts:73-86,
  which strips colors/debug/font and is itself only used by the readiness gate).
- **Keys missing semantic state:** `C1`, `C3`, `M5` above.
- **Keys depending on trace/debug mode:** none. Trace keys
  (`rendererRuntime.ts:133`, renderContextLifecycle.ts:29) are computed only for
  trace spans and never feed memoization or output identity; regression-pinned by
  `tests/traceIndependence.test.ts`.
- **Keys depending on React lifecycle:** none. All keys derive from state values,
  not refs, instances, or effect timing.
- **Future regressions of the typography-memo / renderer-cache class:** the two
  remaining holes are exactly `C1` (export-side context construction) and `C3`
  (precision). The pattern to institutionalize: any new `state.*` field consumed
  inside a memoized stage must be added to that stage's key in the same commit;
  the packed-key files should carry a comment pointing at the consumer list.

---

## 4. React ownership audit

- **Derived state stored unnecessarily:** none found with correctness impact.
  `M2`/`M3` are over-invalidation, not duplication.
- **Duplicated sources of truth:** none found. Runtime-vs-document state split is
  clean (viewport, clock, backend status are runtime; project fields are document).
- **Effects that synchronize instead of derive:** the flow rAF loop commits frames
  into a ref-backed clock — documented authority transfer, acceptable.
  `CanvasFlowPreview.tsx:245` effect depends on whole `state` and rebuilds the
  canvas scene + Path2D cache + resets the clock on any edit (`M6`).
- **Render-time mutations:** `Viewport.tsx:165-176` writes a ref during render
  (`L1`, low — mirrors derived camera values, no visual staleness observed).
- **Refs hiding dependency problems:** `onViewportChangeRef` pattern is
  deliberate and safe. No hidden stale-closure bugs found in the audit sweep.

Classification: no Critical React-ownership findings beyond `C1` (which is an
ownership-boundary bug at the export snapshot, not a hook bug). Medium: `M2`,
`M3`, `M6`. Low: `L1`.

---

## 5. Renderer architecture audit

- **Geometry/presentation separation:** correct. Renderers are pure
  `generateGeometry(state, context) → GeometryGroup`; SVG serialization and
  Canvas2D drawing are downstream consumers.
- **Viewport-state dependence:** no renderer reads camera/presentation state;
  `context.viewport` is the authoritative scene rect fed by the scene layout, not
  the camera. Verified by grep of renderer bodies.
- **Static renderers actually static:** yes — only `flow` has `usesTime`;
  registry and manifests agree (cross-checked).
- **Animated renderers isolated from geometry caching:** yes —
  `generateRendererGeometry` bypasses the module cache for `usesTime`
  (rendererRuntime.ts:160-165).
- **Unnecessary regeneration:** flow is recomputed in up to three memo sites per
  change (`M3`); static context rebuilds the composite field on any edit (`M2`).
- **Safety budgets:** consistent — device-independent node/sample budgets,
  `maxNodes` clipping with diagnostics flags, contour budget module, and the same
  budgets on the export path. Budget application is deterministic (no timing or
  device probes in the budget inputs).

---

## 6. Performance audit

| Issue | Severity | Evidence | Expected impact | Suggested direction |
|---|---|---|---|---|
| Eager `traceKey`/`safeTraceSerialize` of ~3M-float field results on the main thread per substrate build, in production, tracing off | High (CPU) | cpuWorkerBackend.ts:281, 328 | Main-thread stall after every substrate build; scales with raster size | Gate serialization behind `interactionTraceEnabled` (compute keys lazily) |
| Static-context memo deps include whole `state` → `buildCompositeWaveField` (~1M trig ops) rebuilt on any edit, including color/theme | Medium | App.tsx:236-249 | Jank on unrelated edits for field renderers | Narrow deps to the stage key inputs |
| Flow geometry generated uncached in up to three memo sites per change | Medium | useRendererRuntime.ts:30,48-72; rendererRuntime.ts:160-165 | 2-3× flow cost per edit | Single memo feeding all consumers |
| No worker circuit breaker: after crash/timeout, each later request re-bills the 8s timeout plus a main-thread rebuild | Medium | cpuWorkerBackend.ts:153-157, 279-341; fallback.ts:11-36 | Repeated 8s stalls in a broken-worker session | Mark worker unhealthy; stick to cpu-main until next init |
| `CanvasFlowPreview` effect rebuilds scene + Path2D + clock reset on any `state` change; App's flow live-geometry memo is computed but unused under the canvas backend | Medium | CanvasFlowPreview.tsx:245 | Per-keystroke full rebuild under canvas preview | Key the effect on the geometry key; consume live geometry |
| Module geometry cache eviction is FIFO, not LRU | Low | rendererRuntime.ts:178 | Cache thrash when alternating >24 variants | LRU or insert-order refresh on hit |

Memory: all caches bounded (geometry 24, modulation/emitter smaller, debug
WeakMaps); substrate retains only the latest settled result via the scheduler.
No detached-canvas retention found.
GPU: none — render path is Canvas2D/SVG only; no WebGL/WebGPU texture lifecycle,
no device-loss surface. rAF lifecycle is cleaned up on unmount/backend switch.

---

## 7. Async and lifecycle audit

- **Requests without terminal states:** none in the substrate layer —
  `LatestOnlyScheduler` settles every request as success / failure / superseded /
  disposed. This is exemplary and should not change.
- **Stale completions:** rejected correctly — scheduler tags results with the
  request's input key; consumers accept only when output key matches the active
  input key (same invariant the export gate uses).
- **Swallowed errors:** export catch paths set `failed` status. One gap: the
  "settling" export state only completes on readiness `ready`; a substrate failure
  during settling leaves "Preparing export…" forever (`M7`).
- **Abandoned promises:** worker requests have an 8s timeout and settle-once
  guards. Crash path reinitializes the worker. Missing: circuit breaker (`M4`).
- **Race conditions:** export capture is synchronous from settled state; no
  capture-vs-settle race found. Font loading is behind a lazy boundary with
  explicit resolution status (`resolveFontResolution`, exportAuthority.ts:61-73).

Answers to the audit questions: no async path can update after disposal (guarded),
overwrite newer data (latest-only + key match), or silently stop (all failures
surface a status) — except `M7`'s settling hang and `M4`'s repeated-timeout
degradation.

---

## 8. Export determinism audit

- **Shared geometry authority:** yes for scene/typography/substrate — export
  consumes the same settled outputs; `captureExportSnapshot` freezes
  (`structuredClone` + `Object.freeze`, exportAuthority.ts:192, 209). Broken one
  level down at the renderer-geometry cache (`C1`).
- **Cache bypass:** export builds its own snapshot pipeline and does not read
  preview component state — but it shares the module-level renderer geometry
  cache with preview; with `null` identity keys that sharing becomes a stale-hit
  channel (`C1`), and with correct keys it would be a legitimate reuse.
- **Random seeds:** deterministic seeded PRNG; `Math.random` appears only in the
  explicit Randomize button handler (grep-verified across `src/`).
- **Safety budgets:** deterministic (device-independent inputs).
- **Timing effects:** flow frame identity is explicit (`timeMs:frame`) — exports
  of an animated renderer are frame-addressed, which is documented
  non-determinism-by-feature, not a leak. SVG metadata embeds a timestamp →
  canon-deterministic, not byte-deterministic (`L4`). Native text with warping
  disabled rasterizes through `C2`'s path.
- **Canvas/SVG divergence at export:** export always serializes the authoritative
  `GeometryGroup` as SVG; the Canvas2D preview backend is preview-only. With the
  canvas backend active, `exportFrameMode: "current"` reads the frozen SVG clock
  rather than the canvas-reported frame → frame ≈ 0 (`M1`).

---

## 9. Test coverage audit

Existing coverage is strong where previous passes aimed: trace independence,
import boundaries, geometry authority E2E, pipeline invalidation gates, size-drag
gates, golden export fixtures. Missing invariants, in priority order:

1. **Sequential-export cache identity** — two exports differing only in
   textOffsetY (then kerningStrength, then textAlign) must produce different
   geometry. Catches `C1`.
2. **Native raster placement vs canonical layout** — rasterized glyph centroid
   (and first-line baseline) within 1px of `resolveSceneLayout` placement across
   font sizes, line counts, and expansion. Catches `C2`.
3. **Precision-only change rebuilds typography** — change `precision` with all
   else fixed; typography output key must change. Catches `C3`.
4. **Canvas-backend export frame** — with canvas preview active and
   `exportFrameMode: "current"`, the exported frame equals the canvas-reported
   frame. Catches `M1`.
5. **Substrate input key reacts to amplitude at fontSize>220** (and to
   `overlayMode`/`outlineWarp*` for overscanned renderers). Catches `M5`.
6. **Worker crash → no re-billed timeout** — after a forced worker failure, the
   next build resolves via cpu-main without an 8s wait. Catches `M4`.
7. **Settling + substrate failure surfaces `failed`** — export settling observes
   a substrate failure and exits the pending state. Catches `M7`.

Not recommended: more golden fixtures (current corpus already pins the vector
contract), renderer-visual snapshot tests (brittle, low signal), or coverage of
the graph executor (no production consumer; see §10).

---

## 10. Complexity audit

**Good complexity — protects invariants, keep:**

- Stage-key chain + readiness gate: this is the export-determinism machine.
- `LatestOnlyScheduler` terminal-state model: eliminates the whole stale-async
  bug class.
- Frozen export snapshot with `structuredClone`: cheap insurance against
  post-capture mutation.
- Semantic substrate request dedupe: prevents worker thrash on bursty edits.
- Worker self-test at init: converts opaque worker failures into a clean
  fallback decision.
- Layered safety budgets (node caps, contour budget, sampling caps): each layer
  guards a different failure mode; they are not redundant.

**Bad complexity — cost without a protecting invariant:**

- Export "current frame" clock plumbing: the canvas readback path
  (canvasMotionState → export key) exists to support one frame-addressing mode
  and currently reads the wrong clock (`M1`). Keep the feature, fix the source.
- `estimateExportKey` (App.tsx:387-402): hand-maintained parallel key that can
  drift from the real readiness keys; derive it from the same inputs instead (`L7`).
- Flow triple-compute sites (`M3`): three memo consumers each regenerate the same
  uncached geometry; one shared memo removes a whole class of "which one is
  stale" questions.
- `exportSvg.ts:79-88` hardcoded `version: 7` metadata shim for default artboard
  (`L3`): compatibility layer with no remaining consumer visible in-repo; either
  document the consumer or remove in a deliberate cleanup pass.

**Not flagged:** the dual SVG/Canvas2D preview paths for flow (different
trade-offs, both tested) and the v7→v8 migration (correct: v7 fixtures carry no
artboard field, so `artboard: DEFAULT_ARTBOARD` is the only sound default).

---

## 11. Findings

### Critical

**C1 — Export snapshot context drops geometry identity keys; module cache can return stale geometry for export**
- Location: `src/engine/exportAuthority.ts:196-208` (context built without
  `textGeometryKey`/`substrateKey`); `src/engine/renderContextLifecycle.ts:25-26,39-41`
  (params default to `null`); `src/engine/rendererRuntime.ts:88-128` (cache key
  falls back to `"none"`); contrast with the live context which passes them.
- Why it matters: with both keys `"none"`, the packed cache key omits
  kerningMode/kerningStrength, opticalSpacing(+Strength), textAlign, textOffsetY,
  precision, and all substrate identity. The readiness gate computes its keys
  independently and correctly (`rendererGeometryStateKey`, rendererRuntime.ts:73-86,
  includes those fields), so it reports **ready** while `generateRendererGeometry`
  hits a cache entry written by a *previous export* and serializes stale geometry.
- Failure scenario: export SVG; change only `textOffsetY` (or kerning, textAlign,
  precision); wait for ready; export again — second SVG contains the first
  export's geometry. Deterministic, silent, and invisible to the gate. Also: two
  exports never share cache with the live preview even when legitimately
  identical (minor perf side-effect).
- Confidence: high (direct source trace; not reproduced at runtime).
- Recommended fix: pass `typographyOutputKey`/`substrateOutputKey` (already in
  scope at the call site) into `createStaticRenderContext`, or bypass the module
  cache for snapshot generation. Add test §9.1.

**C2 — Native-fallback substrate rasterization re-derives placement from legacy constants**
- Location: `src/engine/substrate/rasterizeGlyphs.ts:64-76` builds a synthetic
  state with `textOffsetY: input.baselineY - TEXT_LAYOUT.baselineY` (405,
  `src/engine/constants.ts:15`) and calls `getTextLayout`, which places text at
  `canonicalBaselineAtAuthoredCenter(viewport.height/2, fontSize) + textOffsetY −
  (lines−1)·lineAdvance/2` (textLayout.ts:47-49; factor 0.41, sceneLayout.ts:81,92,185-190).
  The pipeline already provides the resolved placement in scene space:
  `baselineY: layout.baselineY, textX: layout.x` (useSubstratePipeline.ts:45-46) —
  and the native path ignores `textX` entirely, recomputing x via `alignedBoundsX`
  against the effective artboard width.
- Why it matters: the fallback raster (the default state — any project without an
  exact loaded font, and any native-text export) places glyphs at
  `effH/2 + 0.41·fontSize + (baseline − 405) − (lines−1)·lineAdvance/2` instead of
  `baseline`. Error at factory defaults (720px artboard, fontSize 148, single
  line): **+15.68px** vertically. Grows with font size (0.41·ΔfontSize), with
  artboard expansion (ΔeffH/2), and multi-line text double-counts the centering
  shift. Right-aligned native text additionally shifts horizontally by the
  expansion amount.
- Failure scenario: default project (no uploaded font) with any field/wave
  renderer — the substrate (and everything sampled from it) is offset from the
  typographic placement the user sees in overlays and in the exported vector
  text. Preview and export agree with each other (both wrong the same way), so
  golden fixtures cannot catch it; `tests/substrate.test.ts:126` pins only
  relative movement.
- Confidence: high (arithmetic verified against source constants).
- Recommended fix: rasterize directly at `input.baselineY + lineIndex·lineAdvance`
  and `input.textX` (scene space); delete the 405 compensation. Add test §9.2.

**C3 — `state.precision` missing from typography identity keys**
- Location: consumed at `src/engine/glyphLayout.ts:60`
  (`path.toPathData(state.precision)`); absent from `typographyStageKey`
  (`src/engine/pipelineStageKeys.ts:16-31`) and `typographyInputKey`
  (`src/engine/exportAuthority.ts:75-90`). Schema field: `projectSchema.ts:183`
  (clamped 0-3); default 1 (`presets.ts:74`).
- Why it matters: a precision-only change does not invalidate the typography
  memo, so glyph `d` strings keep the old rounding in preview and export until
  any other keyed input changes. The readiness gate cannot catch it — both of
  its typography keys omit the field.
- Failure scenario: raise precision for a cleaner export; export immediately;
  SVG contains outlines serialized at the old precision.
- Confidence: high. Blast radius smaller than C1/C3-adjacent bugs (cosmetic,
  self-heals on next edit), but it is the exact missing-semantic-input class this
  audit was asked to hunt.
- Recommended fix: add `precision` to both key functions. Add test §9.3.

### Medium

- **M1 — Canvas-backend export of "current" frame reads the frozen SVG clock.**
  App.tsx:271-274: with the Canvas2D preview backend active, `exportFrameMode:
  "current"` captures the frozen static-clock frame (≈0), not the frame the
  canvas is actually showing. Fix: source the frame from `activeClockContext`
  per backend. Add test §9.4.
- **M2 — Static-context memo over-invalidates the composite field.**
  App.tsx:236-249: deps include whole `state`, so `buildCompositeWaveField`
  (~1M trig evaluations) rebuilds on any edit, including colors/theme. Narrow
  deps to the stage-key inputs.
- **M3 — Flow geometry generated in up to three memo sites per change.**
  useRendererRuntime.ts:30,48-72 + rendererRuntime.ts:160-165. One shared memo.
- **M4 — No worker circuit breaker.** cpuWorkerBackend.ts:153-157, 279-341 with
  fallback.ts:11-36: after a crash/timeout, subsequent requests re-attempt the
  worker and re-bill the 8s timeout plus a main-thread rebuild. Mark the worker
  unhealthy and stick to cpu-main for the session. Add test §9.6.
- **M5 — Substrate input memo misses domain-affecting inputs.**
  useSubstratePipeline.ts:21-62 omits `amplitude`, `overlayMode`, `outlineWarp*`
  which contourDomain.ts:83-86 consumes (reachable at fontSize>220 and for
  overscanned renderers) → stale domain bounds until another keyed input
  changes. Add test §9.5.
- **M6 — Canvas flow preview rebuilds the world per edit.**
  CanvasFlowPreview.tsx:245: effect keyed on whole `state` rebuilds canvas
  scene, Path2D cache, and resets the clock on any edit; App's flow
  live-geometry memo is computed but unused under the canvas backend.
- **M7 — Export settling hangs on substrate failure.**
  App.tsx:317-333: settling completes only on readiness `ready`; a substrate
  failure during settling leaves "Preparing export…" indefinitely. Add test §9.7.
- **M8 — Production `console.log` leftovers.** App.tsx:300, 328;
  useSubstrateBackend.ts:100 (inside a state updater — double-log under
  StrictMode), :117. Remove or route through the trace system.

### Low

- **L1** — Viewport.tsx:165-176: render-time ref mutation (camera mirror). Move to an effect.
- **L2** — rendererRuntime.ts:178: module cache eviction is FIFO, not LRU.
- **L3** — exportSvg.ts:79-88: hardcoded `version: 7` metadata shim for the default artboard; undocumented consumer.
- **L4** — export metadata timestamp: canon-deterministic, not byte-deterministic. Document, or gate behind a deterministic-export flag.
- **L5** — projectSchema.ts:201-202: emitter `customX/Y` clamped to hardcoded 1200×720 instead of the project artboard.
- **L6** — exportSvg.ts:188-195: `revokeObjectURL` immediately after click; mostly fine in practice, but a delayed revoke is more robust across browsers.
- **L7** — App.tsx:387-402: `estimateExportKey` is a hand-maintained parallel of the readiness keys; derive from the same inputs.
- **L8** — Cross-environment raster antialiasing → pixel-level SDF/export differences between machines. Document as a known determinism boundary.
- **L9** — Graph executor (`src/graph/`) is a future duplicate-authority risk: no production consumer today, enforced only by import-boundary tests. Either promote it deliberately or keep it quarantined.

---

## 12. Things that should NOT be changed

- The stage-key chain and `resolveExportReadiness` gate (the fix for C1/C3 is to
  feed the existing machine, not to redesign it).
- `LatestOnlyScheduler` and its terminal-state model.
- Semantic substrate request dedupe and the worker self-test.
- `resolveSceneLayout` as the single, pure scene authority (authored vs
  effective artboard split).
- The size draft/settle interaction split (draft is presentation, settlement is
  document).
- Device-independent safety budgets and the seeded PRNG discipline.
- `assertVectorOnlySvg` + the golden export fixture corpus.
- The lazy font boundary with explicit resolution status.
- Import-boundary tests (they are what keeps `src/graph/` quarantined).
- The runtime-vs-document state split.

---

## 13. Suggested next passes

- **P0 (correctness):** C1, C2, C3, M1 + tests §9.1-§9.4. All four fixes are
  small and local; together they close every known stale-geometry path into
  export.
- **P1 (performance):** gate `traceKey`/`safeTraceSerialize` behind
  `interactionTraceEnabled` in `cpuWorkerBackend.compute`
  (cpuWorkerBackend.ts:281, 328 — currently serializes ~3M floats on the main
  thread per build, in production, with tracing off); then M2, M3, M6.
- **P2 (robustness/maintainability):** M4 (circuit breaker), M5 (input memo),
  M7 (settling failure path), M8 (logs), L1 (ref write), L7 (estimate key).
- **P3 (cleanup/docs):** L2-L6, L8-L9; document the determinism boundaries
  (timestamp, raster AA, flow frame addressing) in the export docs.

*End of audit. No code was modified; this report is the only artifact.*
