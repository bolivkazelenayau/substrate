# SUBSTRATE UX / interaction quality audit

Audit date: 2026-07-01  
Scope: first-run creative workflow, panel hierarchy, diagnostics layering, and
dense Flow preview navigation  
Constraint: findings only; no artwork, export, renderer, schema, or UI code was
changed

> Implementation update — 2026-07-01: the no-risk disclosure recommendations
> were implemented in UX Disclosure Pass 1. See
> [`UX_DISCLOSURE_PASS_1.md`](./UX_DISCLOSURE_PASS_1.md) and
> [`design-qa.md`](../design-qa.md). This audit remains the before-state
> evidence and rationale.

Evidence is stored in [`docs/ux-interaction-audit/`](./ux-interaction-audit/).

## Audit scope and user goal

The target user is a designer trying to:

1. enter text and optionally load a font;
2. choose a preset and renderer;
3. adjust a small number of visually meaningful controls;
4. inspect the result;
5. export deterministic vector artwork.

The audit asks whether that path remains legible while advanced controls,
preview policy, export policy, legacy debug switches, and developer tools
coexist.

## Evidence steps

| Step | State | Health |
| ---: | --- | --- |
| 1 | [First-run workspace](./ux-interaction-audit/01-first-run.png) | Mixed: strong canvas and export action; preset/renderer are below the fold and telemetry is prominent. |
| 2 | [Preview and export](./ux-interaction-audit/02-preview-export.png) | Mixed: policy copy is clear; operations are dense and require substantial scrolling. |
| 3 | [Compact diagnostics](./ux-interaction-audit/03-diagnostics-compact.png) | Mixed: useful concise data; legacy/debug controls and dev launchers crowd the same area. |
| 4 | [Full diagnostics](./ux-interaction-audit/04-diagnostics-full.png) | Appropriate for developers; too dominant for routine design work. |
| 5 | [Diagnostics off](./ux-interaction-audit/05-diagnostics-off.png) | Better canvas focus; “Off” is incomplete because legacy debug controls remain visible. |
| 6 | [Dense SVG zoom](./ux-interaction-audit/06-svg-zoom-dense-flow.png) | Visually crisp; browser-paint/DOM cost is visible in diagnostics. |
| 7 | [Dense Canvas zoom](./ux-interaction-audit/07-canvas-zoom-dense-flow.png) | More stable under load; visibly softer when enlarged. |
| 8 | [Glyph-bounds overlay](./ux-interaction-audit/08-debug-overlay-glyph-bounds.png) | Functional, but exposes the split between DiagnosticsMode and legacy debug visibility. |

## Strengths

- The black/acid-lime technical identity is distinctive and coherent.
- The artwork canvas, Save Project, and Export SVG actions have strong visual
  hierarchy.
- Text, size, font status, and Load Font are understandable on first view.
- Preview backend copy correctly states that preview policy does not alter
  vector export.
- FIT and zoom controls are compact and remain outside the transformed artwork.
- Full diagnostics provide unusually good evidence for backend, pacing, cache,
  geometry, and DOM behavior.
- Advanced parameters already have a disclosure boundary; the product does not
  need a broad redesign to improve layering.

## Default first-run assessment

| Need | First-run discoverability |
| --- | --- |
| Text | Immediate and clear. |
| Font | Immediate; native fallback status and Load Font are clear. |
| Preset | Present, but below the initial sidebar viewport. |
| Renderer | Present below Preset; nine equal-weight buttons create scanning cost. |
| Seed | Visible in the bottom transport, but visually detached from preset/renderer controls. |
| Intensity | No single concept is named “Intensity”; users must infer Density, Amplitude, and related controls. |
| Export | Excellent: persistent acid-lime header action. |

Diagnostics are too visible by default for a creative first run. Compact mode
places four status blocks over the canvas before the user has requested
technical detail. The native-text export warning is useful and should remain,
but backend, instrument, control, and animation telemetry can start hidden or
move into a compact status strip.

## Panel grouping assessment

- **Artwork:** correct first section. Keep text, size, font state, load/clear
  font, and a small preset shortcut here.
- **Typography:** conceptually correct, but kerning strength, optical strength,
  and vertical offset are advanced for most first-run work.
- **Field:** currently carries Preset, Renderer, primary creative controls, and
  a fully expanded emitter editor. It is the main source of vertical overload.
- **Appearance:** color controls are clear. Renderer-specific overlay, erosion,
  warp, and diffuser appearance should remain available but live in Advanced.
- **Preview:** correctly runtime-only, but “Preview · Advanced Output” is an
  ambiguous name and is numbered `04`, like Appearance and Export.
- **Export:** clear contract, but numeric precision and frame policy are
  advanced; Final Artwork should remain the normal default.
- **Diagnostics:** valuable, but currently combines runtime density,
  v7-compatible debug flags, WebGPU messaging, and separate floating dev tools.

The visible section numbering is inconsistent: Field repeats `02`, while
Appearance, Preview, and Export all use `04`. This weakens the otherwise strong
technical-instrument visual language.

## Recommended Normal / Advanced / Developer layering

### Normal — visible by default

- Text
- Font status and Load/Clear Font
- Preset
- Renderer, ideally as a compact selector or grouped renderer family control
  while retaining every renderer
- Size
- One clearly named creative macro such as **Intensity**, implemented only if a
  non-destructive mapping can be defined
- Density and Amplitude when the active renderer supports them
- Primary/background color and transparency
- Seed with Randomize
- Play/Pause, Reset, FIT
- Final Artwork export action
- Native-font/export warning when applicable

No renderer algorithm or stored value needs to change to create this layer.
The first pass can simply change disclosure and placement.

### Advanced — available but collapsed

- Tracking, alignment, kerning mode/strength, optical spacing, vertical offset
- Frequency, turbulence, edge influence, and renderer-specific controls
- Emitters and multi-emitter editing
- Diffuser, contour, halftone, glyph modulation, erosion, and warp settings
- Preview backend, quality, FPS cap, static preview, and pause-when-hidden
- Editable Text mode
- Export frame and numeric precision
- Project JSON import/save detail

Advanced controls should remain fully available. “Advanced” is an information
layer, not a capability reduction.

### Diagnostics / Developer

- DiagnosticsMode selector
- Legacy substrate/glyph/field overlay toggles
- Renderer/cache/substrate/backend timings
- DOM/path/write counts
- FPS meter
- WebGPU field tools and parity overlays
- Compositing instrumentation

Developer launchers should live inside the Diagnostics panel or a deliberate
developer dock. They should not float over creative controls.

## Top five UX friction points

1. **The primary creative path is split across a long scroll.** Text/font are
   visible immediately; Preset and Renderer are not.
2. **There is no clear “make it stronger/weaker” control.** Density and
   Amplitude are technically precise but require model knowledge.
3. **Field is overloaded.** Preset, nine renderer choices, shared controls, and
   the expanded emitter editor compete at equal hierarchy.
4. **Diagnostics ownership is visible to users.** DiagnosticsMode can be Off
   while legacy debug controls and developer copy remain present.
5. **Panel naming/numbering undermines orientation.** Repeated `02`/`04` labels
   and “Preview · Advanced Output” make the sidebar feel assembled from passes
   rather than one deliberate workflow.

## Top five interaction performance issues

1. **Dense SVG remains browser-paint-sensitive.** At 1,564 marks the tested
   scene reported about 28.2 FPS, 35.5 ms draw interval, 1,564 SVG DOM elements,
   and `SVG DEBUG / SLOW`.
2. **Crisp SVG zoom trades compositing blur for repaint work.** This is the
   right visual default, but large scenes can feel heavier during navigation.
3. **Canvas zoom is faster-looking but visibly soft at high scale.** At 258%,
   marks lose the crispness of SVG even though Canvas held about 30.3 FPS and
   reported roughly 1.0 ms draw time.
4. **Full diagnostics cover and visually update across the artwork.** The
   diagnostic refresh is throttled, but dense text and changing metrics add
   perceptual noise during interaction.
5. **Debug overlays can compound preview work independently of
   DiagnosticsMode.** Users can enable legacy overlays while runtime
   diagnostics are Off, making performance state difficult to reason about.

These measurements are one captured scene, not a cross-browser benchmark.

## No-risk improvements

1. Default `DiagnosticsMode` to Off for new sessions while preserving the
   user's explicit runtime preference when preference storage exists.
2. Move FPS Meter and GPU Field Debug launchers into the Diagnostics disclosure;
   keep them dev-only.
3. Correct section numbering and rename “Preview · Advanced Output” to
   **Preview**.
4. Collapse Emitters by default unless the active preset/renderer requires
   emitter input.
5. Move Preset and Renderer directly below Artwork/font, above detailed
   Typography.
6. Keep only the native-font/export warning on the normal canvas; reveal
   backend/instrument/control/animation blocks in Compact or Full on demand.
7. Add short helper copy: “Preview only—does not affect SVG export” beside the
   backend selector, retaining the current contract language.
8. Show a small **Canvas: faster / SVG: crisper** comparison in Preview.

These are hierarchy, copy, default-disclosure, and placement changes. They do
not alter project values, geometry, or export.

## Risky improvements to defer

1. **A single Intensity macro.** It could be excellent UX, but mapping one
   control across renderer-specific parameters may change artwork and requires
   explicit per-renderer semantics and migration policy.
2. **Automatic backend switching during navigation.** Switching SVG to Canvas
   while zooming could improve responsiveness but risks visual popping, state
   confusion, and violating explicit backend selection.
3. **Composited SVG navigation by default.** It may reduce repaint cost but
   reintroduces blur; keep it as instrumentation until browser-specific data
   justifies a policy.
4. **Virtualizing or replacing SVG preview geometry.** This can diverge from
   accuracy expectations and needs visual/parity acceptance criteria.
5. **Unifying or deleting legacy debug flags before schema v8.** V7 requires
   lossless compatibility; defer ownership cleanup to the planned migration.

## Accessibility risks

- Most range controls expose the accessible name “Double-click to reset”
  instead of the parameter name. Screen-reader users may hear many
  indistinguishable sliders.
- Several controls use small, low-contrast uppercase labels. The visual style
  is coherent, but contrast and text-size measurements need formal checking.
- Floating developer buttons overlap sidebar content at 1280 × 720, creating
  target obstruction and reading-order ambiguity.
- Dense telemetry uses very small text and long unbroken rows in Full mode.
- Renderer selection is a group of buttons, but selected-state communication
  should be verified with keyboard and assistive technology.
- The canvas warning uses color and a bordered box effectively, but live status
  announcement frequency should be checked to prevent repeated screen-reader
  interruptions.

## Evidence limits and verification gaps

- Only the Codex In-app Browser was available. Separate Chrome, Safari, and
  Firefox targets were not exposed, and the browser engine could not be
  identified reliably. Cross-browser repaint claims remain unverified.
- Wheel zoom and FIT were exercised. Space-drag/middle-button pan could not be
  reproduced with the available automation controls.
- Native fallback was exercised. Uploaded-font testing was blocked because the
  browser control surface did not provide a supported local-file chooser.
- No console warnings or errors were observed during the captured flow.
- Screenshots and DOM inspection cannot establish full keyboard, screen-reader,
  contrast, or WCAG compliance.

## Recommended next action

Implementation status: **completed by UX Disclosure Pass 1**.

Run one narrow implementation pass limited to default disclosure and control
placement:

1. make the creative path Artwork → Preset/Renderer → core Field → Appearance;
2. collapse Emitters, Preview, Export details, and Diagnostics by default;
3. move dev launchers into Diagnostics;
4. fix section labels/numbers;
5. preserve every existing control and all current state/export behavior.

Then repeat this audit in named Chrome, Firefox, and Safari environments with a
real uploaded font and manual space-drag/middle-button pan.
