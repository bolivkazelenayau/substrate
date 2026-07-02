# Renderer manifests

Renderer manifests provide declarative metadata about the current synchronous
`VectorRenderer` implementations. They make capabilities and geometry
dependencies inspectable without changing renderer algorithms or replacing the
renderer registry.

## Relationship to `VectorRenderer`

The registry and its `VectorRenderer` objects remain authoritative at runtime.
Compatibility fields such as `usesTime`, `usesSubstrate`, and
`supportedControls` remain on `VectorRenderer`. Tests require each parallel
manifest to match those fields, preventing silent drift while the manifest
layer is established.

Renderer loading remains synchronous and eager. This pass adds metadata, not an
asynchronous registry contract, and bundle analysis does not justify adding
that complexity.

## Relationship to Graph IR

`createRendererNodeDefinition()` reads the manifest to describe substrate,
field, and time inputs and a `geometry` output. The internal/test-only CPU Graph
Evaluation Prototype can build a one-renderer graph and delegate its output
node to the same synchronous registry renderer. It does not replace the
registry, appear in the UI, enter schema-v7 project files, or run in production
preview/export paths.

## Dependencies and cache identity

Manifest dependencies describe values that may affect generated renderer
geometry. They are intentionally coarser than individual `ProjectState` keys.

| Dependency group | Current cache identity source |
| --- | --- |
| `time` | `RenderContext.timeMs` and `frame`; time renderers bypass the static cache |
| `substrate`, `textGeometry` | resolved substrate object identity and dimensions |
| `seed` | `ProjectState.seed` |
| `typography`, `text` | text, font reference, font size, tracking, or resolved substrate identity |
| `emitters`, `field` | packed emitter configuration and resolved multi-emitter selection |
| `glyphModulation` | `glyphModulationCacheKey()` |
| `contours` | density, amplitude, turbulence, edge influence, wave mode, and dot settings |
| `halftone` | density, amplitude, edge influence, seed, and glyph modulation |
| `diffuser` | diffuser domain, composition, radius, ring, band, and halo settings |
| `appearance` | not currently declared as geometry-affecting; color-only values are excluded |

Contour stroke thickness is deliberately presentation-only: `contourStrokeWidth`
does not change contour extraction, spacing, point count, or cache identity.
`SDF Contours` and continuous `Wave Contours` resolve it through the renderer
stroke-style hook for both SVG preview and Final Artwork export. Dotted Wave
Contours and unrelated renderers retain the historical shared stroke width.
| `warp` | not renderer geometry; handled by the separate outline/export stage |
| `debug` | runtime-only and excluded from renderer geometry identity |

The tests exercise representative values in these groups. The manifest does not
yet generate the cache key; any future move in that direction requires output
parity measurements and explicit migration tests.

## Adding a renderer

When adding a renderer:

1. register the existing `VectorRenderer` normally;
2. add a matching entry to `rendererManifests`;
3. declare only geometry-affecting dependency groups;
4. keep compatibility flags and supported controls identical;
5. add representative cache-identity coverage for new dependency groups;
6. verify its graph definition has renderer category and geometry output;
7. run lint, typecheck, tests, build, and bundle analysis.
