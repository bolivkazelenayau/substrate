# Size Interaction Controller — Pass 4 Final Report

**Date:** 2026-07-12  
**Commit:** `a7f6d8f` — *Add minimal production Size interaction controller (Pass 4)*  
**Parent commit:** `855d89a` — *Establish scene layout authority* (Pass 3)  
**Schema:** v8 (unchanged)

---

## 1. Initial HEAD and working-tree state

| Item | Value |
|------|-------|
| HEAD (Pass 3) | `855d89a` — scene layout authority committed |
| Pass 4 state | Uncommitted working tree on top of `855d89a` |
| Pass 3 preserved | `sceneLayout.ts`, `useSceneLayout.ts`, Gate 7 round-trip semantics unchanged |

**Verification commands run (final):**

- `npm run typecheck` / `typecheck:test` / `typecheck:e2e` — pass  
- Targeted ESLint on Pass 4 source files — pass (0 errors)  
- `npm run build` — pass (**441.49 kB** main, **134.42 kB** gzip)  
- `npm run analyze` — pass  
- `npm run check:reachability` — pass (**15** reviewed owners)  
- `git diff --check` (e2e/src/scripts/tests) — pass (no whitespace errors)  
- Vitest (Pass 4 + updated suites) — **37 / 37** pass in focused batch  
- `npm run test:e2e` — **9 / 9 pass** (~1.1m, `CI=1` fresh preview)

**Bundle delta vs Pass 3:** +7.51 kB main (+2.20 kB gzip). E2E bundle: 448.82 kB / 136.20 kB gzip.

---

## 2. Old Size lifecycle (before Pass 4)

| Stage | Old behavior |
|-------|----------------|
| Native `input` | Immediate `patch({ fontSize })` per event |
| Typography | Rebuild on every input |
| Substrate | Re-request on every input |
| Renderer | Authoritative `renderer.build` on every input |
| React / Canvas | Full artwork commit cycle per input |
| Export | Followed every intermediate Size |

**Measured baseline (Pass 3, `INTERACTION_TRACE_BASELINE.md`):**

| Scenario | Raw inputs | Project commits | Typography builds | Renderer builds |
|----------|------------|-----------------|-------------------|-----------------|
| Ripple drag | 64 | 34 | 34 | 76 |
| Halftone drag | 64 | 34 | 34 | 74 |
| Round trip | 32 | 18 | 18 | 80 |

---

## 3. Size lifecycle table (after Pass 4)

| Event | Controller phase | ProjectState | Authoritative pipeline | Preview |
|-------|------------------|--------------|------------------------|---------|
| `pointerdown` | `dragging` | unchanged | none | draft begins |
| native `input` | `dragging` | unchanged | none | rAF-coalesced draft |
| rAF tick | `dragging` | unchanged | none | `size.draft.frame` |
| `pointerup` / capture loss / `blur` | → `settling` | **one** `{ fontSize }` commit | rebuild starts | retained or draft until exact |
| Authoritative ready | → `idle` | committed Size | exact geometry | `size.exact.visible` |
| New `pointerdown` while settling | `dragging` (supersedes) | prior commit stands; new gesture owns presentation | newest gesture wins | new draft |
| Keyboard down/up | gesture path | one commit on keyup | same as pointer | same |
| Double-click reset | settling or idle | one `{ fontSize: 148 }` | rebuild | Gate 4 path |

---

## 4. Controller type and ownership

```ts
type SizeInteractionState =
  | { phase: "idle"; presentedSize: number }
  | { phase: "dragging"; gestureId: number; baseSize: number; draftSize: number; draftPolicy: SizeDraftPolicy }
  | { phase: "settling"; gestureId: number; committedSize: number };
```

**Hook:** `src/hooks/useSizeInteraction.ts`

**Runtime refs only:** gesture sequence, active gesture id, finished-gesture set, latest raw Size, pending rAF id, synchronous `phaseRef` (required for test/E2E commit timing).

**Not retained:** copied document keys, substrate/renderer keys, frozen snapshots, separate pointer/blur state machines, overlapping readiness booleans.

---

## 5. Production `fontSize` write path

| Caller | Role |
|--------|------|
| `App.tsx` `commitFontSize` | **Sole production `{ fontSize }` patch** |
| `useSizeInteraction` `finishGesture` | Invokes `onCommit` once per gesture |
| `useSizeInteraction` keyboard `change` | Single commit on keyboard completion |
| `useSizeInteraction` `onDoubleClickReset` | Direct `onCommit(148)` (parallel to `finishGesture` for active drag cleanup) |

`ArtworkTypographyPanels.tsx` / `FieldControls.tsx` no longer call `patch({ fontSize })` on every `input`.

---

## 6. Draft scene input

**Module:** `src/engine/sizeDraftScene.ts`

Ephemeral draft uses production `resolveSceneLayout` with `{ ...committedState, fontSize: draftFontSize }`. Same font resource, canonical placement, authored artboard, and `textOffsetY`. Never persisted, exported, or scheduled to substrate.

---

## 7. Draft preview policy

**Module:** `src/engine/sizeRendererDraftPolicy.ts`

| Policy | Renderers | During drag |
|--------|-----------|-------------|
| `renderer-aware` | Flow, Ripple, Dot Field | `renderer.draft` via `sizeDraftRenderer.ts` (max 250 nodes) |
| `retained-transform` | Halftone, Streamlines, Contours, Wave, Glyph Diffuser, … | Scale last exact geometry (`sizeDraftPreview.ts`, cap 500 elements) |

No substrate requests during drag. No authoritative `renderer.build` during drag (Gate 1 assertion).

---

## 8. Draft transform contract

**Module:** `src/engine/sizeSceneTransform.ts`

Scale around authored artboard center derived from source/target resolved scenes. `148 → 540 → 148` round-trips without drift (`tests/sizeInteraction.test.ts`).

---

## 9. Presentation authority

**Module:** `src/engine/sizePresentation.ts`

| Phase | Presentation kind |
|-------|-------------------|
| `idle` | `exact` |
| `dragging` | `draft` (policy from renderer) |
| `settling` + authoritative not ready | `retained` |
| `settling` + authoritative ready | `exact` → `completeSettlement()` → `idle` |

**Viewport** (`data-size-interaction-phase`, `data-size-presentation-kind`) traces `presentation.draft` and `size.draft.present`.

---

## 10. Export gating

**Module:** `src/engine/exportAuthority.ts`

New status: `size-interaction-pending` while phase is not `idle`. Export button disabled during drag/settling until authoritative pipeline matches committed Size and `baseExportReadiness` is satisfied.

---

## 11. InteractionTrace stages added

| Stage | When |
|-------|------|
| `size.gesture.start` | pointer/keyboard gesture begins |
| `size.input.raw` | every native input |
| `size.draft.raf` / `size.draft.frame` | coalesced draft publish |
| `size.gesture.finish.*` | idempotent finish path |
| `size.interaction.commit` | focused fontSize commit |
| `size.settling.start` | post-commit settlement |
| `size.exact.visible` / `size.idle` | authoritative presentation current |
| `renderer.draft` | lightweight renderer-aware preview |
| `presentation.draft` / `size.draft.present` | Viewport draft swap |

Legacy `native.size.*` stages preserved for baseline comparison.

**Deferred trace:** explicit `scene.draft` stage (draft scene uses production resolver inline; no separate trace span).

---

## 12. Production wiring and reachability

```
Production reachability guard passed: 15 reviewed owners reachable; removed architecture island absent.
```

**Added to reviewed list:** `useSizeInteraction.ts`, `sizeDraftScene.ts`, `sizeSceneTransform.ts`, `sizeDraftPreview.ts`, `sizePresentation.ts`, `sizeRendererDraftPolicy.ts`, `sizeDraftRenderer.ts`

**Removed island still absent:** `useTypographySizeDraft.ts`, `sizeSettlement.ts`, `draftRendererPreview.ts`, etc.

---

## 13. Unit / integration tests

| File | Tests | Focus |
|------|-------|-------|
| `tests/sizeInteraction.test.ts` | 8 | policy, transform, draft scene, hook lifecycle, commits |
| `tests/helpers/idleSizeInteraction.ts` | — | test harness |
| Updated: `controls.test.ts`, `appearancePreview.test.ts`, `viewportHud.test.ts`, `sceneNoAutoWrites.test.ts` | — | size handlers, no per-input patch |

**Vitest file count:** 75 (was 74 in Pass 3).

---

## 14. Gate 1 / Gate 2 trace improvement (structural)

| Metric | Pass 3 (Ripple drag) | Pass 4 (Ripple drag) |
|--------|----------------------|----------------------|
| Raw native inputs | ~64 | ≥4 (many) |
| Project commits | ~34 | **1** |
| `project.patch` during drag | many | **0** |
| Typography builds during drag | many | **0** |
| Substrate requests during drag | some | **0** |
| `renderer.build` during drag | many | **0** |
| `renderer.draft` during drag | 0 | **>0** |
| `size.draft.frame` | 0 | **>0** |

Halftone (Gate 2): same zero-during-drag contract; post-release authoritative substrate/renderer builds unchanged.

---

## 15. E2E gate summary

| Gate | Status | New / strengthened assertions |
|------|--------|------------------------------|
| Harness smoke | ✓ | — |
| Gate 1 — Ripple | ✓ | zero authoritative work during drag; `renderer.draft` |
| Gate 2 — Halftone | ✓ | zero authoritative work during drag |
| Gate 3 — second drag wins | ✓ | 2 commits total |
| Gate 4 — double-click reset | ✓ | — |
| Gate 5 — SVG/Canvas parity | ✓ | — |
| Gate 6 — Canvas no blank | ✓ | — |
| Gate 7 — round trip | ✓ | **2 gesture starts, 2 fontSize patches, 2 interaction commits** |
| Gate 8 — navigation | ✓ | **navigate during Size settlement window** (trace timestamps) |

**Total: 9 tests**

---

## 16. Gate 7 one-commit-per-gesture evidence

Round trip `148 → 540 → 148`:

- `sizeGestureStarts` = 2  
- `fontSizePatches` = 2  
- `size.interaction.commit` = 2  
- `repairPatches` = 0 (no artboard / `textOffsetY` writes)  
- DOM `data-scene-layout-key` and effective rect match baseline  

`sceneLayoutKeyFromTrace` reads the last `scene.layout` event **with** `outputKey` (end-phase events without keys are skipped).

---

## 17. Gate 8 settling + navigation evidence

After Size drag to 320:

- `size.settling.start` present  
- `navigation.wheel` timestamps fall within settlement window (before `size.idle` settled)  
- `artboard` / `textOffsetY` unchanged; `fontSize` = 320  
- Subsequent zoom/pan smoke unchanged  

---

## 18. Performance budgets (Part O)

**Not instrumented in this pass.** Draft frame duration is traced (`size.draft.raf` `durationMs`) but 12 ms / 25 ms CPU gates are not enforced. Deferred.

---

## 19. Unchanged by design

| Area | Status |
|------|--------|
| Scene semantics (`resolveSceneLayout`) | unchanged |
| Authored / effective artboard contract | unchanged |
| Schema v8 | unchanged |
| Renderer algorithms & presets | unchanged |
| Substrate worker cancellation | unchanged |
| Canvas double-buffer infrastructure | unchanged |
| Vector-only Final Artwork export | unchanged |
| Golden export fixtures | unchanged (no regeneration) |

---

## 20. Known follow-ups

1. Unify double-click reset through single `finishGesture` path (Gate 4 passes via parallel commit path).  
2. Explicit `scene.draft` trace span.  
3. Draft CPU budget enforcement (12 ms / 25 ms).  
4. Full Vitest batch count on memory-constrained hosts (`npm test` may OOM; use batched script from Pass 3 report).  
5. `npm run lint` on entire tree is slow on this machine; Pass 4 sources lint clean.

---

## 21. Deferred next pass

1. Capability / invalidation gating optimization  
2. Canvas lifecycle / last-good frame infrastructure  
3. Dense renderer work budgets  
4. SVG batching / diagnostics performance  
5. Backend auto-selection  

---

## Key files added / modified

**Added:** `src/hooks/useSizeInteraction.ts`, `src/engine/sizeDraft*.ts`, `src/engine/sizePresentation.ts`, `src/engine/sizeSceneTransform.ts`, `src/engine/sizeRendererDraftPolicy.ts`, `tests/sizeInteraction.test.ts`, `tests/helpers/idleSizeInteraction.ts`, `docs/SIZE_INTERACTION_PASS4_REPORT.md`

**Modified:** `src/App.tsx`, `src/components/Viewport.tsx`, `src/components/CanvasFlowPreview.tsx`, `src/components/panels/ArtworkTypographyPanels.tsx`, `src/components/panels/FieldControls.tsx`, `src/engine/exportAuthority.ts`, `e2e/size-preview.gates.spec.ts`, `scripts/checkProductionReachability.mjs`, updated unit tests

**Viewport E2E attributes (new):** `data-size-interaction-phase`, `data-size-presentation-kind`, `data-size-draft-active`

---

## Running tests on memory-constrained hosts

```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
Get-ChildItem tests\*.test.ts | Sort-Object Name | ForEach-Object {
  npx vitest run --maxWorkers=1 --pool=threads --no-file-parallelism $_.FullName
}
```

E2E: `npm run test:e2e` (ensure port `4173` is free or set `CI=1` for a fresh preview server).