# Project JSON compatibility contract

## Failure boundary

The historical importer accepted a loose object with an optional numeric
`version`, then let the versioned migration and repair layer supply defaults.
The regressed boundary required `text`, `renderer`, `seed`, and (for v8)
`artboard` before migration. That rejected sparse-but-valid historical
documents before the same defaults used by their original releases could run.

The production import path now restores the released loose-object contract.
The exported v7/v8 shape helpers remain stricter diagnostic helpers and validate
their actual version-specific saved shapes; they are not preconditions for
migration.

## Version decision

Schema v9 remains the correct persisted-document version. It is the exact shape
boundary that adds `emitterDisplay`, protected experimental
`glyphDisplacement`, and `dotGrid` state. The v8 to v9 migration preserves any
already-authored additive values and inserts legacy-equivalent defaults when
they are absent:

- emitter display uses `field` mode;
- glyph displacement is disabled;
- the regular dot grid is disabled.

The existing glyph-displacement enum, values, identities, geometry, preview,
and export behavior are protected v9 behavior. A future Display Dislocation
feature must use separate persisted state and must not reinterpret these modes.

## Import order

The production boundary now follows this order:

1. parse JSON syntax and require an object root;
2. identify SUBSTRATE v1 through v9 (an omitted version is historical v1);
3. validate the minimum fields belonging to that historical version;
4. run the existing sequential migration chain;
5. insert additive v9 defaults;
6. repair bounded numeric and enum values;
7. validate the complete latest `ProjectState` shape;
8. restore runtime font bytes separately after import.

Errors retain distinct categories for invalid JSON, unsupported schema,
missing historical fields, migration failure, and latest-shape validation.
Import state is committed only after the complete pipeline succeeds. Unknown
top-level fields and unknown presets are reported rather than silently ignored.

## Compatibility evidence

Checked-in fixtures cover v1 through v8, current v9 save/reload, old single and
multiple emitter structures, uploaded-font metadata, fallback fonts, non-zero
`textOffsetY`, dense SDF settings, and authored artboards. Existing v7 export
goldens remain authoritative. Separate protected-fragmentation fixtures freeze
the displacement key, geometry key, fragment bounds, scene key, renderer
structure, and canonical SVG hash for warp, horizontal slices, vertical slices,
grid cells, and radial sectors.
