# Experiments

Modules here are isolated experiments and cannot be imported by normal
production runtime modules. The source import-boundary test enforces that rule.

## Comlink substrate spike

`comlinkSubstrateSpike.ts` evaluates one transferable substrate build call.
Comlink is not production-used, is installed as a dev dependency, and the spike
is not reachable from the application entry. Neither the spike nor the
`comlink` package appears in the production bundle.

The existing substrate worker protocol remains authoritative. Comlink should be
adopted only if a measured implementation demonstrates all of the following:

- output buffers remain transferables, with no accidental structured-clone copy;
- cancellation or latest-request staleness is explicit and testable;
- worker creation/runtime fallback is visible to users and diagnostics;
- capability diagnostics retain Worker, OffscreenCanvas, Path2D, and backend
  availability detail;
- React Strict Mode mount/unmount cycles release proxies, terminate workers,
  cancel pending work, and do not retain transferred buffers;
- bundle and runtime measurements show a material benefit over the current
  protocol.

The spike does not replace the scheduler, stale-result checks, fallback path,
capability reporting, or cleanup in this pass.
