# SUBSTRATE Product / Design / UX System Audit

Date: 2026-09-06  
Scope: audit only; no application code, renderer behavior, schema, snapshots, or goldens changed.

## EXECUTIVE ASSESSMENT

Score convention: 10 is strong for the first seven dimensions. For **accidental complexity**, 10 means the problem is severe.

| Dimension | Score | Assessment |
|---|---:|---|
| Conceptual clarity | 4/10 | The engine has a coherent pipeline, but the rail does not teach it. |
| UI density | 3/10 | Density is appropriate to an instrument; the problem is excessive permanent height and equal visual priority. |
| Control discoverability | 5/10 | Major systems are findable, but stage, scope, reset behavior, pan gestures, and inactive-state meaning are not. |
| Parameter coherence | 4/10 | Many controls are valid, but naming, units, ranges, defaults, and parent/child relationships are inconsistent. |
| Mode coherence | 4/10 | Renderers are distinct; deformation and emitter-response modes have unclear boundaries and masking rules. |
| Workflow predictability | 5/10 | Direct edits generally retain state, but presets and renderer/effect interactions cause avoidable surprises. |
| Expert power | 9/10 | The app exposes unusually strong, deterministic control over geometry, fields, marks, rendering, and export. |
| Accidental complexity | 8/10 | Duplicate surfaces, no-op controls, mixed stages, Lab parameters, and historical naming materially burden use. |

### Is SUBSTRATE currently too complicated for what it does?

**Yes.** Not because it has too many meaningful creative dimensions. SUBSTRATE earns explicit typography, emitter, glyph-deformation, mark-response, renderer, and export controls. It is too complicated because the UI presents most implementation layers as equal peers, repeats some state through multiple control surfaces, keeps inactive systems physically present, and lets a few state transitions silently suppress or reset other systems.

The clearest example is not “too many sliders.” It is that a user can see **Glyph Fragmentation** as enabled while **Display Dislocation** silently prevents that fragmentation stage from being built. Similarly, **Single** and **Multiple** emitter modes show separate “single” and “global” field forms even though both edit the same shared emitter definition. Those are product-model problems, not density preferences.

The correct next move is a hierarchy and semantics pass, not a simplification-to-one-knob pass.

### Audit coverage and limitations

I exercised the running app in the in-app browser with the default native-text fallback and a loaded outline font (`tests/fixtures/Basic-Regular.ttf`). I tested all nine renderers, the current preset set, single and multiple emitters, custom emitter placement, Micro Warp, Calm Water, all Fragmentation modes, Display Dislocation, Glyph Falloff Field, Emitter Micro Response occupancy modes, Canvas/SVG preview choices, export settings, project save/import, legacy v1 import, zoom/fit/pan, multiline type, extreme type size/line height, diagnostics, and 1280×800 / 1440×900 desktop viewports.

Accessibility coverage was a focused structural pass, not a WCAG conformance audit. I checked browser accessibility exposure for representative controls and found a significant slider-label problem; I did not complete exhaustive keyboard-only, screen-reader, color-contrast, forced-colors, or motion-preference testing.

### Audited workflow health

1. **Default project → compelling result: Minor issues.** The default is immediately generative, but native fallback disables the defining glyph-geometry systems and shows a persistent export warning before the user has made an export decision.
2. **Preset → personalization: Major issues.** Presets are strong recipes, but selecting one resets many unrelated feature states; typography sometimes remains personal and sometimes changes, depending on preset.
3. **Change typography after deformation tuning: Minor issues.** Geometry recalculates coherently and deformation values persist. Large multiline/size changes auto-grow the effective artboard, but the relationship between source layout, artboard, and camera is not taught.
4. **Change renderer late: Major issues.** State retention is valuable, but inherited values can make a renderer almost empty or immediately clipped by `maxNodes`; incompatible controls remain visible with stale values.
5. **Add/move/change emitters late: Minor issues.** Changes are immediate and deterministic. The conceptual split between emitter definition, influence, and downstream response is unclear.
6. **Disable and re-enable effects: Healthy with one critical exception.** Values normally persist and exact no-op behavior is good. Display Dislocation silently masks enabled Fragmentation.
7. **Load an older project: Minor issues.** v1 migration succeeded with a clear warning. Outline font binaries are not embedded, so the user must re-upload the referenced font.
8. **Export: Minor issues.** Deterministic vector export is strong and readiness is authoritative. Warnings can dominate the canvas, project import is filed under Export, and completion feedback is easy to miss.
9. **Return and continue editing: Minor issues.** Project JSON restores creative state, but not the actual font resource or local preview preferences; the resumed project can therefore look and behave differently until the font is restored.

## A. CURRENT PRODUCT MODEL

The UI currently presents SUBSTRATE as a long stack of controls:

1. Artwork
2. Advanced Typography
3. Preset / Renderer
4. Core Field
5. Emitters
6. Emitter Micro Response
7. Glyph Falloff Field
8. Glyph Influence
9. Glyph Micro Warp
10. Calm Water
11. Glyph Fragmentation, with Dot Matrix and Display Dislocation inside the same component family
12. Advanced Parameters
13. Appearance
14. Preview
15. Export
16. Diagnostics

This implies a product model of “choose output, then tune a sequence of effect blocks.” The numbering suggests only seven main sections, but the unnumbered feature blocks between 03 and 04 are effectively first-class sections. The user is not shown whether a block changes source contours, field evaluation, renderer candidates, final marks, the preview backend, or export only.

The result feels like an accumulated control console rather than a readable signal chain. That is appropriate aesthetically but not semantically: a laboratory instrument still needs a legible diagram of what each subsystem measures or modifies.

## B. ACTUAL ENGINE MODEL

Runtime behavior and source architecture indicate this conceptual pipeline:

1. **Project and typography source** — text, font metadata/resource, size, tracking, line height, kerning, alignment, vertical offset.
2. **Parsed glyph geometry** — exact outlines when a TTF/OTF resource is loaded; approximate browser/native-text fallback otherwise.
3. **Glyph-domain deformation authority, in order**
   - Glyph Micro Warp: fine emitter-local contour deformation.
   - Calm Water: broad contour-normal deformation of the already micro-warped outline.
   - Fragmentation / Slice: coarse cuts or domain transformation of that geometry.
   - Exception: active Display Dislocation suppresses Fragmentation consumption while retaining its authored state.
4. **Scene layout / effective artboard** — authored artboard plus overflow-aware effective bounds and typography placement.
5. **Substrate construction** — masks, edges, signed distance, gradient, and occupancy derived from authoritative glyph geometry.
6. **Emitter field** — shared radial-wave definition plus one or more source instances, scopes, per-row weights/phase/radius, and blend.
7. **Renderer geometry** — one of nine genuinely different mark/output models.
8. **Mark-space response and composition** — Glyph Falloff displacement, renderer-supported Display Response, Emitter Micro Response/occupancy, Dot Matrix, Display Dislocation, diffuser composition, overlays, and related renderer-local treatments.
9. **Preview presentation** — SVG DOM or Canvas 2D chosen from a user preference plus runtime element-count/capability logic; preview quality and frame rate are non-authoritative.
10. **Authoritative export** — immutable CPU/vector snapshot, current frame or deterministic time zero, final artwork or editable text representation, validation, precision, and budget warnings.

The engine model is substantially more coherent than the rail. The code comments around `src/App.tsx:141–167` describe the glyph pipeline more clearly than the product UI does.

## C. MISMATCHES

| UI implication | Engine reality | Consequence |
|---|---|---|
| “Core Field” owns emitters, Micro Response, and Glyph Falloff | Those affect different stages: field definition, final mark response, and SDF contour displacement | Users cannot predict whether a change alters geometry, marks, or only eligible renderers. |
| Glyph Influence appears as a standalone effect | It is a shared envelope consumed by selected emitter-local glyph-domain effects | Its “enabledness” and consumers are not visible; it can feel like a no-op. |
| Micro Warp, Calm Water, and Fragmentation are adjacent but unordered peers | They are a strict geometry chain: Micro Warp → Calm Water → Fragmentation | Layering and downstream consequences are hidden. |
| Display Dislocation appears beside Fragmentation | It is a renderer-local inverse-domain display/mark effect that suppresses Fragmentation | Two apparently active systems do not actually compose. |
| “Canvas Performance” is an explicit backend choice | It is a preference: static renderers under 500 elements still use SVG DOM, while high-count views switch to Canvas | The label promises more backend certainty than exists. |
| Renderer buttons look like visual styles | They are distinct geometry/output models with different capabilities and parameter sensitivity | Late renderer switching can inherit unsuitable values and produce faint or clipped output. |
| Single and Multiple emitters imply two field models | Both edit the same shared `state.emitter`; Multiple adds source-instance rows | The user sees duplicate “single” and “global” fields for one concept. |
| All visible controls appear safely editable | Unsupported/no-effect renderer controls often remain visible, preserve checked/value state, and can be edited | The rail becomes longer and users cannot distinguish dormant state from current authority. |
| Save project suggests full resumability | JSON stores font metadata, not the outline font binary; import clears the loaded resource | A resumed project can fall back to approximate native text until the font is re-uploaded. |
| Presets read as style recipes | Applying any named preset first resets every newer deformation/mark-response subsystem to base state | Presets behave like broad hidden state resets. |

## D. DUPLICATION TABLE

| Controls involved | Why they overlap | Real or superficial? | Recommended treatment | Confidence |
|---|---|---|---|---:|
| **Keep particles outside glyph** + **Occupancy** (`Legacy`, `Exclude interior`, `Disperse exterior`) | The checkbox maps the same state to `exclude-interior`/`legacy` while the select exposes all three values | **Real duplicate** | Remove the checkbox from normal UX; retain the explicit three-state Occupancy control with clearer outcome labels | Very high |
| Emitter **Single** field form + Multiple emitter **Global** field form | Both edit the same shared emitter enabled/strength/frequency/phase/radius/falloff/self/neighbor values | **Real presentation duplicate**, not duplicate engine state | Show one persistent **Field Definition**; mode only changes the **Sources** list | Very high |
| `Density`, `Amplitude`, emitter `Strength`, response `Strength`/`Amount` | All increase visible activity in some states | Mostly superficial | Keep distinct, but add stage/scope labels; do not create one global “amount” | High |
| Parent field `Frequency`, emitter `Wave frequency`, Falloff `Ring frequency`, Micro Warp `Detail scale`, Calm `Wavelength`/`Rhythm multiplier` | All control spatial rhythm, but in different domains and units | Partially overlapping mental dimension; technically independent | Keep independent rhythms. Express them consistently as wavelength/cycles or parent-linked multipliers. Calm Water’s linked multiplier is the best current pattern | High |
| Glyph Influence `Radius`/`Edge softness` + feature-specific response radii/falloffs | Multiple systems define emitter-local envelopes | **Partial real overlap** | Use shared Glyph Influence by default; reveal local override only where the runtime genuinely needs a separate domain | High |
| Emitter **Display Response** + **Emitter Micro Response** | Both move/suppress/disperse rendered marks around emitters | Perceptually overlapping, technically different stages | Present one outcome-level **Mark Response** area with clearly ordered sub-stages; move Micro Response internals to Advanced/Lab | High |
| **Glyph Micro Warp** + Glyph Diffuser **Warped Outline** | Both say “warp” and affect a visible outline | Naming overlap only | Keep both; rename/scope the latter as renderer-local **Overlay Warp** and label it “Glyph Diffuser only” | Very high |
| Fragmentation **Domain Warp** + Glyph Micro Warp | Both deform whole contours without obvious slicing | Partial perceptual overlap | Keep capability, but move Domain Warp out of “Fragmentation” or demote it to Advanced/Lab unless further differentiated | Medium-high |
| `selfInfluence`/`neighborInfluence` in shared emitter + per-row influence `Scope`/`Neighborhood` | Both define who receives an emitter contribution | Complementary but currently ambiguous | Group under **Influence Targeting**, explain shared gain vs per-source eligibility | High |
| Range defaults in `rangeDefaults`, `advancedDefaults`, and panel-local `defaults` objects | Reset values and range semantics are repeated across UI modules and keyed by user-facing labels | **Real internal duplication affecting UX** | Move display bounds/default/reset metadata into stable parameter descriptors; keep schema hard limits separate | High |

### Important non-duplicates

- **Density** and **Amplitude** are not substitutes: density changes sampling/mark count while amplitude changes response magnitude.
- **Emitter radius** and **emitter strength** are not substitutes: coverage and magnitude should stay separate.
- **Micro Warp**, **Calm Water**, and slice/grid/radial Fragmentation are visually and semantically distinct enough to preserve.
- **Final Artwork SVG** and **Editable Text SVG** represent different deliverables and should remain explicit.
- Renderer-local frequency/detail controls should not all be collapsed into one value; they need a clearer parent/override model, not false unification.

## E. CONTROL CLASSIFICATION

### A — Core creative control

- Text, outline-font status/load/replace/clear, size.
- Tracking, line height, kerning mode, alignment, and vertical position; these can remain one disclosure level below text/size.
- Preset and renderer/output model.
- Density and amplitude where supported.
- Emitter on/off, source glyph/position, main strength, radius, falloff, and single/multiple source choice.
- Multiple-emitter source rows: glyph, enabled, scope, and a compact per-source weight.
- Glyph Influence target/scope and shared envelope when any consumer is active.
- Enable + one primary amount for Micro Warp, Calm Water, Fragmentation, Glyph Falloff, Display Response, Dot Matrix, and Display Dislocation when supported.
- Fragmentation visual mode where the modes remain perceptually distinct.
- Primary/outline/background colors.
- Final vs editable export, transparent background, current vs deterministic frame.

### B — Contextual / advanced control

- Emitter phase, self/neighbor gain, blend, per-row phase/radius multiplier/neighborhood size.
- Micro Warp response radius, detail scale, normal/tangent balance, quantization.
- Calm rhythm linkage, multiplier or wavelength, surface variation, drift, detail.
- Fragment region size, gap, offset steps, direction, radial/tangential bias, jitter, rotation.
- Glyph Falloff field width/falloff/ring frequency/sharpness.
- Renderer-specific contour thickness, wave contour mode, diffuser domain/composition/dot radius, overlay selection.
- Preview strategy/backend truth, static preview, pause when hidden.
- Numeric precision in Export Advanced.

### C — Preset-authoring / Lab control

- Micro Warp detail octaves, maximum displacement, preserve-counters, seed influence.
- Fine emitter frequency in raw cycles-per-world-unit form.
- Emitter Micro Response position detail, density breakup, detail scale, max displacement, shell, push/tangent/divergence internals.
- Diffuser ring contrast, ring sharpness, band width, halo padding, erosion width, interior protection.
- Overlay warp scale, smoothing, edge bias, maximum displacement.
- Glyph Field Modulation mode and its influence/displacement/density/radius/opacity decomposition.
- Display Dislocation low-level region/gap/steps/alternation/radial-bias/seed set.
- `maxNodes`, substrate quality, preview opacity-level quantization, and FPS cap.

### D — Debug / diagnostic control

- Diagnostics visibility, substrate mask/edge/signed-distance/gradient views.
- Bounds, mark origins, emitter/wave overlays, mark count, frame time, export cost estimate.
- FPS meter and WebGPU field debug controls.

These are useful engineering tools and should remain accessible in development or an explicit Diagnostics workspace, not in the normal numbered authoring path.

### E — Redundant / deprecated

- **Keep particles outside glyph** checkbox: redundant with Occupancy.
- Duplicate Single/Global shared emitter form: consolidate the presentation, not the underlying shared field.
- “Preview-only export kind” product machinery currently classifies every preset as vector. It is harmless architecture, but the dormant branch should not surface product complexity until a preview-only preset actually exists.

### Range quality

| Parameter family | Runtime assessment | Recommended scale/treatment |
|---|---|---|
| Typography size (1–540 soft; higher hard limit) | Useful, but most exact entry behavior is hidden behind double-clicking the numeric readout; large values auto-grow the scene | Keep nonlinear/dynamic soft range and expose obvious numeric entry. Explain authored vs effective artboard when it grows |
| Tracking −10–18, line height 0.5–4, vertical offset ±120 | Broadly useful; endpoints are meaningful but layout consequences can move art outside the current fit | Linear is appropriate; add fit/overflow feedback rather than shrink ranges |
| Density 10–80 | Useful across renderers, but perceptual effect and performance cost differ sharply | Keep linear creative control; show renderer-specific cost/readout separately |
| Amplitude 2–44 | Useful but renderer-dependent | Keep linear, with renderer-specific defaults/recipes rather than changing the range globally |
| Emitter wave frequency 0.005–0.5 | Exposes implementation units; the linear range over-allocates dense oscillation and the value is hard to interpret | Prefer logarithmic wavelength/frequency mapping or show “wave spacing” plus an advanced numeric value |
| Emitter phase −6.28–6.28 | Both ends are the same cyclic phase and radians are implementation language | Use a cyclic/normalized “phase” display (±1 turn or 0–360°); keep exact radians in Lab if required |
| Emitter radius up to the artboard diagonal | Coverage is meaningful, but visual change is compressed as the circle exceeds the composition | Use area-aware/nonlinear slider shaping and an “entire artwork” endpoint; zero remains meaningful |
| Glyph Influence radius/softness | Both are meaningful and produce different envelope shapes; zero is valid | Keep explicit, but show a compact envelope preview or “core / feather” naming |
| Micro Warp strength 0–100 | High values remained useful and topology-safe with a loaded font | Keep normalized linear amount; demote caps/octaves/seed internals |
| Calm Water strength 0–24 | Much of the range can look subtle under some renderers because presentation masks contour differences | Keep the range, but preview this stage against an outline when tuning or provide renderer-aware starting values |
| Fragmentation strength (mode-dependent 0–80 or 0–220) | Mode-dependent range is justified, but the same label changes physical meaning | Use a normalized top-level Amount and keep physical displacement as an advanced mode-specific value |
| Display Dislocation / Dot Matrix geometry | Strong and useful for SDF Halftone; values are irrelevant elsewhere | Preserve ranges but render only in the active renderer context |
| Numeric precision 0–3 | Clear, stepped, and appropriately technical | Keep stepped in Export Advanced |

Zero is usually meaningful and should remain reachable. The more important problem is not endpoint count; it is that soft UI ranges and schema hard bounds diverge, imported values may exceed what the current slider can reproduce, and reset values are hidden behind an undiscoverable double-click. Typography supports typed hard-limit values; many newer feature controls do not.

## F. MODE AUDIT

| Mode family | Verdict | Recommendation |
|---|---|---|
| **Renderers:** Flow Lines, Ripple Lines, Dot Field, SDF Flow, SDF Streamlines, SDF Contours, SDF Halftone, Wave Contours, Glyph Diffuser | All nine produce materially different output models and deserve to remain | Present them as **Output Models**, not mere styles. Contextualize their owned controls and provide per-renderer starting recipes on late switches |
| **Emitter count:** Single / Multiple | First-class distinction is valid | One shared Field Definition plus a source list; Single is one source, Multiple is N sources |
| **Emitter source:** Center, Centroid, Counter center, Custom | Distinct and useful | Keep; clarify geometric vs heuristic anchors. Custom should explicitly explain why scope becomes all typography |
| **Falloff:** Smoothstep, Gaussian, Linear | Expert-useful and perceptually distinct near envelope boundaries | Keep Advanced; consider a tiny curve glyph rather than more text |
| **Blend:** Add / Max | Meaningful for overlapping emitters | Keep with Multiple sources; hide for Single |
| **Display Response:** Field/legacy, Distort, Exclude, Orbit/disperse | Useful outcome modes for supported renderers | Keep as renderer-conditional Mark Response. Rename “Field/legacy” to a perceptual default label and move “legacy” to secondary copy |
| **Micro Response occupancy:** Legacy, Exclude interior, Disperse exterior | Three valid policies | Keep one three-state control; remove the duplicate checkbox; detailed motion components go to Lab |
| **Glyph Falloff Field:** Off / Contour rings | Distinct mark-space displacement | Keep Advanced under Mark Response, not Core Field |
| **Glyph Micro Warp:** Off / on | Distinct fine glyph-domain system | Keep first-class within ordered Glyph Geometry |
| **Calm Water:** Off / on; linked/unlinked rhythm | Distinct broad glyph-domain system | Keep first-class. Linked rhythm is an excellent parent/child model; independent wavelength is Advanced |
| **Fragmentation:** Horizontal, Vertical, Grid, Radial | Each produced distinct geometry | Keep first-class modes |
| **Fragmentation: Domain Warp** | More subtle and conceptually closer to deformation than fragmentation | Keep capability, but move to an Advanced “Domain deformation” branch or Lab unless its visual identity is strengthened |
| **Slice influence:** Global/legacy vs Emitter falloff | Changes both targeting and which radius/falloff controls exist | Keep but rename to “Targeting: Global / Emitter envelope”; do not silently swap parameter models without a summary |
| **Dot Matrix** | A meaningful SDF Halftone generator | Keep renderer-specific; it should not remain a tall disabled group under other renderers |
| **Display Dislocation:** Horizontal bands, Vertical bands, Blocks | Distinct display-space patterns | Keep renderer-specific, but do not allow the UI to imply composition with Fragmentation when the engine suppresses it |
| **Wave contours:** Continuous / Dotted | Distinct renderer output | Keep inside Wave Contours setup |
| **Diffuser domain/composition/overlay modes** | Meaningful expert dimensions | Keep scoped to Glyph Diffuser; move fine overlay warp/erosion detail to Advanced |
| **Glyph field modulation:** Off / Subtle / Strong | Behaves like preset-authoring macro over several component values | Keep Advanced/Lab, not as a general first-class mode |
| **Preview:** Canvas Performance / SVG Accuracy | Useful truth for experts, but not a creative mode and current labels overstate deterministic selection | Rename to Preview Strategy: Auto/Fast and Force SVG, while still reporting actual backend |
| **Preview quality/FPS/static** | Operational, not creative | Keep in Performance disclosure; default automatically where possible |
| **Export:** Final Artwork / Editable Text; Current / Time zero | Distinct deliverables and temporal authority | Keep explicit and close to the export action |
| **Diagnostics modes/views** | Developer-facing | Move out of primary numbered workflow |

### Can users understand the glyph-deformation distinctions today?

Not reliably. The distinctions are real, but the names alone do not communicate **stage, scale, and target**:

- **Micro Warp** — fine contour deformation, emitter-local, before mask/SDF.
- **Calm Water** — broad coherent contour waves, after Micro Warp.
- **Fragmentation / Slice** — coarse segmentation/domain displacement, after Calm Water.
- **Display Dislocation** — SDF Halftone display/mark displacement, not glyph fragmentation.
- **Emitter Display Response** — renderer candidate placement/masking behavior.
- **Emitter Micro Response** — final-footprint micro-displacement and occupancy.

The clearer model is not fewer capabilities. It is two ordered families:

- **Glyph Geometry:** Micro Warp → Calm Water → Fragmentation.
- **Mark Response:** Glyph Falloff → Display Response → Micro Response → renderer-local display treatments.

## G. TOP UX PROBLEMS

### P0 — actively confusing / harmful

1. **Two controls author one occupancy state.** “Keep particles outside glyph” conflicts conceptually with the three-state Occupancy selector.
2. **Presets silently reset broad, unrelated authored state.** `applyPreset` resets Micro Response, Glyph Falloff, Micro Warp, Glyph Influence, Calm Water, Fragmentation, Dot Grid, Display Dislocation, and Display Response before applying a recipe.
3. **Display Dislocation suppresses enabled Fragmentation without resolving the visible state conflict.** The UI can show both authored as on even though only one is authoritative.

### P1 — meaningful complexity problem

4. **The rail does not match the engine pipeline.** Glyph-space, field-space, mark-space, renderer presentation, preview, and diagnostics are interleaved.
5. **Unsupported or currently no-effect controls remain visible and mutable.** State retention is good; tall inactive forms are not.
6. **Emitter definition, emitter sources, influence targeting, and effect response are conflated.** The same shared field appears as “single” and “global,” while downstream response lives in adjacent emitter-named panels.
7. **Late renderer changes preserve values without a usable handoff.** SDF Streamlines became extremely faint with inherited values; SDF Contours immediately hit `maxNodes` clipping.
8. **Advanced Parameters is not one concept.** It mixes field detail, performance caps, renderer geometry, composition, overlay appearance, and glyph modulation.
9. **Slider accessible names are broken or missing.** In the accessibility tree, many sliders are announced as “Double-click to reset” because the `title` becomes their accessible name; other feature sliders are simply unnamed.

### P2 — worthwhile cleanup

10. **Preset scope is inconsistent.** Most presets preserve typography; Display Dislocation changes text to “DISPLAY,” size, and tracking. Users cannot predict whether a preset is visual-only or a whole-scene example.
11. **Preview labels expose implementation while being technically imprecise.** “Canvas Performance” may still resolve to SVG DOM below the automatic threshold.
12. **Project actions are split.** Save is in the header; Import Project JSON is inside Export.
13. **The rail pays permanent height for dormant systems.** Disabled parameter stacks remain visible, particularly with native fallback or unsupported renderers.
14. **Soft ranges, hard schema bounds, and reset defaults are inconsistent across components.** Imported values can be retained but not recreated through some controls.
15. **Font resource persistence is incomplete by design but under-explained.** Saved state references the font; it does not package it.
16. **No visible undo/redo safety net accompanies high-dimensional experimentation.** Reset is prominent, but the consequence/scope is not equivalent to reversible editing.

### P3 — polish

17. Export/download confirmation is a small status line and easy to miss.
18. Pan requires middle-drag or Space+drag, but no visible gesture hint is present.
19. “Sonic Warp” and “Warped Outline” sit near “Glyph Micro Warp” despite referring to a different renderer-local system.
20. Export warnings are useful but visually dominate the artwork even when the user is not exporting.

## H. SIMPLIFICATION PLAN

This is the minimum high-leverage pass; it does not require a new UI framework or engine rewrite.

1. **Make stage ownership explicit.** Regroup existing controls into Typography, Output Model, Field, Glyph Geometry, Mark Response, Appearance, Export & Project, and Performance/Diagnostics.
2. **Consolidate the emitter presentation.** Always show one shared Field Definition. Beneath it, show one source row or the multiple-source list. Move scope/neighborhood under Influence Targeting and downstream response out of the emitter definition.
3. **Resolve the three concrete state conflicts.** Remove the redundant occupancy checkbox, prevent/resolve Display Dislocation + Fragmentation’s misleading simultaneous-on presentation, and define preset scope before any visual reshuffle.
4. **Use stable contextual summaries instead of tall inactive forms.** Preserve dormant values, but collapse unsupported features to one line such as “Display Dislocation · retained · requires SDF Halftone.” Keep stable section positions for learnability.
5. **Split Advanced by owner.** Renderer Setup, Geometry Details, Mark Response Details, Performance, and Diagnostics. Do not leave one miscellaneous Advanced drawer.
6. **Normalize parameter presentation.** Show perceptual units, reveal local radius/frequency overrides only when unlinked, expose obvious numeric entry/reset, and source defaults/ranges from stable descriptors.
7. **Improve renderer handoff.** On a raw late switch, preserve authored state but offer “Use renderer starting values” as an explicit action; show which systems are inactive rather than silently inheriting an unusable recipe.

## I. DO NOT TOUCH

- Do not collapse the instrument into one effect-amount slider.
- Keep all nine renderer/output models; their differences are real.
- Keep explicit glyph-domain stages. Their order should become clearer, not hidden.
- Keep Single and Multiple emitter capability, per-source weighting/scope, and Add/Max blending.
- Keep deterministic seed and exact project-state authoring.
- Keep state retention when an effect is disabled or a renderer temporarily cannot consume it; summarize dormant state instead of deleting it.
- Keep native-text fallback truth and the distinction between approximate and outline-authoritative geometry.
- Keep Final Artwork vs Editable Text export and Current frame vs deterministic time zero.
- Keep explicit preview/backend truth for experts, but move it to operational settings and report the actual backend.
- Keep export readiness, validation, vector-only guarantees, and budget warnings.
- Keep the black/acid-lime/mono/grid instrument language and compact control styling.
- Keep presets as demonstrations and starting recipes, not as the entire product.

## J. BEFORE / AFTER INFORMATION ARCHITECTURE

### Before — current rail

```text
01 Artwork
   Advanced Typography
02 Preset / Renderer
03 Core Field
   Emitters
   Emitter Micro Response
   Glyph Falloff Field
Glyph Influence
Glyph Micro Warp
Calm Water
Glyph Fragmentation
   Dot Matrix
   Display Dislocation
Advanced Parameters
04 Appearance
05 Preview
06 Export
07 Diagnostics
```

### After — minimum semantic regrouping

```text
01 Typography
   Text / Font / Size
   Spacing & Layout

02 Output Model
   Preset
   Renderer
   Renderer Setup [conditional]

03 Field
   Density / Amplitude
   Field Definition
   Sources: Single or Multiple
   Influence Targeting

04 Glyph Geometry
   Micro Warp
   Calm Water
   Fragmentation / Slice
   [ordered stage summaries]

05 Mark Response
   Glyph Falloff Field [capability-gated]
   Display Response [capability-gated]
   Micro Response [advanced]
   Dot Matrix / Display Dislocation [SDF Halftone]

06 Appearance
   Colors
   Renderer Composition / Overlay [conditional]

07 Export & Project
   Save / Import
   Final vs Editable
   Current vs Time Zero
   Export Advanced

Performance & Diagnostics [collapsed utility area]
   Preview strategy / quality / FPS
   Safety budgets
   Diagnostics / developer overlays
```

This is a regrouping of current capability. It is not a new interaction paradigm.

## K. QUICK WINS

- Remove the **Keep particles outside glyph** checkbox and keep Occupancy as the only source of truth.
- Add explicit stage captions: `GLYPH GEOMETRY · 1/3`, `2/3`, `3/3`; `MARK RESPONSE`; `PREVIEW ONLY`; `EXPORT AUTHORITATIVE`.
- Collapse inactive sections to retained-state summaries rather than rendering all disabled children.
- Move Emitter Micro Response and Glyph Falloff out of Core Field into Mark Response.
- Move Dot Matrix and Display Dislocation into a conditional SDF Halftone setup block.
- Split Advanced Parameters into renderer-owned and performance-owned disclosures.
- Rename `Field / legacy placement` to a perceptual default name; keep “legacy behavior” in help text.
- Label the Glyph Diffuser option as `Overlay Warp`, not simply `Warped Outline` near Micro Warp.
- Replace raw phase radians with turns/degrees; describe emitter frequency as spacing/wavelength.
- Make numeric entry and reset explicit on every slider; fix `aria-labelledby` so the visible parameter name is announced.
- Keep Save and Import together. Keep export format/frame/precision beside Export SVG.
- Add `Space + drag / middle-drag to pan` to the viewport control tooltip/help.
- Tone export warnings down to a compact badge until Export is opened or blocked.
- Preserve accordion open state across renderer changes; `OutputPanels key={draft.renderer}` currently remounts its disclosure state.

## L. DEEPER CHANGES

- **Preset scope/schema semantics:** distinguish “renderer recipe,” “full scene example,” and possibly “effect recipe.” This is required to stop broad hidden resets without breaking preset intent.
- **Mutual-exclusion semantics:** represent Display Dislocation’s relationship to Fragmentation explicitly in state/product rules, or make the two stages genuinely composable.
- **Parameter descriptor model:** establish one source for default, UI soft range, schema hard limit, unit, mapping curve, stage ownership, capability, and Lab status. This reduces UI/schema/default drift.
- **Emitter envelope model:** make shared influence plus optional local overrides explicit in state instead of exposing several unrelated radii/falloffs.
- **Renderer handoff model:** add renderer-owned parameter namespaces or recipes so late switching can preserve work while producing a useful initial result.
- **Font resource packaging/reference:** support a deliberate relink workflow and clearer missing-font state; embedding/licensing policy can remain separate.
- **Reversible authoring:** add undo/redo or parameter-history support proportionate to the instrument’s depth.
- **Domain Warp identity:** either give it a clearly distinct conceptual role outside Fragmentation or fold its useful behavior into an existing deformation stage through an intentional migration.

## M. SCREEN-BY-SCREEN / PANEL-BY-PANEL NOTES

### Header

- Brand and Export SVG priority are clear.
- Save Project is separated from Import Project JSON, which is hidden much later under Export.
- Export readiness is accurately enforced, but the warning overlay competes with the artwork before export is the user’s task.

### 01 Artwork

- Typography appropriately appears first and the large text area suits multiline input.
- Outline font status is honest: native fallback versus loaded parsed outlines is clearly stated.
- A local TTF/OTF import is the only font-selection model. There is no font browser, family list, or variable-font axis UI.
- With native fallback, the product’s signature geometry features are unavailable; this is truthful but makes the default experience less representative.
- Size has direct manipulation plus hidden numeric editing; the latter is insufficiently discoverable.

### Advanced Typography

- Tracking, line height, kerning, alignment, vertical offset, and optical spacing belong together.
- The section is appropriately collapsed by default.
- Typography behaves as a real source stage: changes reflow authoritative geometry and effective bounds.
- Multiline and large line height work. Effective artboard growth is visible in canvas metadata, but the authored/effective distinction is specialist language without a user-level explanation.
- No variable-font controls were found.

### 02 Preset / Renderer

- The nine-button renderer grid is compact and scan-friendly.
- Renderers are undersold as styles; changing them changes capabilities and geometry models.
- The 21 named presets are valuable examples, but names mix renderer recipes, visual motifs, new feature showcases, and full-scene examples.
- Most manual field changes set Preset to Custom, while typography changes do not. That is reasonable for personalization, but Display Dislocation’s preset changes typography and breaks the otherwise implied scope.
- “Sonic Warp” selects Glyph Diffuser’s renderer-local warped outline and does not enable Glyph Micro Warp. Runtime proves the two are distinct; the naming still invites a false connection.

### 03 Core Field

- Density and Amplitude are good high-level controls.
- Renderer support is respected for these two, but the section then accumulates downstream effect panels that are not “core field.”

### Emitters

- Source glyph/anchor, strength, radius, falloff, and immediate on-canvas response make the emitter tangible.
- Radius means coverage; strength means contribution magnitude. They are distinct at runtime and should remain separate.
- Frequency is a spatial wave parameter, not a generic effect frequency; raw units obscure that.
- Multiple emitters combine predictably and adding a third source immediately changes output.
- The source-row model is strong, but shared/global field parameters repeat the Single form.
- Custom source position forces all-typography scope. The control disables the scope selector but does not adequately teach why.
- Display Response lives inside the emitter panel even when the current renderer keeps existing output. It can remain mutable while doing nothing.

### Emitter Micro Response

- This is a final-mark/occupancy system, not emitter definition.
- Occupancy modes produced distinct outcomes: legacy, interior exclusion, and exterior dispersion.
- The duplicate checkbox is the clearest removable control in the product.
- Most component controls are excellent algorithm-authoring parameters but too low-level for the primary rail.

### Glyph Falloff Field

- Contour rings produced a distinct final-mark displacement and deserve to exist.
- Its runtime helper explicitly says it applies to final marks before Micro Response occupancy; the rail does not communicate that ordering.
- Place under Mark Response and reveal only for supported renderers.

### Glyph Influence

- Radius, softness, and falloff are coherent as a reusable envelope.
- The current standalone placement does not say which active effects consume it.
- A summary such as “Used by: Micro Warp, Slice targeting” would make the control intelligible without hiding it.

### Glyph Micro Warp

- Visually useful from subtle to maximum, and the topology-preserving behavior held in testing.
- It deserves first-class status.
- Detail octaves, displacement cap, topology preservation, and seed influence are preset-authoring/Lab material for most sessions.

### Calm Water

- Produces broad, coherent contour motion distinct from Micro Warp and Fragmentation.
- Disable/re-enable preserves values correctly.
- Linking to emitter rhythm is a good model of a child frequency as a multiplier of a parent.
- Under Glyph Diffuser, much of the upper strength range can remain visually restrained because renderer presentation masks contour differences; a geometry-stage preview would improve tuning.

### Glyph Fragmentation

- Horizontal, Vertical, Grid, and Radial modes are all visually distinct.
- Tidal Slice demonstrates meaningful combination with Calm Water.
- Switching between slice modes and Grid/Radial/Domain Warp changes not only geometry but the available targeting/radius model.
- Domain Warp is the least coherent member of the family and was subtle at comparable values.
- High radial settings can hit the glyph-displacement safety budget; the warning is accurate but reads as an engine condition rather than design guidance.

### Dot Matrix

- Strong SDF Halftone-specific control family.
- Its placement under the Fragmentation component and persistence under unsupported renderers confuse stage ownership.

### Display Dislocation

- Produces a distinct, compelling displaced display lattice and deserves to remain.
- It is renderer-local, not a glyph fragmentation mode.
- Disabling and re-enabling retains settings correctly.
- The Fragmentation masking rule is the critical problem: authored Fragmentation can remain on while runtime disables that stage.

### Advanced Parameters

- Currently the weakest grouping. Field turbulence, edge influence, modulation mode, `maxNodes`, wave details, contour details, diffuser geometry, overlays, erosion, and glyph modulation do not share one mental model.
- Renderer-conditional groups are useful, but all are filed under “Advanced” rather than their owning output model/stage.
- `maxNodes` is a safety/performance budget. It should not compete visually with creative field detail.

### 04 Appearance

- Primary, outline, and background colors are compact and appropriate.
- Renderer-local overlay/composition settings currently live elsewhere, so “Appearance” is incomplete as a concept.

### 05 Preview

- It correctly states that preview settings do not affect SVG export.
- Canvas vs SVG looked perceptually equivalent in the tested static SDF Halftone state.
- Quality levels were effectively invisible in that state; their opacity quantization matters only in certain previews.
- The user-facing selection displays the preference, not necessarily the backend selected by runtime logic.

### 06 Export

- Final Artwork SVG and Editable Text SVG are clear, valuable modes.
- Current visible frame vs deterministic time zero is exactly the kind of technical truth this product should keep.
- Numeric precision is appropriately explicit but advanced.
- Export readiness and validation are robust; all current presets are marked vector-exportable.
- Native fallback and `maxNodes` warnings are accurate but dominate the canvas.
- Export produces a download and later status text; the completion event is easy to miss.
- Import Project JSON does not belong under Export.

### 07 Diagnostics

- Compact/Full visibility, substrate views, overlays, timings, and cost estimates are useful to engineering.
- Full diagnostics can cover a large portion of the artwork with raw glyph and pipeline metrics.
- This is Debug/Lab, not a primary product stage. Keep it, but remove it from the normal numbered authoring sequence.

### Canvas, transport, and viewport

- Artwork remains the visual focus despite the dense rail; zoom/fit controls are compact.
- Zoom buttons use a 1.25× factor. Wheel zoom is anchored to the pointer.
- Pan is implemented as middle-button drag or Space+primary drag; plain drag correctly does nothing. The gesture is not disclosed.
- Pause, Reset, Randomize Seed, seed/status, and deterministic/static state read as a coherent instrument transport.
- At 1280×800, the 340 px rail plus 60 px header and ~100 px lower/status area leave roughly 890×535 px for the working canvas. At 1440×900, the artwork region is roughly 1050×630 px—about 55% of the full viewport area.
- The problem is not the rail width; it is the amount of scrolling. At one representative scroll position, only renderer selection, two core sliders, and the Emitters summary were visible.

## TERMINOLOGY GLOSSARY AND AUDIT

| Current term | Actual meaning | Issue / recommendation |
|---|---|---|
| Artwork | Typography source controls | Accurate but broad; “Typography” better communicates source authority |
| Core Field | Density/amplitude plus several downstream panels | Too broad; reserve for field generation |
| Density | Sample/mark density | Keep; renderer-sensitive but meaningful |
| Amplitude | Base deformation/field response magnitude | Keep; add owner/stage context |
| Strength / Amount / Influence / Response | Magnitudes at different pipeline stages | Not synonyms in the engine; do not normalize blindly. Pair with target: “Contour strength,” “Mark response,” “Field strength” |
| Frequency / Wave frequency / Ring frequency | Cycles in different domains | Keep distinctions; normalize displayed units and parent-link semantics |
| Radius / Response radius / Base radius | Coverage envelope, sometimes shared, sometimes local | Clarify shared vs override and world-space target |
| Glyph Influence | Shared emitter-local glyph-domain envelope | Explain consumers; “Glyph envelope” may be clearer |
| Glyph Micro Warp | Fine pre-substrate contour deformation | Accurate once staged |
| Calm Water | Broad coherent contour deformation | Evocative and useful, but needs descriptive subtitle |
| Glyph Fragmentation | Coarse slices/grid/radial sectors plus Domain Warp | Mostly accurate; Domain Warp is the outlier |
| Slice | Horizontal/vertical fragmentation | Keep as visual mode; distinguish from generic Fragmentation family |
| Display Dislocation | Renderer-local displaced SDF Halftone display | Good visual name; stage must be explicit |
| Display Response | Renderer-supported mark/candidate behavior around emitters | Too close to Display Dislocation and Micro Response; rename by outcome or nest under Mark Response |
| Emitter Micro Response | Final-footprint micro-displacement/occupancy | Technically accurate, perceptually vague; Advanced/Lab |
| Field / legacy placement | Default historical display behavior | Implementation/history language; replace primary label |
| Native fallback | Browser text path with approximate bounds | Technical but important truth; keep with a short consequence statement |
| Canvas Performance | Auto/Canvas-preferring preview strategy | Inaccurate as a guaranteed backend; rename |
| SVG Accuracy | Forced SVG DOM preview | Accurate enough, though “Force SVG preview” is more truthful |
| Final Artwork SVG | Authoritative renderer marks as vectors | Strong; keep |
| Editable Text SVG | Text-oriented export rather than baked artwork marks | Keep; add concise detail on what remains editable and what effects are omitted/baked |
| Current visible frame | Current animation time captured for export | “Current animation frame” is more precise |
| Deterministic time = 0 | Canonical repeatable export frame | Excellent technical language for this audience |
| Advanced Parameters | Mixed ownerless controls | Replace with stage-owned disclosures |
| Diagnostics | Debug/render/substrate instrumentation | Accurate; relocate outside primary authoring hierarchy |

## N. EVIDENCE

### Runtime evidence

| Evidence | Observation |
|---|---|
| `audit-substrate/01-default.png` | Native fallback, large default rail, persistent export warning, nine renderer buttons |
| `06-calm-water-enabled.png`, `07-calm-water-max.png` | Calm Water is visually distinct but renderer presentation can make range changes restrained |
| `09–13-fragmentation-*.png` | Horizontal, vertical, grid, radial, and domain-warp modes were compared directly |
| `15-display-dislocation-enabled.png` | Distinct displaced lattice; disabled/re-enabled state retention verified |
| `16-renderer-switch-masked-controls.png` | Unsupported Emitter Micro Response retained as unavailable after late renderer switch |
| `17–19-preview-*.png` | Canvas/SVG and quality modes compared in the same static state |
| `20-export-panel.png` | Final/editable, background, frame, precision, and project import placement |
| `21–24-diagnostics-*.png` | Compact/full and substrate debug modes visibly dominate/replace artwork |
| `25-advanced-parameters.png` | Mixed field, budget, and renderer-specific advanced ownership |
| `27–29-typography-*.png` | Multiline, line-height extreme, and size extreme expand effective artboard |
| `32–35-emitter-*.png` | Single/multiple/global/custom emitter behavior and immediate source combination |
| `36-legacy-v1-import.png` | Successful v1 migration with version-15 warning and native-font fallback |
| `37-sonic-warp-preset-warp-off.png` | Sonic Warp preset does not enable Glyph Micro Warp |
| `38–39-micro-warp-*.png` | Micro Warp range tested from default to maximum |
| `40–42-micro-response-*.png` | Legacy, interior exclusion, and exterior dispersion compared |
| `43–47-renderer-*.png` | Late switches exposed faint SDF Streamlines and `maxNodes`-clipped SDF Contours |
| `48–49-viewport-*.png` | Real density and artwork/chrome balance at 1280×800 and 1440×900 |

All screenshots are in `audit-substrate/` and were captured from the running application, not generated from source assumptions.

### Source evidence tied to UX complexity

- `src/App.tsx:141–167` — authoritative Micro Warp → Calm Water → Fragmentation order and Display Dislocation’s Fragmentation suppression.
- `src/App.tsx:471–554` — export readiness, immutable snapshot, vector validation, and completion/warning messaging.
- `src/App.tsx:563–601` — project save, import, font-resource clearing, and re-upload warning.
- `src/types.ts:1–25` — full renderer/mode vocabulary.
- `src/types.ts:76–119` — Micro Response is explicitly final-footprint mark response; Glyph Falloff is post-candidate SDF displacement.
- `src/types.ts:120–176` — Micro Warp, shared Glyph Influence, and Calm Water are distinct glyph-domain concepts.
- `src/components/panels/FieldControls.tsx:190–201` — “emitter consumer active” is inferred from many downstream systems, evidence that emitter scope spans multiple stages.
- `src/components/panels/FieldControls.tsx:239–341` — actual rail order and `OutputPanels key={draft.renderer}` remount behavior.
- `src/components/panels/FieldControls.tsx:358–376` — generic slider’s `title="Double-click to reset"` causes the accessible-name problem.
- `src/components/panels/EmitterControls.tsx:49–228` — repeated Single/Global shared emitter forms and renderer-dependent Display Response.
- `src/components/panels/EmitterMicroResponseControls.tsx:59–93` — duplicate occupancy checkbox/select mapping.
- `src/components/panels/GlyphFalloffDisplacementControls.tsx:47–121` — final-mark ordering and SDF response controls.
- `src/components/panels/GlyphDisplacementControls.tsx:36–229` — Fragmentation, Dot Matrix, and Display Dislocation combined in one UI component.
- `src/components/panels/AdvancedFieldPanel.tsx:33–127` — shared, renderer-local, appearance, and performance controls mixed under one disclosure.
- `src/components/panels/OutputPanels.tsx:61–130` — preview, export/import, and diagnostics structure.
- `src/engine/previewBackend.ts:15–53` — Canvas/SVG labels versus automatic threshold-based backend selection.
- `src/engine/presets.ts:689–707` — named presets reset every accumulated deformation/response subsystem before applying their patch.
- `src/engine/rendererManifest.ts:63–170` and `src/engine/controlOwnership.ts:34–86` — centralized renderer capabilities exist, but the UI frequently represents unsupported state as persistent unavailable controls.
- `src/engine/parameterOwnership.ts:11–31` — the ownership map covers only a small subset of current parameters, evidence that the conceptual model lags the feature set.
- `src/engine/numericBounds.ts:16–92` and `src/engine/projectSchema.ts` — deliberate UI soft bounds versus broader document hard bounds; valuable for compatibility, but inconsistently surfaced.
- `src/hooks/useProjectDocument.ts:13–61` and `src/types.ts:258–265` — JSON persists project state and font metadata, not the font binary.
- `src/components/CanvasNavigation.tsx:121–160, 185–215, 267–271` — wheel zoom, Space/middle-drag pan, and 1.25× zoom buttons.

### Hidden complexity / duplicate implementation

Only architecture issues that directly contribute to product complexity are included:

1. **Scattered capability logic.** Renderer manifest data exists, but control activity, ad hoc renderer checks, consumer checks, and panel-local conditions repeat the question “does this do anything now?” This produces inconsistent unavailable/disabled/hidden behavior.
2. **Defaults are keyed by labels in several UI files.** A copy change can affect reset lookup, and schema/base/UI default definitions can drift.
3. **One large ProjectState exposes mixed owners at the same level.** This is not inherently wrong, but renderer, geometry, response, diagnostics, and preview-adjacent concepts flow through broad shallow patches that encourage flat UI composition.
4. **Preset application is a migration-era reset adapter.** Every preset resets newer subsystems regardless of its advertised scope, directly causing destructive surprise.
5. **Control ownership documentation is incomplete.** `PARAMETER_OWNERSHIP` omits most accumulated feature fields, mirroring the UI’s weak stage taxonomy.
6. **Output panel disclosure state remounts on renderer change.** The state reset is an implementation detail leaking into workflow predictability.
7. **UI soft bounds and document hard bounds are separate by design but inconsistently authorable.** This is useful for compatibility, yet only some controls provide a numeric path to retained out-of-range project values.

## O. FINAL RECOMMENDATION

Do not add another feature in the next UX pass. Spend one pass reducing accidental complexity in this order:

1. Fix the three semantic conflicts: duplicate Occupancy controls, preset-wide hidden resets, and Display Dislocation masking Fragmentation.
2. Re-label and regroup the current controls around the real pipeline: Typography → Field → Glyph Geometry → Renderer → Mark Response → Appearance → Export.
3. Consolidate emitter definition and source management, then expose response as a separate stage.
4. Replace tall inactive forms with stable retained-state summaries and stronger capability gating.
5. Split mixed Advanced controls by owner and move algorithm-tuning parameters to a conceptual Lab tier.
6. Repair slider labeling, numeric entry, reset discoverability, and parameter units.

This would remove a large share of the confusion without deleting a renderer, collapsing meaningful frequencies, weakening deterministic export, or making the application feel like generic SaaS. SUBSTRATE should remain demanding; it should stop demanding knowledge of its implementation history.

## WHAT I WOULD MOVE TO SUBSTRATE LAB

These parameters are valuable for algorithm development, stress testing, and preset authoring, but probably do not deserve permanent primary UI:

- Micro Warp detail octaves, seed influence, maximum displacement cap, preserve-counters/topology switches.
- Raw emitter frequency units and exact phase radians.
- Emitter Micro Response position-detail, breakup, detail-scale, displacement-cap, exterior-shell, push/tangent/divergence decomposition.
- Glyph Falloff ring sharpness and raw field-width/frequency shaping beyond one primary amount.
- Calm Water secondary detail and preservation internals; independent wavelength can stay Advanced rather than primary.
- Fragmentation jitter, rotation cap, seed, per-mode hard displacement/step limits, and Domain Warp if it remains weakly differentiated.
- Display Dislocation low-level region size, gap, step count, alternating offset, radial bias, and local seed.
- Diffuser ring contrast, band width, halo padding, edge-erosion width, interior protection.
- Overlay warp scale, smoothing, edge bias, and maximum displacement.
- Glyph Field Modulation’s decomposed influence/displacement/density/radius/opacity parameters.
- `maxNodes`, substrate quality, preview opacity-level quantization, FPS caps, backend thresholds, and developer performance instrumentation.
- Substrate mask/edge/SDF/gradient viewers, mark origins/bounds, frame/export-cost overlays, FPS meter, and WebGPU field debug.

Lab should not own the main creative decisions. It should own the controls that tune how algorithms behave, how presets are authored, and how safety/performance boundaries are tested.
