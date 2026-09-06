# Glyph Falloff Displacement Decision

## Purpose

Glyph Falloff Field is a separate mark-space displacement stage. It moves final
circle marks according to the signed distance from the authoritative glyph
contour. It does not reuse emitter distance, Glyph Fragmentation randomness, or
Glyph Micro Warp controls.

## Authority and composition order

The renderer pipeline is:

1. Parsed/native glyph outline.
2. Glyph Micro Warp.
3. Glyph Fragmentation.
4. Authoritative mask and signed-distance substrate.
5. Renderer candidate acceptance, radius, and opacity.
6. Glyph Falloff Field position displacement.
7. Emitter Micro Response and its final occupancy policy.
8. Artboard safety and renderer output.

This order makes the field follow the already-warped and already-fragmented
outline. Applying occupancy after both position stages guarantees that
`exclude-interior` and `disperse-exterior` validate the final circle footprint,
not a stale pre-displacement center.

The immutable `GeometryGroup` produced after step 8 is shared by SVG preview,
Canvas preview, and Final Artwork export. A configured falloff field disables
glyph clipping for supported circle renderers so exterior marks remain visible
on all three surfaces.

## Field definition

For a mark center `p`, let `d(p)` be the signed distance from the authoritative
glyph substrate, positive inside glyph ink. The contour distance is
`q = abs(d(p)) / fieldWidth`.

Only samples with `q < 1` are affected. The envelope is the selected linear,
smoothstep, or Gaussian falloff. Ring frequency is expressed as the number of
complete contour-following cycles across `fieldWidth`:

`phase = 2 * pi * ringFrequency * q`

`signal = sign(cos(phase)) * abs(cos(phase)) ^ ringSharpness`

`offset = strength * envelope(q) * signal`

The negative SDF gradient is the outward normal because the substrate is
positive inside. Positive ring lobes move outward; negative lobes move inward.
The envelope is maximal at the contour and decays to zero at the field edge.

## Compatibility and cache identity

- Project schema version is 13. Version 12 and earlier projects migrate with a
  disabled field and safe defaults.
- Presets reset the field to disabled unless they explicitly author it.
- Disabled state is an exact geometry no-op. Its cache key omits inactive
  parameter values and SDF identity.
- Active cache identity includes every field parameter and the authoritative
  substrate key.
- Default SVG metadata elides the v13-only field and retains the previous
  compatibility version. Active exports retain v13 metadata.

## Performance contract

An active candidate performs one signed-distance read. Candidates inside the
field perform four additional reads for the finite-difference gradient. Work is
therefore bounded to five SDF reads per final-circle candidate, with no random
allocation or global search. Diagnostics expose candidates, affected marks,
SDF reads, safety clips, average/max displacement, and build time.
