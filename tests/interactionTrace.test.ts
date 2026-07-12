import { describe, expect, it } from "vitest";
import { baseState } from "../src/engine/presets";
import { createInteractionTrace, safeTraceSerialize } from "../src/dev/interactionTrace";

describe("InteractionTrace", () => {
  it("keeps sequence numbers monotonic", () => {
    let clock = 10;
    const trace = createInteractionTrace({ enabled: true, now: () => clock++ });
    trace.emit({ stage: "one", phase: "instant" });
    trace.emit({ stage: "two", phase: "instant" });
    trace.emit({ stage: "three", phase: "instant" });
    expect(trace.snapshot().map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(trace.snapshot().map((event) => event.timestampMs)).toEqual([10, 11, 12]);
  });

  it("bounds the ring buffer and reports dropped events", () => {
    const trace = createInteractionTrace({ enabled: true, capacity: 3, now: () => 1 });
    for (let index = 0; index < 5; index += 1) trace.emit({ stage: `stage-${index}`, phase: "instant" });
    expect(trace.snapshot().map((event) => event.stage)).toEqual(["stage-2", "stage-3", "stage-4"]);
    expect(trace.getSummary().droppedEventCount).toBe(2);
  });

  it("pairs spans with a duration", () => {
    let clock = 100;
    const trace = createInteractionTrace({ enabled: true, now: () => clock });
    const end = trace.startSpan("typography.build", { detail: { source: "test" } });
    clock = 137;
    end({ detail: { source: "test", complete: true } });
    expect(trace.snapshot().map((event) => event.phase)).toEqual(["start", "end"]);
    expect(trace.snapshot()[1]?.durationMs).toBe(37);
  });

  it("is a no-op when disabled", () => {
    const trace = createInteractionTrace({ enabled: false });
    expect(trace.emit({ stage: "disabled", phase: "instant" })).toBeNull();
    expect(trace.beginGesture()).toBeUndefined();
    trace.beginScenario("disabled");
    expect(trace.snapshot()).toEqual([]);
    expect(trace.getSummary().eventCount).toBe(0);
  });

  it("returns immutable snapshots", () => {
    const trace = createInteractionTrace({ enabled: true });
    trace.emit({ stage: "snapshot", phase: "instant", counts: { frames: 1 }, detail: { label: "original" } });
    const snapshot = trace.snapshot();
    snapshot[0]!.counts!.frames = 99;
    snapshot[0]!.detail!.label = "changed";
    expect(trace.snapshot()[0]?.counts?.frames).toBe(1);
    expect(trace.snapshot()[0]?.detail?.label).toBe("original");
  });

  it("correlates gestures and counts project commits", () => {
    const trace = createInteractionTrace({ enabled: true });
    const gestureId = trace.beginGesture({ value: 148 });
    expect(trace.getActiveGestureId()).toBe(gestureId);
    expect(trace.recordProjectCommit(gestureId)).toBe(1);
    expect(trace.recordProjectCommit(gestureId)).toBe(2);
    trace.endGesture(gestureId, { reason: "pointerup" });
    expect(trace.getActiveGestureId()).toBeUndefined();
    expect(trace.snapshot().filter((event) => event.gestureId === gestureId).length).toBe(2);
  });

  it("serializes circular, bigint, non-finite, and Error values safely", () => {
    const circular: Record<string, unknown> = { count: 1n, infinity: Infinity, error: new Error("boom") };
    circular.self = circular;
    const serialized = safeTraceSerialize(circular);
    expect(serialized).toContain("1n");
    expect(serialized).toContain("[Circular]");
    expect(serialized).toContain("boom");
  });

  it("keeps trace metadata outside the project document", () => {
    const trace = createInteractionTrace({ enabled: true });
    trace.emit({ stage: "project.patch", phase: "instant", documentKey: "trace:1" });
    expect(JSON.stringify(baseState)).not.toContain("project.patch");
    expect(JSON.stringify(baseState)).not.toContain("trace:1");
  });
});
