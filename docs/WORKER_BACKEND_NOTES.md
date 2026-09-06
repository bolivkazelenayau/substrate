# Worker Backend Support Notes

App version: `0.11.0`

## Required APIs

The `cpu-worker` substrate backend requires:

- JavaScript module Worker creation via `new Worker(url, { type: "module" })`
- `OffscreenCanvas` inside the worker
- A worker-accessible `Path2D` constructor
- Canvas 2D path filling and `getImageData`
- Structured cloning of substrate build input
- Transferable `ArrayBuffer` support for mask, edge, and distance arrays

## Runtime self-test

Before the first substrate build, the worker runs a 16 × 16 capability probe:

1. Confirm `OffscreenCanvas`.
2. Confirm worker `Path2D`.
3. Rasterize a simple rectangular SVG path.
4. Read a covered pixel.
5. Transfer a `Float32Array([17, 29])` to the main thread.
6. Verify the typed array and sentinel values.

Reported states:

- `supported`: every probe passed.
- `partially-supported`: module Worker started, but a required worker feature failed.
- `unavailable`: Worker creation, worker execution, or the self-test request failed completely.

## Explicit fallback codes

| Code | Meaning |
| --- | --- |
| `worker-unavailable` | Module Worker cannot be created or used. |
| `offscreen-canvas-unavailable` | Worker lacks `OffscreenCanvas`. |
| `path2d-unavailable` | Worker lacks `Path2D`. |
| `rasterization-failed` | The path probe or substrate rasterization failed. |
| `worker-crashed` | Worker emitted an error event. |
| `timeout` | No response arrived before the 8,000 ms deadline. |
| `unknown` | Failure did not match a known category. |

Diagnostics show the code and human-readable reason. The app never labels fallback computation as worker output.

## Timeout and stale replies

Every self-test and build request receives a timer. The production timeout is:

```text
8,000 ms
```

On timeout:

1. The pending request entry is removed.
2. The promise rejects with code `timeout`.
3. The same build input is retried through `cpu-main`.
4. A late worker response finds no pending entry and is ignored.
5. React request-generation protection independently prevents older builds from committing over newer state.

## Why `cpu-main` remains necessary

Worker support is not uniform across browsers, embedded browser surfaces, privacy modes, or CSP configurations. In particular, worker `Path2D` availability can differ from main-thread `Path2D`.

`cpu-main` remains required for:

- Unsupported module Workers
- Missing worker canvas APIs
- Worker startup/runtime failures
- Timeouts
- Browser-specific regressions
- Diagnostic comparison during rollout

The fallback can block interaction at High/Ultra quality and is explicitly reported.

## Known risks

- Positive `cpu-worker` QA is still required in standalone Chrome/Edge/Firefox.
- Safari worker `OffscreenCanvas`/`Path2D` behavior is unverified.
- Native canvas text can differ by worker font availability.
- Worker initialization cost is included in first-request round-trip time.
- Transferred field buffers cannot be reused inside the worker after transfer.
- Debug-image generation still occurs on the main thread.

## Non-goals

- No WebGPU.
- No reaction-diffusion.
- No persistent simulation.
- No new renderer.
- No raster export.
