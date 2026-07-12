# Interaction Trace Baseline

## Audit context

- Audited commit: `a9998d4` (`truthful-baseline`), branch `master`.
- Audited on 2026-07-12 with Playwright `1.61.1` and Chromium `149.0.7827.55`.
- E2E artifact: `vite build --mode e2e`, served with Vite preview on `127.0.0.1:4173`.
- Browser context: Chromium, viewport `1440×1000`, DPR `1`, locale `en-US`, timezone `UTC`.
- Native fallback typography was active. The checked-in `tests/fixtures/Basic-Regular.ttf` remains available as the OFL fixture; no new font was added.
- The normal production build does not expose `window.__SUBSTRATE_TRACE__` and contains no active trace API/stage strings.

## Trace contract

`src/dev/interactionTrace.ts` owns one passive, E2E/dev-only stream:

```ts
type InteractionTraceEvent = {
  sequence: number;
  traceId: string;
  gestureId?: number;
  stage: string;
  phase: "instant" | "start" | "end";
  inputKey?: string;
  outputKey?: string;
  documentKey?: string;
  frameKey?: string;
  timestampMs: number;
  durationMs?: number;
  counts?: Record<string, number>;
  bytes?: Record<string, number>;
  detail?: Record<string, string | number | boolean | null>;
};
```

The buffer is a 4,000-event ring. Sequence numbers are monotonic, snapshots clone nested fields, spans pair `start`/`end`, and safe serialization handles circular values, `bigint`, non-finite numbers, and `Error`. The E2E-only API is `reset`, `snapshot`, `beginScenario`, `endScenario`, and `getSummary`. Final runs reported zero dropped events.

## Gate status

| Gate | Result | Evidence |
| --- | --- | --- |
| Harness smoke | Pass | API exists in the E2E build; native pointerdown/input events reached the trace. |
| 1. Ripple Size drag | Pass | Final committed Size `300`; 64 raw native input events; 34 project commits; 34 typography builds; 82 renderer builds; control remained enabled. |
| 2. Halftone Size drag | Pass | Final committed Size `520`; 64 raw input events; 34 project commits; 5 substrate requests; 78 renderer builds; React commit evidence present; no fallback frame assertion failed. |
| 3. Second drag supersession | Pass | Two gestures; 64 raw input events; final Size matched the second release; no later first-gesture result won. |
| 4. Double-click reset | Pass | Exactly one reset event; canonical default `148`; reset patch included `fontSize`; later drag committed `220`. |
| 5. Flow SVG/Canvas parity | Pass | Shared frame key `flow-lines`; SVG and Canvas screenshots were non-empty; Canvas backing state was observed. |
| 6. Canvas no blank frame | Pass | 9 clear, 9 resize, 9 draw, and 9 present events; page-side probe recorded `0` all-background frames. |
| 7. `148 → 540 → 148` round trip | Expected failure | Confirmed current auto-grow defect: final artboard `3367×777` vs initial `1200×720`; final `textOffsetY` `43.87999999999994` vs `0`. The assertion remains active inside Playwright's explicit expected-failure annotation. |
| 8. Zoom/pan smoke | Pass | 2 wheel events, 10 coalesced navigation commits, 8 pointer moves, no project patch, and no renderer rebuild caused by camera movement; Canvas backing dimensions were observed at DPR 1. |

The final `npm run test:e2e` completed successfully with 9 tests: 8 passing and Gate 7 failing only in its declared expected-failure state. No `.skip`, `.todo`, infrastructure expectation, or broad failure-hiding retry was used for the gate result.

## Final-run normalized measurements

The values below are application trace measurements, not Playwright action wall time.

| Scenario | Raw input | Project commits | Typography | Substrate requests | Renderer builds | React commits | Canvas clear/resize/draw/present | Blank frames | Release → exact visible (ms) | Exact visible → export ready (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| Ripple | 64 | 34 | 34 | 6 | 76 | 38 | 0 / 0 / 0 / 0 | 0 | 115.2 | 0.0 |
| Halftone | 64 | 34 | 34 | 3 | 74 | 37 | 0 / 0 / 0 / 0 | 0 | 576.5 | 0.1 |
| Second drag | 64 | 36 | 36 | 9 | 90 | 45 | 0 / 0 / 0 / 0 | 0 | 900.4 | 0.0 |
| Double-click reset | 18 | 10 | 10 | 4 | 26 | 13 | 0 / 0 / 0 / 0 | 0 | 687.5 | 0.0 |
| Flow parity | 0 | 0 | 0 | 0 | 4 | 2 | 1 / 1 / 1 / 1 | 0 | n/a | n/a |
| Canvas update | 16 | 14 | 14 | 7 | 62 | 20 | 14 / 14 / 14 / 14 | 0 | 19.4 | 0.0 |
| Round trip | 32 | 18 | 18 | 4 | 80 | 22 | 18 / 18 / 18 / 18 | 0 | 561.5 | 0.0 |
| Navigation | 0 | 0 | 0 | 0 | 3 | 1 | 1 / 1 / 1 / 1 | 0 | n/a | n/a |

Trace timing is measured with `performance.now()`. Playwright scenario durations are separate harness wall time and are not presented as renderer or worker time. React Profiler callbacks are retained around the control pane and artwork/Viewport subtree; the production React build did not expose actual/base Profiler durations, so the E2E trace records a narrow commit-observer count with those durations explicitly unavailable.

## Instrumented runtime stages

- Native Size pointerdown, pointerup, lost pointer capture, blur, double-click reset, raw input/change values, and gesture IDs.
- Project patch fields, document keys, revision counters, Size/artboard before/after values, and per-gesture commit counts.
- Typography build start/end, parsed-font/native-fallback path, glyph count, and bounds.
- Artboard expansion plan and document-write decisions, including requested bounds, artboard, and `textOffsetY`.
- Substrate request, scheduler active/pending/coalesced/stale state, worker compute, result dimensions, raster cells, and planned resident bytes.
- Static field context creation.
- Renderer runtime live/export/estimate calls plus renderer generation, cache, geometry counts, and clipping summaries.
- React commit observations and scoped Profiler callbacks.
- SVG lifecycle, geometry-group updates, SVG element/path counts, viewBox, and presented frame key.
- Canvas lifecycle, backing resize, CSS size, DPR, clear, draw, present, visibility, frame key, and failed-context path.
- Preview backend switches and navigation wheel/pointer/commit activity.
- Export readiness, exact-visible, snapshot capture, serialization, and ready events.
- Optional long-task, navigation/paint, and approximate memory entries where supported.

## Browser and bundle results

- Normal production build: `433.04 kB` JS / `131.65 kB` gzip; baseline: `422.44 kB` / `128.32 kB` gzip. Delta: `+10.60 kB` / `+3.33 kB` gzip.
- E2E trace build: `438.12 kB` JS / `133.17 kB` gzip. The additional E2E-only trace behavior is not active in the normal artifact.
- E2E page probe sampled 25 pixels per observed Canvas frame. It is a lightweight blank-frame observation, not a full bitmap diff.
- `performance.memory` is approximate and was not required for any gate assertion. Long-task entries are browser-dependent.

## Verification totals

- ESLint: pass, zero errors and warnings.
- Source/test/E2E typechecks: pass.
- Vitest: 66 files, 599 tests passed.
- Normal build and analyze: pass.
- E2E build: pass.
- Chromium E2E: 9 tests completed successfully; 8 pass and 1 explicit expected failure.
- Production reachability guard: pass.
- `git diff --check`: pass.
- Golden fixtures and existing renderer/export tests were unchanged.

## Scope preserved and deferred fixes

No renderer algorithms, ProjectState schema, ExportSnapshot, Final Artwork SVG serialization, presets, substrate scheduling policy, Canvas clearing/resizing behavior, or golden fixtures were intentionally changed. Deferred product fixes remain:

- scene/placement authority;
- minimal Size controller;
- Canvas continuity;
- capability/invalidation gating;
- dense renderer work budgets;
- SVG/diagnostics presentation.
