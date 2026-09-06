# SUBSTRATE Parameter Quality Audit

Date: 2026-09-06  
Baseline: `c550651` / `semantic-ui-aligned`

This pass audits the authorable numeric controls in the accepted Typography → Field → Emitters → Glyph Geometry → Renderer → Mark Response → Appearance → Preview / Export hierarchy. ProjectState numbers, schema meanings, migration behavior, renderer math, geometry authority, and SVG serialization remain unchanged.

## Inventory and interaction contract

`Old UI range` and `New UI range` describe the normal authoring slider band. Document hard bounds are called out separately where they are broader. `baseState.*` is the explicit semantic reset identity; it is not derived from the visible label at the shared control boundary.

| Stage | Control | Old UI range | New UI range | Mapping | Step | Display format / unit | Reset | Change made? | Reason |
|---|---|---:|---:|---|---:|---|---|---|---|
| Typography | Size | 1–contextual soft max | unchanged | linear, expandable around retained value | 1 | integer type size | `fontSize` = 148 | Interaction only | Existing size scheduler and soft/hard bounds are already intentional; reset is now visible. |
| Typography | Tracking | −10–18 | unchanged | linear, bipolar | 1 | integer spacing units | `tracking` = −3 | Interaction only | Full useful layout band. |
| Typography | Line height | 0.5–4 | unchanged | linear | 0.05 | multiplier | `lineHeight` = 1 | Interaction only | Soft band is useful; typed entry still reaches hard 0.25–8. |
| Typography | Kerning strength | 0–2 | unchanged | linear | 0.05 | coefficient | `kerningStrength` = 1 | Interaction only | Fine decimal tuning is retained. |
| Typography | Vertical offset | contextual ±120 | unchanged | linear, bipolar | 1 | world units | `textOffsetY` = 0 | Interaction only | Zero-centered and context-expanded. |
| Typography | Optical strength | 0–1 | unchanged | linear | 0.05 | normalized coefficient | `opticalSpacingStrength` = 0 | Interaction only | Useful normalized range. |
| Field | Density | 10–80 | unchanged | linear | 1 | marks / sampling density | `density` = 46 | Shared control | Perceptually useful across renderers. |
| Field | Amplitude | 2–44 | unchanged | linear | 1 | response magnitude | `amplitude` = 22 | Shared control | No dead zone found in runtime checks. |
| Field | Frequency | 6–34 | unchanged | linear | 1 | field cycles / scene | `frequency` = 18 | Shared control | Independent core-field rhythm remains distinct from emitter frequency. |
| Field | Turbulence | 0–100 | unchanged | linear | 1 | percent | `turbulence` = 42 | Shared control | 0 is meaningful and the full band is authored in presets. |
| Field | Edge influence | 0–100 | unchanged | linear | 1 | percent | `edgeInfluence` = 68 | Shared control | 0 is meaningful and the full band is authored in presets. |
| Emitters | Strength | 0–4 | unchanged | linear | 0.1 | field strength | `emitter.amplitude` = 1 | Shared control | Fine decimal tuning is useful. |
| Emitters | Wave frequency | 0.005–0.5 | 0–100 slider position representing stored 0.005–0.5 | logarithmic UI mapping; exact entry stores raw frequency | 0.005 stored / 1 position | cycles / world unit | `emitter.frequency` = 0.09 | Yes — slider mapping and unit | Low frequencies occupy too little useful linear travel; stored semantics are unchanged. |
| Emitters | Phase | −6.28–6.28 | unchanged stored range | linear, bipolar | 0.1 rad stored | degrees in display; typed degrees convert to radians | `emitter.phase` = 0 | Yes — display only | Radians were implementation-oriented; zero and signed direction remain clear. |
| Emitters | Radius | 20–contextual artboard band | unchanged | linear, context-expanded | 10 | world units | `emitter.radius` = 430 | Hard-bound contract | Imported values remain visible and editable up to hard 8192. |
| Emitters | Self influence | 0–3 | unchanged | linear | 0.1 | coefficient | `emitter.selfInfluence` = 1 | Shared control | Useful full band. |
| Emitters | Neighbor influence | 0–3 | unchanged | linear | 0.1 | coefficient | `emitter.neighborInfluence` = 0.65 | Shared control | Useful full band. |
| Emitters | Custom X / Y | 0–artboard dimension | unchanged | linear | 10 | world units | `emitter.customX/Y` = 600 / 360 | Shared control | Spatial quantities are now identified by the common unit language. |
| Emitters | Source weight | 0–2 | unchanged | linear | 0.05 | multiplier | `emitters[].weight` = 1 | Shared control | Fine per-source balance. |
| Emitters | Source phase | −6.3–6.3 | unchanged stored range | linear, bipolar | 0.1 rad stored | degrees in display | `emitters[].phaseOffset` = 0 | Yes — display only | Same phase contract as the shared field. |
| Emitters | Source radius × | 0.25–2 | unchanged | linear | 0.05 | multiplier | `emitters[].radiusMultiplier` = 1 | Shared control | Centered around the neutral multiplier. |
| Emitters | Neighborhood | 0–8 | unchanged | stepped integer | 1 | glyph count | `emitter.neighborhoodSize` = 1 | Stepped control | Count is not a continuous quantity. |
| Mark Response | Micro distortion | 0–100 | unchanged | linear | 1 | percent | `emitterDisplay.distortionStrength` = 58 | Shared control | Full response band is useful. |
| Mark Response | Response radius | 8–720 | unchanged | linear | 4 | world units | `emitterDisplay.distortionRadius` = 180 | Shared control | Renderer-local display response uses a spatial unit. |
| Mark Response | Noise scale | 2–160 | unchanged | linear | 2 | world units | `emitterDisplay.noiseScale` = 48 | Shared control | Useful full band. |
| Mark Response | Grid size | 0–96 | unchanged | stepped integer | 1 | world units; 0 disables | `emitterDisplay.gridSize` = 24 | Stepping clarified | Zero is an explicit off state. |
| Mark Response | Grid amount | 0–100 | unchanged | linear | 1 | percent | `emitterDisplay.gridAmount` = 68 | Shared control | Useful full band. |
| Mark Response | Edge bias | 0–100 | unchanged | linear | 1 | percent | `emitterDisplay.edgeBias` = 78 | Shared control | Useful full band. |
| Mark Response | Interior suppression | 0–100 | unchanged | linear | 1 | percent | `emitterDisplay.interiorSuppression` = 100 | Shared control | 0 and 100 are meaningful. |
| Mark Response | Orbit amount | 0–100 | unchanged | linear | 1 | percent | `emitterDisplay.orbitAmount` = 72 | Shared control | Useful full band. |
| Mark Response | Settle / repel | −100–100 | unchanged | linear, bipolar | 1 | signed percent | `emitterDisplay.divergence` = 18 | Shared control | Zero-centered signed response. |
| Glyph Geometry | Glyph Influence radius | 0–640 | unchanged soft band; hard 8192 | linear | 5 | world units | `glyphInfluence.radius` = 100 | Hard-bound contract | Retained legacy values are not silently clamped. |
| Glyph Geometry | Glyph Influence edge softness | 0–720 | unchanged soft band; hard 8192 | linear | 5 | world units | `glyphInfluence.edgeSoftness` = 240 | Hard-bound contract | Same compatibility treatment as radius. |
| Glyph Geometry | Micro Warp strength | 0–100 | unchanged | linear | 1 | percent | `glyphMicroWarp.strength` = 64 | Shared control | Useful full band. |
| Glyph Geometry | Micro Warp response radius | 8–640 | unchanged soft band; hard 8192 | linear | 2 | world units | `glyphMicroWarp.responseRadius` = 170 | Hard-bound contract | Exact retained values survive import. |
| Glyph Geometry | Micro Warp detail scale | 4–160 | unchanged | linear | 1 | world units | `glyphMicroWarp.detailScale` = 18 | Shared control | Runtime evidence supports the band. |
| Glyph Geometry | Micro Warp detail octaves | 1–3 | unchanged | stepped integer | 1 | octave count | `glyphMicroWarp.detailOctaves` = 2 | Stepping clarified | Discrete count. |
| Glyph Geometry | Normal / tangential displacement | 0–100 | unchanged | linear | 1 | percent | 82 / 14 | Shared control | Independent axes remain separate. |
| Glyph Geometry | Edge turbulence | 0–100 | unchanged | linear | 1 | percent | `glyphMicroWarp.edgeTurbulence` = 36 | Shared control | Useful full band. |
| Glyph Geometry | Detail steps | 0–16 | unchanged | stepped integer | 1 | step count; 0 continuous | `glyphMicroWarp.quantizationSteps` = 0 | Stepping clarified | Count and zero-off semantics are explicit. |
| Glyph Geometry | Maximum displacement | 0–48 | unchanged | linear | 0.5 | world units | `glyphMicroWarp.maxDisplacement` = 12 | Shared control | Fine cap tuning. |
| Glyph Geometry | Seed influence | 0–100 | unchanged | linear | 5 | percent | `glyphMicroWarp.seedInfluence` = 100 | Shared control | Useful full band. |
| Glyph Geometry | Calm Water strength | 0–24 | unchanged | linear | 0.5 | world units | `glyphCalmWater.strength` = 10 | Shared control | Fine broad-wave tuning. |
| Glyph Geometry | Rhythm multiplier | 0.25–2 | unchanged | linear multiplier | 0.05 | multiplier | `glyphCalmWater.frequencyMultiplier` = 0.55 | Shared control | Parent/child rhythm relationship is preserved as a multiplier. |
| Glyph Geometry | Calm Water wavelength | 40–520 | unchanged | linear | 5 | world units | `glyphCalmWater.wavelength` = 140 | Shared control | Only shown when unlinked. |
| Glyph Geometry | Surface variation | 0–100 | unchanged | linear | 2 | percent | `glyphCalmWater.surfaceVariation` = 36 | Shared control | Useful full band. |
| Glyph Geometry | Drift | 0–40 | unchanged | linear | 1 | world units | `glyphCalmWater.drift` = 10 | Shared control | Useful full band. |
| Glyph Geometry | Calm Water detail | 0–60 | unchanged | linear | 1 | percent | `glyphCalmWater.detail` = 14 | Shared control | Useful full band. |
| Glyph Geometry | Fragmentation strength | 0–80 / 0–220 by mode | unchanged | linear | 2 | world units | `glyphDisplacement.strength` = 56 | Shared control | Mode-specific soft range is intentional and authoritative geometry is untouched. |
| Glyph Geometry | Fragment response radius | 40–1200 | unchanged soft band; hard 8192 | linear | 10 | world units | `glyphDisplacement.responseRadius` = 420 | Hard-bound contract | Imported extremes remain exact. |
| Glyph Geometry | Slice / cell size | 8–180 | unchanged | linear | 2 | world units | `glyphDisplacement.fragmentSize` = 44 | Shared control | Useful full band. |
| Glyph Geometry | Gap | 0–64 | unchanged | linear | 1 | world units | `glyphDisplacement.gap` = 8 | Shared control | Zero is meaningful. |
| Glyph Geometry | Offset steps | 1–16 | unchanged | stepped integer | 1 | count | `glyphDisplacement.quantizationSteps` = 6 | Stepping clarified | Discrete count. |
| Glyph Geometry | Direction | −180–180 | unchanged | linear, bipolar | 5° stored as degrees | degrees | `glyphDisplacement.direction` = 0 | Display contract | Signed center is clear. |
| Glyph Geometry | Radial / tangential | −100–100 | unchanged | linear, bipolar | 5 | signed percent | `glyphDisplacement.radialTangential` = 0 | Shared control | Zero-centered blend. |
| Glyph Geometry | Jitter | 0–100 | unchanged | linear | 2 | percent | `glyphDisplacement.jitter` = 22 | Shared control | Useful full band. |
| Glyph Geometry | Fragment rotation | 0–8 | unchanged | linear | 0.25 | turns / rotation amount | `glyphDisplacement.fragmentRotation` = 1.5 | Shared control | Fine tuning remains available. |
| Glyph Geometry | Fragment seed influence | 0–100 | unchanged | linear | 5 | percent | `glyphDisplacement.seedInfluence` = 100 | Shared control | Useful full band. |
| Renderer | Dot-grid spacing | 4–32 | unchanged | stepped integer | 1 | world units | `dotGrid.spacing` = 12 | Stepping clarified | Spatial grid count is discrete. |
| Renderer | Dot radius | 0.5–8 | unchanged soft band; hard 128 | linear | 0.1 | world units | `dotGrid.radius` / `diffuserDotRadius` | Hard-bound contract | Exact imported values remain editable. |
| Renderer | Dot threshold / edge softness | 0.1–0.9 / 0–1 | unchanged | linear | 0.05 | normalized coefficient | `dotGrid.threshold` = 0.55 / `dotGrid.edgeSoftness` = 0.18 | Shared control | Useful normalized ranges. |
| Renderer | Contour thickness | 0.25–12 | unchanged | linear | 0.25 | normalized contour weight | `contourStrokeWidth` = 1.4 | Shared control | Renderer-local and capability-gated. |
| Renderer | Glyph modulation influence / density / radius / opacity | 0–100 | unchanged | linear | 1 | percent | respective `glyphField*` defaults | Shared control | Independent renderer-local stages remain separate. |
| Renderer | Glyph modulation displacement | 0–40 | unchanged | linear | 1 | world units | `glyphFieldDisplacement` = 12 | Shared control | Spatial quantity is identified. |
| Renderer | Ring contrast | 0–1 | unchanged | linear | 0.05 | normalized coefficient | `diffuserRingContrast` = 0.72 | Shared control | Fine normalized tuning. |
| Renderer | Ring sharpness | 0.5–8 | unchanged | linear | 0.1 | shaping coefficient | `ringSharpness` = 2.4 | Shared control | Useful full band. |
| Renderer | Band width | 0.05–0.8 | unchanged | linear | 0.01 | normalized width | `bandWidth` = 0.28 | Shared control | Fine decimal tuning. |
| Renderer | Halo padding | 0–400 | unchanged | linear | 10 | world units | `diffuserHaloPadding` = 80 | Shared control | Spatial quantity is identified. |
| Renderer | Max nodes / marks | 400–5000 | unchanged | stepped integer | 100 | mark budget | `maxNodes` = 2800 | Shared control | Safety budget remains distinct from creative density. |
| Mark Response | Glyph Falloff strength / field width | 0–96 / 4–320 | unchanged | linear | 1 / 2 | world units | 24 / 96 | Shared control | Existing final-mark ranges are useful. |
| Mark Response | Ring frequency / sharpness | 0.5–16 / 0.5–8 | unchanged | linear | 0.5 / 0.1 | cycles across field / coefficient | 4 / 2.4 | Shared control | Independent frequency and shaping remain distinct. |
| Appearance | Overlay opacity | 0–1 | unchanged | linear | 0.05 | normalized opacity | `textOverlayOpacity` = 1 | Shared control | No unit conversion needed. |
| Appearance | Edge erosion / interior protection | 0–1 | unchanged | linear | 0.05 | normalized percent-like coefficient | 0.2 / 0.68 | Shared control | Display remains 0–1 because these are normalized engine coefficients. |
| Appearance | Erosion width | 0–64 | unchanged | linear | 1 | world units | `edgeErosionWidth` = 16 | Shared control | Spatial quantity is identified. |
| Appearance | Outline width | contextual soft max | unchanged soft band; hard 512 | linear | 0.25 | world units | `outlineStrokeWidth` = 1.5 | Hard-bound contract | Dynamic soft range stays useful without narrowing compatibility. |
| Appearance | Overlay warp amount / scale / smoothing / edge bias | 0–60 / 0.25–3 / 0–1 / 0–1 | unchanged | linear | 1 / 0.05 / 0.05 / 0.05 | amount, multiplier, normalized coefficients | respective base defaults | Shared control | Renderer-local presentation is unchanged. |
| Appearance | Overlay warp max displacement | contextual soft max | unchanged soft band; hard 2048 | linear | 1 | world units | `outlineWarpMaxDisplacement` = 18 | Hard-bound contract | Retained advanced values remain exact. |

All controls now use the same interaction contract: click or double-click the numeric value to edit; Enter commits; Escape cancels; blur/Tab commits; invalid input restores the last valid value; Arrow uses one normal step; Shift+Arrow uses a coarse five-step move; Alt+Arrow provides fine decimal adjustment where the parameter has a fractional step. Reset is exposed as `↺` only after a value differs from its semantic reset, and the reset button is independently labeled.

## OUT-OF-SOFT-RANGE COMPATIBILITY

UI soft ranges remain authoring bands, not document limits. The shared numeric control expands the slider domain around a retained current value and marks the row with `data-out-of-soft-range="true"`; the exact numeric display remains visible. Typed entry clamps only to the document hard bound supplied by the owning panel. The imported value is never normalized merely because it sits outside the normal slider band.

Verified in the browser with an imported `emitterMicroResponse.responseRadius = 1800`: the normal slider band remains 8–720, the value displays as 1800 with an out-of-soft-range indicator, and exact entry changes it to 1750. The saved project contains 1750. Similar hard-bound plumbing is applied to emitter radius, glyph influence, Micro Warp radius, Fragmentation radius, dot radius, outline width, and overlay displacement.

## Runtime evidence

Representative screenshots are generated by the parameter-quality browser gate under the ignored `e2e-artifacts/parameter-quality/` directory:

- `controls-1280x800.png`
- `controls-1440x900.png`
- `retained-response-radius.substrate.json` is test input evidence and is not tracked.

The selected interaction workflows covered default/preset tuning, exact entry, reset, phase display, logarithmic emitter frequency, modifier-key adjustment, imported retained values, renderer-safe UI, disable/re-enable state retention, and the accepted semantic hierarchy at 1280×800 and 1440×900.

## Deferred recommendations

- A schema-level parent/child frequency model could expose emitter wave spacing and renderer-local response rhythms as explicit multipliers. It is deferred because doing so would change stored meaning or migration semantics; this pass uses UI-only mapping/display conversion.
- Raw algorithm-tuning controls remain in their accepted product locations. They are future tuning-only candidates: Micro Warp octaves/caps, Emitter Micro Response internals, Glyph Falloff shaping, Fragmentation jitter/seed limits, Display Dislocation low-level region controls, diffuser ring/erosion internals, `maxNodes`, substrate quality, and diagnostics.

## Result

PASS for this interaction pass. Important controls have consistent numeric entry, deterministic reset, truthful accessible names, coherent keyboard tuning, retained-value compatibility, and targeted display units. No ProjectState numeric meaning, migration behavior, authoritative geometry, renderer math, SVG export semantics, or goldens changed.

