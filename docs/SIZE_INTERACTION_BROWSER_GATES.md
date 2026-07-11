# Size interaction browser gates

This is a future browser-level acceptance specification. It records observable
requirements for the later Size/scene work; it does not describe the current
runtime implementation.

## 1. Ripple native Size drag

- Setup: Open a Ripple project with the native font fallback active.
- User action: Drag Size through a range of values and release.
- Observable expected behavior: The preview follows the drag, settles to the released value, and remains usable immediately afterward.
- Key invariant: The committed document contains exactly the released Size and no stale value replaces it.

## 2. Halftone native Size drag

- Setup: Open a Halftone project with the native font fallback active.
- User action: Drag Size across a small and a large value before releasing.
- Observable expected behavior: The preview remains bounded and responsive, then settles to the released value without a blank frame.
- Key invariant: Dense preview work is bounded and the final rendered state matches the committed Size.

## 3. Release followed immediately by a second drag

- Setup: Open any supported project and begin with a stable preview.
- User action: Release one Size drag and start a second drag before the first update visibly finishes.
- Observable expected behavior: The second drag remains interactive and its release becomes the final visible state.
- Key invariant: A late result from the first gesture cannot overwrite the second gesture.

## 4. Double-click Size reset

- Setup: Open a project whose Size differs from its default.
- User action: Double-click the native Size control, then make another Size change.
- Observable expected behavior: Size resets once to its default and the control remains enabled and usable.
- Key invariant: Reset changes only the Size-owned document value and later input is not lost.

## 5. Canvas/SVG parity for Flow

- Setup: Open the same Flow project with Canvas preview and SVG preview available.
- User action: Switch between the two preview backends without changing project inputs.
- Observable expected behavior: Mark origins and visible placement coincide within the declared rendering tolerance.
- Key invariant: Both backends use the same authored scene coordinates and typography inputs.

## 6. No blank Canvas frame during an update

- Setup: Open a Canvas-backed project with a visible generated field.
- User action: Change Size or another supported input once.
- Observable expected behavior: The previous or next complete frame remains visible throughout the update; the canvas never flashes blank.
- Key invariant: Frame retention is continuous until a valid replacement frame is ready.

## 7. Size 148 → 540 → 148 scene round trip

- Setup: Open a project at Size 148 and record its visible placement.
- User action: Set Size to 540, then return to 148.
- Observable expected behavior: The final scene returns to the original placement and authored document values.
- Key invariant: A reversible Size round trip does not accumulate placement or artboard drift.

## 8. Dense SVG and supported Canvas zoom/pan smoke test

- Setup: Open a dense SVG project and a supported Canvas project.
- User action: Zoom and pan across the visible artboard, including the minimum and maximum supported zoom ranges.
- Observable expected behavior: Both previews remain responsive, bounded, and correctly aligned to the viewport.
- Key invariant: Navigation does not change document geometry or move output outside the visible artboard contract.
