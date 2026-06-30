# ProjectState.debug compatibility

`ProjectState.debug` remains in schema v7 because older project files persist
artwork-adjacent debug visibility settings there. The v7 repair path fills
missing keys from `defaultDebugSettings`, and current saves preserve the object
to maintain lossless v7 round trips.

This is distinct from runtime-only `DiagnosticsMode`. `debug` controls specific
legacy visual aids such as glyph bounds, emitter markers, substrate views, and
timing labels. `DiagnosticsMode` controls the visibility level of the current
diagnostic surface and is intentionally absent from `.substrate.json`.

New schema-v7 saves should continue preserving `ProjectState.debug`. Removing it
now would silently discard settings on round trip, make older files behave
differently after save, and complicate downgrade/interchange with v7 builds.

For schema v8, migrate legacy debug values into a versioned, local runtime
preferences store and remove them from the serialized document only after:

1. v7 imports explicitly extract the settings before project repair;
2. v8 saves no longer claim lossless v7 round trips;
3. tests cover v7 import, v8 save, downgrade behavior, and default restoration;
4. the UI no longer reads `ProjectState.debug` as artwork state.

The migration should document that debug visibility is user/workspace
preference, not generated-artwork input. Until that path exists, early removal
risks data loss, surprising UI changes, and schema compatibility regressions.
