# Glyph-domain displacement decision

## Insertion point

Insert one derived typography-geometry stage immediately after authoritative font layout and before scene layout. Parsed `TextGeometry` remains immutable. The derived stage returns the exact source geometry and source key when disabled or equivalent to a no-op; otherwise it returns one displaced vector geometry and a focused semantic identity.

The active result is the sole typography authority consumed by scene bounds, substrate rasterization and SDF construction, renderer context, preview, and export.

## Geometry strategy

- Flatten parsed outline curves with deterministic world-space sampling budgets.
- For warp mode, map every source contour point through one bounded deterministic field.
- For slice/grid/sector modes, split source contours against stable world-coordinate regions and apply one coherent affine transform per fragment.
- Recompute glyph, ink, fragment, and scene bounds from the displaced vectors.
- Keep native text fallback as an explicit parsed-font-only limitation rather than silently changing semantics.

## Renderer and export strategy

SDF renderers consume the displaced raster/SDF. Mask-clipped renderers consume the displaced vector mask. SDF Halftone additionally offers a regular world-grid mode whose candidates are classified against the displaced domain and remain vector circles in Final Artwork SVG. Existing emitter-display response remains a separate downstream mark-space stage.
