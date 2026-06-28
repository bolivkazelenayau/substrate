# Wave Contours QA

Version: 0.12.0  
Date: 2026-06-28

## Environment

- Automated: Vitest/jsdom with `@napi-rs/canvas`
- Font fixture: OFL-licensed `tests/fixtures/Basic-Regular.ttf`
- Browser smoke check: local Chromium/in-app browser
- Backend observed during browser smoke check: `CPU-WORKER / READY / SUPPORT SUPPORTED`

## QA matrix

| Check | Status | Evidence / notes |
| --- | --- | --- |
| Default text + Glyph Ripple | Browser checked | Wave Contours rendered static continuous polylines, selected the first eligible native glyph, and reported field/contour diagnostics. |
| Default text + Dotted Diffuser | Automated | Preset/schema and dotted circle generation are covered; dedicated manual visual comparison remains recommended. |
| First/middle/last glyph emitter | Automated | Stable glyph selection and different-emitter field/output tests cover selection changes; full visual matrix remains recommended. |
| O/o/0 emitter | Automated | Parsed O counter-center heuristic and center fallback are tested. This is bounds-based, not topology analysis. |
| Radius low/medium/high | Automated | Radius cutoff and falloff behavior are tested; visual sweep remains recommended. |
| Self vs neighbor influence | Automated | Zero/nonzero source-region and non-source-region contributions are tested. |
| Continuous vs dotted | Automated | Finite polylines and finite positive-radius circles are tested with separate node budgets. |
| Native text fallback | Browser checked | Default native-text substrate rendered Wave Contours and approximate native glyph cells. |
| Uploaded Basic-Regular.ttf | Automated | Real parsed glyph paths, IDs, anchors, substrate, field, contours, and export use the bundled OFL fixture. Manual upload interaction remains recommended. |
| SVG export | Automated | DOM reload validation passes; output contains no image, canvas, PNG, JPEG, or data URL. |
| Project JSON save/load | Automated | JSON stringify/parse plus schema validation preserves emitter and contour settings. Manual download/upload interaction remains recommended. |

## Diagnostics checked

Wave Contours reports selected glyph, anchor coordinates, source mode, field resolution, min/max range, contour levels, fragments, output/point count, node clipping, field build time, contour extraction time, contour mode, and bounds-based membership.

## Remaining manual checks

The automated suite is authoritative for deterministic math, budgets, schema, and serialization. A human visual pass should still compare Dotted Diffuser spacing, first/middle/last glyph aesthetics, radius extremes, and the actual file-picker upload/save/load interactions across standalone Chrome, Firefox, and Safari.
