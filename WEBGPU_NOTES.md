# WebGPU Backend Notes

Status: future-backend design notes only  
Current app version: `0.11.0`  
Implemented substrate backends: `cpu-main`, `cpu-worker`  
WebGPU implementation: **Not started**

## Purpose

The v0.11 substrate architecture separates substrate orchestration from compute implementation through `SubstrateComputeBackend`. This makes a future `webgpu` backend possible without coupling renderers or UI state directly to GPU APIs.

WebGPU should not be introduced until profiling shows that the worker CPU implementation is insufficient for the intended resolutions or future simulation workloads.

## Existing backend contract

Every backend exposes:

```ts
interface SubstrateComputeBackend {
  readonly id: "cpu-main" | "cpu-worker";
  readonly label: string;
  readonly available: boolean;
  compute(input: SubstrateBuildInput): Promise<SubstrateBackendResult>;
  dispose(): void;
}
```

A future implementation would extend the backend ID union with `"webgpu"` while returning the same CPU-readable `SubstrateData` shape:

- Soft mask
- Edge map
- Signed distance field
- Bounds and substrate type
- Phase/build diagnostics
- Backend timing diagnostics

Renderers should continue consuming the existing sampling API. They should not know which backend produced the arrays.

## Candidate GPU pipeline

1. Rasterize glyph paths or upload a CPU-rasterized mask.
2. Generate edge classifications in a compute pass.
3. Build an exact or approximate distance field.
4. Read back mask/edge/distance arrays only when CPU renderers require them.
5. Keep future GPU-native simulations resident on the device where practical.

The largest architectural question is readback. Current SDF renderers sample typed arrays on the CPU. A GPU backend that immediately reads every field back may improve construction time but still pay significant synchronization and transfer costs.

## Availability and fallback

A future backend must:

- Check `navigator.gpu` and adapter/device availability.
- Treat device loss as a recoverable backend failure.
- Fall back to `cpu-worker`, then `cpu-main`.
- Preserve request IDs and stale-result protection.
- Report adapter/device initialization separately from compute timing.
- Never silently label CPU data as GPU-generated.

## Data and precision decisions

Before implementation, decide:

- Storage texture formats for mask, edge, and distance.
- Whether 16-bit float precision is sufficient for the 1200 × 720 world.
- Exact Euclidean distance transform versus jump flooding or another approximation.
- Whether glyph rasterization remains Canvas/worker-based or moves to GPU tessellation.
- Whether readback arrays are required for every renderer.
- How GPU resources are cached by text/font/layout/resolution identity.

## Worker relationship

The first production migration target remains the current `cpu-worker` backend. WebGPU should not replace the worker abstraction; it should become another implementation behind it.

Possible deployment models:

- WebGPU on the main thread with asynchronous commands.
- WebGPU in a dedicated worker where browser support permits.
- Worker orchestration with main-thread device ownership.

These require browser support research and measurement before choosing a model.

## Explicit non-goals for v0.11

- No WebGPU adapter/device creation.
- No WGSL shaders.
- No GPU textures or buffers.
- No GPU renderer integration.
- No reaction-diffusion.
- No persistent particle simulation.
- No raster export.

## Entry criteria for implementation

Implement a WebGPU backend only after:

1. `cpu-worker` is validated across target browsers.
2. Worker build timing is profiled at High and Ultra quality.
3. External vector export compatibility is accepted.
4. A concrete workload exceeds the worker CPU budget.
5. Readback cost and fallback behavior have test plans.
