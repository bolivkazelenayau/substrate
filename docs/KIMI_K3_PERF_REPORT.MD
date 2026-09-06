SUBSTRATE — Principal Architecture Audit

   Method note: subagent delegation was unavailable (quota), so every claim below comes from my own read of the source. ~70 files read in full; all file:line citations verified against the working tree. No
   code was modified.

   ────────────────────────────────────────────────────────────────────────────────

   1. Architecture map

   ```
     ProjectState (v8 document, useProjectDocument)
       │  identity: documentKey / per-stage keys (JSON projections)
       ▼
     Typography identity ── typographyInputKey (exportAuthority.ts:75)
       │  useTypographyGeometry: layoutGlyphs(project, loadedFont) | null (native)
       ▼
     Glyph geometry (TextGeometry) ── typographyOutputKey
       │  useSceneLayout → resolveSceneLayout (sceneLayout.ts:214)  ← single scene authority
       ▼
     Effective artboard / scene layout ── sceneLayout.key + typography.key
       │  useSubstratePipeline → SubstrateBuildInput ── substrateBuildInputKey
       ▼
     Substrate generation ── useSubstrateBackend → LatestOnlyScheduler
       │  cpu-worker (OffscreenCanvas) → cpu-main fallback; outputKey = inputKey when settled
       ▼
     Renderer geometry ── createStaticRenderContext + generateRendererGeometry
       │  module Map cache (static renderers) / uncached (flow, usesTime)
       ▼
     Presentation ── Viewport: SVG DOM (FlowPreview buckets) | Canvas 2D (flow only)
       ▼
     Export ── exportReadiness gate → captureExportSnapshot → createTimedSvgFromSnapshot
   ```

   ┌───────────────────────┬────────────────────────────────────────┬────────────────────────────────────────────┬────────────────────────────────────────────────────────┬────────────────────────────────────┐
   │ Layer                 │ Owner                                  │ Mutated by                                 │ Identity                                               │ Invalidation                       │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Document              │ useProjectDocument                     │ controls, import, font handlers, size      │ documentKey (JSON minus debug)                         │ any setProject                     │
   │                       │                                        │ commit                                     │                                                        │                                    │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Typography geometry   │ useTypographyGeometry                  │ rebuilt only                               │ typographyStageKey + loadedFont identity               │ key change                         │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Scene                 │ useSceneLayout → resolveSceneLayout    │ nobody (pure)                              │ sceneInputKey, output layout.key                       │ key change                         │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Substrate             │ useSubstrateBackend                    │ backend only                               │ substrateBuildInputKey semantic; dedupe by key not     │ key change; explicit reset on      │
   │                       │ (+scheduler/worker)                    │                                            │ object                                                 │ disable                            │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Static render context │ App.tsx memo                           │ nobody                                     │ staticContextInputKey (+ raw object deps)              │ key or object change               │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Renderer geometry     │ rendererRuntime module cache           │ generateRendererGeometry                   │ packed rendererGeometryCacheKey                        │ key miss                           │
   ├───────────────────────┼────────────────────────────────────────┼────────────────────────────────────────────┼────────────────────────────────────────────────────────┼────────────────────────────────────┤
   │ Export                │ captureExportSnapshot → frozen         │ nobody after capture                       │ readiness stage keys                                   │ re-capture per click               │
   │                       │ snapshot                               │                                            │                                                        │                                    │
   └───────────────────────┴────────────────────────────────────────┴────────────────────────────────────────────┴────────────────────────────────────────────────────────┴────────────────────────────────────┘

   Sources of truth: ProjectState (document), textGeometry (typography), resolveSceneLayout (placement + effective rect), substrateBuild.data (field), GeometryGroup (marks). Derived state is mostly keyed, not
   duplicated — with exceptions below.

   ────────────────────────────────────────────────────────────────────────────────

   2. Geometry authority audit

   • One authoritative typography output? Yes for placement: getTextLayout + canonicalBaselineAtAuthoredCenter is shared by glyph layout, scene layout, SVG text serialization, and substrate input. One
     exception: rasterizeGlyphs native path re-derives placement through a legacy constant (Critical C2).
   • Canvas vs SVG different geometry? Both consume GeometryGroup/flow frames from the same generator; Canvas re-runs createFlowPreviewFrame in its own loop with its own clock (M1, M6).
   • Export vs preview different geometry? Export regenerates from a frozen snapshot using the same registry and the same effective rect — but through a differently-keyed cache context (C1).
   • Renderer receiving older typography state? Preview: no — textGeometryKey rides the live context. Export: yes, via module-cache collision (C1).
   • Object-reference identities remaining: useSubstratePipeline input memo depends on effectiveArtboard object identity (works only because useSceneLayout always returns a fresh object on key change —
     fragile relay, Medium); exportSvg.ts:74 compares context.textGeometry === textGeometry by reference (benign patch); buildGlyphSamplingDiagnostics/debug caches use WeakMap on object identity (fine,
     diagnostic-only).

   3. Semantic identity audit — cache table

   • Cache: module geometryCache (rendererRuntime.ts:11) · Owner: rendererRuntime · Key: packed scalars + context.textGeometryKey + context.substrateKey + viewport · Missing inputs: kerning mode/strength,
     optical spacing, textAlign, textOffsetY, precision — only when the caller's context carries textGeometryKey: null (live context is complete; export snapshot context is not → C1) · Risk: stale export
     geometry.
   • Cache: useTypographyGeometry memo · Key: typographyStageKey · Missing: state.precision (read by layoutGlyphs at glyphLayout.ts:60) → C3.
   • Cache: useSubstratePipeline input memo · Key: substrateProjectSliceKey + textGeometry + effectiveArtboard identity · Missing: amplitude, overlayMode, outlineWarpMaxDisplacement, outlineStrokeWidth — read
     by resolveContourDomain (contourDomain.ts:83-86) → M5.
   • Cache: useRendererRuntime live/estimate/export memos · Key: liveRevisionKey (+project object in deps — over-invalidates; module cache absorbs it for static renderers, not for flow) → M3.
   • Cache: flow baseCache (flowLinesRenderer.ts:18) · Key: seed:count:bounds — complete, bounded (12). OK.
   • Cache: debug image WeakMaps (debugImage.ts:10-12) — keyed on SubstrateData object, released with substrate. OK.
   • Cache: warpedOutline memo (Viewport.tsx:153) · Key: outlineWarpCacheKey + context field/substrate/textGeometry — complete. OK.
   • Worker request identity: substrateBuildInputKey — complete (typography key, raster params, domain, viewport). OK.

   No keys depend on trace/debug mode (verified: traceIndependence.test.ts pins this; semantic keys are computed ungated). No key depends on React lifecycle.

   4. React ownership audit

   Classified findings are folded into the final report; summary:

   • Critical-class: none in hooks themselves; the React-layer contribution to C1 is the asymmetric context construction in captureExportSnapshot.
   • Medium: App.tsx:236-249 static-context memo lists state as a dep → semantic key defeated, field rebuilt on any edit (M2). App.tsx:271-274 export clock source (M1). App.tsx:317-333 settlement masks
     failure (M7). CanvasFlowPreview.tsx:245 effect depends on state → full teardown/reclock per edit (M6).
   • Low: Viewport.tsx:165-176 render-time ref mutation (diagnostics-only, concurrent-unsafe); App.tsx:300/328 + useSubstrateBackend.ts:100/117 production console.log leftovers, one inside a state updater.

   Effects that sync rather than derive: none found that corrupt state — the disable/enable substrate effect is genuinely lifecycle, not synchronization.

   5. Renderer architecture audit

   • Geometry generation is separated from presentation (GeometryGroup IR; Canvas/SVG both consume it).
   • No renderer reads viewport-navigation, devicePixelRatio, DOM, or trace flags. All nine renderers' state.* reads are covered by the packed key (verified field-by-field against the grep of all renderers +
     glyphModulationCacheKey + emitterGeometryKey).
   • Static renderers are actually static; only flow is usesTime, and it bypasses the cache correctly.
   • Animated renderer isolation: correct — but see M3 (regeneration cost).
   • Budgets: maxNodes enforced per renderer (halftone/streamlines/contours/wave/diffuser each clamp + set maxNodesClipped); budgetContourFragmentsFairly is deterministic; substrate raster plan is
     device-independent. Budget application is consistent between preview and export (same registry functions).
   • emitterGeometryKey/glyphModulationCacheKey coverage verified complete against compositeWaveField/glyphFieldModulation reads.

   6. Performance audit (runtime)

   • Issue: Ungated traceKey(input) / traceKey(result) in worker compute path · Severity: High-Medium · Evidence: cpuWorkerBackend.ts:281,328 call sites evaluate safeTraceSerialize eagerly; traceStartSpan
     gates only inside (interactionTrace.ts:127-128); result carries three Float32Arrays up to 1M cells → JSON.stringify of ~3M floats on the main thread per substrate build, in production, tracing off ·
     Expected impact: likely the single largest main-thread cost in the substrate path; directly defeats the worker offload (serialization happens before/after the round trip) · Direction: gate key
     computation behind interactionTraceEnabled at the call site, as done everywhere else.
   • Issue: Composite wave field rebuild on any project change · Severity: Medium · Evidence: App.tsx:248 state in memo deps → createStaticRenderContext → buildCompositeWaveField (up to ~1M sin/hypot) on
     appearance-only edits when emitter active · Direction: drop raw objects from deps; trust staticContextInputKey.
   • Issue: Animated renderer triple regeneration (live + estimate [+ time-zero export]) per state change, uncached · Severity: Medium · Evidence: useRendererRuntime.ts:48-72, rendererRuntime.ts:160-165 ·
     Direction: memo estimate/export variants on semantic keys only; skip estimate when cost-estimate debug is off.
   • Issue: No worker circuit breaker · Severity: Medium · Evidence: after crash/timeout, available stays true, capability stays "supported" (cpuWorkerBackend.ts:153-157,292); every later request re-pays up
     to 8s timeout then a main-thread rebuild (fallback.ts:16-29) · Direction: mark worker dead on onerror/timeout, recreate once, then stick to cpu-main.
   • Issue: Canvas effect over-invalidation + dead live-geometry under canvas · Severity: Medium · Evidence: CanvasFlowPreview.tsx:245 (state dep → rAF/Path2D/backing-store rebuild + elapsedTime reset per
     edit); App.tsx:261-266 liveGeometry regenerated per 300ms canvas sample though Viewport renders null for it (Viewport.tsx:324-337) · Direction: narrow effect deps; skip live generation when canvas owns
     the frame.

   7. Async and lifecycle audit

   • Terminal states: every scheduler request ends in success | failure | superseded | disposed (latestOnlyScheduler.ts) — verified including reset-while-active and dispose-while-active. Worker requests
     settle via response, 8s timeout, onerror failAll, or dispose failAll. No limbo found.
   • Update after disposal? Guarded (mounted ref + stale checks, useSubstrateBackend.ts:243,271). Strict Mode double-mount handled via deferred dispose. Clean.
   • Overwrite newer data? Stale completions rejected by request-id (latestRequest.current !== requestId) and scheduler staleness — double protection, correct.
   • Leak resources? Worker terminated on real unmount; buffers transferred (not copied) back; debug images WeakMap-keyed. Canvas rAF loops cleaned. FlowPreview local-clock rAF cleaned. OK.
   • Silently stop? One: a crashed worker isn't marked dead, so the system degrades to per-request 8s stalls instead of a clean sticky fallback (M4). Errors otherwise propagate to backendState.error and block
     export via readiness failed.

   8. Export determinism audit

   • Both pipelines share resolveSceneLayout, getTextLayout, the same registry, and the same GeometryGroup when keys align. Except the export snapshot's cache context (C1) and the native raster anchor (C2).
   • Export does not bypass preview caches — it adds its own entries under weaker keys (C1).
   • Seeds: createSeededRandom LCG everywhere; Math.random only in the explicit Randomize button (writes seed into the document). Deterministic.
   • Budgets: device-independent. Deterministic.
   • Timing: exportTimestamp in metadata (canonicalized in fixtures — export is canon-deterministic, not byte-deterministic); exportFrameMode:"current" captures the render-time clock (≤1 frame lag, acceptable
     under SVG; wrong under Canvas, M1).

   9. Test coverage audit

   Strong: identity keys, trace independence, preview/export scene equality, stale substrate rejection, backend lifecycle, golden corpus, migration chain, import boundaries. Missing (high-value only):

   1. Two sequential exports with only textOffsetY/kerningMode/textAlign changed (parsed font, static substrate renderer, text inside artboard) asserting the second export's geometry differs — catches C1.
   2. Native raster placement authority: rasterize native text across font sizes (e.g. 60/148/300) and multi-line, assert mask centroid matches canonical placement within 1px — catches C2.
   3. Precision-only change rebuilds typography geometry — catches C3.
   4. Canvas backend + exportFrameMode:"current" exports the canvas-reported frame, not the frozen SVG clock — catches M1.
   5. Substrate input key reacts to amplitude at fontSize>220 for overscanned renderers — catches M5.
   6. Worker crash mid-build → next request does not pay a timeout (circuit-breaker contract) — catches M4.
   7. Settling + substrate failure surfaces failed and exits settling — catches M7.

   10. Complexity audit

   • Good complexity (keep): stage-key chain + export readiness gates; latest-only scheduler with terminal states; semantic substrate dedupe; draft/settle size split with per-renderer draft policy;
     device-independent safety budgets; vector-only assertion + canonicalized golden corpus; lazy font boundary; import-boundary tests.
   • Bad complexity: the dual cache-key construction (live vs snapshot contexts) that created C1; rasterizeGlyphs' legacy-constant placement reconstruction (C2); manual field lists that must be maintained by
     hand (estimateExportKey, App.tsx:387-402 — will rot); export metadata version: 7 shim (exportSvg.ts:79-88); readiness "renderer-stage" gate that is structurally always-pass (App.tsx:297-299 vs
     exportAuthority.ts:161-163 — redundant but harmless).

   ────────────────────────────────────────────────────────────────────────────────

   Executive summary

   The stabilization passes worked: the identity chain (typography → scene → substrate → renderer) is semantic, traced, and well-tested; async lifecycles have real terminal states; geometry authority is
   single-sourced with one significant leak. The system is not quite ready for feature development: two correctness bugs in the geometry/export core should land first, because new features will build on the
   assumption that "export always reflects current project state" and "native and parsed fonts share one placement authority" — both are currently false in specific configurations.

   Biggest remaining risks: (1) silent stale geometry in exported SVG via the export-path cache key; (2) native-fallback field/text misalignment in the default configuration; (3) a main-thread serialization
   cost hidden inside the worker path.

   Critical findings

   C1 — Export snapshot context drops semantic keys; export cache can return stale geometry.
   • Location: src/engine/exportAuthority.ts:196-208 (calls createStaticRenderContext without textGeometryKey/substrateKey); src/engine/rendererRuntime.ts:88-128 (key reads context.textGeometryKey ?? "none",
     substrateKey ?? "none"); contrast with the live context at src/App.tsx:236-249.
   • Why it matters: the export-path cache key omits kerning mode/strength, optical spacing, textAlign, textOffsetY, precision, and all substrate identity. Live keys include them. Two exports whose packed
     fields and effective viewport are unchanged but whose typography/substrate changed produce the same export-path key — the second export silently reuses the first's GeometryGroup (24-entry module cache,
     never cleared in production).
   • Failure scenario: parsed font, sdf-halftone, text fits the artboard. Export. Drag Text Offset Y (substrate rebuilds, preview updates). Export again → identical SVG geometry from the old position;
     readiness gate passes because readiness keys are computed independently and correctly.
   • Confidence: High (mechanism verified line-by-line; trigger requires the stale entry to survive eviction, which is the common case for quick tweak→re-export).
   • Recommended fix: pass typographyOutputKey/substrateOutputKey into the snapshot's static context (they exist at the call site) so export and preview share one key space — or bypass the module cache for
     snapshot generation (the snapshot is frozen anyway).

   C2 — Native-fallback substrate raster is anchored to the legacy 405 baseline, not the canonical placement.
   • Location: src/engine/substrate/rasterizeGlyphs.ts:64-76 reconstructs layout via textOffsetY: input.baselineY - TEXT_LAYOUT.baselineY; src/engine/constants.ts:15 (baselineY: 405); canonical formula at
     src/engine/sceneLayout.ts:185-190 + src/engine/textLayout.ts:47-49.
   • Why it matters: rasterized native text lands at effectiveHeight/2 + 0.41·fontSize + (input.baselineY − 405) instead of input.baselineY. Error = (effH − 720)/2 + 0.41·fontSize − 45 − (lines−1)·fontSize·
     lineHeight/2 ≈ +15.7px at factory defaults (fontSize 148), growing with font size, expansion, and line count. Right-aligned native text additionally shifts horizontally by the expansion amount. The SDF
     field detaches from the text shown by mask/ghost/overlay/export — in the app's default state (no uploaded font). Deterministic, so golden fixtures pin it instead of catching it.
   • Failure scenario: native fallback, sdf-contours, fontSize 300 → field sits ~78px below the text it supposedly derives from; export clips marks against the correctly-placed mask.
   • Confidence: High on the arithmetic; there is no test pinning absolute raster placement (tests/substrate.test.ts:126 checks only relative movement).
   • Recommended fix: rasterize at input.baselineY (+ lineIndex·lineAdvance) directly, or compute the reconstruction delta against canonicalBaselineAtAuthoredCenter, not the constant; delete the 405 anchor.

   C3 — typographyStageKey omits precision; glyph outlines go stale on precision-only change.
   • Location: src/engine/pipelineStageKeys.ts:16-31 vs src/engine/glyphLayout.ts:60 (path.toPathData(state.precision)).
   • Why it matters: changing precision 1→3 does not rebuild textGeometry; exported glyph paths, masks, and overlays keep old-precision d strings while serializeGeometry uses the new precision. Inconsistent
     artwork until some other typography input forces a rebuild.
   • Failure scenario: user lowers precision to shrink SVG, exports — glyph path data unchanged.
   • Confidence: High.
   • Recommended fix: add precision to typographyStageKey (and audit typographyInputKey in exportAuthority.ts:75-90, which also omits it).

   Medium findings

   M1 — Canvas backend + "current" frame export captures a frozen clock.
   • Location: src/App.tsx:271-274 uses context (the SVG clock, stopped when canvasFlowActive, App.tsx:118) instead of activeClockContext (App.tsx:225).
   • Why/scenario: flow renderer, Canvas Performance backend, exportFrameMode:"current" → export regenerates frame ≈0 while the user sees frame N. SVG backend is consistent.
   • Confidence: High. Fix: source capturedExportContext from activeClockContext.

   M2 — state in the static-context memo deps defeats the semantic key; field rebuilt per edit.
   • Location: src/App.tsx:236-249 (+ renderContextLifecycle.ts:54).
   • Why: any project change (incl. color-only) rebuilds buildCompositeWaveField — up to ~1M trig evaluations on the main thread for emitter-active field renderers. Confidence: High. Fix: key the memo on
     staticContextInputKey only.

   M3 — Animated renderer regenerates in up to three memo sites per change, uncached.
   • Location: src/hooks/useRendererRuntime.ts:30,48-72, src/engine/rendererRuntime.ts:160-165. project object in live deps; estimate runs even when cost-estimate debug is off. Fix: semantic-key the
     estimate/export variants; skip estimate when unused.

   M4 — No worker circuit breaker; crash/timeout re-bills every later request.
   • Location: src/engine/substrate/backends/cpuWorkerBackend.ts:153-157,279-341, fallback.ts:11-36. Scenario: worker dies mid-session → every substrate edit waits 8s, then pays a full main-thread rebuild
     (double compute, worker keeps burning CPU). Fix: mark dead on onerror/timeout, one recreate attempt, sticky cpu-main.

   M5 — Substrate input memo misses overscan-domain inputs.
   • Location: src/hooks/useSubstratePipeline.ts:21-62, src/engine/pipelineStageKeys.ts:69-81, src/engine/contourDomain.ts:83-86.
   • Scenario: fontSize>220, SDF/wave renderer, change amplitude → domain padding (contourSpread) stale; readiness can't catch it (key derives from the stale input). Edge-distance artifacts. Fix: include the
     domain-input fields in substrateProjectSliceKey (also covers the effectiveArtboard-identity relay fragility).

   M6 — Canvas preview effect rebuilds on every project change; live geometry computed-but-unused under canvas.
   • Location: src/components/CanvasFlowPreview.tsx:245, src/App.tsx:261-266, src/components/Viewport.tsx:324-337. Rebuilds backing store/Path2D clip and resets the clock per edit; App regenerates flow
     geometry per 300ms sample that nothing renders.

   M7 — Size settlement masks substrate failure.
   • Location: src/App.tsx:317-333. settling completes only when readiness is ready; on failure the interaction stays "settling" and the export button shows "Preparing export…" forever instead of the failure.
     Fix: let failed readiness complete/abort settlement.

   M8 — Production console.log leftovers.
   • Location: src/App.tsx:300 (every render, logs full keys), src/App.tsx:328, src/hooks/useSubstrateBackend.ts:100 (inside a state updater — double-logs under Strict Mode), :117. Remove or gate behind the
     trace flag.

   Low findings

   • L1: src/components/Viewport.tsx:165-176 — render-time ref mutation for regen flags; diagnostics-only, concurrent-unsafe.
   • L2: rendererRuntime.ts:178 — FIFO eviction, no LRU touch on hits.
   • L3: exportSvg.ts:79-88 — hardcoded version: 7 metadata shim for default artboards; metadata shape bifurcates by artboard.
   • L4: exportSvg.ts:78 — timestamp means exports are canon-deterministic, not byte-deterministic (managed via fixtures; document the contract).
   • L5: projectSchema.ts:201-202 — emitter customX/Y clamped to hardcoded 1200×720 on import.
   • L6: exportSvg.ts:188-195 — immediate revokeObjectURL after click (Safari download risk).
   • L7: App.tsx:387-402 — hand-maintained estimateExportKey field list; will silently rot as fields are added.
   • L8: Cross-environment raster antialiasing (worker OffscreenCanvas vs main canvas vs test canvas) can flip borderline SDF cells — pixel-level export differences between environments; golden fixtures pin
     only one environment. Inherent; document it.
   • L9: Graph executor has no production consumer (enforced by import-boundary tests) — fine today, but it is a future duplicate-authority risk if ever wired without reusing rendererRuntime key semantics.

   Things that should NOT be changed

   • The stage-key chain and resolveExportReadiness gate ordering (substrate-before-renderer, font-before-typography).
   • LatestOnlyScheduler semantics (coalesce-to-latest, terminal completions, dispose-on-reset).
   • Semantic substrate dedupe by input key (never object identity) and the worker self-test protocol.
   • resolveSceneLayout as the single pure scene authority (no document write-backs — the old auto-grow hook must not return).
   • Size draft/settle separation and per-renderer draft policy.
   • Device-independent safety budgets; seeded PRNG; assertVectorOnlySvg; canonicalized golden corpus with opt-in regeneration.
   • Lazy font engine boundary; import-boundary tests; runtime-only vs document state split.

   Suggested next passes

   • P0 (correctness): C1 (snapshot context keys), C2 (native raster authority), C3 (precision in typography keys) + the three corresponding tests; M1 clock source.
   • P1 (performance): ungate or remove the traceKey serialization in cpuWorkerBackend.compute; M2 static-context deps; M3 estimate gating; M6 canvas effect deps.
   • P2 (maintainability): M4 circuit breaker; M5 domain input keys; M7 settlement failure path; M8 log removal; L1 render-time ref write.
   • P3 (cleanup): L2–L7; document the canon-vs-byte determinism and cross-environment raster caveats.

   Overall health: good bones, two real fractures. The identity architecture is sound and — unusually for this stage — the tests actually pin the invariants that were fixed. The remaining bugs live exactly
   where the tests don't: the export-side reuse of the runtime cache, and the native-font rasterization path.
