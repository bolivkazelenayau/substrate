# SUBSTRATE — Tuning Separation Phase 1

Date: 2026-09-06  
Pass: Tuning Separation Phase 1

## 1. Classification architecture

`src/engine/parameterOwnership.ts` is the single product-surface authority. Existing stable control IDs retain their semantic stage, feature owner, renderer requirements, activity contract, tier, shared/local status, and ProjectState meaning. `productSurface` is an orthogonal classification with the values `PRIMARY`, `ADVANCED`, `TUNING`, `SAFETY`, `PERFORMANCE`, `DIAGNOSTICS`, and `LEGACY`.

`NumericRange` accepts an optional stable `controlId` and exposes the resolved classification as DOM metadata. It remains the only numeric interaction implementation.

## 2. Controls moved from normal product UI

Only High-confidence tuning detail was moved behind owner-local `Custom tuning…` disclosures:

- Micro Warp: `glyphMicroWarp.detailOctaves`, `glyphMicroWarp.quantizationSteps`, `glyphMicroWarp.seedInfluence`.
- Calm Water: `glyphCalmWater.detail`.
- Fragmentation: `glyphDisplacement.quantizationSteps`, `glyphDisplacement.seedInfluence`.
- Glyph Modulation: `glyphFieldInfluence`, `glyphFieldDisplacement`, `glyphFieldDensity`, `glyphFieldRadius`, `glyphFieldOpacity`.
- Glyph Diffuser: `ringSharpness`.
- Display Dislocation: `displayDislocation.quantizationSteps`, `displayDislocation.seed`.
- Emitter Display Response: `emitterDisplay.noiseScale`, `emitterDisplay.gridSize`, `emitterDisplay.gridAmount`, `emitterDisplay.edgeBias`.
- Emitter Micro Response: `emitterMicroResponse.positionDetail`, `emitterMicroResponse.densityBreakup`, `emitterMicroResponse.detailScale`.
- Glyph Falloff: `glyphFalloffDisplacement.ringSharpness`.
- Appearance finish: `edgeErosionWidth`, `interiorProtection`, `outlineWarpSmoothing`, `outlineWarpEdgeBias`.

Safety and operational values are separated into subordinate disclosures rather than mislabeled as creative tuning. `maxNodes` is in `Performance & safety`, and its existing value is directly editable when output is capped. Preview backend, quality, FPS cap, static preview, and pause-when-hidden remain in the product-facing `Preview Performance` disclosure.

## 3. Medium-confidence candidates intentionally not moved

The following remain authorable in their existing owning Advanced area and are marked `phase2Candidate` in the authority:

- Micro Warp edge turbulence.
- Calm Water surface variation and drift.
- Fragmentation jitter.
- Glyph Diffuser ring contrast and band width.
- Dot Matrix edge softness.
- Display Dislocation alternating offset and radial bias.
- Emitter Display Response distortion strength.
- Disperse Exterior exterior push, tangential flow, and divergence.

## 4. Primary and Advanced controls protected

Emitter source glyph, strength, radius, frequency, phase, falloff, self/neighbor influence, per-source weight/phase/radius/scope; Micro Warp enable, strength, radius, falloff, detail scale, normal and tangential displacement; Calm Water rhythm/wavelength and linkage; Fragmentation mode, strength, size, gap, localization, direction, radial/tangential, jitter, and rotation; Display Dislocation region, amount, size, radius/falloff, direction, gap, alternating offset, and radial bias; Glyph Falloff mode, strength, width, falloff, and frequency; and Glyph Diffuser domain, composition, dot radius, band width, halo padding, and medium-confidence ring contrast remain product-facing.

## 5. Retained/custom-state detection semantics

The feature-state resolver compares values against the expected current recipe (`applyPreset(baseState, state.preset)`) rather than blindly comparing to base-state defaults. Custom projects use the canonical Glyph Modulation macro recipe for Off/Subtle/Strong comparison. A non-canonical coefficient mix is reported as `CUSTOM`; values are never quantized or rewritten. Built-in preset-authored values are reported as `TUNED` only when they differ from that preset's expected recipe. Default and canonical states do not produce a forest of indicators.

Feature summaries show compact `TUNED`, `CUSTOM`, or `LEGACY ACTIVE` truth at the owning feature. Hidden values are not enumerated by default.

## 6. Escape-access design

The Phase 1 escape mechanism is a shared, owner-local `Custom tuning…` disclosure. It reuses existing selects, toggles, and `NumericRange` controls, writes the same ProjectState paths, preserves hard bounds and exact out-of-soft-range values, and uses existing semantic reset values. It is intentionally small and independent of DialKit or a public Lab surface.

## 7. Safety handling

Geometry and topology guardrails are classified separately. Micro Warp, Emitter Micro Response, and outline warp displacement caps plus counter/topology preservation are in owner-local Safety disclosures. Renderer `maxNodes / marks` is outside normal renderer detail. When `maxNodesClipped` is reported by the existing geometry summary, the UI expands the performance/safety disclosure and states that output is limited, with direct access to the existing cap.

## 8. Legacy suppression handling

Emitter Display interior suppression remains at `emitterDisplay.interiorSuppression` and is never remapped to Occupancy, migrated, or zeroed. It is removed from normal independent authoring and remains exact-editable in the owner-local escape disclosure. Non-default active values show `LEGACY ACTIVE` and an explanatory warning. Canonical Occupancy remains the normal control in Emitter Micro Response.

## 9. Preset compatibility

No preset definition, path, scope, value, or patch behavior changed. Classification and feature-state resolution are presentation metadata only. Scoped preset application continues to preserve unrelated state, including hidden tuning values.

## 10. Import/save/reload compatibility

No ProjectState field, schema version, migration, serialization, or import normalization changed. Hidden values remain in the document and are rendered through the same engine paths. Focused ownership tests cover default, preset-authored, arbitrary Glyph Modulation, and legacy retained-state detection. Browser evidence is captured under `e2e-artifacts/tuning-separation/`.

## 11. UI density evidence

The browser workflow records representative states at 1280×800 and 1440×900:

- `default`
- `calm-water`
- `fragmentation`
- `custom-glyph-modulation`
- `custom-mark-response`
- `legacy-suppression`
- `safety-cap-active`

The workflow records rail scroll height, visible Primary/Advanced controls, hidden High-confidence tuning controls, retained/custom indicators, and Safety status text. Generated evidence is ignored by repository convention and is not committed.

## 12. Tests and browser workflows

Validation completed:

- Full Vitest: 100 files, 937 tests passed.
- TypeScript: application, node config, test, and E2E projects passed.
- ESLint: passed with zero errors and zero warnings.
- Production build and E2E-instrumented build: passed.
- Full Playwright baseline: 66/66 passed across all 14 E2E suites, including Semantic UX Integrity, Semantic UI Alignment, Parameter Quality, legacy compatibility, emitter/glyph gates, production geometry authority, pipeline invalidation, size/preview, export parity, and this pass's tuning-separation workflow.
- `git diff --check`: passed.

No SVG golden update was made or accepted. The first browser attempt against the non-instrumented production bundle was discarded as an environment mismatch; the complete rerun used the E2E-instrumented bundle and passed.

## 13. Semantic invariants

This pass changes presentation and metadata only. No engine algorithm, geometry math, emitter math, mark-response math, renderer behavior, cache identity, SVG serialization, export authority, ProjectState field, schema version, migration, or preset semantics were changed.

## PHASE 2 CANDIDATES

| Parameter | Current destination | Why uncertain | Runtime experiment | Likely consequence of hiding |
| --- | --- | --- | --- | --- |
| `glyphMicroWarp.edgeTurbulence` | Micro Warp Advanced | May refine the same warp family rather than create a separate roughness family. | Sweep at matched strength/detail scale across parsed glyphs and renderers. | Could remove rough-versus-clean contour character. |
| `glyphCalmWater.surfaceVariation` | Calm Water Advanced | Visible secondary wave character is not proven to be a separate intent. | Compare zero/mid/max at fixed strength and wavelength in diffuser and halftone. | Could reduce irregular water-surface references. |
| `glyphCalmWater.drift` | Calm Water Advanced | Directional effect varies by scale and text shape. | Compare extremes across multiline and single-line type at matched rhythm. | Could remove controlled directional surface motion. |
| `glyphDisplacement.jitter` | Fragmentation Advanced | Regularity role is unresolved relative to a future macro. | Isolate across slice, grid, and radial families with gap and size fixed. | Could eliminate broken/irregular fragment references. |
| `diffuserRingContrast` | Glyph Diffuser Advanced | Presets use it heavily, but independent ring intent is unproven. | Sweep with sharpness, band width, and domain fixed. | Could reduce soft-to-graphic ring matching. |
| `bandWidth` | Glyph Diffuser Advanced | Extreme values may correct band scale, not just finish. | Sweep independently from contrast and halo padding. | Could make band-scale correction inaccessible. |
| `dotGrid.edgeSoftness` | Dot Matrix Advanced | Boundary calibration may be meaningful at threshold extremes. | Compare across threshold extremes and grid spacing. | Could remove boundary-calibration control. |
| `displayDislocation.alternatingOffset` | Display Dislocation Advanced | Parity structure needs comparison with direction/gap. | Sweep at fixed region, gap, direction, and radial bias in all modes. | Could remove alternating-band compositions. |
| `displayDislocation.radialBias` | Display Dislocation Advanced | Emitter-relative flow is distinct in principle but unverified. | Compare against authored direction for centered, custom, and multiple anchors. | Could remove emitter-relative flow. |
| `emitterDisplay.distortionStrength` | Emitter Display Response Advanced | Amount semantics vary by behavior mode. | Compare matched amounts for field, distort, exclude, and orbit. | Could make response intensity harder to author. |
| `emitterMicroResponse.exteriorPush` | Disperse Exterior Advanced | Compound relationship with tangent flow/divergence is unresolved. | Parameter-isolation sweep with occupancy and shell fixed. | Could remove exterior motion character. |
| `emitterMicroResponse.tangentialFlow` | Disperse Exterior Advanced | Direction change needs a stable compound mapping. | Compare tangent-only, push-only, and combined motion. | Could remove rotational exterior flow. |
| `emitterMicroResponse.divergence` | Disperse Exterior Advanced | Spread contribution may be lower-level character. | Sweep independently at matched push/tangent values. | Could make outward-spread correction inaccessible. |
