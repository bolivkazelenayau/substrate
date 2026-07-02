# SUBSTRATE — Modular Refactor Pass 1

Date: 2026-06-30

> 2026-07-01 addendum: UX Disclosure Pass 1 reordered the existing panel
> modules into the fixed `01`–`07` creative path, made detailed typography,
> emitters, preview, export, and diagnostics opt-in, and moved dev launchers
> into Diagnostics. Module ownership and parent-owned mutation semantics remain
> unchanged. See `docs/UX_DISCLOSURE_PASS_1.md`.

## Summary

This pass separates serialized artwork state from runtime-only preview and
diagnostic state, decomposes the control surface into focused modules, adds
static correctness tooling, validates imported project JSON at the boundary,
and evaluates Comlink without changing the production worker protocol.

The pass intentionally preserves:

- generated artwork and preset values;
- deterministic vector-only SVG export;
- the isolated CPU SVG export path;
- Canvas and WebGPU as preview/runtime concerns only;
- the existing black, acid-lime, grid/mono technical visual identity;
- custom React components and custom CSS;
- the existing main-thread CPU fallback and worker scheduling behavior.

No component library, CSS framework, Zustand store, Tweakpane panel, or Leva
dependency was added.

## UI module structure

`src/components/Controls.tsx` is now a compatibility entry point. The active
control implementation is divided under `src/components/panels/`.

| Module | Responsibility |
| --- | --- |
| `ArtworkTypographyPanels.tsx` | Text, font loading, font size, tracking, kerning, optical spacing, alignment, and vertical offset |
| `FieldControls.tsx` | Renderer selection, presets, shared field controls, substrate quality, and field composition |
| `EmitterControls.tsx` | Single/multiple emitter modes, row editing, duplication/removal, global emitter shaping, and emitter warnings |
| `DiffuserAppearancePanel.tsx` | Diffuser overlay mode, erosion, outline, and warped-outline controls |
| `AdvancedFieldPanel.tsx` | Node limits, diffuser detail, glyph modulation, and dotted-wave detail |
| `OutputPanels.tsx` | Appearance colors, preview settings, export settings, project import, and diagnostics controls |
| `PanelSection.tsx` | Semantic panel wrappers for Artwork, Typography, Field, Appearance, Preview, Export, and Diagnostics |

Parent-owned state mutation semantics remain unchanged. Renderer changes still
reset the same parent-owned accordion state. Emitter row-detail expansion is
local to `EmitterControls`.

The large inactive copies of the previous Artwork/Typography and
Output/Diagnostics JSX were removed after extraction.

## Runtime and document state

### Project document

`useProjectDocument` owns the active `ProjectState` and project import boundary.
`serializeProjectDocument(project)` serializes only the supplied
`ProjectState`.

### Preview settings

`usePreviewSettings` owns runtime-only:

- preview backend;
- preview quality;
- FPS cap;
- static/reduced-motion preview;
- pause-when-hidden behavior.

These settings are not included in exported `.substrate.json`.

### Diagnostics visibility

The runtime-only model is:

```ts
type DiagnosticsMode = "off" | "compact" | "full";
```

- `off` hides viewport diagnostic blocks.
- `compact` retains the compact backend/FPS/mark/export instrumentation.
- `full` enables the existing detailed runtime, renderer, substrate, and
  emitter diagnostics.

`DiagnosticsMode` is owned by `useDiagnosticsState` and is not serialized.
WebGPU diagnostics remain explicitly labelled preview/debug-only and
not-export.

New sessions now default to `off`. `compact` and `full` remain explicit runtime
choices and are still excluded from project serialization.

### Focused hooks introduced

- `useProjectDocument`
- `useTypographyGeometry`
- `useSubstratePipeline`
- `useRendererRuntime`
- `usePreviewSettings`
- `useExportController`
- `useDiagnosticsState`

The full `ProjectState` was not moved into Zustand.

## Imported project validation

Valibot is used only at the unknown JSON import boundary in
`src/engine/projectImport.ts`.

The adapter exposes:

```ts
parseImportedProjectJson(input: unknown): unknown
validateProjectV7Shape(input: unknown): ProjectStateCandidate
migrateAndRepairProject(input: unknown): ProjectValidationResult
```

Valibot verifies the outer imported value and the optional v7 candidate shape.
Existing `projectSchema.ts` migration, repair, clamping, enum validation, and
compatibility behavior remain authoritative.

Internal domain types were not converted into Valibot schemas.

## ESLint and architecture guardrails

`npm run lint` now runs ESLint. TypeScript checking remains available through:

```sh
npm run typecheck
```

Added tooling:

- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`

Configured checks include:

- Rules of Hooks;
- exhaustive hook dependencies;
- floating promises;
- misused promises;
- switch exhaustiveness;
- React refresh export correctness.

Import restrictions prevent `src/engine/exportSvg.ts` from importing Canvas
preview, preview runtime, WebGPU, or experiment modules. Production source is
also prevented from directly importing `src/experiments`.

## Comlink evaluation

Comlink was added for an isolated spike only:

- `src/experiments/comlinkSubstrateSpike.ts`
- `src/experiments/comlinkSubstrateSpike.worker.ts`
- `src/experiments/README.md`

The spike exposes one transferable substrate build method. It is not imported
by production runtime code and does not replace:

- `LatestOnlyScheduler`;
- request identity or stale-result protection;
- capability and startup diagnostics;
- main-thread CPU fallback;
- the existing worker backend;
- Strict Mode cleanup behavior.

The production protocol should not adopt the spike until capability reporting,
fallback visibility, transfer behavior, cancellation/staleness, and failure
diagnostics can remain at least as explicit as they are now.

## WebGPU positioning

WebGPU remains optional and is still limited to preview, debug, benchmarks, and
future runtime work. It is not an SVG export backend.

Temporary Comlink evaluation is under `src/experiments`. Existing WebGPU debug
UI continues to state that it is not export-related.

## Dependencies added

Runtime:

- `valibot`
- `comlink`

Development:

- `eslint`
- `@eslint/js`
- `typescript-eslint`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh`

Zustand, Tweakpane, Leva, UI component libraries, and CSS frameworks were not
added.

## Tests and verification

Added `tests/runtimeBoundaries.test.ts` covering:

- preview settings excluded from project serialization;
- diagnostics mode excluded from project serialization;
- Valibot boundary validation followed by existing migration and repair;
- SVG export import isolation;
- focused panel declarations.

Existing project-schema, control, preview, renderer, WebGPU, and SVG export
tests continue to pass.

Final verification:

```text
ESLint:           pass, zero warnings
Production build: pass
Vitest:           39 files, 422 tests passed
Browser QA:       pass, no console errors
```

Browser QA covered:

- panel order and collapsed/expanded behavior;
- diagnostics `off`, `compact`, and `full` wiring;
- Glyph Diffuser renderer switching;
- diffuser-specific overlay controls;
- single and multiple emitter modes;
- emitter row-detail expansion.

The Vitest environment prints two expected JSDOM notices for the unimplemented
native `HTMLCanvasElement.getContext()` method. They do not fail tests.

## Compatibility and non-goals

- Preset definitions were not intentionally changed by this modular pass.
- Renderer geometry algorithms were not intentionally changed.
- SVG serialization and validation behavior were not intentionally changed.
- Canvas and WebGPU were not introduced into export code.
- Existing worker fallback code was not removed.
- Project migrations were not rewritten.
- Product artwork state was not moved into a global store.

## Known follow-ups

1. Decide whether the Comlink spike should be benchmarked further or removed.
2. Consider extracting the remaining shared renderer/preset portion of
   `FieldControls.tsx` if it grows again.
3. Consider a runtime-only migration for the legacy `ProjectState.debug`
   overlay toggles. This pass keeps that existing field for project
   compatibility; only the new `DiagnosticsMode` is guaranteed runtime-only.
   Removing `debug` from serialized documents requires an explicit schema and
   backward-compatibility decision.
4. Consider code-splitting heavy development-only WebGPU tools. The production
   build still reports the existing chunk-size warning above 500 kB.

## Worktree note

The repository already contained substantial uncommitted changes before this
pass, including preview performance, Canvas navigation, WebGPU diagnostics,
export validation, and related tests. Those changes were preserved. This
document describes the modular boundary work completed during this pass and
does not claim authorship of unrelated pre-existing edits.
