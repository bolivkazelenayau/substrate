# Pipeline Gating — Pass 5 Final Report

**Date:** 2026-07-12  
**Baseline commit:** `c893c96` — *Add minimal production Size interaction controller (Pass 4)*  
**Pass 5 commits:** `f341b5e` (core wiring) + follow-up completion commit  
**Schema:** v8 (unchanged)

---

## 1. Initial HEAD and working-tree state

| Item | Value |
|------|-------|
| Pass 4 HEAD | `c893c96` — 9/9 Playwright gates green |
| Pass 5 start | Uncommitted working tree on `c893c96` |
| Pass 5 preserved | Size controller, scene layout authority, schema v8, golden fixtures |

**Final verification (completion pass):**

- `npm run lint` — pass (0 errors, 0 warnings after focused-deps cleanup)
- `npm run typecheck` / `typecheck:test` / `typecheck:e2e` — pass
- `npm run build` — pass (**444.12 kB** main, **135.15 kB** gzip)
- `npm run analyze` — pass
- `npm run build:e2e` — pass (**452.15 kB** main, **137.18 kB** gzip)
- `npm run check:reachability` — pass (**18** reviewed owners)
- Vitest full suite — **648 / 648** pass
- `CI=1 npm run test:e2e` — **15 / 15** pass (9 original + 6 invalidation gates)
- `git diff --check` (source/tests/e2e/scripts) — pass

---

## 2. E2E harness port-conflict cause and solution

**Cause:** `preview:e2e` defaulted to port **4173**. Orphaned `vite preview` processes from prior runs caused `EADDRINUSE`, which Playwright reported as a test-suite failure.

**Solution:** `scripts/runPlaywrightE2e.mjs`

- Probes **4173–4204** for a free port (`findFreePort` with retry)
- Spawns `preview:e2e` on the chosen port with `--strictPort`
- Sets `E2E_PREVIEW_PORT` and `E2E_MANAGED_PREVIEW=1` for Playwright
- `playwright.config.ts` disables `webServer` when managed preview is active
- Terminates preview with `SIGTERM` in `finally`
- Harness smoke asserts `__SUBSTRATE_E2E_BUILD__ === "e2e-trace"`

---

## 3. Renderer capability matrix

Derived from `rendererManifests` via `rendererRequirements.ts`:

| Renderer | Substrate | Static field | Glyph field | Animation time | Canvas preview |
|----------|-----------|--------------|-------------|----------------|----------------|
| flow | no | no | no | yes | yes |
| ripple | no | no | no | no | yes |
| dots | no | no | no | no | yes |
| sdf-flow | yes | no | no | no | no |
| sdf-streamlines | yes | yes | yes | no | no |
| sdf-contours | yes | yes | yes | no | no |
| sdf-halftone | yes | yes | yes | no | no |
| wave-contours | yes | yes | yes | no | no |
| glyph-diffuser | yes | yes | yes | no | no |

All renderers require typography + scene layout.

---

## 4. Requirement resolver

`resolveRendererRequirements(rendererId)` in `src/engine/rendererRequirements.ts`:

- Deterministic, pure, manifest-backed
- Production entry: `App.tsx` → `resolveRendererRequirements(state.renderer)`
- Traced via `tracePipelineRequirements()`

---

## 5. Stage ownership and dependency table

| Stage | Owner | Semantic key | Gated by |
|-------|-------|--------------|----------|
| Typography | `useTypographyGeometry` | `typographyStageKey` / `inputKey` | always (all renderers need text) |
| Scene layout | `useSceneLayout` | `sceneLayoutStageKey` | always |
| Substrate | `useSubstratePipeline` → `useSubstrateBackend` | `substrateStageKey` / `SUBSTRATE_NOT_REQUIRED_KEY` | `requirements.substrate` |
| Static field | `createStaticRenderContext` | `staticRenderContextStageKey` | `staticField` / `glyphField` |
| Live renderer | `useRendererRuntime` | `rendererGeometryStateKey` + time revision | renderer manifest |
| Export snapshot | `captureExportSnapshot` | export authority keys | manifest `usesSubstrate` |
| Presentation | Viewport / CanvasNavigation | camera, backend (not authoritative) | isolated from pipeline keys |

---

## 6–10. Key before/after and exclusions

### Typography key

- **Before:** whole `ProjectState` in `useMemo` deps
- **After:** focused `inputKey` from text, font, size, tracking, kerning, align, `textOffsetY`, artboard
- **Excluded:** camera, diagnostics, theme colors, preview backend, renderer appearance, debug toggles

### Scene key

- **Before:** whole `project` dep
- **After:** `sceneLayoutStageKey(project, textGeometry)`
- **Excluded:** camera, diagnostics, presentation backend

### Substrate key

- **Before:** unconditional scheduling for all renderers
- **After:** `substrateProjectSliceKey` + `SUBSTRATE_NOT_REQUIRED_KEY` when capability off
- **Excluded:** stroke styling, diagnostics, camera, SVG/Canvas backend, unrelated preset UI

### Renderer key

- **Before:** broad state-driven invalidation
- **After:** `rendererGeometryStateKey` + time revision for `usesTime` renderers only
- **Excluded:** camera, theme, diagnostics, export UI, presentation backend

### Static context key (new)

- `staticRenderContextStageKey(renderer, requirements, sceneKey, typographyOutput, substrateOutput)`

---

## 11. Inactive / not-required semantics

| State | Meaning |
|-------|---------|
| `substrate` phase `not-required` | Renderer manifest declares `usesSubstrate: false` |
| `outputKey: SUBSTRATE_NOT_REQUIRED_KEY` | Export/readiness must not wait for substrate |
| `pipeline.stage.skipped` | Stage not constructed for active capability |
| `pipeline.stage.invalidated` | In-flight work revoked (e.g. capability switch) |
| `pipeline.stage.reused` | Same semantic revision served from bounded live cache |

---

## 12. Unconditional stages removed

- Substrate worker scheduling for flow/ripple/dots
- Composite glyph field construction for non-field renderers
- Substrate data in static context when capability off

---

## 13. Duplicate live renderer paths removed

- `useRendererRuntime` ref cache keyed by `liveRevisionKey`
- Traces: `renderer.live.duplicatePrevented`, `pipeline.stage.reused`

---

## 14. Production callers of capability resolution

- `App.tsx` — requirements resolve + static context gating
- `useSubstratePipeline` / `useSubstrateBackend`
- `createStaticRenderContext` (App + `exportAuthority`)
- `exportAuthority.resolveExportReadiness` — manifest `usesSubstrate`

---

## 15. Reachability guard

18 reviewed owners including `rendererRequirements.ts`, `pipelineStageKeys.ts`, `pipelineTrace.ts`.

---

## 16. Export capability / readiness

- Non-substrate renderers: readiness does not wait for substrate (`SUBSTRATE_NOT_REQUIRED_KEY`)
- Substrate renderers: stale output rejected via existing revision checks
- Export snapshot uses gated static context

---

## 17. Test totals

| Suite | Result |
|-------|--------|
| Vitest (full) | **648 / 648** |
| Playwright E2E | **15 / 15** |
| Pipeline unit focus | 21 (requirements + stage keys + invalidation scenarios) |

---

## 18–24. Trace evidence (structural)

E2E gates prove:

| Scenario | Evidence |
|----------|----------|
| Flow Size commit (Gate A) | 1 fontSize patch, 0 substrate, renderer + export ready |
| Halftone Size commit (Gate B) | substrate.request > 0, renderer build |
| Halftone → Flow → Halftone (Gate C) | substrate skipped/invalidated on Flow; export ready without stale substrate.result |
| Diagnostics (Gate D) | 0 authoritative typography/scene/substrate/renderer builds |
| Backend switch (Gate E) | 0 authoritative builds, no ProjectState patch |
| Navigation (Gate F) | 0 authoritative builds, scene key unchanged |

Unit tests cover theme/diagnostics exclusion, ripple geometry-only change, flow export without substrate, renderer capability coverage.

**Note:** Live animation preview frames still emit `renderer.build` with `authority: "preview"` for timed renderers (Edge Current). Authoritative isolation gates filter to `static-or-authoritative` only.

---

## 25. Unchanged guarantees

- Visual output, presets, schema v8, scene authority, Size controller lifecycle
- Canvas lifecycle (no last-good-frame / double-buffer work)
- Golden export fixtures
- Deterministic Final Artwork export path

---

## 26. Deferred next passes

1. Canvas lifecycle cleanup
2. Dense renderer work budgets
3. SVG and diagnostics presentation performance
4. Remaining renderer-ID conditionals in Viewport/panels (presentation-only)
5. Full 12-scenario integration trace matrix with before/after numeric counts (Part S)

---

## E2E invalidation gates (Part R)

| Gate | Assertion summary |
|------|-------------------|
| A | Flow commit: zero substrate, export ready |
| B | Halftone commit: substrate requested |
| C | Halftone → Flow → Halftone: capability gating + stale substrate rejection |
| D | Diagnostics: zero authoritative builds |
| E | Backend switch: zero authoritative builds |
| F | Navigation: zero authoritative builds, scene key stable |

Original Gates 1–8 preserved unchanged.