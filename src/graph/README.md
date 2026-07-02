# Graph IR

This directory defines a minimal, future-facing intermediate representation
and an internal CPU evaluation prototype for a possible node-based SUBSTRATE
workflow.

It is currently:

- not serialized into `.substrate.json` or included in `ProjectState`;
- not a node editor or UI model;
- not a WebGPU runtime or shader graph;
- not a replacement for the renderer registry.

The current renderer registry remains authoritative for preview and SVG export.
`createRendererNodeDefinition()` describes a current `VectorRenderer` as a
geometry-producing node. `buildRendererGraphFromProject()` builds a minimal
one-renderer graph, and `executeGraphCpu()` validates that graph and delegates
to the same synchronous registered renderer.

Execution is a test-only/internal parity prototype. It is not imported by
`App.tsx`, preview components, or `exportSvg.ts`, and it is not authoritative
over any production path. It does not model project controls as nodes, schedule
multi-node graphs, add asynchronous renderer loading, or provide a WebGPU
execution backend.

The graph path must reproduce the checked-in canonical geometry and golden SVG
exports before any product use. A future evaluator, if justified, must retain
that parity and separately define caching, errors, persistence, and migration.

Future graph nodes may provide abstractions over substrate, field, renderer,
appearance, and output stages. General evaluation, migrations, persistence,
UI, and GPU execution remain out of scope until their product contracts are
known.
