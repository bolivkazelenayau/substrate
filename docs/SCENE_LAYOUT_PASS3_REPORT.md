# Scene Layout Authority — Pass 3 Final Report

**Date:** 2026-07-12  
**Baseline tag:** `truthful-baseline` (`a9998d4`)  
**Working-tree HEAD:** `a9998d4135d5f3944a5b49a8ecabf55d14380fca` (uncommitted Pass 3 work on top of baseline)  
**Schema:** v8 (unchanged)

---

## 1. Initial HEAD and working-tree state

| Item | Value |
|------|-------|
| HEAD | `a9998d4` — *Restore truthful repository baseline* |
| Pass 3 state | Large uncommitted working tree: scene resolver, E2E gates, InteractionTrace, 11 scene test files, golden fixture updates |
| InteractionTrace / Playwright | Present but uncommitted (`e2e/`, `src/dev/interactionTrace.ts`, `playwright.config.ts`) |
| Prior stable tag | `truthful-baseline` — lint, typecheck, Vitest, build, analyze, reachability, and E2E (Gate 7 expected-failure) |

**Verification commands run (final):**

- `npm run lint` — pass  
- `npm run typecheck` / `typecheck:test` / `typecheck:e2e` — pass  
- Vitest — **74 files / 621 tests** pass (batched sequential run; bare `npm test` OOMs on this machine)  
- `npm run build` — pass (433.98 kB main, 132.22 kB gzip)  
- `npm run analyze` — pass  
- `npm run check:reachability` — pass  
- `npm run test:e2e` — **9/9 pass** (~92s)

---

## 2. Old scene / artboard / placement ownership (before Pass 3)

| Field / concept | Old owner | Classification |
|-----------------|-----------|----------------|
| `project.artboard.width/height` | User input **and** auto-grown containment result | Mixed authored + derived (bug) |
| `textOffsetY` | User input **and** auto-repair after Size/geometry changes | Mixed + legacy automatic repair |
| Typography baseline | Hard-coded `TEXT_LAYOUT.baselineY` (405) | Legacy fixed baseline |
| Effective artboard | Persisted via `useAutoGrowArtboard` | Automatic document repair |
| Preview / export viewBox | Authored `0 0 width height` | Assumed zero origin |
| Scene identity | Partial keys (width/height only in places) | Incomplete |

**Automatic document writes removed:**

- `useAutoGrowArtboard` hook (deleted)  
- `src/engine/artboardExpansion.ts` (deleted)  
- Post-render artboard growth commits  
- Automatic `textOffsetY` repair on Size / typography / containment changes  
- Export waiting for auto-grow repair revision  

---

## 3. Every automatic persisted write removed

| Trigger | Old behavior | Pass 3 behavior |
|---------|--------------|-----------------|
| Size change | Could patch `artboard`, `textOffsetY` | Patches **`fontSize` only** |
| Typography geometry change | Could repair offset / artboard | **No ProjectState write** |
| Artboard containment | Grew persisted artboard | **Effective rect derived only** |
| Auto-grow debounce / pending transactions | Committed larger artboard | **Removed entirely** |
| Double-click Size reset | Could include hidden layout patches | **`fontSize` only** |

Confirmed by: `tests/sceneNoAutoWrites.test.ts`, Gate 7 `repairPatches` assertion (zero artboard/textOffsetY patches).

---

## 4. Final authored artboard type

```ts
type AuthoredArtboard = {
  width: number;
  height: number;
};
```

- Persisted in `ProjectState.artboard` (schema v8).  
- Always interpreted as the **authored minimum**; existing saved dimensions are taken exactly as stored (no shrink/repair on load).

---

## 5. Final effective `ArtboardRect` type

```ts
type ArtboardRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

- **Never persisted.**  
- Re-derived on every `resolveSceneLayout()` call.  
- Consumed by preview, renderers, substrate, diagnostics, and export.

---

## 6. Final canonical typography-placement rule

**Authority:** stable typography **layout box** (compositional), centered on the authored artboard center.

```
authoredCenterY = authoredArtboard.height / 2
canonicalBaseline = authoredCenterY + (1 - 1.18/2) * fontSize
                  = authoredCenterY + 0.41 * fontSize

resolvedBaseline = canonicalBaseline + textOffsetY
```

Horizontal placement follows the existing alignment contract (`left` / `center` / `right`); no new horizontal persisted offset field was added.

**Layout box height factor:** `fontSize * 1.18` (matches `glyphLayout.ts` / `textLayout.ts`).

---

## 7. Exact meaning of `textOffsetY`

- **User-authored vertical displacement delta** applied after canonical placement.  
- **Not** an auto-grow correction.  
- **Not** a cached baseline from a previous Size.  
- **Not** rewritten when Size, font, tracking, or layout changes.  
- **Not** rewritten to keep artwork inside the artboard.  
- Persisted in `ProjectState.textOffsetY`; unchanged across `148 → 540 → 148`.

---

## 8. Symmetric effective-artboard formula

Given padded authoritative artwork bounds and authored center:

```
halfWidth = max(
  authoredWidth / 2,
  authoredCenterX - paddedLeft,
  paddedRight - authoredCenterX,
)

halfHeight = max(
  authoredHeight / 2,
  authoredCenterY - paddedTop,
  paddedBottom - authoredCenterY,
)

effective.x = authoredCenterX - halfWidth   (rounded)
effective.y = authoredCenterY - halfHeight  (rounded)
effective.width  = halfWidth * 2              (rounded)
effective.height = halfHeight * 2             (rounded)
```

**Invariants:**

- Effective center equals authored center.  
- Effective size never below authored minimum.  
- Symmetric growth around authored center; may shrink back toward minimum when artwork fits.  
- Clamped against `ARTBOARD_LIMITS.max`; deterministic `roundSceneNumber()` (3 decimal places).

---

## 9. Parsed font and native fallback placement agreement

Both paths use the **same coordinate contract** via `resolveSceneLayout` + `getTextLayout` / `layoutGlyphs`:

- Same canonical baseline formula (authored center + factor).  
- Same `textOffsetY` semantics.  
- Ink/layout bounds accuracy may differ (parsed glyph union vs native approximate bounds).  
- Contract tests: `tests/sceneFontPlacementContract.test.ts`, updated `tests/glyphLayout.test.ts`.

---

## 10. Non-zero origin propagation (renderer families)

| Family | Mechanism |
|--------|-----------|
| **Flow / Ripple / Dots** | `contextArtboard(context)` effective rect; `resolveSimpleMarkBounds(state, artboard)` for large-type sampling |
| **SDF Flow / Halftone / Streamlines** | `artboardLeft/Right/Top/Bottom`, `worldToLocal` for cell indexing |
| **SDF Contours / Wave Contours** | Composite field `worldBounds` from effective viewport |
| **Glyph Diffuser** | Halo lattice clamped to `artboardLeft/Right/Top/Bottom` |

`RenderContext.viewport` carries full effective rect `(x, y, width, height)` from `createStaticRenderContext(..., sceneLayout.effectiveArtboard)`.

Tests: `tests/sceneNonZeroOriginRenderers.test.ts`.

---

## 11. Occupancy and sampling vs rect origin

**Rule:** index by local coordinates before cell lookup:

```
localX = worldX - rect.x
localY = worldY - rect.y
```

Implemented in `worldToLocal()`, `intersectArtboard()`, substrate raster mapping, SDF samplers, and contour domains. Diagnostics and export use the same effective rect.

---

## 12. Production runtime callers of `resolveSceneLayout`

| Caller | Role |
|--------|------|
| `src/hooks/useSceneLayout.ts` | Memoized production hook (`App.tsx`) |
| `src/App.tsx` | Authoritative pipeline: substrate, render context, export snapshot, Viewport |
| `src/components/Viewport.tsx` | Preview viewBox, stage data attributes, SVG/Canvas |
| `src/engine/renderContextLifecycle.ts` | Static render context + glyph field |
| `src/hooks/useSubstratePipeline.ts` | Substrate viewport input |
| `src/engine/exportSvg.ts` / `exportAuthority.ts` | Export viewBox + snapshot metadata |
| `src/engine/textLayout.ts` | Canonical baseline for native fallback |

---

## 13. Reachability-guard proof

```
Production reachability guard passed: 8 reviewed owners reachable; removed architecture island absent.
```

Reviewed modules reachable from `src/main.tsx`:

- `App.tsx`, `Viewport.tsx`, `CanvasNavigation.tsx`, `ArtworkTypographyPanels.tsx`  
- `sceneLayout.ts`, `useSceneLayout.ts`, `exportSvg.ts`, `renderers/index.ts`

Removed island confirmed absent: `useAutoGrowArtboard.ts`, `artboardExpansion.ts`, Size draft/settlement modules, etc.

---

## 14. ExportSnapshot and SVG viewBox changes

**ExportSnapshot** now includes immutable:

- `authoredArtboard`  
- `effectiveArtboard` (full rect)  
- `sceneLayoutKey`  
- `typographyPlacementKey`  

**SVG output:**

- `width` / `height` = effective width / height  
- `viewBox` = `effective.x effective.y effective.width effective.height`  
- When artwork fits authored minimum: `viewBox` remains `0 0 1200 720` for default projects  

Tests: `tests/sceneExportFoundations.test.ts`, `tests/scenePreviewExportEquality.test.ts`.

---

## 15. Unit / integration / E2E totals

| Suite | Result |
|-------|--------|
| Vitest files | **74 / 74** pass |
| Vitest tests | **621** pass |
| E2E tests | **9 / 9** pass |
| Scene-focused tests | 11 files under `tests/scene*.test.ts` |

**New scene test files:**

1. `sceneEffectiveArtboard.test.ts`  
2. `sceneTypographyPlacement.test.ts`  
3. `sceneFontPlacementContract.test.ts`  
4. `sceneSizeRoundTrip.test.ts`  
5. `sceneOffsetPreservation.test.ts`  
6. `sceneAuthoredMinimum.test.ts`  
7. `sceneV8Compatibility.test.ts`  
8. `sceneNonZeroOriginRenderers.test.ts`  
9. `scenePreviewExportEquality.test.ts`  
10. `sceneNoAutoWrites.test.ts`  
11. `sceneExportFoundations.test.ts`  

---

## 16. Gate 7 before / after evidence

### Before (expected failure — `docs/INTERACTION_TRACE_BASELINE.md`)

| Field | Initial | After 148→540→148 |
|-------|---------|-------------------|
| Authored artboard | 1200×720 | **3367×777** (mutated) |
| `textOffsetY` | 0 | **~43.88** (mutated) |
| Gate status | `test.fail` / expected failure | — |

### After (Pass 3 — normal pass)

| Assertion | Result |
|-----------|--------|
| `finalProject === initialProject` | Pass |
| `finalProject.artboard === initialProject.artboard` | Pass (1200×720) |
| `finalProject.textOffsetY === initialProject.textOffsetY` | Pass (0) |
| `finalRect === initialRect` | Pass |
| `finalViewBox === initialViewBox` | Pass |
| `finalSceneKey === initialSceneKey` | Pass |
| `finalRendererElements === initialRendererElements` | Pass |
| `repairPatches.length === 0` | Pass |
| Final Size | 148 |

**Gate 7 fix (E2E):** `beginScenario()` clears the trace buffer, so scene key / renderer count are read from viewport DOM attributes (`data-scene-layout-key`, `data-renderer-element-count`) with baseline captured before scenario start.

---

## 17. Gate 7 InteractionTrace — before / after counts

Baseline trace (pre-fix round trip, from `INTERACTION_TRACE_BASELINE.md`):

| Metric | Round-trip scenario |
|--------|---------------------|
| Raw input events | 32 |
| Project commits | 18 |
| Typography builds | 18 |
| Substrate requests | 4 |
| Renderer builds | 80 |
| React commits | 22 |
| Canvas clear / resize / draw / present | 18 / 18 / 18 / 18 |
| Blank frames | 0 |
| **Automatic artboard writes** | **Present (defect)** |
| **Automatic textOffsetY writes** | **Present (defect)** |

Pass 3 semantic improvement:

- Automatic artboard writes: **zero** (Gate 7 `repairPatches` assertion)  
- Automatic `textOffsetY` writes: **zero**  
- No second repair revision after typography settles  

Raw input / per-input commit counts unchanged (Size still commits on every input — out of scope for this pass).

---

## 18. Changed golden fixtures (individual review)

All six native export summaries updated via `UPDATE_EXPORT_FIXTURES=1`. **viewBox unchanged** (`0 0 1200 720`) for fixtures that fit authored minimum; **canonicalHash** changed due to canonical typography placement (baseline 420.68 vs legacy 405) and effective-rect-aware renderer sampling.

| Fixture | Old hash (prefix) | New hash (prefix) | Reason |
|---------|-------------------|-------------------|--------|
| `edge-current-native` | `79922bf4…` | `f95c797b…` | Flow line positions shift with canonical vertical placement |
| `dot-field-native` | `a4a8faa7…` | `54b95da5…` | Dot sampling uses effective rect origin |
| `sdf-contours-native` | `5d32db13…` | `e2d8f350…` | Contour domain aligned to effective viewport |
| `sdf-halftone-native` | `38b4865a…` | `f0d30a26…` | Halftone sampling within shifted rect |
| `wave-contours-native` | `28f81ae6…` | `23be3b80…` | Wave field world bounds from effective rect |
| `glyph-diffuser-native` | `70b879d3…` | `0b1a8f78…` | Diffuser lattice uses artboardLeft/Right/Top/Bottom |

Element counts unchanged (e.g. edge-current: 800 paths). No wholesale golden regeneration.

---

## 19. Unchanged by design

| Area | Status |
|------|--------|
| Project schema | v8 |
| Size gesture scheduling | Per-input commits retained; no draft controller |
| Canvas lifecycle | No double buffering / last-good frame |
| Renderer algorithms & presets | Unchanged |
| Deterministic safety budgets | Unchanged |
| Vector-only Final Artwork export | Unchanged |
| InteractionTrace stage boundaries | Unchanged (plus `scene.layout` span in `useSceneLayout`) |

---

## 20. Deferred next pass

1. Minimal Size draft controller (runtime-only draft, one-commit-on-release)  
2. Capability / invalidation gating optimization  
3. Canvas lifecycle cleanup  
4. Dense renderer work budgets  
5. SVG / diagnostics performance  

---

## E2E gate summary (final run)

| Gate | Status | Duration (approx.) |
|------|--------|-------------------|
| Harness smoke | ✓ | 7.8s |
| Gate 1 — Ripple Size drag | ✓ | 7.8s |
| Gate 2 — Halftone Size drag | ✓ | 7.1s |
| Gate 3 — Second drag wins | ✓ | 7.3s |
| Gate 4 — Double-click reset | ✓ | 6.3s |
| Gate 5 — SVG/Canvas parity | ✓ | 5.5s |
| Gate 6 — Canvas no blank frame | ✓ | 5.7s |
| **Gate 7 — 148→540→148** | **✓** | **5.7s** |
| Gate 8 — Navigation smoke | ✓ | 4.3s |

**Total: 9 passed (~1.0m)**

---

## Key files added / removed

**Added:** `src/engine/sceneLayout.ts`, `src/hooks/useSceneLayout.ts`, `tests/scene*.test.ts`, `tests/utils/sceneLayoutHarness.ts`, E2E suite  

**Removed:** `src/hooks/useAutoGrowArtboard.ts`, `src/engine/artboardExpansion.ts`, related dead tests  

**Viewport E2E attributes:** `data-scene-layout-key`, `data-artboard-effective-width/height`, `data-renderer-element-count`

---

## Running tests on memory-constrained hosts

Bare `npm test` may OOM. Use batched sequential Vitest:

```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
Get-ChildItem tests\*.test.ts | Sort-Object Name | ForEach-Object {
  npx vitest run --maxWorkers=1 --pool=threads --no-file-parallelism $_.FullName
}
```

E2E: `npm run test:e2e`