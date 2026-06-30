# Experiments

Modules here are not production runtime dependencies.

`comlinkSubstrateSpike.ts` evaluates one transferable substrate build call. It
does not replace the existing worker backend, scheduler, stale-result checks,
fallback path, capability diagnostics, or cleanup. Adoption should proceed only
if those guarantees can remain explicit.
