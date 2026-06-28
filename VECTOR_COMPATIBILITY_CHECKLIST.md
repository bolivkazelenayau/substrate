# SUBSTRATE SVG Vector Compatibility Checklist

Use the same representative project for each application:

- A short word with counters and curves, such as `FORM`.
- A custom uploaded `.ttf` or `.otf` font.
- Final Artwork export using `glyph-paths`.
- Editable Text export from the same project.
- A moderate mark count and one high-budget stress export.

Record application name, version, operating system, exported SVG byte size, and any import options used.

## Source Browser

### Final Artwork

- [ ] SVG opens without an XML/parser error.
- [ ] Path mask renders correctly.
- [ ] Generated artwork remains clipped to the glyph shapes.
- [ ] Appearance matches the frozen SUBSTRATE preview frame.
- [ ] Removing or changing the installed source font does not change the masked artwork.
- [ ] `background`, `substrate-mask`, `substrate-outline`, `generated-artwork`, and `source-text-hidden` structures are present in developer tools.
- [ ] Metadata contains project JSON, font metadata, renderer, seed, and `glyph-paths` substrate type.
- [ ] File remains responsive at normal mark budgets.
- [ ] High-budget export size and rendering time are recorded.

### Editable Text

- [ ] SVG opens.
- [ ] Text is represented by native `<text>`.
- [ ] Text appearance is correct while the custom font is available.
- [ ] Missing-font behavior is understood and documented.

## Figma

Import both SVGs into a new blank file.

### Final Artwork

- [ ] SVG imports without an error.
- [ ] Path mask renders correctly.
- [ ] Artwork remains clipped to glyph shapes.
- [ ] Glyph mask is font-independent after the original font is disabled/uninstalled.
- [ ] Generated paths/circles remain vector objects.
- [ ] Hidden source-text or substrate-outline layers are preserved, removed, or flattened as recorded.
- [ ] Metadata preservation behavior is recorded.
- [ ] Layer/node count is usable and file does not become unexpectedly heavy.

### Editable Text

- [ ] Text remains editable as text.
- [ ] Correct font is used when installed.
- [ ] Font substitution behavior is recorded when unavailable.

## Adobe Illustrator

Open the SVG directly and repeat using **File → Place** if behavior differs.

### Final Artwork

- [ ] SVG opens without a repair warning.
- [ ] Path mask renders correctly.
- [ ] Artwork remains clipped to glyph shapes.
- [ ] Glyph mask remains font-independent.
- [ ] Mask/group hierarchy is understandable in the Layers panel.
- [ ] Hidden reference layers are preserved or their loss is recorded.
- [ ] Metadata preservation behavior is recorded.
- [ ] Object count, interaction latency, and saved file size remain reasonable.

### Editable Text

- [ ] Text remains editable.
- [ ] Correct font resolves when installed.
- [ ] Missing-font dialog/substitution behavior is recorded.

## Inkscape

Open the SVG directly.

### Final Artwork

- [ ] SVG opens without XML or namespace errors.
- [ ] Path mask renders correctly.
- [ ] Artwork remains clipped to glyph shapes.
- [ ] Glyph mask remains font-independent.
- [ ] XML Editor shows the expected IDs and groups.
- [ ] Hidden source text and substrate outline are preserved.
- [ ] Metadata is visible in the XML tree or its removal is recorded.
- [ ] Rendering and selection remain responsive at normal mark budgets.

### Editable Text

- [ ] Text remains editable with the Text tool.
- [ ] Correct font resolves when installed.
- [ ] Font fallback behavior is recorded.

## Affinity Designer (if available)

Open or place both SVGs.

### Final Artwork

- [ ] SVG opens without an error.
- [ ] Path mask renders correctly.
- [ ] Artwork remains clipped to glyph shapes.
- [ ] Glyph mask remains font-independent.
- [ ] Group/mask hierarchy is preserved or flattening behavior is recorded.
- [ ] Hidden layers and metadata preservation are recorded.
- [ ] Element count and document responsiveness remain reasonable.

### Editable Text

- [ ] Text remains editable.
- [ ] Correct font resolves when installed.
- [ ] Missing-font behavior is recorded.

## Compatibility Result Template

```text
Application/version:
Operating system:
Export mode:
Renderer:
Glyph path count:
Generated mark count:
SVG element count:
SVG byte size:

Opened successfully:
Mask correct:
Artwork clipped:
Font-independent:
Editable text preserved:
Hidden layers preserved:
Metadata preserved:
Unexpected weight/performance:
Notes/screenshots:
```
