# SUBSTRATE Worker Backend QA

App version: `0.11.0`  
Operating system: Windows  
Worker timeout: `8,000 ms`  
Date: 2026-06-28

## Browser matrix

| Browser | Status | Worker result | Notes |
| --- | --- | --- | --- |
| Codex in-app Chromium | Tested after fix | `cpu-worker` ready | Diagnostics reached `CPU-WORKER`, `READY`, `SUPPORT SUPPORTED`; fallback was absent and no console warnings/errors were recorded. |
| Chrome | Manually confirmed | `cpu-worker` ready | The user confirmed standalone Chrome now reports `CPU-WORKER`, `READY`, `SUPPORT SUPPORTED`, and no fallback. |
| Firefox | Not tested | Not tested | Firefox was not available in the current environment. |
| Safari | Not tested | Not tested | Safari was not available on Windows. |
| Edge | Not tested | Not tested | Edge was not exposed through the available browser-control backend. |

Successful real-browser `cpu-worker` builds are now recorded in the Codex Chromium surface and manually confirmed in standalone Chrome.

## Strict Mode startup regression and fix

Before the fix, standalone Chrome passed a direct console capability probe:

- `typeof Worker === "function"`
- `typeof OffscreenCanvas === "function"`
- `typeof Path2D === "function"`
- A blob-backed module worker constructed and returned a message

SUBSTRATE nevertheless reported `WORKER-UNAVAILABLE`. The worker URL was already correct: `cpuWorkerBackend.ts` is in `substrate/backends`, while `substrate.worker.ts` is one directory above, so Vite's static construction pattern is:

```ts
new Worker(new URL("../substrate.worker.ts", import.meta.url), {
  type: "module",
});
```

The root cause was React Strict Mode's development effect rehearsal. `useSubstrateBackend` stored one backend instance in state, but its cleanup immediately disposed that worker. Strict Mode then reran setup with the same permanently disposed backend. Disposal is now delayed by one task and cancelled by the rehearsal setup; genuine unmount still terminates the worker.

Startup now has a separate typed `ping` / `pong` probe before the substrate self-test. Constructor, startup timeout, self-test, runtime crash, and build failures retain distinct codes and messages. Constructor diagnostics include the resolved URL, exception name/message/stack, and main-thread API `typeof` values.

## Post-fix Chromium results

| Check | Result | Evidence / notes |
| --- | --- | --- |
| App loads | Pass | UI and preview loaded without console warnings/errors. |
| `cpu-worker` selected by default | Pass | Active backend reported `CPU-WORKER`. |
| Worker startup probe | Pass | Module worker received `ping` and returned `pong`. |
| Worker self-test | Pass | `SUPPORT SUPPORTED`. |
| Backend diagnostics | Pass | `CPU-WORKER`, `READY`, request ID, worker/main/round-trip timing, and no fallback. |
| Native-text substrate | Pass | Default 384 × 230 native fallback text substrate built through `cpu-worker`. |
| Timing | Pass | Total 157.8 ms; worker compute 38.4 ms; main/coordination 119.4 ms; round trip 157.8 ms. |
| Console errors/warnings | Pass | None observed after a fresh load. |

The earlier v0.11 fallback run also covered rapid text/quality changes, Low/Medium/High/Ultra, all four SDF renderers, mask/edge/distance/gradient debug views, and vector-only SVG export through `cpu-main`. Those fallback results remain valid, but were not repeated in full during this focused startup repair.

Font upload through the worker remains not manually tested because the available browser-control surface did not expose a supported file upload operation.

## Manual standalone Chrome procedure

1. Start the app with `npm run dev`.
2. Reload the page so the repaired worker lifecycle is active.
3. Confirm backend diagnostics show:
   - `CPU-WORKER`
   - `READY`
   - `SUPPORT SUPPORTED`
   - no fallback row
4. Confirm no worker constructor/startup errors are logged.
5. Select Low, Medium, High, and Ultra; record worker compute and round-trip times.
6. Enter text rapidly and confirm only the final request commits.
7. Change quality rapidly and confirm only the final quality commits.
8. Upload `tests/fixtures/Basic-Regular.ttf`; confirm `glyph-paths`.
9. Clear the font; confirm `native-text-fallback`.
10. Check SDF Flow, Streamlines, Contours, and Halftone.
11. Check mask, edge, distance, and gradient debug views.
12. Export Final Artwork and confirm XML parses, no `<image>` exists, and generated artwork remains clipped.

## Automated startup/fallback coverage

- Worker constructor exception name/message and resolved URL preservation.
- Successful ping/pong before the full self-test.
- Self-test timeout is not classified as constructor unavailability.
- Worker runtime crash is not classified as constructor unavailability.
- Explicit constructor/self-test/build/runtime failure categories.
- Timed-out response rejection and stale late-response protection.
- Precise `cpu-main` fallback reason.
- Vector-only SVG export from fallback substrate.

Manual timeout simulation remains deferred because the production UI intentionally has no fake worker-delay control.
