# SUBSTRATE UX interaction audit capture notes

Captured: 2026-07-01  
Target: local Vite development build at `127.0.0.1:5173`  
Viewport: 1280 × 720  
Available browser target: Codex In-app Browser only

## Step 1 — First-run workspace

Evidence: `01-first-run.png`

- The artwork canvas and Export SVG action dominate appropriately.
- Text, size, and font are immediately visible.
- Preset and renderer are below the initial sidebar viewport.
- Four compact diagnostic blocks and an export warning compete with the artwork
  before the user asks for diagnostic detail.
- FPS and GPU developer launchers overlap the lower-left sidebar region.

## Step 2 — Preview and export controls

Evidence: `02-preview-export.png`

- Preview settings clearly state that the backend is preview-only and export
  remains vector.
- Preview and Export are adjacent, but both use section number `04`.
- Reaching these settings requires a long sidebar scroll.
- Export mode, frame mode, numeric precision, import, preview backend, quality,
  frame cap, and pause policy produce a dense operations block.

## Step 3 — Compact diagnostics

Evidence: `03-diagnostics-compact.png`

- Compact mode provides useful backend, renderer, control, and animation status.
- The sidebar still exposes the complete legacy debug-control matrix.
- Developer launchers overlap nearby diagnostics controls at this viewport.

## Step 4 — Full diagnostics

Evidence: `04-diagnostics-full.png`

- Full mode exposes actionable cache, backend, generation, pacing, and DOM
  metrics.
- The overlay becomes a dense telemetry table spanning the artwork.
- This mode is suitable for developer investigation, not routine creation.

## Step 5 — Diagnostics off

Evidence: `05-diagnostics-off.png`

- Artwork telemetry blocks are hidden as expected.
- The native-text export warning remains because it is an export warning rather
  than runtime diagnostics.
- The diagnostics sidebar still shows legacy debug toggles and the WebGPU note,
  so “Off” does not read as a fully quiet creative mode.

## Step 6 — Dense Flow in SVG Accuracy at 258%

Evidence: `06-svg-zoom-dense-flow.png`

- SVG remains crisp when enlarged.
- At the tested 1,564-mark scene, runtime diagnostics reported approximately
  28.2 FPS, 35.5 ms draw interval, 1,564 SVG DOM elements, 24 grouped Flow
  paths, and `SVG DEBUG / SLOW`.
- Wheel zoom reached 258% and retained the crisp 2D transform.

## Step 7 — Dense Flow in Canvas Performance at 258%

Evidence: `07-canvas-zoom-dense-flow.png`

- Canvas reached the same zoom state with visibly softer scaled marks.
- Runtime diagnostics reported approximately 30.3 FPS, 33.0 ms draw interval,
  1.0 ms Canvas draw time, and zero SVG DOM marks.
- This backend feels more stable under the tested load, but the scale-quality
  tradeoff should remain explicit.

## Step 8 — Legacy glyph-bounds overlay

Evidence: `08-debug-overlay-glyph-bounds.png`

- The overlay can be enabled while DiagnosticsMode is Off.
- This confirms two independent visibility systems: runtime diagnostic density
  and legacy debug overlays.
- The distinction is architecturally valid for v7 compatibility but difficult
  to explain in the current control hierarchy.

## Evidence limits

- The browser service exposed only one in-app browser target. Separate Chrome,
  Safari, and Firefox runs were unavailable, and the in-app target did not
  expose a trustworthy browser-engine identifier.
- Space-drag/middle-button pan could not be reproduced with the available
  automation controls; zoom and FIT were tested.
- Native text fallback was tested. The browser control surface did not expose a
  supported local-file chooser operation, so uploaded-font interaction was not
  completed.
- Screenshots and DOM inspection can identify likely accessibility risks, but
  they do not establish WCAG conformance or screen-reader behavior.
- Gesture command elapsed time includes automation overhead and is not treated
  as a browser paint benchmark. On-screen SUBSTRATE diagnostics are used for
  the renderer comparison.
