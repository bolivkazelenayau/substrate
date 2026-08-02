# Emitter Micro Response ownership decision

## Existing behavior

`emitterDisplay` is a released v9 mark-space feature and remains compatibility-owned. Its `field`, `distort`, `exclude`, and `orbit` values combine several artistic behaviors, run before a renderer knows the final mark footprint, use center occupancy, and are deliberately bypassed by SDF Halftone while Display Dislocation is active. Reinterpreting that state would change saved projects.

Glyph Fragmentation remains the parsed-outline/domain authority. Display Dislocation remains SDF Halftone's inverse-domain, coherent-region lattice stage. Neither stage is moved or merged.

## New boundary

Schema v11 adds an independent `emitterMicroResponse` state with orthogonal microstructure and occupancy controls. A shared post-candidate sampler consumes only:

- the resolved active emitter anchors;
- the renderer's final circular candidate footprint;
- the current `RenderContext` substrate and its semantic key;
- the project seed and response settings.

It never rebuilds typography, changes canonical placement, or creates another scene authority.

The composition order is:

1. renderer candidate generation and, where active, Display Dislocation inverse sampling;
2. released `emitterDisplay` behavior at its existing compatibility position;
3. renderer-owned radius and opacity calculation;
4. Emitter Micro Response microstructure;
5. selected occupancy response;
6. final radius-aware SDF clearance and effective-artboard check;
7. immutable circle geometry shared by Canvas, SVG preview, and export.

Glyph Diffuser and SDF Halftone are supported. Other renderer capabilities are declared centrally and remain unchanged. Disabled/legacy state contributes no renderer-key segment and follows the existing byte-stable output path.
