# Graph IR

This directory defines a minimal, future-facing intermediate representation
for a possible node-based SUBSTRATE workflow.

It is currently:

- not serialized into `.substrate.json` or included in `ProjectState`;
- not a node editor or UI model;
- not a WebGPU runtime or shader graph;
- not an execution engine;
- not a replacement for the renderer registry.

The current renderer registry remains authoritative for preview and SVG export.
`createRendererNodeDefinition()` is only a type-level bridge showing how a
current `VectorRenderer` can later be described as a geometry-producing node.
It does not alter or execute the renderer.

Future graph nodes may provide abstractions over substrate, field, renderer,
appearance, and output stages. Evaluation, migrations, persistence, UI, and
GPU execution should be designed separately when their product contracts are
known.
