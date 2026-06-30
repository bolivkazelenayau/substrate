# Bundle audit — Modular Refactor Pass 2

Measured with `npm run analyze` on 2026-06-30. The command performs a
production Vite build and writes an interactive treemap to
`dist/bundle-report.html`. `dist` remains a local, ignored build artifact.

## Production output

| Output | Minified | Gzip |
| --- | ---: | ---: |
| Main application JavaScript | 627.92 kB | 185.07 kB |
| Substrate worker | 5.97 kB | — |
| CSS | 15.55 kB | 3.73 kB |

The report contains one main application chunk and the existing worker chunk.
There are no production chunks for dev overlays, WebGPU, or experiments.

## Largest modules

Visualizer module sizes are attribution estimates before final chunk
minification; per-module gzip values are calculated independently and are not
additive.

| Module | Rendered attribution | Independent gzip |
| --- | ---: | ---: |
| `react-dom/cjs/react-dom-client.production.js` | 552,879 B | 95,428 B |
| `opentype.js/dist/opentype.mjs` | 486,381 B | 96,169 B |
| `src/components/Viewport.tsx` | 41,971 B | 6,510 B |
| `src/engine/substrate/backends/cpuWorkerBackend.ts` | 18,368 B | 5,137 B |
| `src/components/panels/EmitterControls.tsx` | 17,624 B | 2,771 B |
| `src/engine/renderers/glyphDiffuserRenderer.ts` | 15,785 B | 4,140 B |
| `src/App.tsx` | 15,304 B | 4,061 B |

`opentype.js` is a major contributor: its independently compressed attribution
is about 96 kB, roughly 52% of the final main chunk's gzip size. It is loaded by
the user-facing custom-font path, so Pass 2 records the cost rather than
changing font behavior or loading semantics.

## Boundary findings

- WebGPU preview, parity diagnostics, benchmarks, and GPU UI modules do not
  appear in the production bundle. The WebGPU and FPS overlays now use
  `import.meta.env.DEV`-guarded dynamic imports, making their load timing and
  intended boundary explicit in development.
- The Comlink spike and the `comlink` package do not appear in the production
  bundle. Comlink is classified as a dev dependency and remains isolated under
  `src/experiments`.
- All current `VectorRenderer` implementations are eagerly included in the main
  chunk through the renderer registry. This is intentional for this pass:
  replacing or asynchronously restructuring that registry is a non-goal.
- Production Canvas/SVG preview modules are present because they implement
  normal product preview behavior. Preview runtime diagnostics that survive
  tree-shaking are small; no heavy dev benchmark or overlay UI is present.

## 500 kB warning

The warning is caused by the shipping product graph and its production
dependencies, not by dev-only WebGPU diagnostics or Comlink. Both product code
and dependencies contribute, but React DOM and `opentype.js` dominate the
module attribution. Eager renderers and the current product UI add the remaining
weight. Pass 2 does not split renderers or alter font loading because either
change has a wider behavior/runtime contract than this boundary pass.

## Recommendation

Retain the warning as a measurement signal. A future measured optimization
should evaluate lazy custom-font parsing first, then renderer loading only if a
stable asynchronous registry contract is designed. Neither should be changed
without interaction, export-parity, and latency measurements.
