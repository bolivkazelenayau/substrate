# Final Artwork export fixture strategy

The golden corpus protects the complete schema-v7 project-to-vector-SVG path
before graph execution or other runtime layers can sit beside it. Renderer unit
tests check local algorithms and invariants; these fixtures check the integrated
contract: project repair, substrate/field preparation, renderer geometry, SVG
serialization, metadata, vector structure, and stable artboard output.

## Stable output contract

Each checked-in project has fixed text, renderer, seed, controls, node budget,
quality, and Final Artwork export mode. Its expected summary records:

- the canonical SHA-256 of the complete SVG;
- `viewBox`;
- vector and forbidden-element counts;
- data-image and base64 absence.

The canonical hash covers geometry payloads, project metadata, masks, paths,
circles, polylines, text, colors, and structural attributes. A geometry or
serialization change therefore changes the hash even when element counts stay
the same.

The only ignored metadata is `exportTimestamp`. Canonicalization parses SVG,
sorts metadata object keys, preserves exporter attribute order, and removes
insignificant inter-element whitespace. It does not round coordinates, reorder geometry,
remove diagnostics/project metadata, or otherwise conceal artwork changes.

Projects use `font: null`, contain no binary data, and serialize native SVG text
masks. For cross-platform test determinism, the already checked-in
`Basic-Regular.ttf` test font supplies reference glyph geometry to the substrate
builder; it is not added to project JSON or passed to SVG serialization.

## Intentional updates

Normal tests are read-only. To regenerate summaries explicitly:

```sh
npm run update:export-fixtures
```

The command runs only the golden suite with write access enabled and prints the
old/new hash plus element counts for every fixture. Review project JSON,
summary diffs, and the reason for every changed hash before committing them.
Then run the complete test/build verification.

Never update fixtures merely to silence an unexplained failure. Expected
changes should come from an approved renderer, preset, project migration, or SVG
contract change.

## Graph readiness

Future graph execution must reproduce this corpus before it can replace,
bypass, or become authoritative over the current renderer registry path. The
Graph IR may describe equivalent stages, but equivalence means matching these
canonical exports—not merely producing visually similar previews.
