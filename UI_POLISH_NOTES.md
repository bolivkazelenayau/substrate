# UI Polish Notes (v0.16.1)

## Goals
The objective of the v0.16.1 pass was to clean up the control panel and diagnostic viewport without introducing new renderers, altering the export semantics, or modifying the project schema.

## Changes Implemented

### 1. Stable DOM Structure
Previously, inactive control blocks were unmounted from the DOM, leading to disorienting layout jumps when changing renderers or overlay modes.
- Controls are now wrapped in `.control-group` div blocks.
- When inactive, the group is given a `.disabled-group` CSS class which lowers its opacity, and the individual inputs receive `disabled=true`.
- Helpful `.inactive-hint` text is rendered inside these groups to explain *why* they are inactive and under what conditions they become available.

### 2. Diagnostics Compaction
The `Viewport` previously displayed a wall of text for all geometry metrics, animation states, and substrate timings.
- Added a `diagnosticsExpanded` state, toggled via a new checkbox in the debug section.
- By default, non-critical metrics are hidden, leaving only core high-level summaries (e.g. element counts) visible.
- Critical diagnostics and warnings (native fallback, clipped nodes, Web Worker errors, export checks) bypass the collapsed state and are always displayed, ensuring users do not miss important failure modes.

### 3. Compact Inactive Groups (Regression Fix)
Initially, inactive controls were faded but still consumed full vertical height, leaving little room for the canvas. A subsequent fix collapsed inactive groups by default, hiding all internal sliders and inputs and showing only the group header and a compact hint.
- Groups like **Glyph Modulation**, **Wave Contours**, and **Diffuser Field** reduce to a single line when disabled.
- **Warped Outline** and **Edge Erosion** use context-aware compact hints to explicitly tell the user what they need to enable to access those controls.
- The **Text Overlay** `<select>` mode was fixed to remain editable for the Glyph Diffuser even when set to "Hidden", preventing lockouts.
- The **Outline width** slider editability regression was corrected.

### 4. CSS Enhancements
Added `.control-group`, `.disabled-group`, `.nested-group`, and `.inactive-hint` to `styles.css`.
- Spacing and padding across controls were tightened to reduce the vertical footprint.
- Opacity transitions and dashed borders (`.nested-group`) are smoothed using CSS.

### 5. Fixed Workbench Layout
The application has been restructured to function as a fixed layout workbench instead of a scrolling document:
- The `html`, `body`, and `#root` elements are strictly constrained to `100vh` with `overflow: hidden`.
- The left control panel (`.controls`) scrolls independently with `overscroll-behavior: contain`.
- The right workspace (`.viewport-shell`) remains fixed, providing a stable area for the canvas.
- A new `.stage-frame` centers the SVG canvas (`.stage`), bounding it so that it perfectly fits its `1200x720` aspect ratio without overflowing.
- The transport bar and diagnostic elements stay locked to the bottom of the viewport shell.
- Manual verification across small (1366x768, 1440x900) and large viewports guarantees the artboard and transport controls remain visible at all times.

### 6. Accordion Inspector (v0.16.1)
- Replaced the large scrolling control list with an Accordion-based inspector.
- The `Controls.tsx` panel now stores `userToggles` state and filters advanced options based on the active renderer (`controlActivity`).
- Advanced groups (e.g., Diffuser Field, Glyph Emitter) open automatically when relevant, and hide completely when inactive.
### 7. Glyph Diffuser Empty State (v0.16.1)
- Redesigned the Glyph Emitter UX when empty/disabled.
- Promoted the emitter toggle to a visual "Off / On" mode switch rather than a hidden checkbox.
- Added a conditional callout when `renderer === "glyph-diffuser"` and no emitter is enabled, explicitly prompting the user to "Enable first eligible emitter" with a prominent action button.
- If no eligible glyphs are found in the current font, the button is replaced by a clear warning: "No eligible glyph found for current text/font", avoiding hidden failures.
- Streamlined fallback diagnostics logic so the viewport message accurately mirrors the control panel.

## Status
All implementation items have been completed. Tests and production builds verify that the structural DOM changes do not break schema serialization or visual output. The UI is now clean, compact, and avoids layout jumps.
