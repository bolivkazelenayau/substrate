// DEV-ONLY instrumentation for the viewport zoom/pan lag investigation.
//
// Counters below measure how often the navigation shell touches React or the
// diagnostics/mask wrappers during zoom/pan. They do NOT measure browser-side
// compositing/repaint — that belongs to the DevTools Performance panel.
//
// All exports are no-ops in production builds (`import.meta.env.DEV` is replaced
// at compile time; the whole module is tree-shaken from production bundles
// because every exported function guards on this constant).
//
// Public surface:
//   - `record*` hooks called from React components during render/commit.
//   - Counters readable through `globalThis.__SUBSTRATE_NAV_PERF__` so the
//     existing dev meter or the browser console can sample them.
//
// Never imported by the export path or by renderer code; pure observation only.
//
import type { FlowPreviewUpdateResult } from "../engine/flowPreviewOptimization";

// `import.meta.env.DEV` is statically replaced by Vite with the boolean literal
// (`true` in dev/test, `false` in production builds). Keeping this access direct
// (rather than through a cast) lets the minifier fold every `if (DEV)` /
// `if (!DEV)` branch: production builds drop the counters, the compositing-mode
// setter, and the composited `translate3d` navigation branch entirely, leaving
// only the crisp-default path. No runtime overhead, no dead strings shipped.
const DEV: boolean = import.meta.env.DEV;

export interface NavigationCounters {
  canvasNavigationRenders: number;
  viewportRenders: number;
  flowPreviewRenders: number;
  flowPreviewPathCommits: number;
  flowPreviewAttributeWrites: number;
  geometryBuilds: number;
  wheelEvents: number;
  pointerMoveEvents: number;
  viewportActiveUpdates: number;
  windowStartedAtMs: number;
  windowElapsedMs: number;
}

function zeroCounters(): NavigationCounters {
  return {
    canvasNavigationRenders: 0,
    viewportRenders: 0,
    flowPreviewRenders: 0,
    flowPreviewPathCommits: 0,
    flowPreviewAttributeWrites: 0,
    geometryBuilds: 0,
    wheelEvents: 0,
    pointerMoveEvents: 0,
    viewportActiveUpdates: 0,
    windowStartedAtMs: performance.now(),
    windowElapsedMs: 0,
  };
}

let counters: NavigationCounters = zeroCounters();

export function recordCanvasNavigationRender(): void {
  if (!DEV) return;
  counters.canvasNavigationRenders += 1;
}

export function recordViewportRender(): void {
  if (!DEV) return;
  counters.viewportRenders += 1;
}

export function recordFlowPreviewRender(): void {
  if (!DEV) return;
  counters.flowPreviewRenders += 1;
}

export function recordFlowPreviewPathCommit(stats: FlowPreviewUpdateResult): void {
  if (!DEV) return;
  counters.flowPreviewPathCommits += 1;
  counters.flowPreviewAttributeWrites += stats.attributeWrites;
}

export function recordWheelEvent(): void {
  if (!DEV) return;
  counters.wheelEvents += 1;
}

export function recordPointerMoveEvent(): void {
  if (!DEV) return;
  counters.pointerMoveEvents += 1;
}

export function recordViewportActiveUpdate(): void {
  if (!DEV) return;
  counters.viewportActiveUpdates += 1;
}

export function resetNavigationCounters(): void {
  counters = zeroCounters();
}

export function snapshotNavigationCounters(): NavigationCounters {
  return {
    ...counters,
    windowElapsedMs: performance.now() - counters.windowStartedAtMs,
  };
}

// ---------------------------------------------------------------------------
// Navigation compositing mode — runtime-only, dev-tunable.
//
// Controls whether `CanvasNavigation` keeps the preview subtree on the native
// crisp repaint path (`"crisp"`) or promotes it to a compositor GPU layer
// (`"composited"`, default since the P0 zoom fix). The crisp path re-rasters
// the SVG/canvas subtree on every committed transform value — sharp at every
// zoom step, but the full-scene repaint is the dominant zoom cost on heavy
// (multi-thousand-node) SVG scenes. The composited default keeps the subtree
// on a GPU layer (`translate3d` + `backface-visibility: hidden`), with
// `will-change: transform` applied only during active interaction and removed
// ~220 ms after the gesture settles, so the browser re-rasterizes sharply at
// the final zoom. Trade-off: transient upscale blur during the gesture itself.
//
// NOT serialized into `ProjectState`, NOT a creative control, and NOT exposed
// through any UI surface. Reachable only via the dev console global
// `__SUBSTRATE_NAV_COMPOSITING__` (set in dev builds) as an escape hatch back
// to `"crisp"`. The getter is intentionally build-agnostic: production ships
// the composited hybrid path.
export type NavigationCompositingMode = "crisp" | "composited";

let compositingMode: NavigationCompositingMode = "composited";

export function getNavigationCompositingMode(): NavigationCompositingMode {
  return compositingMode;
}

export function setNavigationCompositingMode(mode: NavigationCompositingMode): void {
  if (!DEV) return;
  compositingMode = mode;
}

type PublicApi = {
  snapshot: typeof snapshotNavigationCounters;
  reset: typeof resetNavigationCounters;
};

type CompositingApi = {
  get: typeof getNavigationCompositingMode;
  set: typeof setNavigationCompositingMode;
};

if (DEV) {
  const globalWithApi = globalThis as typeof globalThis & {
    __SUBSTRATE_NAV_PERF__?: PublicApi;
    __SUBSTRATE_NAV_COMPOSITING__?: CompositingApi;
  };
  globalWithApi.__SUBSTRATE_NAV_PERF__ = {
    snapshot: snapshotNavigationCounters,
    reset: resetNavigationCounters,
  };
  globalWithApi.__SUBSTRATE_NAV_COMPOSITING__ = {
    get: getNavigationCompositingMode,
    set: setNavigationCompositingMode,
  };
}