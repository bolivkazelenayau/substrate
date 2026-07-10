# SUBSTRATE schema v8 planning

Status: planning only  
Current authoritative schema: v7  
Implementation target: not scheduled

This document describes a possible schema-v8 direction. It does not change the
v7 schema, import/repair behavior, save format, debug compatibility, or graph
persistence.

## 1. Current v7 shape and pain points

`ProjectState` v7 is a single large, flat artwork document. It currently stores:

- source text, font metadata, and typography controls;
- renderer selection and deterministic seed;
- field, contour, halftone, diffuser, emitter, glyph-modulation, erosion, and
  warp controls;
- substrate quality and geometry budgets;
- appearance and overlay settings;
- export mode, frame policy, and precision;
- preset identity;
- legacy `debug` visibility settings.

This structure remains valid and supported, but it creates several pressures.

### Large flat document

Unrelated settings share one namespace. Adding a feature increases the size of
`ProjectState`, its defaults, validation, repair, cache-key review, fixtures,
and migration surface. Ownership is difficult to infer from field names alone.

### Renderer-specific and global settings are mixed

Global artwork settings such as typography, appearance, and export policy sit
beside controls used by only one renderer family. A renderer change can leave
inactive renderer-specific values in the document. Those values are useful for
non-destructive switching, but their ownership is implicit.

### Legacy debug state

`ProjectState.debug` is serialized for lossless v7 compatibility. It contains
visibility settings for older visual aids, not deterministic artwork inputs.
Runtime-only `DiagnosticsMode` already has the more appropriate ownership:
editor/runtime state outside the project document.

Removing `debug` from v7 would lose data during round trips and could change how
older files reopen. It must remain until an explicit versioned migration exists.

### Future graph persistence pressure

The internal Graph IR is currently neither serialized nor authoritative. If a
future product requires persistent graphs, adding graph nodes and connections
to the existing flat shape would make document ownership less clear and could
couple experimental runtime design to established project compatibility.

Schema v8 should reserve a deliberate extension point without committing to a
graph format before graph evaluation, product behavior, and migration contracts
are stable.

## 2. Proposed v8 grouping

The following is a conceptual grouping, not a final TypeScript interface.
Exact field placement must be validated against renderer dependencies, export
parity, and user expectations before implementation.

```text
ProjectDocumentV8
├── version: 8
├── metadata
├── typography
├── appearance
├── renderer
├── field
├── emitters
├── substrate
├── export
└── graph?              # optional future extension; absent initially
```

### `metadata`

Candidate ownership:

- document/application metadata required for compatibility;
- preset identity;
- deterministic seed if treated as document identity rather than renderer
  configuration;
- future creation or format provenance only if it has a defined compatibility
  purpose.

Ephemeral timestamps, UI state, loaded font objects, and runtime diagnostics do
not belong here.

### `typography`

Candidate ownership:

- source text;
- font metadata reference;
- font size and tracking;
- kerning mode and strength;
- optical spacing and strength;
- alignment and vertical offset.

Raw font bytes remain excluded. Font metadata may identify a file but cannot
restore parsed outlines without user re-upload.

### `appearance`

Candidate ownership:

- primary, outline, and background colors;
- transparent-background policy;
- text overlay opacity and mode;
- outline width;
- warp controls;
- erosion/composition controls that affect final visual structure.

Fields that alter generated geometry must remain represented in renderer/export
cache identity even if grouped under appearance.

### `renderer`

Candidate ownership:

- selected renderer ID;
- renderer-family-specific controls, preferably grouped by stable renderer or
  capability keys;
- contour, halftone, diffuser, and glyph-modulation configuration where those
  values are renderer-owned.

The design must preserve inactive renderer settings if switching renderers is
expected to restore prior configuration. A renderer-keyed settings map is one
option, but it requires explicit validation, defaults, and unknown-renderer
policy.

### `field`

Candidate ownership:

- density, amplitude, frequency, turbulence, and edge influence;
- field blend policy;
- shared scalar/vector field controls used across renderer families.

Only genuinely shared controls should live here. Renderer-specific values
should not be placed in `field` merely because they use field terminology.

### `emitters`

Candidate ownership:

- single/multiple emitter mode;
- shared emitter configuration;
- emitter rows and weights;
- glyph source selection and falloff behavior.

Stable row IDs and current row limits must survive migration unchanged unless a
separate product change explicitly revises them.

### `substrate`

Candidate ownership:

- substrate quality;
- any persistent substrate-generation policy;
- geometry/node budgets if they are confirmed to belong to substrate rather
  than renderer or export policy.

Resolved substrate arrays, worker state, backend selection, timings, and debug
images remain runtime-only.

### `export`

Candidate ownership:

- Final Artwork versus Editable Text mode;
- current-frame versus time-zero policy;
- coordinate precision;
- export-only limits or policy that are part of the saved document.

Preview backend, preview quality, FPS cap, and navigation state remain excluded.

### Optional future `graph`

No graph field should be emitted by the first v8 implementation unless graph
persistence has a stable product contract. If later introduced, it should be:

- optional and independently versioned;
- validated separately from document sections;
- deterministic and independent of editor layout where possible;
- explicit about node type/version compatibility;
- proven equivalent to the authoritative renderer path through golden exports;
- accompanied by unsupported-node and downgrade policy.

Node editor positions, selection, viewport, and panel state should normally be
workspace/UI preferences rather than artwork semantics.

## 3. Debug extraction plan

Debug extraction is a compatibility migration, not deletion.

### v7 import

The v8 import path should inspect the raw v7 object and extract legacy `debug`
before normal v7 repair can replace missing or partial values with defaults.
This preserves the distinction between values explicitly stored by the user and
values restored by repair.

A safe sequence is:

1. validate that the input is an object and identify version 7;
2. read and validate any present legacy debug keys against the v7 debug shape;
3. migrate and repair the complete v7 artwork document;
4. map artwork fields into grouped v8 sections;
5. merge valid extracted debug preferences into the runtime preference store;
6. restore defaults for missing or invalid preference keys;
7. report non-fatal repair/migration warnings.

The existing v7 importer must remain available and unchanged while v7 is the
authoritative format.

### Runtime preference ownership

Debug visibility should move to a versioned local/workspace preference store.
That store should own:

- legacy substrate and glyph visual-aid visibility;
- emitter and field debug visibility;
- timing/cost visibility where still supported;
- `DiagnosticsMode` or its successor, if the product chooses one unified
  diagnostics preference model.

The preference store is not artwork state and must not affect renderer
geometry, export output, canonical project identity, or golden fixtures.

Storage scope requires an explicit decision:

- local user preferences apply across projects;
- workspace preferences apply within a project/workspace but are saved outside
  the artwork document;
- session preferences reset on reload.

Mixing these scopes without documented precedence would recreate the current
ownership ambiguity.

### v8 save

V8 saves should omit `debug`. Saving must not copy runtime diagnostics,
preview settings, backend status, or local preferences into project JSON.

### Downgrade behavior

Downgrading v8 to v7 cannot be described as a lossless round trip once debug is
removed and sections or future features diverge.

If v8 → v7 export is supported, it should:

- flatten supported grouped artwork fields into a valid v7 document;
- populate `debug` from documented v7 defaults, not silently from unrelated
  runtime state, unless the user explicitly requests preference embedding;
- reject or warn about features with no v7 representation;
- state that workspace preferences and any future graph are omitted;
- produce a migration report suitable for UI display and tests.

If safe downgrade cannot be guaranteed, the application should show an
unsupported-version/export notice rather than producing a misleading v7 file.

## 4. Migration strategy

### V7 → v8

Migration should be a pure, deterministic transformation with no browser,
worker, font parser, renderer, or storage dependency.

Requirements:

- accept only data that passed the normal unknown-input boundary;
- reuse established v7 validation and repair semantics;
- extract legacy debug separately as described above;
- map every serialized v7 artwork field exactly once;
- preserve renderer IDs, seeds, emitter IDs, font metadata, and inactive
  settings;
- return structured warnings for repaired or defaulted values;
- avoid writing runtime preferences until migration succeeds.

A field-accounting test should fail if a v7 field is neither migrated nor
explicitly classified as runtime-only legacy state.

### V8 validation and repair

Each section should have a focused validator plus document-level validation for
cross-section constraints. Repair should:

- fill missing sections from canonical defaults;
- repair partial sections key-by-key;
- retain valid sibling values;
- clamp or replace invalid scalar values using documented rules;
- handle unknown renderer configuration without executing renderer code;
- report all material repairs.

Validation must not load fonts, build substrate data, execute graphs, or
generate geometry.

### Default restoration

Defaults should have one canonical source per schema version. V8 defaults must
not accidentally inherit mutable runtime preferences.

Missing legacy debug values restore preference defaults, not project fields.
Missing artwork values restore v8 artwork defaults. Tests should distinguish
these two paths.

### V8 → v7

Before implementation, choose one policy:

1. supported, explicitly lossy downgrade with warnings and feature checks; or
2. unsupported downgrade with a clear notice.

Do not implement an implicit “best effort” flattening path. If downgrade is
supported, its output must pass the current v7 validator and the applicable
golden export parity suite.

## 5. Test plan

### V7 import

- import every representative v7 fixture through the unknown-input boundary;
- migrate to v8 and account for every v7 field;
- preserve renderer, seed, typography, emitters, appearance, substrate, and
  export settings;
- confirm no graph data is created;
- confirm raw font bytes remain absent.

### V8 save

- serialize grouped sections deterministically;
- verify `version: 8`;
- verify debug, diagnostics, preview settings, navigation, worker state, parsed
  fonts, and raw font bytes are absent;
- validate save → import → save stability.

### Missing or partial debug

- v7 with complete debug extracts all valid preferences;
- v7 with partial debug retains valid keys and restores missing defaults;
- v7 with malformed debug reports repairs and restores safe defaults;
- v7 without debug restores runtime preference defaults;
- v8 saves never reintroduce extracted debug.

### Downgrade behavior

For a supported downgrade:

- generated v7 passes the v7 validator;
- supported artwork fields flatten without drift;
- debug uses the documented policy;
- unsupported v8-only data produces explicit warnings or a hard refusal;
- workspace preferences and graph data are not silently embedded.

For an unsupported downgrade, test the exact structured error/notice.

### Golden export parity

- migrate each checked-in golden v7 project to v8;
- build the same resolved text geometry and render context;
- generate geometry through the authoritative renderer registry;
- export through the existing precomputed-geometry SVG path;
- require canonical SVG hashes and summaries to equal the current fixtures.

Parity must cover Final Artwork vector-only guards and must not regenerate
fixtures merely to make a migration test pass.

### Additional boundary tests

- schema modules do not import React, preview components, renderer execution,
  Graph execution, WebGPU, workers, or SVG export;
- runtime preferences do not enter project serialization;
- graph remains absent until separately approved;
- migration is deterministic and does not mutate input objects.

## 6. Non-goals

This planning pass does not:

- implement `ProjectDocumentV8`;
- modify `ProjectState` v7;
- change project import, repair, save, or export behavior;
- remove or reinterpret `ProjectState.debug`;
- migrate existing files;
- add graph serialization or make Graph IR authoritative;
- add a graph/node editor;
- change renderer algorithms, cache keys, previews, or SVG output;
- persist raw font bytes in project JSON;
- define cloud sync, collaboration, or account-level preference storage;
- guarantee v8 → v7 downgrade support.

Implementation should begin only after section ownership, debug preference
scope, downgrade policy, and golden-parity acceptance criteria are approved.
