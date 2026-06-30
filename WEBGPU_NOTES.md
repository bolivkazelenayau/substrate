# WebGPU Direction Notes

Status: Gate 7 dev-only heatmap overlay shell  
Current app version: `0.17.0`

## Intended role

WebGPU is an optional acceleration path for future preview work:

- dense field-map computation;
- SDF and raster experiments;
- a possible future print/raster branch;
- preview acceleration when measurement shows a useful gain.

Final Artwork SVG remains CPU/vector-generated and deterministic. The procedural
project state and CPU renderer geometry remain the source of truth.

## Gate 0 implementation

`src/engine/gpu/webgpuSupport.ts` detects `navigator.gpu` and requests an adapter
and device. Unsupported browsers, unavailable adapters, and request errors return
explicit result objects; they do not throw from the capability API.

`src/engine/gpu/webgpuComputeSpike.ts` is an internal, unconnected probe. It:

1. uploads four unsigned integers to a storage buffer;
2. runs a small WGSL compute shader (`output = input * 2 + 1`);
3. copies the output to a readable buffer;
4. validates the deterministic result `[3, 5, 7, 9]`.

The spike is not imported by the UI, renderers, substrate backends, or exporters.
CI tests use structural mocks and do not require WebGPU or a physical GPU.

## Non-goals

- No WebGPU source of truth for SVG geometry.
- No renderer or substrate-backend rewrite.
- No WebGPU preview UI.
- No animation runtime.
- No node graph.
- No worker architecture changes.
- No schema, preset, typography, or export-semantic changes.

## Gate 1 benchmark

`src/engine/gpu/webgpuFieldBenchmark.ts` compares a deterministic CPU reference
with an optional WGSL compute workload at `128×128`, `256×256`, and `512×512`.
Three fixed emitters contribute:

`amplitude * sin(distance * frequency + phase) / (1 + falloff * distance)`

The harness records device readiness, pipeline creation, one warmup dispatch,
buffer upload, measured dispatch, readback, total GPU time, and CPU baseline time
separately. Results also include finite/dimension validation plus maximum and mean
CPU/GPU differences. Measurements are exploratory and machine-dependent; the
harness does not claim a speedup.

When WebGPU, an adapter, or a device is unavailable, the benchmark returns
`cpu-fallback` with the completed CPU field and the explicit GPU failure reason.
Automated tests use this path and never require a physical GPU.

Readback can dominate a small compute workload because it synchronizes GPU and
CPU work and transfers the full field. A future preview experiment should prefer
keeping GPU output in a texture and displaying it directly instead of reading it
back each frame. Readback remains useful here only for correctness comparison.

With the Vite development app open in a WebGPU-capable browser, run this in the
browser console:

```js
const { runWebGpuFieldBenchmarkSuite } =
  await import("/src/engine/gpu/webgpuFieldBenchmark.ts");
const results = await runWebGpuFieldBenchmarkSuite();
console.table(results.map(({ status, size, ...result }) => ({
  status,
  size,
  ...(status === "success" ? result.timings : {}),
})));
```

Inspect each successful result's validation and comparison fields as well as the
timing table. A `cpu-fallback` row includes the unavailable/error reason.

## Gate 2A repeated measurements

The repeated runner defaults to 20 recorded samples and 3 discarded warmups for
each required grid size. It retains raw samples and reports min, median, mean,
p95, max, sample count, fallback count, and failure count for every timing phase.

With the Vite development app open, run:

```js
const benchmark =
  await import("/src/engine/gpu/webgpuRepeatedBenchmark.ts");
const report = await benchmark.runRepeatedWebGpuFieldBenchmarkSuite();
benchmark.reportRepeatedWebGpuFieldBenchmark(report);
const csv = benchmark.repeatedBenchmarkToCsv(report);
```

Copy the table or `csv`, plus browser, operating system, GPU, and whether the
browser was on battery power, into a measurement report. Raw per-run results are
available under `report.sizes[index].samples`.

Options include `sampleCount`, `warmupCount`, `sizes`, and
`includeCpuBaselinePerSample`. Setting the last option to `false` reuses one CPU
reference field for validation and omits per-sample CPU timing.

Compare steady-state `dispatchMs` with `readbackMs`. If readback is materially
larger, a future preview experiment should keep the field GPU-resident and render
it directly; that observation alone does not justify renderer integration. Do
not claim a speedup unless repeated results on representative hardware beat the
CPU baseline with correctness validation passing.

### Recorded cold-path measurements

The first 20-sample browser run produced zero fallbacks and zero failures:

| Grid | CPU median | GPU total median | Dispatch median | Readback median |
| --- | ---: | ---: | ---: | ---: |
| 128² | 3.50 ms | 88.70 ms | 1.30 ms | 1.50 ms |
| 256² | 18.55 ms | 116.30 ms | 1.65 ms | 1.85 ms |
| 512² | 59.90 ms | 110.85 ms | 1.70 ms | 2.15 ms |

These cold-path results do not justify a GPU-to-texture prototype. Device and
resource setup dominated total GPU time. The next decision depends on the
persistent-resource steady-state measurements below.

## Gate 2B persistent-resource measurements

`webgpuPersistentFieldBenchmark.ts` creates one device, pipeline, bind group, and
set of buffers sized for the largest requested grid. It reports device readiness,
pipeline creation, buffer allocation, and total setup once.

Each repeated sample reports CPU baseline, dimension upload, command encoding,
dispatch/queue completion, copy-to-readback, map/readback, and total GPU time.
Readback validation mode compares the numeric field with the CPU reference.
No-readback mode leaves output GPU-resident and is explicitly marked timing-only;
it reports whether the same formula and size previously passed validation.

Run the persistent suite from the Vite development console:

```js
const persistent =
  await import("/src/engine/gpu/webgpuPersistentFieldBenchmark.ts");
const report =
  await persistent.runRepeatedPersistentFieldBenchmarkSuite();
persistent.reportPersistentFieldBenchmark(report);
```

The defaults are 3 discarded warmups and 20 recorded samples for both validation
and no-readback modes at 128², 256², and 512². Raw samples remain under
`report.results[index].samples`.

### Recorded persistent measurements

The first persistent 20-sample run produced zero fallbacks and zero validation
failures:

| Grid | Mode | CPU median | Dispatch median | Total GPU median |
| --- | --- | ---: | ---: | ---: |
| 128² | readback validation | 3.35 ms | 92.70 ms | 320.45 ms |
| 128² | no readback | 2.70 ms | 13.95 ms | 21.75 ms |
| 256² | readback validation | 11.50 ms | 74.50 ms | 205.85 ms |
| 256² | no readback | 10.10 ms | 44.95 ms | 47.45 ms |
| 512² | readback validation | 41.70 ms | 54.05 ms | 142.70 ms |
| 512² | no readback | 46.20 ms | 59.25 ms | 60.50 ms |

Persistent no-readback timing was better than validation timing but did not beat
the CPU baseline. Variance and scaling indicate that queue synchronization and
browser/driver scheduling may dominate. These results do not justify a
GPU-to-texture prototype.

## Gate 2C batched dispatch and timestamps

`webgpuBatchedFieldBenchmark.ts` measures multiple dispatches per command buffer
and multiple submissions before one queue-completion wait. Batch sizes default to
1, 2, 4, 8, 16, and 32. Results report batch total, queue completion, total
no-readback time, and normalized per-dispatch cost alongside CPU time per field.

The harness requests the optional `timestamp-query` feature only when the adapter
advertises it. When enabled, timestamp query sets report GPU-side compute-pass
time separately from CPU-side encoding, submission, and synchronization. Missing
feature or API support produces `timestamp-unavailable`; CPU-side benchmarking
continues normally and CI never requires timestamp support.

Run 20 samples per size and batch size from the Vite development console:

```js
const batched =
  await import("/src/engine/gpu/webgpuBatchedFieldBenchmark.ts");
const report =
  await batched.runRepeatedBatchedFieldBenchmarkSuite();
batched.reportBatchedFieldBenchmark(report);
```

Record browser, operating system, GPU, power state, and `timestampStatus`. Compare
CPU median per field with `normalizedPerDispatchMs`, optional
`gpuTimestampPerDispatchMs`, and `queueCompletionMs`. A lower GPU timestamp alone
does not establish an application speedup if queue/scheduling cost remains high.

### Recorded batched measurements

Timestamp queries were available and the 20-sample run completed without
fallbacks or failures. Representative medians:

| Grid | Batch | CPU/field | Normalized GPU | GPU timestamp/dispatch |
| --- | ---: | ---: | ---: | ---: |
| 128² | 1 | 3.20 ms | 46.85 ms | 0.066 ms |
| 128² | 32 | 2.40 ms | 0.344 ms | 0.031 ms |
| 256² | 1 | 9.65 ms | 11.75 ms | 0.131 ms |
| 256² | 32 | 9.50 ms | 0.458 ms | 0.105 ms |
| 512² | 1 | 53.40 ms | 1.975 ms | 0.360 ms |
| 512² | 16 | 59.25 ms | 0.475 ms | 0.364 ms |

Stable GPU timestamps and improving normalized cost show that earlier latency was
primarily queue synchronization and scheduling overhead. This justifies an
isolated GPU-to-texture experiment, but not renderer migration or a production
speedup claim.

## Gate 3 texture preview prototype

`webgpuTexturePreview.ts` computes the fixed benchmark field into an
`rgba8unorm` storage texture, then samples that texture in a fullscreen render
pass targeting a provided canvas. Compute and render are encoded into one command
buffer. The default frame path submits without queue synchronization and never
maps or reads GPU data back to the CPU.

The prototype supports 256² and 512² canvases. `phaseOffset` and
`frequencyScale` are manual parameters only; project state, presets, renderers,
and exporters are not imported. If WebGPU or a canvas WebGPU context is
unavailable, the same fixed field is painted through a bounded 2D-canvas CPU
fallback.

Run manually from the Vite development console:

```js
const preview =
  await import("/src/engine/gpu/webgpuTexturePreview.ts");
const canvas = document.createElement("canvas");
canvas.style.cssText =
  "position:fixed;right:16px;bottom:16px;width:384px;height:384px;z-index:9999";
document.body.append(canvas);
const mounted =
  await preview.mountWebGpuTexturePreview(canvas, { size: 512 });
await mounted.controller?.render({
  phaseOffset: 0.8,
  frequencyScale: 1.15,
});
```

Inspect `mounted.status`, `mounted.setupMs`, `mounted.initialFrame`, and the
controller backend. Calling `render(parameters, { synchronize: true })` measures
queue-completion latency for diagnostics; normal preview rendering should leave
`synchronize` false. Remove the manual canvas and call
`mounted.controller?.dispose()` when finished.

### Gate 3 manual QA

The 512² manual preview reported `ready` with backend `webgpu-texture` and visibly
rendered the false-color field while the normal SVG preview remained active.
Frame enqueue was approximately 0.2 ms. A separately requested synchronized
diagnostic completed in approximately 51.1 ms. No console errors were observed.
These are prototype observations, not a production speedup claim.

## Gate 4 sustained timing and device loss

`webgpuTexturePreviewRunner.ts` runs the isolated texture preview through
`requestAnimationFrame`. It defaults to 300 frames at a 60 FPS target and varies
the fixed field phase so updates remain visible. Normal mode submits compute and
render commands without `queue.onSubmittedWorkDone()` and without GPU readback.

The summary retains raw frames and reports total wall-clock duration, approximate
FPS, late/dropped-frame indicators, and min/median/mean/p95/max for JavaScript
frame intervals and command enqueue time. Enqueue timing measures CPU-side command
construction/submission only; it is not GPU completion time and does not prove
visible smoothness. Browser frame intervals are the closest harness-level signal
for visible pacing.

Synchronized diagnostic mode is opt-in and separately labeled. It waits for queue
completion per frame and reports that latency, so it intentionally does not model
the normal preview path.

The controller observes `device.lost`, changes to `lost`, and notifies the runner.
An active loop then stops safely with state `device-lost`. The manual harness
exposes `recreate()` to request a new device/context explicitly. Unsupported
WebGPU continues through the CPU canvas fallback.

Run sustained timing from the Vite development console:

```js
const sustained =
  await import("/src/engine/gpu/webgpuTexturePreviewRunner.ts");
const canvas = document.createElement("canvas");
Object.assign(canvas.style, {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  width: "512px",
  height: "512px",
  zIndex: "99999",
});
document.body.append(canvas);
const harness =
  await sustained.createSustainedTexturePreviewHarness(canvas, { size: 512 });
const summary =
  await harness.runSustainedTiming({ frameCount: 300 });
console.table({
  mode: summary.mode,
  frames: summary.completedFrameCount,
  fps: summary.approximateFps,
  late: summary.lateFrameCount,
  dropped: summary.droppedFrameCount,
  enqueueMedian: summary.enqueueMs.median,
  intervalMedian: summary.frameIntervalMs.median,
  intervalP95: summary.frameIntervalMs.p95,
});
```

Repeat with a newly created harness at 256². Run synchronized diagnostics only as
a separate short sample:

```js
const diagnostic =
  await harness.runSustainedTiming({
    frameCount: 30,
    diagnosticSync: true,
  });
```

Use `harness.stop()`, `harness.getState()`, `harness.getTimingSummary()`,
`await harness.recreate()`, and `harness.dispose()` for manual lifecycle control.

### Recorded Gate 4 sustained results

Normal unsynchronized runs reported:

| Size | Approx. FPS | Late | Dropped | Interval p95 | Enqueue median |
| --- | ---: | ---: | ---: | ---: | ---: |
| 512² | 57.3 | 17 | 16 | 33.2 ms | 0.1 ms |
| 256² | 47.6 | 75 | 74 | 33.4 ms | 0.1 ms |

Cheap enqueue confirms that JavaScript command construction is not the obvious
bottleneck, but frame pacing is unstable. The smaller workload performing worse
points toward rAF/compositor scheduling, harness conditions, overlapping manual
contexts, or environmental noise rather than raw field-compute cost. App-state
and renderer integration remain blocked until that distinction is understood.

## Gate 4B pacing diagnostics

The sustained runner supports these isolated diagnostic modes:

- `raf-only`: no canvas draw and no WebGPU submission;
- `canvas-2d`: a simple changing 2D fill;
- `webgpu-render-only`: presents the existing texture without recomputing it;
- `webgpu-compute-render`: the Gate 3 compute-to-texture path;
- `webgpu-static-frame`: optional compute/render with unchanged parameters.

All modes retain raw samples and report identical FPS, interval, late/dropped,
and enqueue summaries. Synchronized diagnostics remain opt-in. Their summary is
named `synchronizedQueueCompletionMs`; it is empty in normal unsynchronized runs.

`stop()` cancels the pending animation frame, `dispose()` stops active work and
releases the controller, and a second run on an already-running runner is
rejected. `runTexturePreviewPacingSuite()` runs one mode at a time and disposes
its runner, controller, and canvas before continuing.
`cleanupTexturePreviewPacingHarnesses()` is available for manual cleanup and
removes any marked diagnostic canvases.

Before measuring, refresh the tab or run the cleanup helper. Do not compare runs
while old manual canvases, controllers, or loops remain active. Record browser,
OS, GPU, and power state.

```js
const pacing =
  await import("/src/engine/gpu/webgpuTexturePreviewRunner.ts");
pacing.cleanupTexturePreviewPacingHarnesses();
const result = await pacing.runTexturePreviewPacingSuite({
  frameCount: 300,
  sizes: [256, 512],
  modes: [
    "raf-only",
    "canvas-2d",
    "webgpu-render-only",
    "webgpu-compute-render",
  ],
});
pacing.reportTexturePreviewPacingSuite(result);
```

Run synchronized diagnostics separately and briefly:

```js
const diagnostic = await pacing.runTexturePreviewPacingSuite({
  frameCount: 30,
  sizes: [256, 512],
  modes: ["webgpu-compute-render"],
  diagnosticSync: true,
});
pacing.reportTexturePreviewPacingSuite(diagnostic);
```

The reporter column is `synchronizedQueueCompletionMedian`, derived from
`summary.synchronizedQueueCompletionMs`. Enqueue time, GPU completion time, and
visible pacing are different measurements; none alone establishes stable 60 FPS.

### Gate 4B pacing finding

Clean measurements showed the 512² compute/render path near 60 FPS, while 256²
WebGPU modes remained unstable, especially render-only. Repeated 256²
compute/render runs could become stable. Because the smaller workload was worse
and enqueue remained near 0.1 ms, warmup, presentation/compositor behavior, and
measurement conditions remain more plausible than raw compute saturation.
App-state integration remains blocked.

## Gate 4C warmup and presentation variants

Pacing runs now accept `warmupFrameCount`. The pacing suite defaults to 60 warmup
frames and 300 recorded frames. Warmup samples are retained under
`summary.warmupFrames` but excluded from FPS, frame-interval, enqueue, late, and
dropped-frame statistics.

The presentation comparison modes are:

- `webgpu-render-only-static`: presents the existing texture unchanged;
- `webgpu-render-only-changing`: changes render-pass color presentation without
  recomputing the field;
- `webgpu-compute-render-changing`: changes field and presentation parameters.

Each summary records internal texture size, canvas bitmap dimensions, CSS display
dimensions, device pixel ratio, diagnostic mode, warmup count, and recorded frame
count under `summary.metadata`. It also reports
`intervalP95Exceeds25Ms` and `droppedFramesExceedThreshold`; the current threshold
is more than 5 dropped frames per recorded run.

Every WebGPU presentation-mode entry now attempts preview mounting explicitly.
Suite entries and reporter rows include `mountStatus`, `fallbackReason`, and
`failureReason`. A WebGPU failure may run through backend `cpu-canvas`, but a
missing backend can no longer appear as a successful all-zero `none` result.
Variant metadata is retained even when mounting fails.

Run one clean suite after refreshing the tab:

```js
const pacing =
  await import("/src/engine/gpu/webgpuTexturePreviewRunner.ts");
pacing.cleanupTexturePreviewPacingHarnesses();
const result = await pacing.runTexturePreviewPacingSuite({
  warmupFrameCount: 60,
  frameCount: 300,
  variants: [
    { internalSize: 256, cssDisplaySize: 256 },
    { internalSize: 256, cssDisplaySize: 512 },
    { internalSize: 512, cssDisplaySize: 256 },
    { internalSize: 512, cssDisplaySize: 512 },
  ],
  modes: [
    "webgpu-render-only-static",
    "webgpu-render-only-changing",
    "webgpu-compute-render-changing",
  ],
});
pacing.reportTexturePreviewPacingSuite(result);
```

Record FPS, late/dropped counts, interval median/p95, enqueue median/p95, internal
size, CSS size, DPR, browser, OS, GPU, and power state. The suite removes each
canvas/controller before starting the next variant. Do not leave older manual
harnesses running in another tab or console context.

### Recorded Gate 4C warmed results

`webgpu-compute-render-changing` stabilized after warmup:

| Internal → CSS | Approx. FPS | Interval p95 | Dropped |
| --- | ---: | ---: | ---: |
| 256 → 256 | 59.5 | 16.9 ms | 2 |
| 256 → 512 | 60.0 | 16.9 ms | 0 |
| 512 → 256 | 58.7 | 16.9 ms | 5 |
| 512 → 512 | 60.0 | 16.9 ms | 0 |

The dynamic compute-preview path is stable enough for a dev-only state adapter.
The `render-only-static` anomaly remains a presentation/compositor oddity and is
not evidence that static WebGPU presentation is production-ready.

## Gate 5 dev-only app-field adapter

`webgpuAppFieldPreviewAdapter.ts` maps a read-only `ProjectState` snapshot to the
bounded texture-preview field format. It maps:

- single versus multiple emitter mode;
- the shared emitter enabled state, amplitude, frequency, phase, radius, and
  falloff style;
- global amplitude and frequency scaling;
- enabled instance weights, phase offsets, and radius multipliers;
- up to the existing safe cap of eight emitter rows;
- resolved emitter anchors when supplied;
- preview bounds and grid size.

Disabled emitters are excluded. Rows beyond the first eight are clipped. When a
resolved glyph anchor is unavailable, multiple emitters use a deterministic
spread across the preview; this is a diagnostic approximation, not CPU renderer
parity.

In development builds only, `App` exposes
`globalThis.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__()`. The returned project and
emitter rows are cloned and include current resolved anchors where available.
This adds no production UI and does not mutate project state.

Mount a manual overlay from the Vite console:

```js
const adapter =
  await import("/src/engine/gpu/webgpuAppFieldPreviewAdapter.ts");
const canvas = document.createElement("canvas");
Object.assign(canvas.style, {
  position: "fixed",
  right: "16px",
  bottom: "16px",
  width: "512px",
  height: "512px",
  zIndex: "99999",
  border: "1px solid #d7ff00",
});
document.body.append(canvas);
globalThis.devGpuField = await adapter.mountDevWebGpuAppFieldPreview(
  canvas,
  globalThis.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__(),
  { size: 512 },
);
globalThis.devGpuField.controller?.start(
  () => globalThis.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__(),
);
```

Changing emitter controls or switching single/multiple mode updates the live
heatmap. For manual one-shot updates, call
`adapter.updateDevWebGpuAppFieldPreview(controller, snapshot)`. Call
`globalThis.devGpuField.controller?.stop()` or `.dispose()` when finished;
dispose removes the manual canvas by default.

The adapter previews field state only. It does not preview marks, contours,
glyph deformation, typography geometry, or Final Artwork SVG. Existing CPU/vector
renderers and `.substrate.json` remain authoritative, and SVG export never uses
this GPU texture.

### Gate 5 manual QA accepted

Manual QA in a WebGPU-capable browser confirmed:

- the GPU heatmap mounts successfully via `mountDevWebGpuAppFieldPreview`;
- backend `webgpu-texture` is used when available;
- a single emitter field is visibly rendered;
- multiple emitter interference is visibly rendered;
- the **emitter-off / zero-active-emitter** state renders a neutral flat field
  (no contribution ⇒ `value = 0` everywhere ⇒ neutral color);
- the existing SVG preview and SVG export remain separate, authoritative, and
  unchanged;
- no console errors were observed.

The GPU heatmap is therefore a **diagnostic field preview only**. It is not a
production renderer and does not feed Final Artwork SVG. The emitter-off neutral
flat field is the safe default and a useful visual parity signal.

## Gate 6 CPU/GPU field parity diagnostics

`webgpuFieldParityDiagnostics.ts` adds a dev/manual console diagnostic layer that
compares the CPU reference evaluation of the Gate 5 mapped app-state field against
an explicit GPU readback of the same field formula on a bounded diagnostic grid
(`64×64` and `128×128`). The goal is to let a developer trust the GPU heatmap as a
field debug instrument by quantifying how close its field is to the CPU reference.

What it compares:

- the Gate 5 app-state snapshot is mapped through the same
  `mapAppFieldSnapshotToTexturePreview` used by the live heatmap;
- the CPU reference is `evaluateTexturePreviewFieldCpu`, which re-implements the
  texture-preview field formula on the normalized `[0,1]` grid (the same formula
  the preview compute shader and the CPU-canvas fallback use);
- the GPU side runs a separate diagnostic WGSL compute shader
  (`PARITY_COMPUTE_SHADER`) that reproduces that exact field formula and writes
  raw `f32` field values (not colors) to a storage buffer, then copies them to a
  read-only buffer for `mapAsync` readback.

Color grading in the preview shader is intentionally excluded from parity —
parity is about the raw field, not the heatmap colors.

Reported fields per grid size:

- `gridSize`;
- `status`: `pass` | `fail` | `diagnostic-unavailable` | `invalid`;
- `activeEmitterCount` and `skippedEmitterCount` (rows beyond the 8-row cap);
- CPU and GPU finite-value validation plus a `neutral` flag
  (`true` when every sample is `0`, i.e. zero active emitters);
- `maxDifference`, `meanDifference`, `rmsDifference`, and `sampleCount`;
- `tolerance`;
- `reason`, when parity is approximate or impossible (e.g. fallback anchors,
  GPU readback unavailable, or a GPU readback exception).

Aggregate result fields:

- `status`: `complete` | `diagnostic-unavailable` | `error`;
- `emitterMode`, `activeEmitterCount`, `clippedEmitterCount`,
  `usedResolvedAnchorCount`, `totalEmitterRowCount`, `disabledEmitterCount`;
- `resultRows` (one per requested grid size).

The default tolerance is `0.02` (absolute field units); override with the
`tolerance` option. The comparison uses the pre-color raw field, so a small
Float32-vs-Float64 rounding residual (well below `1e-4`) is expected and within
tolerance on real WebGPU.

Important cases covered:

- single emitter;
- multiple emitters;
- disabled emitters are excluded from the active count and the field;
- emitter-off / zero active emitters ⇒ neutral flat field, reported without
  requesting a GPU device;
- `phaseOffset` / `frequencyScale` parameters shift parity predictably;
- weight / radius changes flow through the mapped emitters and affect both
  references identically;
- missing glyph anchors use the deterministic diagnostic fallback layout; the
  result row records an `approximate` `reason` in that case.

### Readback behavior and invariants

GPU readback happens **only** inside
`runDevWebGpuFieldParityDiagnostics`. The normal texture-preview / heatmap path
(`mountDevWebGpuAppFieldPreview`, `controller.update`, `controller.start`)
never imports this module and never performs `mapAsync`/`copyBufferToBuffer`
readback. The parity diagnostic must not be called from the preview/animation
loop. A zero-active-emitter snapshot skips device acquisition entirely.

This layer is dev/prototype scoped. It changes no schema, migration, renderer
algorithm, preset, typography behavior, production UI, SVG export, or the SVG
preview. CPU/vector renderers remain the source of truth; a parity mismatch
means the GPU dev heatmap is untrustworthy and never changes CPU output.

### Run from the Vite development console

```js
const parity =
  await import("/src/engine/gpu/webgpuFieldParityDiagnostics.ts");
const snapshot = globalThis.__SUBSTRATE_GET_WEBGPU_DEV_SNAPSHOT__();
const result =
  await parity.runDevWebGpuFieldParityDiagnostics(snapshot, {
    gridSizes: [64, 128],
    phaseOffset: 0,
    frequencyScale: 1,
    tolerance: 0.02,
  });
console.log(parity.reportWebGpuFieldParityDiagnostics(result));
```

Inspect the printed table; expect `pass` rows for single, multiple, disabled-row,
and emitter-off snapshots in a WebGPU-capable browser. Re-run after changing
emitter amplitude/phase/radius/weight to confirm parity shifts predictably.
Confirm the normal SVG preview/export still works unchanged and that no console
errors appear. The preview animation path continues to use no readback.

When WebGPU is unavailable, `runDevWebGpuFieldParityDiagnostics` returns
`status: "diagnostic-unavailable"` with only the CPU reference computed and an
explicit `unsupportedReason`; the suite never requires a physical GPU.

### Gate 6 manual QA results

Parity diagnostics were run manually in a WebGPU-capable browser:

- **neutral pass** — emitter-off / zero-active emitter snapshot produced a
  neutral flat field on both 64² and 128², `maxDifference = 0`, `pass`.
- **forced single active emitter** — `single` mode with
  `project.emitter.enabled = true` passed, `maxDifference ≈ 5.6e-5`
  (Float32 WGSL vs Float64 JS residual; well inside the 0.02 tolerance).
- **forced multiple active emitters** — `multiple` mode with enabled rows and
  resolved glyph anchors passed, `maxDifference ≈ 5.6e-5`.

No console errors; CPU/vector SVG preview/export remained unchanged; the normal
GPU preview path continued to use no readback.

## Gate 6.1 heatmap state diagnostics & mapping clarity

Manual QA during Gate 6 surfaced a confusing state distinction that the parity
report alone did not make explicit:

- in `single` mode, the active source of truth is `project.emitter` (the shared
  emitter). `project.emitters[i].enabled` does **not** activate the single-mode
  shared emitter.
- `project.emitters[0].enabled` may be `true` while `project.emitter.enabled` is
  `false`. The heatmap is then neutral even though a visible emitter row looks
  enabled. This is correct behavior, not a bug — but it is easy to misread.

Gate 6.1 makes the mapping state explicit and hard to misread before any
product-facing overlay work. This is a diagnostic clarity gate; it changes no
renderer, UI integration, schema, preset, typography, or export semantics.

### Mapping diagnostics in `webgpuAppFieldPreviewAdapter.ts`

`DevWebGpuMappedField` now exposes explicit diagnostic fields:

- `fieldState: "active" | "neutral" | "approximate"`:
  - `neutral` → zero active emitters (no field contribution);
  - `active` → one or more active emitters, all with resolved glyph anchors;
  - `approximate` → one or more active emitters, but at least one used the
    deterministic diagnostic fallback anchor layout.
- `neutralReason` (only when `neutral`): `"shared emitter disabled"` (single
  mode, `project.emitter.enabled === false`) or `"no enabled emitter rows"`
  (multiple mode).
- `approximateReason` (only when `approximate`): describes how many active
  emitters had resolved glyph anchors and how many used fallback anchors.
- `singleModeSharedEmitterEnabled: boolean` — the `project.emitter.enabled`
  flag. The single-mode source-of-truth flag, surfaced explicitly to contrast
  with `project.emitters[]` row `enabled` flags.
- `ignoredEmitterRowsCount` — rows in `project.emitters[]` ignored because
  single mode uses the shared emitter. In `single` mode this equals
  `project.emitters.length`; in `multiple` mode it is `0`.
- `enabledEmitterRowsCount` / `disabledEmitterRowsCount` — counts of rows in
  `project.emitters[]` by their `enabled` flag (informational; in single mode
  these rows are still ignored).
- `fallbackAnchorCount` — count of active mapped emitters that fell back to
  the deterministic diagnostic anchor layout.

### Single-mode source of truth

In `single` mode the heatmap/field uses `project.emitter` (shared). All
`project.emitters[]` rows are ignored for field purposes, regardless of their
`enabled` flags. `ignoredEmitterRowsCount` reports this directly. When the
shared emitter is disabled, the field is neutral with `neutralReason =
"shared emitter disabled"` even if every row in `project.emitters[]` is
`enabled: true`. This is by design and now stated explicitly in the report.

In `multiple` mode the shared `project.emitter` settings (amplitude, frequency,
phase, radius, falloff) still parameterize each row, but activation is driven
by `project.emitters[i].enabled` (capped at 8 rows). `neutralReason =
"no enabled emitter rows"` when no rows are enabled.

### Mounted controller `getMapping()` manual debugging

`DevWebGpuAppFieldPreviewController.getMapping()` always returns the latest
`DevWebGpuMappedField` (including all Gate 6.1 diagnostic fields) while the
controller is alive. It never returns `undefined` after `mountDevWebGpuAppFieldPreview`,
`controller.update(...)`, or `controller.start(...)`. Use it to inspect the
exact field the heatmap is rendering without performing GPU readback:

```js
const adapter =
  await import("/src/engine/gpu/webgpuAppFieldPreviewAdapter.ts");
const m = globalThis.devGpuField.controller?.getMapping?.();
console.log({
  fieldState: m?.fieldState,
  neutralReason: m?.neutralReason,
  approximateReason: m?.approximateReason,
  singleModeSharedEmitterEnabled: m?.singleModeSharedEmitterEnabled,
  activeEmitterCount: m?.activeEmitterCount,
  ignoredEmitterRowsCount: m?.ignoredEmitterRowsCount,
  enabledEmitterRowsCount: m?.enabledEmitterRowsCount,
  disabledEmitterRowsCount: m?.disabledEmitterRowsCount,
  fallbackAnchorCount: m?.fallbackAnchorCount,
  usedResolvedAnchorCount: m?.usedResolvedAnchorCount,
});
```

### Parity report labels

`reportWebGpuFieldParityDiagnostics` now prints `fieldState`, the full row
counts, `sharedEmitterEnabled`, `ignoredRows`, `fallbackAnchors`, plus
`neutralReason` / `approximateReason` lines. Snapshot labels distinguish:

- `single/neutral: shared emitter disabled`
- `single/1-emitter` (resolved anchor) or `single/1-emitter/approximate`
  (fallback anchor)
- `multiple/neutral: no enabled emitter rows`
- `multiple/N-emitters` (all resolved) or `multiple/N-emitters/approximate`
  (some/all fallback anchors)

The report header and per-grid `reason` rows include the neutral or
approximate reason, so the heatmap/parity state is explicit and cannot be
silently misread as a bug.

This layer is dev/prototype scoped. No product-facing overlay UI was added.
GPU readback still happens only inside `runDevWebGpuFieldParityDiagnostics`;
`getMapping()` and the normal preview path never read back. CPU/vector
renderers and SVG export remain the source of truth.

## Next gate

A future gate may surface the GPU heatmap as an opt-in, product-facing dev
overlay (toggle, dispose-on-unmount, device-lost surfacing), gated on the Gate
6 / 6.1 parity and mapping-clarity evidence, with a separate product-UI
decision. CPU/vector SVG remains authoritative and WebGPU must not be required
for the app.

## Gate 7 dev-only heatmap overlay shell

Gate 7 surfaces the existing WebGPU field heatmap as an opt-in **development**
overlay with explicit lifecycle, status, and diagnostic labeling. This is not a
renderer integration, not an SVG export path, and not a new WebGPU computation
gate. Final Artwork SVG remains CPU/vector-generated and authoritative; WebGPU
stays optional and non-required; the heatmap never feeds SVG export.

### Dev-only gating

`src/components/dev/WebGpuFieldOverlay.tsx` is the overlay shell. `App.tsx` gates
the entire overlay + its toggle behind `import.meta.env.DEV`, so it never appears
in production builds. The entry point is a small dev-only floating toggle button
(lower-left, `▸ GPU FIELD DEBUG`) plus a keyboard shortcut `Ctrl/⌘ + Shift + G`.
The toggle text flips to `✕ GPU DEBUG` while open. No production UI is affected.

### Overlay lifecycle behavior

On open `WebGpuFieldOverlay` mounts the existing `mountDevWebGpuAppFieldPreview`
controller, calls `controller.start(() => getSnapshot())` for live updates, and
subscribes to `controller.onDeviceLost(...)` for device-loss surfacing. A low
rAF poll reads `controller.getMapping()` (a cached JS object) for the inline
legend. Closing the overlay or unmounting the component calls `controller.stop()`
and `controller.dispose()`, which removes its canvas and cancels its rAF loop.
Mounting finishes after close: the effect disposes any controller that mounted
late. Repeated toggle on/off re-creates a fresh controller each time and disposes
the previous one, so no duplicate canvases, controllers, or rAF loops remain.

Because the snapshot getter reads fresh project state inside the controller's own
`start()` loop, changing emitter controls updates the heatmap and legend without
re-mounting the component.

### Visible labeling

The overlay header reads `GPU FIELD DEBUG — NOT EXPORT`, so it cannot be mistaken
for production output. It prints:

- `backend: webgpu-texture | cpu-canvas` (`(fallback)` appended when the mount
  resolved as `cpu-fallback`, plus a `fallback reason:` line when the adapter
  reports one);
- `mounting heatmap…` while mounting;
- `mount error: …` when the adapter returns `status: "error"`;
- `device lost: …` when the controller's `onDeviceLost` fires.

### Inline state legend (from `getMapping()`)

Below the canvas the overlay renders a `legend` block read entirely from
`controller.getMapping()` — never from GPU readback:

- `fieldState` (active / neutral / approximate);
- `active` (active emitter count);
- `mode` (`emitterMode`);
- `shared emitter` (`singleModeSharedEmitterEnabled`);
- `enabled rows` / `disabled rows` / `ignored rows` (the Gate 6.1 row diagnostics);
- `resolved anchors` (`usedResolvedAnchorCount`);
- `fallback anchors` (`fallbackAnchorCount`);
- `neutral: <reason>` when `fieldState === "neutral"`;
- `approximate: <reason>` when `fieldState === "approximate"`.

This reuses the Gate 6.1 mapping-clarity fields so the heatmap state is
self-explanatory and cannot be silently misread (e.g. the single-mode
shared-emitter-disabled case shows the neutral reason and the ignored-rows count).

### States handled visibly

- active field;
- neutral field (with `neutralReason`);
- approximate field (with `approximateReason`);
- unsupported WebGPU / CPU fallback (backend label + optional `fallback reason`);
- device-lost (typed into `status` via the `onDeviceLost` subscription, never
  crashing the app — the legend keeps showing the last mapping);
- mount error (typed into `status` without crashing).

### Readback invariant

The overlay never performs GPU readback. It only mounts the controller, drives
live presentation via `start()`, and reads the cached `getMapping()` JS object
for the legend. The only GPU readback path remains the separate
`runDevWebGpuFieldParityDiagnostics` function, which is console-only and never
invoked from the overlay or the normal preview/animation loop.

This layer is dev/prototype scoped. No product-facing overlay appears in
production builds. Schema, migrations, renderers, presets, typography, SVG export,
and the SVG preview are unchanged. WebGPU is not required.

## Gate 7.4 field-versus-renderer visual contract

The heatmap displays the mapped scalar field. It does **not** display final Glyph
Diffuser marks and does not apply the CPU renderer's candidate lattice, seeded
acceptance, domain culling, mark cap, or 56-unit artboard edge feather. Consequently,
field influence can remain visible in the heatmap where fixed-bounds SVG marks have
already faded or are outside the `0 0 1200 720` view box.

The renderer comparison block keeps these states separate:

- overlay active emitter count versus CPU runtime active field emitter count;
- consumed CPU field mode and normalization mode;
- per-row anchor, weight, radius multiplier, effective/sample radius, bounds,
  sample count, and rendered mark count;
- `artboard clipped: yes · edge feathered` versus `marks cap: clipped`.
- enabled rows versus positive-strength contributing emitters; zero-strength
  sources remain configured but do not enter the heatmap or produce CPU marks.

`active` means field emitters, not rendered mark clusters. Overlay mapping remains a
cached JavaScript diagnostic with no GPU readback. Final Artwork remains deterministic,
vector-only, CPU-generated SVG with fixed `1200×720` bounds.

## Next gate

A future gate could extend the dev overlay with an on-demand "Run parity"
diagnostic button (invoking `runDevWebGpuFieldParityDiagnostics` once per press,
clearly labeled diagnostic-only readback), gated on whether that adds real value
vs. running the console helper. Any product-facing promotion of the heatmap would
require a separate lifecycle, accessibility, and product-UI decision gate.
CPU/vector SVG remains authoritative and WebGPU must not be required for the app.
