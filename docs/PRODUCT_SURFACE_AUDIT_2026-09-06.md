# SUBSTRATE Product Surface Audit

Date: 2026-09-06  
Pass: Product Surface Audit  
Decision scope: product-facing control classification only

## EXECUTIVE VERDICT

**Yes. The current primary UI is still exposing too much of the engine.**

The accepted stage hierarchy is correct and should remain protected:

Typography → Field → Emitters → Glyph Geometry → Renderer → Mark Response → Appearance → Preview / Export

Diagnostics is correctly separate. The problem is not the number of stages, the visual language, or the normalized NumericRange interaction model. The problem is that several stages expose both the artistic concept and the coefficients used to make that concept behave. This makes the normal authoring surface carry preset construction, implementation tuning, and safety work that a designer does not usually think about independently.

The audit found a stable product split:

- Keep direct access to outcome-defining dimensions: typography, density, emitter source/radius/strength, deformation enable/strength/scale/direction, fragmentation mode/size/gap, renderer identity, mark occupancy, primary response amount, appearance, seed, and export semantics.
- Keep genuinely independent but less frequent dimensions in the owning feature's Advanced disclosure: phase, falloff, scope, normal versus tangential direction, response envelopes, fragment direction/rotation, contour frequency, renderer-specific composition, and export precision.
- Remove coefficient-level controls from the normal authoring surface while preserving them in ProjectState, presets, imports, deterministic export, and a future internal tuning capability.
- Keep performance controls together and subordinate. Keep diagnostics developer-only.
- Do not replace expert control with presets. Presets are evidence and tuned starting points, not the product surface.

**Recommendation: PASS for a Tuning Separation implementation pass**, subject to the migration safeguards in sections I–K. The creative/tuning boundary is clear enough to act without changing engine semantics or losing a major visual family.

## Audit basis and runtime evidence

This pass read the accepted Semantic UX and Parameter Quality audits, inspected the current control components, renderer manifests, ProjectState, control ownership, and all 21 preset definitions, then exercised the current application at 1200 × 720 with the Basic-Regular outline-font fixture.

Representative runtime comparisons included:

- Calm Water at zero/default/maximum strength, minimum/maximum rhythm, and low/high surface variation, drift, and detail in Glyph Diffuser and SDF Halftone.
- Micro Warp with normal-only and tangential-only displacement at high strength and maximum displacement.
- Fragment Matrix at its authored state and maximum gap.
- Display Dislocation enabled versus disabled.
- Emitter Display Response, Exclude Interior, Disperse Exterior, and Glyph Falloff contour rings.
- Sonic Interference with three active emitters versus one active source, plus inspection of per-source weight, phase, radius multiplier, and scope.
- Sonic Halftone with strong glyph modulation versus modulation off from a clean application state.
- Preview, export, and diagnostic disclosures in the live interface.

Observed evidence that materially affects the decision:

1. Strength, mode, spatial scale/radius, direction, occupancy, and source selection consistently produced recognizable outcomes describable without implementation language.
2. Normal and tangential Micro Warp produced different contour motion and therefore must remain independently authorable.
3. Calm Water rhythm changed the broad wave character, while variation/drift/detail mostly refined the same character at ordinary viewing scale.
4. Fragment gap and cell size changed the visual identity; offset steps, jitter, and seed primarily tuned regularity and preset character.
5. Exclude Interior and Disperse Exterior produced distinct, useful mark-placement families. Their low-level shell/push/tangent/divergence decomposition was not required to identify the family.
6. Strong versus Off glyph modulation changed the halftone family substantially in a clean state, while the decomposed modulation coefficients behaved as preset character controls.
7. Partial presets intentionally preserve unrelated state. In testing, inherited Micro Warp, Glyph Falloff, occupancy, or Dot Matrix state could strongly mask a later preset. This is a preset-state interaction risk, not a reason to surface every retained coefficient in primary UI.
8. Zero-response values can disable their dependent controls. That is relevant to escape-hatch design, but the accepted shared numeric interaction behavior itself is not reopened by this audit.

## Classification legend

- **A — CORE CREATIVE:** a direct, meaningful design or workflow dimension.
- **B — EXPERT / ADVANCED CREATIVE:** a real independent creative dimension used less frequently.
- **C — PRESET-AUTHORING / TUNING:** useful mainly for algorithm character, defaults, references, or presets.
- **D — PERFORMANCE / SAFETY:** fidelity, budget, scheduling, backend, or guardrail control.
- **E — DIAGNOSTIC / DEBUG:** inspection and instrumentation only.
- **F — REDUNDANT / LEGACY:** independently exposed meaning is superseded or duplicated.

Confidence is High unless runtime behavior was renderer-conditional or a proposed grouping still needs a parameter sweep.

## A. CONTROL CLASSIFICATION MATRIX

### Typography and project workflow

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Typography | Content | Text substrate | A — Core Creative | Defines the authored typographic subject. | PRIMARY | High |
| Typography | Scale | Size | A — Core Creative | Directly controls composition, legibility, and available glyph domain. | PRIMARY | High |
| Typography | Font resource | Load / Replace / Clear outline font | A — Core Creative | Changes authoritative geometry and export capability, not just styling. | PRIMARY | High |
| Typography | Spacing | Tracking | B — Expert / Advanced Creative | Independent typographic rhythm; often adjusted after preset selection. | ADVANCED | High |
| Typography | Spacing | Line height | B — Expert / Advanced Creative | Required for multiline composition but not constant workflow. | ADVANCED | High |
| Typography | Kerning | Kerning mode | B — Expert / Advanced Creative | Changes how glyph pairs are composed. | ADVANCED | High |
| Typography | Alignment | Text alignment | B — Expert / Advanced Creative | Direct composition choice. | ADVANCED | High |
| Typography | Kerning | Kerning strength | B — Expert / Advanced Creative | A real corrective/expressive dimension within kerning. | ADVANCED | High |
| Typography | Placement | Vertical offset | B — Expert / Advanced Creative | Alters the typographic relationship to the field and frame. | ADVANCED | High |
| Typography | Optical spacing | Enable / strength | B — Expert / Advanced Creative | Perceptual spacing correction with clear visual meaning. | ADVANCED | High |
| Project | Persistence | Save Project | A — Core Creative | Essential authoring workflow action. | PRIMARY | High |
| Project | Persistence | Import Project JSON | A — Core Creative | Essential recovery and continuation action. | PRIMARY | High |

### Field

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Field | Core field | Density | A — Core Creative | Sets the amount and spacing of visible structure. | PRIMARY | High |
| Field | Core field | Amplitude | A — Core Creative | Sets the dominant field displacement/energy. | PRIMARY | High |
| Field | Field detail | Frequency | B — Expert / Advanced Creative | Defines the scale of repeated field structure. | ADVANCED | High |
| Field | Field detail | Turbulence | B — Expert / Advanced Creative | Independently changes ordered versus irregular field motion. | ADVANCED | High |
| Field | Glyph coupling | Edge influence | B — Expert / Advanced Creative | Controls how strongly the field recognizes the glyph boundary. | ADVANCED | High |
| Field | Multi-emitter composition | Blend mode: Add / Max | B — Expert / Advanced Creative | Add and Max produce different interference/composition logic; meaningful mainly with multiple emitters. | ADVANCED | High |

### Emitters

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Emitters | Source count | Single / Multiple mode | A — Core Creative | Changes composition from one source to a system of sources. | PRIMARY | High |
| Emitters | Activation | Emitter / Field enabled | A — Core Creative | Directly enables the source system. | PRIMARY | High |
| Emitters | Source | Source glyph | A — Core Creative | Chooses where the field originates in the text. | PRIMARY | High |
| Emitters | Source placement | Center / centroid / counter / custom | B — Expert / Advanced Creative | Different anchors are perceptually meaningful, but most work can begin with a glyph source. | ADVANCED | High |
| Emitters | Custom placement | Custom X / Y | B — Expert / Advanced Creative | Explicit position is a genuine spatial control when Custom is selected. | ADVANCED | High |
| Emitters | Field | Strength | A — Core Creative | Dominant emitter intensity. | PRIMARY | High |
| Emitters | Field | Radius | A — Core Creative | Defines the spatial reach around the source. | PRIMARY | High |
| Emitters | Field | Wave frequency | B — Expert / Advanced Creative | Changes wave spacing and interference character; real but not constantly needed. | ADVANCED | High |
| Emitters | Field | Phase | B — Expert / Advanced Creative | Essential for multi-wave alignment and interference, despite technical presentation. | ADVANCED | High |
| Emitters | Field | Falloff shape | B — Expert / Advanced Creative | Smoothstep, Gaussian, and Linear create different spatial envelopes. | ADVANCED | High |
| Emitters | Glyph coupling | Self influence | B — Expert / Advanced Creative | Controls response at the source glyph independently. | ADVANCED | High |
| Emitters | Glyph coupling | Neighbor influence | B — Expert / Advanced Creative | Controls propagation beyond the source glyph. | ADVANCED | High |
| Emitters | Multi-source row | Row enabled / source glyph / Add / Duplicate / Remove | A — Core Creative | These are the basic compositional actions for a multi-source field. | PRIMARY | High |
| Emitters | Multi-source row | Weight | B — Expert / Advanced Creative | Balances sources independently; three-versus-one-source runtime comparison showed clear output change. | ADVANCED | High |
| Emitters | Multi-source row | Phase / radius multiplier | B — Expert / Advanced Creative | Necessary to author interference and localized reach per source. | ADVANCED | High |
| Emitters | Multi-source row | Influence scope / neighborhood | B — Expert / Advanced Creative | Chooses which typography receives each source; independent of source definition. | ADVANCED | High |
| Emitters | Shared definition | Repeated shared field form in Multiple mode | A — Core Creative | It is the same authoritative shared field, not an independently redundant parameter. Keep one ownership model even if presented contextually. | PRIMARY | High |

### Glyph Influence

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Glyph Geometry | Glyph Influence | Scope | A — Core Creative | Defines which glyph region participates in a geometry feature. | PRIMARY | High |
| Glyph Geometry | Glyph Influence | Neighborhood | B — Expert / Advanced Creative | Refines a neighbor-based scope rather than defining the feature itself. | ADVANCED | High |
| Glyph Geometry | Glyph Influence | Radius | A — Core Creative | Defines the visible spatial extent of geometry response. | PRIMARY | High |
| Glyph Geometry | Glyph Influence | Edge softness | B — Expert / Advanced Creative | Controls the transition character at the influence boundary. | ADVANCED | High |
| Glyph Geometry | Glyph Influence | Falloff shape | B — Expert / Advanced Creative | Changes the response envelope perceptually. | ADVANCED | High |

### Glyph Micro Warp

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Glyph Geometry | Micro Warp | Enable | A — Core Creative | Activates an identity-level outline transformation. | PRIMARY | High |
| Glyph Geometry | Micro Warp | Strength | A — Core Creative | Dominant deformation amount. | PRIMARY | High |
| Glyph Geometry | Micro Warp | Response radius | B — Expert / Advanced Creative | Defines where deformation reaches around the emitter/glyph. | ADVANCED | High |
| Glyph Geometry | Micro Warp | Falloff | B — Expert / Advanced Creative | Defines the spatial response envelope. | ADVANCED | High |
| Glyph Geometry | Micro Warp | Detail scale | B — Expert / Advanced Creative | Sets the size of visible warp features; describable as coarse versus fine deformation. | ADVANCED | High |
| Glyph Geometry | Micro Warp | Normal displacement | B — Expert / Advanced Creative | Normal-only testing produced expansion/compression across the contour. | ADVANCED | High |
| Glyph Geometry | Micro Warp | Tangential displacement | B — Expert / Advanced Creative | Tangential-only testing produced sliding/shearing along the contour; not redundant with normal. | ADVANCED | High |
| Glyph Geometry | Micro Warp | Edge turbulence | C — Preset-authoring / Tuning | Refines roughness inside the existing warp family. | TUNING | Medium |
| Glyph Geometry | Micro Warp | Detail octaves | C — Preset-authoring / Tuning | Changes internal complexity more than an independent design intent. | TUNING | High |
| Glyph Geometry | Micro Warp | Detail steps | C — Preset-authoring / Tuning | Quantizes implementation detail; useful for references and presets. | TUNING | High |
| Glyph Geometry | Micro Warp | Maximum displacement | D — Performance / Safety | A geometry guardrail; the user thinks in Strength, not a second cap. | PERFORMANCE | High |
| Glyph Geometry | Micro Warp | Preserve counters and topology | D — Performance / Safety | Protects valid glyph topology rather than defining the desired form. | PERFORMANCE | High |
| Glyph Geometry | Micro Warp | Seed influence | C — Preset-authoring / Tuning | Tunes deterministic variation while global Randomize Seed remains the creative action. | TUNING | High |

### Calm Water

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Glyph Geometry | Calm Water | Enable | A — Core Creative | Activates the broad contour-normal water deformation. | PRIMARY | High |
| Glyph Geometry | Calm Water | Strength | A — Core Creative | Dominant and understandable wave amount. | PRIMARY | High |
| Glyph Geometry | Calm Water | Linked to emitter rhythm | B — Expert / Advanced Creative | Chooses whether the water participates in the field's rhythm or uses its own wavelength. | ADVANCED | High |
| Glyph Geometry | Calm Water | Rhythm multiplier / wavelength | A — Core Creative | Runtime extremes changed the broad wave scale; this is part of the effect's artistic concept. | PRIMARY | High |
| Glyph Geometry | Calm Water | Surface variation | C — Preset-authoring / Tuning | Refines irregularity within the same calm-wave family. | TUNING | Medium |
| Glyph Geometry | Calm Water | Drift | C — Preset-authoring / Tuning | Mostly adjusts secondary directional character at normal viewing scale. | TUNING | Medium |
| Glyph Geometry | Calm Water | Detail | C — Preset-authoring / Tuning | Adds secondary texture rather than a new visual family. | TUNING | High |
| Glyph Geometry | Calm Water | Preserve counters and topology | D — Performance / Safety | Topology guardrail, not authored water character. | PERFORMANCE | High |

### Fragmentation / Slice

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Glyph Geometry | Fragmentation | Enable | A — Core Creative | Activates a major geometry family. | PRIMARY | High |
| Glyph Geometry | Fragmentation | Mode | A — Core Creative | Domain warp, slices, grid cells, and radial sectors are distinct visual families. | PRIMARY | High |
| Glyph Geometry | Fragmentation | Slice influence: emitter / global legacy | B — Expert / Advanced Creative | Localized versus global slicing changes composition; legacy wording should not be promoted. | ADVANCED | High |
| Glyph Geometry | Fragmentation | Strength | A — Core Creative | Primary displacement amount. | PRIMARY | High |
| Glyph Geometry | Fragmentation | Response radius / falloff | B — Expert / Advanced Creative | Defines localization around the emitter; shared Glyph Influence remains authoritative where applicable. | ADVANCED | High |
| Glyph Geometry | Fragmentation | Slice / cell size | A — Core Creative | Changes the scale and readability of fragments. | PRIMARY | High |
| Glyph Geometry | Fragmentation | Gap | A — Core Creative | Maximum-gap testing changed the family from continuous fragments to sparse islands. | PRIMARY | High |
| Glyph Geometry | Fragmentation | Direction | B — Expert / Advanced Creative | Clear directional authorship for slices and cells. | ADVANCED | High |
| Glyph Geometry | Fragmentation | Radial / tangential | B — Expert / Advanced Creative | Changes outward versus rotational displacement; a real vector direction. | ADVANCED | High |
| Glyph Geometry | Fragmentation | Fragment rotation | B — Expert / Advanced Creative | Rotating pieces is a visible, independently desired outcome. | ADVANCED | High |
| Glyph Geometry | Fragmentation | Offset steps | C — Preset-authoring / Tuning | Quantizes the displacement implementation rather than naming a separate concept. | TUNING | High |
| Glyph Geometry | Fragmentation | Jitter | C — Preset-authoring / Tuning | Primarily tunes regularity/noise around the chosen mode. | TUNING | Medium |
| Glyph Geometry | Fragmentation | Seed influence | C — Preset-authoring / Tuning | Controls deterministic variation weight; global seed remains creative. | TUNING | High |

### Renderer selection and detail

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Renderer | Presets | Preset | A — Core Creative | Selects an authored starting character while retaining expert customization. | PRIMARY | High |
| Renderer | Renderer identity | Flow, Ripple, Dot, SDF variants, Wave Contours, Glyph Diffuser | A — Core Creative | Each renderer produces a distinct mark language. | PRIMARY | High |
| Renderer | Wave Contours | Continuous / dotted contour mode | A — Core Creative | Line versus dot contour rendering is identity-defining. | PRIMARY | High |
| Renderer | Contours | Contour thickness | B — Expert / Advanced Creative | Direct visible weight control for supported contour renderers. | ADVANCED | High |
| Renderer | Glyph modulation | Off / Subtle / Strong | B — Expert / Advanced Creative | Clean-state comparison changed halftone structure substantially; the macro mode is useful. | ADVANCED | High |
| Renderer | Glyph modulation | Influence / displacement | C — Preset-authoring / Tuning | Coefficients refine the macro modulation character and are heavily preset-authored. | TUNING | High |
| Renderer | Glyph modulation | Density / radius / opacity modulation | C — Preset-authoring / Tuning | Decomposed implementation coefficients; presets need them, ordinary authoring usually needs the macro mode. | TUNING | High |
| Renderer | Glyph Diffuser | Domain | A — Core Creative | Inside, halo, and combined domains determine where the renderer exists. | PRIMARY | High |
| Renderer | Glyph Diffuser | Composition | A — Core Creative | Behind, through, reactive, eroded, and clipped are materially different compositions. | PRIMARY | High |
| Renderer | Glyph Diffuser | Dot radius | B — Expert / Advanced Creative | Directly controls visible mark size. | ADVANCED | High |
| Renderer | Glyph Diffuser | Ring contrast | C — Preset-authoring / Tuning | Tunes separation between existing rings. | TUNING | Medium |
| Renderer | Glyph Diffuser | Ring sharpness | C — Preset-authoring / Tuning | Refines edge profile inside the same ring concept. | TUNING | High |
| Renderer | Glyph Diffuser | Band width | B — Expert / Advanced Creative | Defines the visible scale of diffuser bands and can rescue/correct a preset. | ADVANCED | Medium |
| Renderer | Glyph Diffuser | Halo padding | B — Expert / Advanced Creative | Controls how far the diffuser domain extends around the type. | ADVANCED | High |
| Renderer | Safety | Max nodes / marks | D — Performance / Safety | Explicit output budget; not a creative intensity control. | PERFORMANCE | High |

### Renderer-local Dot Matrix and Display Dislocation

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Renderer | Dot Matrix | Regular world grid enable | A — Core Creative | Switches to an identity-defining regular dot display. | PRIMARY | High |
| Renderer | Dot Matrix | Grid spacing | A — Core Creative | Defines dot-display resolution and rhythm. | PRIMARY | High |
| Renderer | Dot Matrix | Dot radius | A — Core Creative | Defines visible dot weight. | PRIMARY | High |
| Renderer | Dot Matrix | Threshold | B — Expert / Advanced Creative | Controls glyph-domain inclusion and can materially correct form. | ADVANCED | High |
| Renderer | Dot Matrix | Edge softness | C — Preset-authoring / Tuning | Refines boundary sampling without creating a new dot-display family. | TUNING | Medium |
| Renderer | Display Dislocation | Enable | A — Core Creative | Enabled versus disabled produced the intended displaced-display identity. | PRIMARY | High |
| Renderer | Display Dislocation | Region mode | A — Core Creative | Horizontal bands, vertical bands, and blocks are distinct structures. | PRIMARY | High |
| Renderer | Display Dislocation | Displacement amount | A — Core Creative | Primary dislocation strength. | PRIMARY | High |
| Renderer | Display Dislocation | Band / cell size | A — Core Creative | Defines the scale of the displaced regions. | PRIMARY | High |
| Renderer | Display Dislocation | Response radius / falloff | B — Expert / Advanced Creative | Controls localization around the emitter. | ADVANCED | High |
| Renderer | Display Dislocation | Display direction | B — Expert / Advanced Creative | Directly determines displacement direction. | ADVANCED | High |
| Renderer | Display Dislocation | Display gap | B — Expert / Advanced Creative | Controls separation of visible regions and can change legibility. | ADVANCED | High |
| Renderer | Display Dislocation | Alternating offset | B — Expert / Advanced Creative | Creates alternating band structure rather than generic intensity. | ADVANCED | Medium |
| Renderer | Display Dislocation | Radial bias | B — Expert / Advanced Creative | Adds emitter-relative direction distinct from global direction. | ADVANCED | Medium |
| Renderer | Display Dislocation | Display offset steps | C — Preset-authoring / Tuning | Quantizes the displacement implementation. | TUNING | High |
| Renderer | Display Dislocation | Seed | C — Preset-authoring / Tuning | Reproducibility coefficient for the local effect; global seed remains the product action. | TUNING | High |

### Mark Response

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Mark Response | Emitter Display Response | Behavior | B — Expert / Advanced Creative | Field, distort, exclude, and orbit produce distinct mark behaviors, but this is renderer-conditional. | ADVANCED | High |
| Mark Response | Emitter Display Response | Micro distortion | A — Core Creative | Primary amount for the selected display response. Rename by mode later; keep explicit. | PRIMARY | Medium |
| Mark Response | Emitter Display Response | Response radius | B — Expert / Advanced Creative | Controls spatial reach of the response. | ADVANCED | High |
| Mark Response | Emitter Display Response | Noise scale / grid size / grid amount / edge bias | C — Preset-authoring / Tuning | Together tune the texture and quantization of the selected response. | TUNING | High |
| Mark Response | Emitter Display Response | Interior suppression | F — Redundant / Legacy | Duplicates the product meaning of canonical Occupancy: Exclude interior, though it occurs at an earlier stage. Preserve value for old projects. | REMOVE/LEGACY | High |
| Mark Response | Emitter Display Response | Orbit amount | A — Core Creative | Primary amount for Orbit / Disperse behavior. | PRIMARY | High |
| Mark Response | Emitter Display Response | Settle / repel | B — Expert / Advanced Creative | Pulling toward versus pushing away from the contour is a real signed direction. | ADVANCED | High |
| Mark Response | Emitter Micro Response | Enable | B — Expert / Advanced Creative | Enables fine response after the main display transform. | ADVANCED | High |
| Mark Response | Occupancy | Legacy / Exclude interior / Disperse exterior | A — Core Creative | Runtime comparison produced recognizable placement families and should be the canonical occupancy control. | PRIMARY | High |
| Mark Response | Micro Response | Response radius / falloff | B — Expert / Advanced Creative | Defines where fine response is applied. | ADVANCED | High |
| Mark Response | Micro Response | Position detail / density breakup | C — Preset-authoring / Tuning | Tunes ordered versus broken marks inside an already selected response family. | TUNING | High |
| Mark Response | Micro Response | Detail scale / maximum displacement | C — Preset-authoring / Tuning | Implementation scale and cap; useful for presets and matching references. | TUNING | High |
| Mark Response | Occupancy | Exterior shell | B — Expert / Advanced Creative | Defines how far the exclusion/disperse zone extends and may be needed to correct silhouettes. | ADVANCED | High |
| Mark Response | Disperse | Exterior push / tangential flow / divergence | C — Preset-authoring / Tuning | Decomposes one perceptual disperse character into three coefficients. Keep internal editing and an Advanced escape hatch. | TUNING | Medium |
| Mark Response | Glyph Falloff | Off / Contour rings | A — Core Creative | Contour-rings testing created a distinct mark-flow family around glyph edges. | PRIMARY | High |
| Mark Response | Glyph Falloff | Strength / field width | A — Core Creative | Amount and reach are the main contour-field dimensions. | PRIMARY | High |
| Mark Response | Glyph Falloff | Falloff / ring frequency | B — Expert / Advanced Creative | Envelope and number of rings are independent, visible character controls. | ADVANCED | High |
| Mark Response | Glyph Falloff | Ring sharpness | C — Preset-authoring / Tuning | Refines the profile of the existing ring family. | TUNING | High |

### Appearance

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Appearance | Palette | Primary / outline / background colors | A — Core Creative | Direct artwork palette. | PRIMARY | High |
| Appearance | Background | Transparent background | A — Core Creative | Materially changes composition and export use. | PRIMARY | High |
| Appearance | Glyph Diffuser overlay | Solid / outline / knockout / hidden / warped outline | A — Core Creative | Defines the relationship between type and diffuser marks. | PRIMARY | High |
| Appearance | Glyph Diffuser overlay | Outline width | B — Expert / Advanced Creative | Direct line-weight control when Outline is selected. | ADVANCED | High |
| Appearance | Glyph Diffuser overlay | Overlay opacity | A — Core Creative | Primary prominence of the glyph overlay. | PRIMARY | High |
| Appearance | Edge erosion | Erosion amount | B — Expert / Advanced Creative | Directly controls the degree of eroded composition. | ADVANCED | High |
| Appearance | Edge erosion | Erosion width / interior protection | C — Preset-authoring / Tuning | Coefficients stabilize and tune the erosion algorithm. | TUNING | High |
| Appearance | Warped outline | Warp amount | A — Core Creative | Primary visible warp for the overlay. | PRIMARY | High |
| Appearance | Warped outline | Warp scale | B — Expert / Advanced Creative | Defines coarse versus fine outline warp. | ADVANCED | High |
| Appearance | Warped outline | Smoothing / edge bias | C — Preset-authoring / Tuning | Refines implementation response without adding a new family. | TUNING | High |
| Appearance | Warped outline | Maximum displacement / preserve counters | D — Performance / Safety | Guardrails for valid, bounded outline geometry. | PERFORMANCE | High |

### Preview, export, canvas transport, and diagnostics

| Stage | Feature | Control | Classification | Runtime rationale | Recommended destination | Confidence |
|---|---|---|---|---|---|---|
| Preview / Export | Preview | Canvas Performance / SVG Accuracy | D — Performance / Safety | Explicit backend/fidelity tradeoff; preview only and export-safe. | PERFORMANCE | High |
| Preview / Export | Preview | Full / Balanced / Performance quality | D — Performance / Safety | Controls preview opacity quantization, not authored output. | PERFORMANCE | High |
| Preview / Export | Preview | FPS cap | D — Performance / Safety | Scheduler/load choice. | PERFORMANCE | High |
| Preview / Export | Preview | Static preview | D — Performance / Safety | Disables time updates for preview stability/load. | PERFORMANCE | High |
| Preview / Export | Preview | Pause when hidden | D — Performance / Safety | Background scheduling policy. | PERFORMANCE | High |
| Preview / Export | Export | Final Artwork SVG / Editable Text SVG | A — Core Creative | Chooses the output contract. | PRIMARY | High |
| Preview / Export | Export | Current frame / deterministic time = 0 | A — Core Creative | Changes exported temporal state and must remain explicit. | PRIMARY | High |
| Preview / Export | Export | Numeric precision | B — Expert / Advanced Creative | Changes serialization fidelity and file size; technical but output-semantic. | ADVANCED | High |
| Canvas | Navigation | Zoom out / in / fit | A — Core Creative | Essential inspection workflow, although not a ProjectState parameter. | PRIMARY | High |
| Canvas | Time | Pause animation | A — Core Creative | Lets the designer inspect and export a chosen temporal state. | PRIMARY | High |
| Canvas | Time | Reset | A — Core Creative | Resets animation time, not ProjectState; keep, but the label should remain contextually clear. | PRIMARY | High |
| Canvas | Variation | Randomize Seed | A — Core Creative | Product-level deterministic variation action. | PRIMARY | High |
| Canvas | Variation | Displayed seed status | A — Core Creative | Required to understand and reproduce randomized results. | PRIMARY | High |
| Diagnostics | Visibility | Off / Compact / Full | E — Diagnostic / Debug | Controls instrumentation density only. | DIAGNOSTICS | High |
| Diagnostics | Overlays | FPS meter / WebGPU field debug | E — Diagnostic / Debug | Performance and implementation instrumentation. | DIAGNOSTICS | High |
| Diagnostics | Substrate view | None / outlines / mask / edge map / SDF / gradient | E — Diagnostic / Debug | Direct internal substrate inspection. | DIAGNOSTICS | High |
| Diagnostics | Geometry overlays | Glyph bounds / ink-layout bounds / baseline / glyph origins | E — Diagnostic / Debug | Layout and geometry inspection. | DIAGNOSTICS | High |
| Diagnostics | Mark and emitter overlays | Mark origins / emitter anchor-radius / composite wave field | E — Diagnostic / Debug | Internal field and mark inspection. | DIAGNOSTICS | High |
| Diagnostics | Counters | Mark count / frame-time / export estimate | E — Diagnostic / Debug | Instrumentation; mark count may remain as passive canvas status but not an authoring control. | DIAGNOSTICS | High |

## B. FEATURE SURFACE SUMMARIES

The budgets below are hierarchy targets, not arbitrary maximum counts. Conditional controls appear only when their mode makes them relevant.

| Major feature | Current controls | Proposed Primary | Proposed Advanced | Proposed Tuning-only / non-product |
|---|---|---|---|---|
| Typography | Text, size, font resource, tracking, line height, kerning mode/strength, alignment, vertical offset, optical spacing | Text, size, outline font | Tracking, line height, kerning, alignment, vertical offset, optical spacing | None |
| Field | Density, amplitude, frequency, turbulence, edge influence, blend mode | Density, amplitude | Frequency, turbulence, edge influence; blend mode when Multiple | None |
| Emitters | Mode, enable, glyph, anchor, custom XY, strength, frequency, phase, radius, falloff, self/neighbor; per-row authoring | Mode, enable, source glyph, strength, radius; row add/remove/enable/glyph | Anchor/custom XY, frequency, phase, falloff, self/neighbor; row weight/phase/radius/scope | None; presentation should continue to share one field definition |
| Glyph Influence | Scope, neighborhood, radius, softness, falloff | Scope, radius | Neighborhood, edge softness, falloff | None |
| Micro Warp | Enable plus 12 parameters | Enable, strength | Radius, falloff, detail scale, normal direction, tangential direction | Edge turbulence, octaves, steps, seed influence; max displacement and topology protection to Safety |
| Calm Water | Enable, strength, rhythm link/multiplier or wavelength, variation, drift, detail, topology | Enable, strength, scale/rhythm | Rhythm-link choice | Variation, drift, detail; topology protection to Safety |
| Fragmentation | Enable, mode, localization, strength, size, gap, steps, direction, radial/tangential, jitter, rotation, seed | Enable, mode, strength, size, gap | Localization, falloff, direction, radial/tangential, rotation | Offset steps, jitter, seed influence |
| Renderer base | Preset, renderer grid, contour mode/thickness, glyph modulation, modulation coefficients, cap | Preset, renderer; contour mode when relevant | Contour thickness, glyph modulation macro | Modulation coefficients; max marks to Performance |
| Glyph Diffuser renderer | Domain, composition, dot/ring/band/halo coefficients | Domain, composition | Dot radius, band width, halo padding | Ring contrast, ring sharpness |
| Dot Matrix | Enable, spacing, radius, threshold, softness | Enable, spacing, radius | Threshold | Edge softness |
| Display Dislocation | Enable, region mode, radius/falloff, amount, region size, gap, steps, direction, alternating offset, radial bias, seed | Enable, region mode, amount, region size | Radius/falloff, direction, gap, alternating offset, radial bias | Offset steps, local seed |
| Emitter Display Response | Behavior plus response, noise, grid, edge, exclusion, orbit coefficients | Mode-appropriate amount | Behavior, radius, settle/repel | Noise scale, grid size/amount, edge bias; retire duplicate interior suppression exposure |
| Emitter Micro Response / Occupancy | Enable, occupancy, radius/falloff, detail/breakup/scale/cap, shell/push/tangent/divergence | Occupancy | Enable, radius/falloff, exterior shell | Detail, breakup, scale, cap, push/tangent/divergence character coefficients |
| Glyph Falloff | Mode, strength, width, falloff, frequency, sharpness | Mode, strength, width | Falloff, ring frequency | Ring sharpness |
| Appearance | Three colors, transparency, overlay modes/opacity, erosion, outline warp coefficients | Colors, transparency, overlay mode/opacity, warp amount | Outline width, erosion amount, warp scale | Erosion width/protection, warp smoothing/edge bias; caps/topology to Safety |
| Preview / Export | Backend, quality, FPS, static/hidden scheduling, output type, frame, precision, import | Output type, export frame, import | Numeric precision | All preview controls to a subordinate Performance group |
| Diagnostics | Visibility, viewers, bounds/origins, field overlays, counters, estimates | None | None | Entire family remains Diagnostics-only |

### Approximate visible budgets

- Typography: 3 primary groups, 6 advanced groups.
- Field: 2 primary controls, 4 advanced controls.
- Emitters: 5 primary groups plus source-row management, 6 shared/per-row advanced groups.
- Glyph Influence: 2 primary controls, 3 advanced controls.
- Micro Warp: 2 primary controls, 5 advanced controls.
- Calm Water: 3 primary controls, 1 advanced mode choice.
- Fragmentation: 5 primary controls, up to 5 mode-conditional advanced controls.
- Each renderer: renderer identity plus no more than 2–4 primary identity controls and 2–4 advanced controls.
- Each Mark Response feature: 1–3 primary outcome controls and 1–4 advanced controls.
- Appearance: palette plus 1–3 renderer-conditional primary controls and 1–3 advanced controls.
- Preview / Export: export semantics primary; one compact Performance disclosure; numeric precision advanced.

## C. TOP TUNING-ONLY CANDIDATES

Ranked by clarity gained versus creative power lost:

1. **Glyph modulation coefficients** — influence, displacement, density, radius, and opacity modulation. The Off/Subtle/Strong macro retains the meaningful family; presets retain exact character.
2. **Emitter Display texture coefficients** — noise scale, grid size, grid amount, and edge bias. These expose the construction of the response more than the desired result.
3. **Emitter Micro Response detail coefficients** — position detail, density breakup, detail scale, and maximum displacement.
4. **Micro Warp implementation detail** — detail octaves, detail steps, edge turbulence, and seed influence. Keep detail scale and normal/tangential direction explicit.
5. **Calm Water secondary character** — surface variation, drift, and detail. Keep strength and rhythm/wavelength explicit.
6. **Disperse decomposition** — exterior push, tangential flow, and divergence. Retain their values and an expert escape path; expose Occupancy as the product concept.
7. **Diffuser ring profile** — ring contrast and ring sharpness. Presets rely on them heavily, while users more often need domain, composition, mark size, band width, and halo reach.
8. **Fragment quantization and randomness** — offset steps, jitter, and seed influence. Keep fragment mode, size, gap, direction, and rotation.
9. **Display Dislocation quantization** — display offset steps and local seed. Keep region mode, amount, size, direction, gap, and spatial bias.
10. **Dot Matrix edge softness** — useful for tuned boundary sampling, but not a separate dot-display concept.
11. **Glyph Falloff ring sharpness** — frequency is creative; sharpness is the tuned profile of that frequency.
12. **Erosion/outline stabilization coefficients** — erosion width, interior protection, outline smoothing, and outline edge bias.

The highest-value redundant/legacy candidate is the independent **Emitter Display interior suppression** control. Its user-facing meaning is already represented by canonical Occupancy: Exclude interior. The old value still needs compatibility handling because the two operations occur at different pipeline stages.

## D. CONTROLS THAT MUST STAY

SUBSTRATE is an expert instrument. The following complexity is justified and should not be removed merely because it is technical or conditional:

- Emitter source glyph and source mode, including Custom X/Y.
- Emitter radius, wave frequency, phase, falloff shape, self influence, and neighbor influence.
- Multiple-emitter mode, per-source enable, glyph, weight, phase, radius multiplier, scope, duplicate, remove, and add.
- Field blend Add versus Max for multi-emitter work.
- Glyph Influence scope and radius.
- Micro Warp normal versus tangential displacement. Runtime testing showed different contour motion.
- Micro Warp detail scale and response envelope.
- Calm Water rhythm/wavelength. It changes the broad surface scale, not merely internal detail.
- Fragmentation mode, fragment size, gap, direction, radial/tangential character, and fragment rotation.
- Renderer selection and renderer-specific identity controls.
- Glyph Diffuser domain and composition.
- Dot Matrix spacing and radius.
- Display Dislocation region mode, amount, region size, direction, gap, alternating offset, and radial bias.
- Occupancy: Legacy, Exclude Interior, and Disperse Exterior, with Legacy eventually relabeled as the neutral/off behavior rather than promoted as a creative name.
- Glyph Falloff mode, strength, width, falloff, and ring frequency.
- Overlay mode, overlay opacity, edge erosion amount, warped-outline amount, and warp scale.
- Export type, export frame, and numeric precision.
- Global Randomize Seed and visible seed status.

These controls let a designer request a visual outcome without needing to describe an internal coefficient.

## E. POSSIBLE COMPOUND CONTROLS

These are future opportunities, not implementation instructions. Each preserves the existing underlying values and must permit an Advanced escape hatch where noted.

| Proposed compound control | Underlying mapping | Evidence and boundary | Confidence |
|---|---|---|---|
| Micro Warp surface character | Edge turbulence + detail octaves + detail steps + seed influence; detail scale remains explicit | The grouped values refine roughness/complexity while normal and tangential displacement remain independently meaningful. | Medium |
| Calm Water surface character | Surface variation + drift + detail | Runtime extremes refined one broad water family; strength and rhythm/wavelength remained the recognizable axes. | Medium |
| Fragment regularity | Jitter + offset steps; fragment rotation remains explicit | These values move from ordered/repeated fragments toward broken/irregular fragments. Rotation has separate authored meaning. | Medium |
| Glyph modulation character | Existing Off/Subtle/Strong mode maps influence + displacement + renderer-supported density/radius/opacity modulation | Clean-state Strong versus Off produced a large change; individual coefficients are preset-authored. The existing macro already proves this compound model. | High |
| Mark texture: Ordered ↔ Broken | Position detail + density breakup + detail scale | These values jointly tune breakup after a response mode is chosen. Maximum displacement stays a cap. | Medium |
| Exterior motion character | Exterior push + tangential flow + divergence | Runtime proved Disperse Exterior as a distinct family; the exact internal mix was not needed to select the intent. Keep individual values available in Advanced/tuning until sweeps confirm a stable mapping. | Medium |
| Diffuser ring character | Ring contrast + ring sharpness | Preset inspection shows these values travel together to establish soft versus graphic rings. Band width and halo padding remain explicit spatial controls. | Medium |
| Outline warp finish | Smoothing + edge bias | Both refine the finish of an already chosen warp amount/scale. Displacement cap and topology protection remain safety. | Medium |

No compound control is recommended for Micro Warp normal/tangential direction, emitter phase/radius, Fragmentation direction/rotation, or Glyph Falloff frequency. Those axes were or are structurally independent.

## F. PRESET DEPENDENCY ANALYSIS

Presets are patch-like authored recipes except for the explicit full-project Display Dislocation snapshot. A tuning-only control can therefore remain critical to a preset even when it should not remain in normal authoring UI.

| Preset family | Low-level dependencies that must remain editable internally | Normal post-preset controls users still need |
|---|---|---|
| Edge Current through Halftone Press | Core field values, renderer choice, renderer safety budget in some recipes | Density, amplitude, renderer, field frequency/turbulence when supported |
| Glyph Ripple / Dotted Diffuser | Wave contour mode plus stored dot spacing/radius character | Contour mode, contour thickness, field scale |
| Sonic Halftone | Glyph modulation influence/displacement/density/radius/opacity; ring/band values | Modulation macro, density, emitter strength/radius, renderer |
| Sonic Contours / Sonic Stream | Glyph modulation influence/displacement and density where supported | Modulation macro, contour thickness, field and emitter axes |
| Sonic Diffuser | Domain, composition, dot radius, ring contrast/sharpness, band width, halo padding, overlay opacity, erosion tuning | Domain, composition, dot radius, band width, halo reach, overlay mode/opacity |
| Sonic Warp | Diffuser recipe plus outline warp amount/scale/smoothing/edge bias/cap/topology | Overlay mode, warp amount, warp scale |
| Sonic Interference / Counter Resonance / Split Field | Per-emitter weights, phases, radius multipliers, scopes, shared source mode, Add blend | Source count/glyphs; advanced weight/phase/radius/scope and blend |
| Fragment Matrix | Fragment strength/radius/size/gap/steps/direction/radial character/jitter/rotation plus Dot Matrix values | Mode, strength, size, gap, direction/rotation; dot spacing/radius |
| Display Dislocation | Full-project typography, Dot Matrix threshold/softness, dislocation radius/falloff/steps/alternation/radial bias/local seed | Region mode, amount, size, direction, gap, spatial bias |
| Calm Current | Glyph Influence, Calm Water variation/drift/detail, rhythm multiplier, topology protection; also stored Dot Matrix values | Calm strength, rhythm/scale, influence scope/radius |
| Tidal Slice | Calm Water tuning plus slice localization, fragment steps/jitter/rotation and Dot Matrix values | Calm strength/scale; fragment mode/strength/size/gap/direction |

### Preset interaction finding

Because partial presets preserve unrelated ProjectState, a previously enabled feature can mask or overwhelm a newly selected preset. During this audit:

- extreme Micro Warp remained active when Fragment Matrix was selected from a custom state;
- mark-response and Glyph Falloff values remained active when switching renderer recipes;
- Dot Matrix state could remain active and conceal a modulation comparison.

This is consistent with non-destructive preset application, but it creates an important requirement for Tuning Separation: the UI must reveal active inherited features even when their coefficient controls leave the product surface. Do not change preset semantics in the separation pass. Add active-state visibility and legacy escape access instead.

## G. PERFORMANCE / DIAGNOSTIC SEPARATION

### Normal-user visibility

Keep one subordinate **Preview Performance** group under Preview / Export containing:

- Performance versus Accuracy backend choice.
- Preview quality.
- FPS cap.
- Static preview.
- Pause when hidden.

These controls should not appear alongside renderer identity or creative mark controls. The current copy correctly states that preview choices do not affect SVG export; preserve that truth.

Keep **Max nodes / marks** in the same subordinate performance/safety area or expose it only when the cap is reached. It is an emergency budget, not renderer character.

Keep **numeric precision** in Export Advanced because it changes serialized output fidelity and file size. It is technical, but it is not merely diagnostic.

### Developer-only visibility

Keep all of the following in Diagnostics / Developer:

- Diagnostics visibility.
- FPS and WebGPU field overlays.
- Glyph outlines, raster mask, edge map, signed distance, and distance gradient views.
- Glyph bounds, ink/layout bounds, baseline, glyph origins, and mark origins.
- Emitter anchor/radius and composite wave field.
- Frame/time and export estimate.

Mark count may remain as passive canvas status because it helps explain output density, but its toggle belongs to Diagnostics.

Backend names should remain truthful where they affect preview fidelity or troubleshooting. Internal candidate caps, texture resolution, sampling thresholds, and scheduler heuristics should not be added to the product surface.

## H. PROPOSED FINAL PRODUCT SURFACE

This preserves the accepted hierarchy. Only Primary and Advanced product controls appear below.

### 01 Typography

**Primary:** Text, Size, Outline Font.  
**Advanced:** Tracking, Line Height, Kerning Mode/Strength, Alignment, Vertical Offset, Optical Spacing.

### 02 Field

**Primary:** Density, Amplitude.  
**Advanced:** Frequency, Turbulence, Edge Influence, Multi-emitter Blend.

### 03 Emitters

**Primary:** Single/Multiple, Enable, Source Glyph, Strength, Radius; multi-source Add/Remove/Duplicate/Enable/Glyph.  
**Advanced:** Anchor Mode and Custom X/Y, Wave Frequency, Phase, Falloff, Self/Neighbor Influence; per-source Weight, Phase, Radius Multiplier, Scope, Neighborhood.

### 04 Glyph Geometry

**Glyph Influence — Primary:** Scope, Radius.  
**Glyph Influence — Advanced:** Neighborhood, Edge Softness, Falloff.

**Micro Warp — Primary:** Enable, Strength.  
**Micro Warp — Advanced:** Response Radius, Falloff, Detail Scale, Normal Displacement, Tangential Displacement.

**Calm Water — Primary:** Enable, Strength, Rhythm/Scale.  
**Calm Water — Advanced:** Linked-to-emitter-rhythm choice.

**Fragmentation — Primary:** Enable, Mode, Strength, Slice/Cell Size, Gap.  
**Fragmentation — Advanced:** Localization, Response Radius/Falloff, Direction, Radial/Tangential, Fragment Rotation.

### 05 Renderer

**Primary:** Preset, Renderer choice, renderer-conditional identity controls: Wave Contour Mode; Glyph Diffuser Domain/Composition; Dot Matrix Enable/Spacing/Radius; Display Dislocation Enable/Region Mode/Amount/Region Size.  
**Advanced:** Contour Thickness, Glyph Modulation macro; Diffuser Dot Radius/Band Width/Halo Padding; Dot Matrix Threshold; Display Dislocation Radius/Falloff/Direction/Gap/Alternating Offset/Radial Bias.

### 06 Mark Response

**Primary:** Canonical Occupancy, mode-appropriate Display Response Amount, Glyph Falloff Mode/Strength/Width.  
**Advanced:** Display Behavior and Radius, Orbit Settle/Repel; Micro Response Enable/Radius/Falloff/Exterior Shell; Glyph Falloff Falloff/Frequency.

### 07 Appearance

**Primary:** Primary/Outline/Background colors, Transparent Background, Overlay Mode/Opacity, Warped Outline Amount.  
**Advanced:** Outline Width, Edge Erosion Amount, Warped Outline Scale.

### 08 Preview / Export

**Primary:** Final Artwork SVG, Editable Text SVG, Export Frame, Import Project.  
**Advanced:** Numeric Precision; subordinate Preview Performance group.

### Canvas transport

**Primary:** Zoom/Fit, Pause, Reset Time, Randomize Seed, Seed Status.

Diagnostics remains a separate developer surface and does not join the numbered product hierarchy.

## I. TUNING CAPABILITY REQUIREMENTS

The future developer/tuning capability must operate on current ProjectState paths without changing the schema or renderer pipeline. It must support:

- Number, boolean, select, and XY-pair values.
- Integer, float, signed, logarithmic, and unit-formatted numeric mappings.
- Existing soft UI ranges and document hard bounds.
- Exact numeric entry, keyboard tuning, reset/default, and accessible names through the existing NumericRange model.
- Live updates with the same renderer invalidation behavior as current controls.
- Per-renderer and per-mode capability gating.
- Per-emitter row addressing and shared-emitter values.
- Preset authoring and inspection of which paths a preset overrides.
- Current value, default value, preset-authored value, and inherited/retained value visibility.
- JSON path/value copy and full project JSON serialization.
- Developer-only persistence without changing normal project behavior.
- Optional parameter sweeps for numeric values and enum-state comparison.
- Deterministic seed control and repeatable snapshots.
- Reset one value, one feature, or all tuning values to existing defaults without resetting creative state.
- Readable indication when a tuning value is active but its product control is hidden.
- An Advanced escape hatch for imported or legacy non-default values that would otherwise be unreachable.

This requirement list intentionally does not choose DialKit, a Lab panel, a route, or a second application.

## J. MIGRATION RISK

ProjectState, presets, imports, migrations, renderers, geometry, and export must remain unchanged for every row below.

| Controls leaving normal UI | ProjectState unchanged | Presets still use values | Old projects retain values | Unreachable-value risk | Required safeguard |
|---|---|---|---|---|---|
| Micro Warp edge turbulence, octaves, steps, seed influence | Yes | Yes, where authored | Yes | Medium | Active-value summary plus tuning access; promote to Advanced when imported non-default values materially change output. |
| Micro Warp max displacement/topology | Yes | Yes | Yes | High because invalid combinations may need correction | Performance/Safety access and warning when a cap/backoff is active. |
| Calm variation, drift, detail | Yes | Yes: Calm Current and Tidal Slice | Yes | Medium | Preset-authoring access; legacy active-value summary. |
| Calm topology protection | Yes | Yes | Yes | High | Safety access; never silently coerce or reset. |
| Fragment offset steps, jitter, seed influence | Yes | Yes: Fragment Matrix/Tidal Slice | Yes | Medium | Tuning access and preset-path inspection. |
| Glyph modulation coefficients | Yes | Yes: Sonic renderer presets | Yes | High; macro changes cannot reproduce every imported mix | Advanced custom escape hatch when coefficient mix differs from preset/macro values. |
| Diffuser ring contrast/sharpness | Yes | Yes: diffuser presets | Yes | Medium | Tuning access; expose non-default custom status. |
| Dot Matrix edge softness | Yes | Yes: Display Dislocation and stored recipes | Yes | Low/Medium | Tuning access; keep threshold Advanced for correction. |
| Display Dislocation offset steps/local seed | Yes | Yes: Display Dislocation | Yes | Medium | Tuning access and deterministic value display. |
| Display Response noise/grid/edge coefficients | Yes | Yes where response recipes author them | Yes | High for reference reproduction | Custom Advanced escape hatch for non-default imported mixes. |
| Display interior suppression | Yes | Potentially | Yes | High because stage differs from Occupancy exclusion | Stop normal independent authoring, but show legacy-active state and allow Advanced editing; do not remap automatically. |
| Micro Response detail/breakup/scale/cap | Yes | Yes where authored | Yes | Medium | Tuning access; cap-active warning. |
| Disperse push/tangent/divergence | Yes | Yes where authored | Yes | High; a compound value cannot encode every mix | Keep individual Advanced escape access until a reversible compound mapping is proven. |
| Glyph Falloff ring sharpness | Yes | Yes where authored | Yes | Low/Medium | Tuning access and retained-value status. |
| Erosion width/interior protection | Yes | Yes: diffuser recipes | Yes | Medium | Tuning access; surface when legacy values create a visibly active erosion. |
| Outline smoothing/edge bias | Yes | Yes: Sonic Warp | Yes | Medium | Tuning access and custom-value status. |
| Geometry caps/topology controls | Yes | Yes | Yes | High | Dedicated Safety access; warnings must link to the relevant existing values. |
| Max nodes / marks | Yes | Yes in some presets | Yes | High when output is capped | Performance access plus clear cap-reached status. |
| Preview backend/quality/FPS/static/hidden scheduling | Yes | Generally no creative dependency | Yes | Low | Keep in Preview Performance; never change export semantics. |
| Diagnostics controls | Yes | No creative dependency | Yes | Low | Keep existing Diagnostics / Developer access. |

### Global migration rules

1. Hiding a control never deletes, resets, clamps, normalizes, or reinterprets its value.
2. Imported values continue to render and export exactly as before.
3. Preset patches continue to modify the same paths and preserve the same unrelated state.
4. A hidden non-default value must be discoverable; otherwise the user cannot explain or correct an inherited appearance.
5. Where a future compound control is introduced, its mapping must be reversible or must expose the original coefficients through Advanced/custom access.
6. The separation pass must add no migration because the schema remains unchanged.

## K. FINAL IMPLEMENTATION PLAN

This is the smallest safe future pass. It is not implemented by this audit.

1. **Freeze compatibility fixtures.** Add project/preset/export snapshots for representative default, imported legacy, multi-emitter, Micro Warp, Calm, Fragment, Display Dislocation, occupancy, and Glyph Falloff states.
2. **Create a product-surface classification map.** Associate existing ProjectState/control paths with PRIMARY, ADVANCED, TUNING, PERFORMANCE, DIAGNOSTICS, or REMOVE/LEGACY. This is UI metadata only; do not change types or values.
3. **Filter the existing panels by classification.** Keep the numbered stage hierarchy and visual layout. Leave Primary controls in place, keep feature-owned Advanced disclosures, and omit Tuning/Performance/Diagnostics rows from the normal creative disclosures.
4. **Consolidate performance placement.** Reuse existing Preview / Export and Diagnostics areas; do not add a new top-level stage.
5. **Add retained-state visibility.** When a hidden tuning/legacy value is active, show a compact, non-editing status at the owning feature so inherited preset/project state is explainable.
6. **Provide the minimum escape hatch.** Reuse the existing control components behind a developer/internal capability and allow Advanced access for active imported legacy/custom values. Do not add DialKit or design a Lab page in this pass.
7. **Retire only duplicate authorability.** Make canonical Occupancy the normal control for interior exclusion. Preserve earlier-stage interior-suppression state and editing through legacy access; do not remap old projects.
8. **Validate product power.** Re-run the representative runtime matrix with tuning rows hidden. Confirm every major family remains reachable using Primary/Advanced controls and presets.
9. **Validate compatibility.** Confirm ProjectState round trips unchanged, all 21 presets retain their current values and patch semantics, SVG output is byte/determinism compatible where expected, and old projects retain hidden values.
10. **Stop.** Do not redesign the interface, add effects, alter preset recipes, change renderer behavior, or build the long-term tuning UI during this separation pass.

## Final recommendation

**PASS — begin a focused Tuning Separation implementation pass.**

The boundary is sufficiently clear: outcome, spatial reach, direction, occupancy, composition, and renderer identity stay product-facing; coefficients, quantization detail, caps, topology protection, preview scheduling, and instrumentation move to their appropriate internal surfaces. The pass can preserve expert power because no ProjectState value, preset dependency, legacy project value, or export behavior needs to be removed or changed.
