# SUBSTRATE Vector Compatibility Results

App version: `0.10.0`  
Operating system: Windows  
Export format: SVG 1.1-compatible XML with structured groups and SVG masks  
Compatibility mode: Standard SVG only; no flattened-mask mode is claimed

The current Final Artwork export uses vector geometry plus a path-based SVG `<mask>` when parsed glyph outlines are available. A flattened boolean-intersection export has not been implemented because reliable path clipping/boolean operations would require a substantial geometry pipeline and external-editor validation. No raster compatibility fallback is embedded.

| Target | Status | Final artwork opens | Glyph mask preserved | Artwork clipped | Editable text editable | Metadata preserved | Hidden layers preserved | Performance / known issues |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Browser (Chromium in Codex) | Tested on `0.10.0`, Windows | Yes | Yes, automated DOM inspection | Yes in preview/export structure | Native `<text>` is present in Editable Text export | Yes | Required hidden groups remain in DOM | Ultra QA: 768×461, 654 ms build, 77.5 KB exact SVG diagnostic, 6.1 ms serialization; severe warning displayed correctly |
| Figma | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Manual import required |
| Adobe Illustrator | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Manual open/place tests required |
| Inkscape | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Manual XML tree and rendering tests required |
| Affinity Designer | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Not tested | Test only if available |

## Automated compatibility export set

`generateCompatibilityExportSet()` creates these in-memory SVG fixtures without browser download interaction:

1. Editable Text
2. Final Artwork with glyph-path mask
3. SDF Flow
4. SDF Streamlines
5. SDF Contours
6. SDF Halftone
7. High mark-count stress export
8. Special-character native-text export using `&`, `<`, `>`, and quotes

Each result includes renderer, substrate type, glyph-path count, generated element count, point count, exact byte size, serialization time, and export warnings.

Automated validation confirms that every Final Artwork fixture parses as XML, contains no `<image>` elements, and keeps generated artwork as vector paths, polylines, lines, circles, or text.

The browser debug preview may contain one raster `<image>` only while a raster substrate debug mode is selected. That preview-only node is not serialized into Final Artwork exports.

## Manual test gap

Only the browser target is currently verified. Figma, Illustrator, Inkscape, and Affinity results must remain `Not tested` until the files are imported by a reviewer using the steps in `VECTOR_COMPATIBILITY_CHECKLIST.md`.
