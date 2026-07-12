export type InteractionTracePhase = "instant" | "start" | "end";

export interface InteractionTraceEvent {
  sequence: number;
  traceId: string;
  gestureId?: number;
  stage: string;
  phase: InteractionTracePhase;
  inputKey?: string;
  outputKey?: string;
  documentKey?: string;
  frameKey?: string;
  timestampMs: number;
  durationMs?: number;
  counts?: Record<string, number>;
  bytes?: Record<string, number>;
  detail?: Record<string, string | number | boolean | null>;
}

export type InteractionTraceEventInput = Omit<InteractionTraceEvent, "sequence" | "traceId" | "timestampMs"> & {
  timestampMs?: number;
};

export interface InteractionTraceSummary {
  traceId: string;
  scenario: string | null;
  eventCount: number;
  droppedEventCount: number;
  sequence: number;
  gestureCount: number;
  stages: Record<string, { instant: number; start: number; end: number }>;
}

export interface InteractionTraceApi {
  reset(): void;
  snapshot(): InteractionTraceEvent[];
  beginScenario(name: string): void;
  endScenario(): void;
  getSummary(): InteractionTraceSummary;
}

export interface InteractionTraceController extends InteractionTraceApi {
  emit(event: InteractionTraceEventInput): InteractionTraceEvent | null;
  startSpan(stage: string, event?: Omit<InteractionTraceEventInput, "stage" | "phase" | "durationMs">): (end?: Omit<InteractionTraceEventInput, "stage" | "phase">) => InteractionTraceEvent | null;
  beginGesture(detail?: Record<string, string | number | boolean | null>): number | undefined;
  endGesture(gestureId?: number, detail?: Record<string, string | number | boolean | null>): InteractionTraceEvent | null;
  getActiveGestureId(): number | undefined;
  recordProjectCommit(gestureId?: number): number;
}

export const INTERACTION_TRACE_BUFFER_CAP = 4_000;

function cloneEvent(event: InteractionTraceEvent): InteractionTraceEvent {
  return {
    ...event,
    counts: event.counts ? { ...event.counts } : undefined,
    bytes: event.bytes ? { ...event.bytes } : undefined,
    detail: event.detail ? { ...event.detail } : undefined,
  };
}

export function safeTraceSerialize(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, currentValue: unknown) => {
      if (typeof currentValue === "bigint") return `${currentValue}n`;
      if (typeof currentValue === "number" && !Number.isFinite(currentValue)) return String(currentValue);
      if (currentValue instanceof Error) return { name: currentValue.name, message: currentValue.message };
      if (currentValue && typeof currentValue === "object") {
        if (seen.has(currentValue)) return "[Circular]";
        seen.add(currentValue);
      }
      return currentValue;
    }) ?? "null";
  } catch {
    return "[Unserializable]";
  }
}

function traceHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function traceKey(value: unknown): string {
  return `trace:${traceHash(safeTraceSerialize(value))}`;
}

export function createInteractionTrace(options: {
  enabled: boolean;
  capacity?: number;
  now?: () => number;
}): InteractionTraceController {
  const capacity = Math.max(1, Math.floor(options.capacity ?? INTERACTION_TRACE_BUFFER_CAP));
  const now = options.now ?? (() => typeof performance !== "undefined" ? performance.now() : Date.now());
  let sequence = 0;
  let traceId = "trace:idle";
  let scenario: string | null = null;
  let droppedEventCount = 0;
  let gestureCount = 0;
  let activeGestureId: number | undefined;
  let events: InteractionTraceEvent[] = [];
  const gestureStarts = new Map<number, number>();
  const projectCommits = new Map<number, number>();

  const controller: InteractionTraceController = {
    emit(input) {
      if (!options.enabled) return null;
      const event: InteractionTraceEvent = {
        ...input,
        sequence: ++sequence,
        traceId,
        timestampMs: input.timestampMs ?? now(),
      };
      if (events.length >= capacity) {
        events = events.slice(events.length - capacity + 1);
        droppedEventCount += 1;
      }
      events.push(event);
      return cloneEvent(event);
    },

    startSpan(stage, input = {}) {
      if (!options.enabled) return () => null;
      const startedAt = now();
      controller.emit({ ...input, stage, phase: "start", timestampMs: startedAt });
      return (end = {}) => controller.emit({
        ...end,
        stage,
        phase: "end",
        durationMs: Math.max(0, now() - startedAt),
      });
    },

    beginGesture(detail) {
      if (!options.enabled) return undefined;
      const gestureId = ++gestureCount;
      activeGestureId = gestureId;
      gestureStarts.set(gestureId, now());
      projectCommits.set(gestureId, 0);
      controller.emit({ stage: "native.size.gesture", phase: "start", gestureId, detail });
      return gestureId;
    },

    endGesture(gestureId = activeGestureId, detail) {
      if (!options.enabled || gestureId === undefined) return null;
      const startedAt = gestureStarts.get(gestureId);
      const result = controller.emit({
        stage: "native.size.gesture",
        phase: "end",
        gestureId,
        durationMs: startedAt === undefined ? undefined : Math.max(0, now() - startedAt),
        detail,
      });
      gestureStarts.delete(gestureId);
      if (activeGestureId === gestureId) activeGestureId = undefined;
      return result;
    },

    getActiveGestureId() {
      return options.enabled ? activeGestureId : undefined;
    },

    recordProjectCommit(gestureId = activeGestureId) {
      if (!options.enabled || gestureId === undefined) return 0;
      const next = (projectCommits.get(gestureId) ?? 0) + 1;
      projectCommits.set(gestureId, next);
      return next;
    },

    reset() {
      if (!options.enabled) return;
      events = [];
      scenario = null;
      activeGestureId = undefined;
      gestureStarts.clear();
      projectCommits.clear();
      droppedEventCount = 0;
      gestureCount = 0;
    },

    snapshot() {
      if (!options.enabled) return [];
      return events.map(cloneEvent);
    },

    beginScenario(name) {
      if (!options.enabled) return;
      events = [];
      scenario = name;
      traceId = `trace:${traceHash(`${name}:${sequence + 1}`)}`;
      activeGestureId = undefined;
      gestureStarts.clear();
      projectCommits.clear();
      droppedEventCount = 0;
      gestureCount = 0;
      controller.emit({ stage: "scenario", phase: "start", detail: { name } });
    },

    endScenario() {
      if (!options.enabled) return;
      controller.emit({ stage: "scenario", phase: "end", detail: { name: scenario } });
      scenario = null;
      activeGestureId = undefined;
    },

    getSummary() {
      const stages: InteractionTraceSummary["stages"] = {};
      for (const event of events) {
        const stage = stages[event.stage] ?? { instant: 0, start: 0, end: 0 };
        stage[event.phase] += 1;
        stages[event.stage] = stage;
      }
      return {
        traceId,
        scenario,
        eventCount: events.length,
        droppedEventCount,
        sequence,
        gestureCount,
        stages,
      };
    },
  };

  return controller;
}

const TRACE_ENABLED = import.meta.env.DEV || import.meta.env.VITE_SUBSTRATE_TRACE === "1";
export const interactionTraceEnabled = TRACE_ENABLED;
export const interactionTrace = createInteractionTrace({ enabled: TRACE_ENABLED });

export function traceEvent(event: InteractionTraceEventInput): InteractionTraceEvent | null {
  return interactionTrace.emit(event);
}

export function traceStartSpan(stage: string, event: Omit<InteractionTraceEventInput, "stage" | "phase" | "durationMs"> = {}) {
  return interactionTrace.startSpan(stage, event);
}

export function beginTraceGesture(detail?: Record<string, string | number | boolean | null>) {
  return interactionTrace.beginGesture(detail);
}

export function endTraceGesture(gestureId?: number, detail?: Record<string, string | number | boolean | null>) {
  return interactionTrace.endGesture(gestureId, detail);
}

export function activeTraceGestureId() {
  return interactionTrace.getActiveGestureId();
}

export function recordTraceProjectCommit(gestureId?: number) {
  return interactionTrace.recordProjectCommit(gestureId);
}

export interface SubstrateTraceWindow extends Window {
  __SUBSTRATE_TRACE__?: InteractionTraceApi;
  __SUBSTRATE_E2E_BUILD__?: string;
}

function installBrowserTraceObservers() {
  if (!TRACE_ENABLED || typeof window === "undefined") return;
  const traceWindow = window as SubstrateTraceWindow;
  traceWindow.__SUBSTRATE_TRACE__ = {
    reset: () => interactionTrace.reset(),
    snapshot: () => interactionTrace.snapshot(),
    beginScenario: (name) => interactionTrace.beginScenario(name),
    endScenario: () => interactionTrace.endScenario(),
    getSummary: () => interactionTrace.getSummary(),
  };
  traceWindow.__SUBSTRATE_E2E_BUILD__ = "e2e-trace";

  if ("PerformanceObserver" in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          traceEvent({
            stage: "browser.long-task",
            phase: "instant",
            durationMs: entry.duration,
            detail: { startTime: entry.startTime, entryType: entry.entryType },
          });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task entries are optional and unsupported browsers stay observable.
    }
  }

  const recordBrowserMetrics = () => {
    const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    if (navigation) {
      traceEvent({
        stage: "browser.navigation",
        phase: "instant",
        durationMs: navigation.duration,
        detail: {
          domContentLoaded: navigation.domContentLoadedEventEnd,
          loadEventEnd: navigation.loadEventEnd,
          transferSize: navigation.transferSize,
        },
      });
    }
    for (const entry of performance.getEntriesByType("paint")) {
      traceEvent({ stage: "browser.paint", phase: "instant", timestampMs: entry.startTime, detail: { name: entry.name } });
    }
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    if (memory) {
      traceEvent({
        stage: "browser.memory",
        phase: "instant",
        bytes: { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize },
        detail: { approximate: true },
      });
    }
  };
  if (document.readyState === "complete") window.setTimeout(recordBrowserMetrics, 0);
  else window.addEventListener("load", recordBrowserMetrics, { once: true });
}

installBrowserTraceObservers();
