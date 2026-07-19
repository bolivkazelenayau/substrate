import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { baseState } from "../src/engine/presets";
import { SUBSTRATE_NOT_REQUIRED_KEY } from "../src/engine/pipelineStageKeys";
import { substrateBuildInputKey } from "../src/engine/exportAuthority";
import { typographyStageKey } from "../src/engine/pipelineStageKeys";
import { useSubstrateBackend, type SubstrateBackendState } from "../src/hooks/useSubstrateBackend";
import type { SubstrateBuildInput, SubstrateData } from "../src/engine/substrate";

type HookResult = SubstrateBackendState;

const baseInput: SubstrateBuildInput = {
  sourceText: baseState.text,
  textGeometry: null,
  fontSize: baseState.fontSize,
  tracking: baseState.tracking,
  fontFamily: "sans-serif",
  fontWeight: 400,
  baselineY: 360,
  textX: 600,
  lineHeight: baseState.lineHeight,
  textAlign: baseState.textAlign,
  kerningMode: baseState.kerningMode,
  resolution: { width: 64, height: 39 },
  bounds: null,
  domainBounds: { x: 0, y: 0, width: 1200, height: 720 },
  viewport: { x: 0, y: 0, width: 1200, height: 720 },
};

const typographyKey = typographyStageKey(baseState, "font:native");
const inputKeyA = substrateBuildInputKey(baseInput, typographyKey);
const inputKeyB = substrateBuildInputKey({ ...baseInput, sourceText: `${baseInput.sourceText}!` }, typographyKey);

// Configurable compute delay so hook lifecycle tests can observe active work.
var computeDelayMs = 0;

function makeSubstrateData(): SubstrateData {
  return {
    width: 64,
    height: 39,
    viewportWidth: 1200,
    viewportHeight: 720,
    scaleX: 1,
    scaleY: 1,
    sourceText: baseInput.sourceText,
    substrateType: "glyph-paths",
    mask: { width: 64, height: 39, data: new Float32Array(64 * 39) },
    edge: { width: 64, height: 39, data: new Float32Array(64 * 39) },
    distance: { width: 64, height: 39, data: new Float32Array(64 * 39) },
    bounds: null,
    diagnostics: {
      maskCoverage: 0,
      edgePixelCount: 0,
      minDistance: 0,
      maxDistance: 0,
      rasterizeTimeMs: 0,
      edgeMapTimeMs: 0,
      distanceFieldTimeMs: 0,
      buildTimeMs: 0,
    },
  };
}

vi.mock("../src/engine/substrate", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/engine/substrate")>();
  return {
    ...original,
    createCpuWorkerSubstrateBackend: () => ({
      id: "cpu-worker",
      label: "CPU / Web Worker",
      available: false,
      availabilityReason: "Worker unavailable in test environment.",
      capability: null,
      compute: async () => { throw new Error("unreachable"); },
      dispose: () => {},
    }),
    computeSubstrateWithFallback: async () => {
      if (computeDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, computeDelayMs));
      }
      return {
        result: {
          data: makeSubstrateData(),
          error: null,
          requestId: 1,
          backend: "cpu-main" as const,
          timing: { totalMs: 1, mainThreadMs: 1, workerComputeMs: 0, roundTripMs: 0 },
        },
        fallbackCode: "worker-unavailable" as const,
        fallbackReason: "Worker unavailable in test environment.",
      };
    },
  };
});

function SubstrateProbe(props: {
  input: SubstrateBuildInput;
  inputKey: string;
  enabled: boolean;
  publish: (result: HookResult) => void;
}) {
  props.publish(useSubstrateBackend(props.input, props.inputKey, props.enabled));
  return null;
}

describe("useSubstrateBackend identity and lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: HookResult;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(input: SubstrateBuildInput, inputKey: string, enabled = true) {
    act(() => root.render(createElement(SubstrateProbe, {
      input,
      inputKey,
      enabled,
      publish: (result: HookResult) => { latest = result; },
    })));
    return latest;
  }

  async function waitForOutput(inputKey: string) {
    await vi.waitFor(() => expect(latest.outputKey).toBe(inputKey), { timeout: 2000 });
  }

  it("enqueues a second build when the same input object gets a new semantic key", async () => {
    render(baseInput, inputKeyA);
    await waitForOutput(inputKeyA);

    const before = latest.status.requestId;
    render(baseInput, inputKeyB);
    await waitForOutput(inputKeyB);

    expect(latest.outputKey).toBe(inputKeyB);
    expect(latest.status.requestId).toBeGreaterThan(before);
  });

  it("skips duplicate work when a new object has the same semantic key", async () => {
    render(baseInput, inputKeyA);
    await waitForOutput(inputKeyA);

    const before = latest.status.requestId;
    render({ ...baseInput }, inputKeyA);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(latest.outputKey).toBe(inputKeyA);
    expect(latest.status.requestId).toBe(before);
  });

  it("disables substrate and leaves no pending request", async () => {
    render(baseInput, inputKeyA);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    render(baseInput, inputKeyA, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(latest.outputKey).toBe(SUBSTRATE_NOT_REQUIRED_KEY);
    expect(latest.status.phase).toBe("not-required");
    expect(latest.status.pendingRequestCount).toBe(0);
  });

  it("disables substrate while an active build is running and reports not-required", async () => {
    computeDelayMs = 500;
    render(baseInput, inputKeyA);
    // Let A start active compute.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(latest.status.phase).toBe("building");

    render(baseInput, inputKeyA, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    expect(latest.outputKey).toBe(SUBSTRATE_NOT_REQUIRED_KEY);
    expect(latest.status.phase).toBe("not-required");
    expect(latest.status.activeRequestId).toBeNull();
    computeDelayMs = 0;
  });

  it("re-enables with the same semantic input after disable", async () => {
    render(baseInput, inputKeyA);
    await waitForOutput(inputKeyA);

    render(baseInput, inputKeyA, false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    render(baseInput, inputKeyA, true);
    await waitForOutput(inputKeyA);

    expect(latest.outputKey).toBe(inputKeyA);
    expect(["ready", "fallback"]).toContain(latest.status.phase);
  });

  it("supersedes a pending request when a newer one arrives", async () => {
    computeDelayMs = 200;
    render(baseInput, inputKeyA);
    // Let A's debounce timer fire and start active compute.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    // Schedule B while A is still computing.
    render({ ...baseInput, sourceText: "A" }, inputKeyB);
    await waitForOutput(inputKeyB);

    expect(latest.outputKey).toBe(inputKeyB);
    expect(latest.status.coalescedRequestCount).toBeGreaterThan(0);
    computeDelayMs = 0;
  });

  it("cleans up scheduler on unmount without throwing", async () => {
    render(baseInput, inputKeyA);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(() => act(() => root.unmount())).not.toThrow();
  });
});
