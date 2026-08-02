# Glyph Micro Warp geometry authority

## Decision

Glyph Micro Warp is a parsed-outline derivation stage, not a renderer or presentation effect. The production order is:

1. immutable base parsed typography geometry;
2. optional deterministic Glyph Micro Warp;
3. optional existing coarse Glyph Fragmentation;
4. one final typography-domain geometry and key;
5. scene layout, mask, SDF, fields, renderers, preview, and export;
6. renderer-local Display Dislocation candidates;
7. post-candidate Emitter Micro Response marks.

Micro Warp precedes Fragmentation so it changes local surface character first and existing fragment modes then move coherent warped pieces. Display Dislocation intentionally suppresses coarse Fragmentation as before, but now samples the fine-warped authoritative mask. No feature builds a parallel mask.

## Geometry and safety

Parsed curves are deterministically flattened to a bounded contour sample set. Each point receives a smooth world-space, seeded normal component plus an independently authored restrained tangent component. Up to eight emitter contributions are blended with a continuous union weight; there is no nearest-emitter partition.

Displacement is limited by the authored maximum and, when counter preservation is enabled, by local sample spacing. Contour direction and signed area are checked. New self-intersections are checked under a deterministic comparison budget. Unsafe contours are progressively backed off and ultimately restored to their source contour. The stage reports point-budget, clamp, and topology status rather than emitting a partial invalid path.

## Identity and fallback

The focused key includes the source typography output key, resolved emitter identities/positions/weights/radii/phases, seed when active, and every consumed warp parameter. Camera, pan, zoom, FIT, DPR, backend, trace/diagnostics, panels, and mark-space response settings are excluded.

Disabled, zero-strength, missing-emitter, and native-fallback paths return the exact source geometry object and source key. Native fallback is explicitly unsupported; the UI does not claim that native text has been warped.
