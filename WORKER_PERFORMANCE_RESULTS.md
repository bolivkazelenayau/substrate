# SUBSTRATE Worker Performance Results

App version: `0.11.0`  
Date: 2026-06-28  
Operating system: Windows  
Backend: `cpu-worker`  
Fallback during normal runs: none

## Test context

Standalone Chrome was independently confirmed by the user to report:

```text
CPU-WORKER
READY
SUPPORT SUPPORTED
FALLBACK NO
```

The timing matrix below was captured in the controlled Codex Chromium surface against the Vite development server. Both are Chromium-based, but these numbers should not be treated as a substitute for a repeatable standalone Chrome benchmark.

Each row is one observed build after selecting the quality. These are practical QA timings, not statistically rigorous medians. Browser warm-up, JIT compilation, garbage collection, dev-server overhead, and overlapping UI work explain some non-monotonic results, particularly the first Low run and coordination spikes.

Debug views were disabled while each substrate build was timed. Mask, edge, and distance views were then enabled without rebuilding the substrate, allowing their main-thread debug-image generation cost to be measured separately.

## Native text fallback

Source text: `SUBSTRATE`  
Substrate type: `native-text-fallback`

| Quality | Resolution | Total | Worker | Main / coordination | Round trip | Raster | Edge map | Distance field | Build | Debug mask | Debug edge | Debug distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 256 × 154 | 209.5 ms | 84.0 ms | 125.5 ms | 209.5 ms | 6.3 ms | 45.1 ms | 24.0 ms | 83.8 ms | 63.4 ms | 41.0 ms | 13.2 ms |
| Medium | 384 × 230 | 58.0 ms | 43.6 ms | 14.4 ms | 58.0 ms | 4.7 ms | 21.7 ms | 14.9 ms | 43.6 ms | 62.7 ms | 59.1 ms | 52.5 ms |
| High | 512 × 307 | 104.2 ms | 64.8 ms | 39.4 ms | 104.2 ms | 4.7 ms | 33.3 ms | 22.0 ms | 64.7 ms | 46.8 ms | 117.8 ms | 26.5 ms |
| Ultra | 768 × 461 | 71.1 ms | 64.2 ms | 6.9 ms | 71.1 ms | 16.1 ms | 20.9 ms | 12.5 ms | 64.1 ms | 20.1 ms | 167.9 ms | 30.1 ms |

## Parsed Basic-Regular.ttf

Source text: `SUBSTRATE`  
Font fixture: `tests/fixtures/Basic-Regular.ttf`  
Substrate type: `glyph-paths`  
Observed glyph layout time: 8.5 ms

| Quality | Resolution | Total | Worker | Main / coordination | Round trip | Raster | Edge map | Distance field | Build | Debug mask | Debug edge | Debug distance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 256 × 154 | 145.5 ms | 32.9 ms | 112.6 ms | 145.5 ms | 3.8 ms | 14.6 ms | 9.1 ms | 32.9 ms | 120.4 ms | 18.6 ms | 43.6 ms |
| Medium | 384 × 230 | 69.5 ms | 61.4 ms | 8.1 ms | 69.5 ms | 2.8 ms | 22.2 ms | 15.3 ms | 61.4 ms | 31.4 ms | 39.3 ms | 39.3 ms |
| High | 512 × 307 | 197.1 ms | 34.4 ms | 162.7 ms | 197.1 ms | 5.4 ms | 7.1 ms | 11.6 ms | 34.4 ms | 42.7 ms | 167.5 ms | 35.6 ms |
| Ultra | 768 × 461 | 189.6 ms | 119.7 ms | 69.9 ms | 189.6 ms | 51.1 ms | 30.4 ms | 19.7 ms | 119.6 ms | 20.2 ms | 103.9 ms | 101.3 ms |

## Rapid-change tests

### Rapid text changes

Sequence: `A` → `AB` → `LATEST`

- Final committed text: `LATEST`
- Final request: `REQ 10`
- Backend: `CPU-WORKER`
- Support: `SUPPORTED`
- Fallback: none
- Final build: 61.9 ms total, 39.5 ms worker, 22.4 ms coordination

Only the latest state committed. Stale-result protection worked.

### Rapid quality changes

Sequence: Low → Ultra → Medium

- Final selected quality: Medium
- Final request: `REQ 13`
- Backend: `CPU-WORKER`
- Support: `SUPPORTED`
- Fallback: none
- Final observed round trip: 596.2 ms
- Final worker compute: 25.8 ms
- Main / coordination: 570.4 ms

The latest Medium result committed correctly, but the large coordination time shows that obsolete requests can still occupy the worker/message pipeline. Request IDs prevent stale commits; they do not cancel already queued computation.

## Bottlenecks

1. **Debug-image generation remains material.** It still runs on the main thread. High/Ultra edge images took 117.8–167.9 ms for native text and 103.9–167.5 ms for glyph paths. Ultra glyph distance visualization took 101.3 ms.
2. **Rapid-change request backlog is the largest responsiveness risk.** The Low → Ultra → Medium burst produced a 596.2 ms final round trip despite only 25.8 ms of final worker computation.
3. **Ultra glyph rasterization is meaningfully heavier.** Its raster phase reached 51.1 ms and total worker build reached 119.7 ms.
4. **Edge-map and distance-field work are otherwise bounded.** In ordinary warm runs they were generally tens of milliseconds rather than hundreds.
5. **Coordination measurements are noisy.** Single-run High glyph and cold Low builds show main/coordination spikes that are larger than worker compute, so future benchmarking should collect repeated medians and percentile data.

## Quality assessment

- **Low:** Acceptable, though cold-start/JIT cost can dominate the first run.
- **Medium:** Acceptable as the default. Warm builds completed around 58–70 ms.
- **High:** Acceptable through `cpu-worker` for deliberate parameter changes. Occasional coordination spikes remain visible.
- **Ultra:** Acceptable as an opt-in quality for static substrate changes, not for rapid scrubbing. Worker compute remained under 120 ms in this pass, but glyph rasterization and main-thread debug views can make the interaction noticeably slower.

## Recommendation

Before adding persistent simulation work, add lightweight latest-request coalescing or cancellation so obsolete substrate builds do not queue during rapid text/quality changes. After that, move preview debug-image generation into the worker or generate it from transferred image data off the critical interaction path.

No WebGPU, reaction-diffusion, or new renderer work was included in this pass.

## Animation-pass follow-up

The recommended latest-only scheduler is now implemented. It permits one active build and retains only the newest pending build, so Low → Ultra → Medium no longer requires the pending Ultra request to execute after Low. The previous measured result remains 596.2 ms round trip / 25.8 ms final worker compute. A controlled after-change browser timing could not be captured because local navigation was unavailable in the browser QA surface; the new unit contract verifies the executed request sequence is active + latest only.

Debug-image generation now uses deferred, substrate/mode-keyed caching. It no longer blocks substrate commit or regenerates on animation ticks. It remains main-thread work when its idle/deferred task runs.
