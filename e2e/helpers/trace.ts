import type { Page } from "@playwright/test";

export type E2ETraceEvent = {
  sequence: number;
  traceId: string;
  gestureId?: number;
  stage: string;
  phase: "instant" | "start" | "end";
  inputKey?: string;
  outputKey?: string;
  documentKey?: string;
  frameKey?: string;
  timestampMs: number;
  durationMs?: number;
  counts?: Record<string, number>;
  bytes?: Record<string, number>;
  detail?: Record<string, string | number | boolean | null>;
};

export type E2ETraceApi = {
  reset(): void;
  snapshot(): E2ETraceEvent[];
  beginScenario(name: string): void;
  endScenario(): void;
  getSummary(): unknown;
};

export function eventsFor(events: E2ETraceEvent[], stage: string, phase?: E2ETraceEvent["phase"]) {
  return events.filter((event) => event.stage === stage && (phase === undefined || event.phase === phase));
}

/** Pipeline stages tagged with `detail.authority === "static-or-authoritative"` only. */
export function authoritativeEventsFor(events: E2ETraceEvent[], stage: string, phase?: E2ETraceEvent["phase"]) {
  return eventsFor(events, stage, phase).filter(
    (event) => event.detail?.authority === "static-or-authoritative",
  );
}

export async function beginScenario(page: Page, name: string) {
  await page.evaluate((scenario) => {
    (window as Window & { __SUBSTRATE_TRACE__?: E2ETraceApi }).__SUBSTRATE_TRACE__?.beginScenario(scenario);
  }, name);
}

export async function readTrace(page: Page): Promise<E2ETraceEvent[]> {
  return page.evaluate(() => (
    (window as Window & { __SUBSTRATE_TRACE__?: E2ETraceApi }).__SUBSTRATE_TRACE__?.snapshot() ?? []
  ));
}