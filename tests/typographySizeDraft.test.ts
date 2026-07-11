import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, createElement, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Viewport } from "../src/components/Viewport";
import { parseFontBuffer, type LoadedFont } from "../src/engine/fontLoader";
import { baseState, presets } from "../src/engine/presets";
import { generateRendererGeometry } from "../src/engine/rendererRuntime";
import { planArtboardExpansionToText } from "../src/engine/artboardExpansion";
import { createDraftRenderInput, createFrozenRendererRevision, planDraftRendererPreview, sampleDraftGeometry } from "../src/engine/draftRendererPreview";
import { mapWorldPoint, resolveProjectedScenePresentation } from "../src/engine/projectedScenePresentation";
import {
  applyTypographySizePlacement,
  projectTypographySizeFromPlacement,
  resolveArtboardCenteredTypographySize,
  resolveSettledTypographyPlacement,
} from "../src/engine/typographySizePlacement";
import { useTypographySizeDraft, type TypographySizeDraft, type TypographySizePhase } from "../src/hooks/useTypographySizeDraft";
import { getRendererManifest } from "../src/engine/renderers/rendererManifest";
import type { ProjectState, RenderContext } from "../src/types";

interface ProbeValue {
  project: ProjectState;
  phase: TypographySizePhase;
  draft: TypographySizeDraft | null;
  begin: () => void;
  update: (size: number) => void;
  commit: () => void;
  cancel: () => void;
  reset: (size: number) => void;
  setReady: (ready: boolean) => void;
}

let projectCommits = 0;
let runtimeLayouts = 0;

/**
 * Simulates the authoritative pipeline the App exposes to the draft hook. The
 * `ready` flag drives whether the substrate/typography/renderer output keys
 * have caught up to the committed document's input keys. The hook receives
 * immutable input keys (document/typographyInput/settledRendererInput) plus
 * the live output keys (typographyOutput/substrateOutput/currentRendererInput),
 * mirroring how App derives them from exportAuthority.
 */
function Probe({ publish, initialProject }: { publish: (value: ProbeValue) => void; initialProject: ProjectState }) {
  const [project, setProject] = useState(initialProject);
  const [ready, setReady] = useState(true);
  const geometry = useMemo(() => generateRendererGeometry(project, { timeMs: 0, frame: 0 }), [project]);
  const revisionKey = `visual:${project.renderer}:${project.fontSize}:${project.textOffsetY}:${project.artboard.width}x${project.artboard.height}`;
  const manifest = getRendererManifest(project.renderer);
  const requiresSubstrate = manifest.usesSubstrate;
  const typographyInputKey = `typography-input:${project.fontSize}:${project.textOffsetY}:${project.artboard.width}x${project.artboard.height}`;
  const typographyOutputKey = `typography-output:${typographyInputKey}`;
  const substrateInputKey = requiresSubstrate ? `substrate-input:${typographyInputKey}` : null;
  // `ready` toggles whether the live substrate/worker output and renderer input
  // have caught up to the committed targets. Both gated so non-substrate
  // renderers (flow/ripple/dots) wait on `ready` exactly as the App would when
  // the renderer worker reports its build complete.
  const substrateOutputKey = requiresSubstrate ? (ready ? substrateInputKey : "substrate-output:stale") : null;
  const settledRendererInputKey = `renderer-input:${revisionKey}|substrate:${requiresSubstrate ? substrateInputKey : "unused"}`;
  const currentRendererInputKey = ready
    ? settledRendererInputKey
    : `renderer-input:${revisionKey}|substrate:${requiresSubstrate ? (substrateOutputKey ?? "stale") : "unused"}|pending`;
  const documentKeyValue = `document:${project.fontSize}:${project.textOffsetY}:${project.artboard.width}x${project.artboard.height}`;
  const controller = useTypographySizeDraft(project, (next) => {
    projectCommits += 1;
    setProject(next);
  }, {
    loadedFont: null,
    visualRevision: { geometry, geometryRevisionKey: revisionKey },
    authoritative: {
      rendererId: project.renderer,
      requiresSubstrate,
      documentKey: documentKeyValue,
      typographyInputKey,
      typographyOutputKey,
      substrateInputKey,
      substrateOutputKey,
      currentRendererInputKey,
      settledRendererInputKey,
    },
    onRuntimeLayout: () => { runtimeLayouts += 1; },
  });
  publish({ project, phase: controller.phase, draft: controller.draft, begin: controller.begin, update: controller.update, commit: controller.commit, cancel: controller.cancel, reset: controller.reset, setReady });
  return null;
}

describe("minimal Size controller", () => {
  let container: HTMLDivElement;
  let root: Root;
  let latest: ProbeValue;
  const snapshot = () => latest;

  beforeEach(() => {
    vi.useFakeTimers();
    projectCommits = 0;
    runtimeLayouts = 0;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  function render(initialProject: ProjectState = baseState) {
    act(() => root.render(createElement(Probe, { initialProject, publish: (value) => { latest = value; } })));
  }

  function frame(size: number) {
    act(() => snapshot().update(size));
    act(() => vi.advanceTimersByTime(17));
  }

  it("coalesces Halftone input with zero document/substrate/renderer work during drag", () => {
    render({ ...baseState, renderer: "sdf-halftone" });
    act(() => snapshot().begin());
    act(() => {
      for (let size = 180; size <= 540; size += 10) snapshot().update(size);
    });
    expect(projectCommits).toBe(0);
    expect(runtimeLayouts).toBe(1);
    expect(snapshot().draft?.draftSize).toBe(180);
    act(() => vi.advanceTimersByTime(17));
    expect(runtimeLayouts).toBe(2);
    expect(snapshot().draft?.draftSize).toBe(540);
    expect(projectCommits).toBe(0);
  });

  it("derives 148 -> 540 -> 100 -> 300 directly from one frozen gesture revision", () => {
    render();
    act(() => snapshot().begin());
    act(() => snapshot().update(540));
    const visualRevision = snapshot().draft?.visualRevision;
    expect(snapshot().draft?.draftSize).toBe(540);
    expect(snapshot().draft?.renderInput.scale).toBeCloseTo(540 / 148, 8);

    frame(100);
    expect(snapshot().draft?.renderInput.scale).toBeCloseTo(100 / 148, 8);
    frame(300);
    expect(snapshot().draft?.renderInput.scale).toBeCloseTo(300 / 148, 8);
    expect(snapshot().draft?.visualRevision).toBe(visualRevision);
    expect(snapshot().draft?.visualRevision.geometry).toBe(visualRevision?.geometry);
    expect(projectCommits).toBe(0);
  });

  it("commits once with a focused patch and preserves a non-default preset byte-for-byte", () => {
    const initial: ProjectState = {
      ...baseState,
      ...presets["Sonic Halftone"],
      preset: "Sonic Halftone",
      seed: 918273,
      text: "PRESET INTEGRITY",
      emitter: { ...baseState.emitter, enabled: true, radius: 777 },
      emitters: [{ ...baseState.emitters[0], id: "custom-emitter", weight: 1.8 }],
      backgroundColor: "#102030",
    };
    render(initial);
    act(() => snapshot().begin());
    frame(235);
    act(() => snapshot().commit());
    expect(projectCommits).toBe(1);
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expectUnrelatedStateEqual(snapshot().project, initial);
  });

  it("allows a second drag while the first exact renderer is pending", () => {
    render();
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().project.fontSize).toBe(540);
    const frozenSnapshot = snapshot().draft?.visualRevision;

    act(() => snapshot().begin());
    frame(100);
    expect(snapshot().draft?.visualRevision).toBe(frozenSnapshot);
    expect(snapshot().draft?.renderInput.scale).toBeCloseTo(100 / baseState.fontSize, 8);
    act(() => snapshot().commit());
    expect(snapshot().project.fontSize).toBe(100);
    expect(projectCommits).toBe(2);
  });

  it("keeps the preview pending until current exact authority is ready, then swaps in one frame", () => {
    render();
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    const frozenRevision = snapshot().draft?.visualRevision;
    const frozenGeometry = snapshot().draft?.visualRevision.geometry;
    act(() => vi.advanceTimersByTime(100));
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().draft?.visualRevision).toBe(frozenRevision);
    expect(snapshot().draft?.visualRevision.geometry).toBe(frozenGeometry);
    act(() => snapshot().setReady(true));
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    expect(snapshot().draft).toBeNull();
  });

  it("performs one atomic next-frame swap when the committed exact revision is already ready", () => {
    render();
    act(() => snapshot().begin());
    act(() => snapshot().update(235));
    act(() => snapshot().commit());
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().draft?.settlement).toBeTruthy();
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    expect(snapshot().draft).toBeNull();
  });

  it("double-click reset transaction changes only Size-owned fields", () => {
    const initial: ProjectState = {
      ...baseState,
      ...presets["Sonic Stream"],
      preset: "Sonic Stream",
      fontSize: 540,
      seed: 123456,
      text: "DO NOT RESET",
      primaryColor: "#abcdef",
      emitter: { ...baseState.emitter, phase: 1.25 },
    };
    render(initial);
    act(() => snapshot().reset(baseState.fontSize));
    expect(projectCommits).toBe(1);
    expect(snapshot().draft?.visualRevision.gestureStartSize).toBe(540);
    expect(snapshot().draft?.renderInput.scale).toBeCloseTo(baseState.fontSize / 540, 8);
    expect(snapshot().project.fontSize).toBe(baseState.fontSize);
    expectUnrelatedStateEqual(snapshot().project, initial);
  });

  it("stays waiting for matching substrate and renderer geometry, then settles", () => {
    render({ ...baseState, renderer: "sdf-halftone" });
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().draft?.settlement?.requiresSubstrate).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    // Substrate worker still in flight: draft stays pending, not swapped.
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().draft).not.toBeNull();
    // Substrate result arrives.
    act(() => snapshot().setReady(true));
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    expect(snapshot().draft).toBeNull();
  });

  it("does not wait for substrate on a non-substrate renderer", () => {
    render({ ...baseState, renderer: "ripple" });
    act(() => snapshot().setReady(true));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    expect(snapshot().draft?.settlement?.requiresSubstrate).toBe(false);
    // Non-substrate renderer geometry is already current; swap on next frame.
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    expect(snapshot().draft).toBeNull();
  });

  it("settles without waiting for draft-preview cleanup", () => {
    render();
    act(() => snapshot().setReady(true));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    const frozenRevision = snapshot().draft?.visualRevision ?? null;
    expect(frozenRevision).not.toBeNull();
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    // Exact swap completed; the snapshot ref is released by the hook.
    expect(snapshot().draft).toBeNull();
  });

  it("discards a stale settlement when a newer commit supersedes it", () => {
    render();
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    const staleToken = snapshot().draft?.settlement?.settlementToken;
    expect(snapshot().draft?.settlement?.settlementToken).toBe(staleToken);
    // Second commit while settlement A is still pending.
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(300);
    act(() => snapshot().commit());
    expect(snapshot().draft?.phase).toBe("waiting-for-exact-renderer");
    // Stale token must not drive settlement of the new commit.
    expect(snapshot().draft?.settlement).not.toBe(null);
    if (snapshot().draft?.settlement) {
      expect(snapshot().draft?.settlement?.settlementToken).not.toBe(staleToken);
    }
    act(() => snapshot().setReady(true));
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
  });

  it("supersedes a pending settlement when a new drag starts", () => {
    render();
    act(() => snapshot().setReady(false));
    act(() => snapshot().begin());
    frame(540);
    act(() => snapshot().commit());
    const pendingSettlement = snapshot().draft?.settlement;
    expect(pendingSettlement).toBeTruthy();
    // Begin a second drag while the first exact renderer is still pending.
    act(() => snapshot().begin());
    frame(300);
    expect(snapshot().draft?.phase).toBe("dragging");
    expect(snapshot().draft?.settlement).toBeNull();
    // First pending settlement must not settle this gesture.
    act(() => snapshot().setReady(true));
    act(() => vi.advanceTimersByTime(100));
    expect(snapshot().draft?.phase).toBe("dragging");
  });

  it("double-click reset reaches the new exact renderer and returns to idle", () => {
    render({ ...baseState, renderer: "ripple", fontSize: 540 });
    act(() => snapshot().setReady(false));
    act(() => snapshot().reset(baseState.fontSize));
    expect(snapshot().project.renderer).toBe("ripple");
    expect(projectCommits).toBe(1);
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    expect(snapshot().draft?.settlement).toBeTruthy();
    act(() => snapshot().setReady(true));
    act(() => vi.advanceTimersByTime(17));
    expect(snapshot().phase).toBe("idle");
    expect(snapshot().draft).toBeNull();
  });

  it("duplicate commit/pointerup/lostpointercapture settle produces one commit and one waiting target", () => {
    render();
    act(() => snapshot().begin());
    frame(235);
    act(() => snapshot().commit());
    expect(projectCommits).toBe(1);
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    const targetToken = snapshot().draft?.settlement?.settlementToken ?? -1;
    // Second commit during waiting phase is a no-op (duplicate pointer event).
    act(() => snapshot().commit());
    // No new commit, no new settlement target, phase unchanged.
    expect(projectCommits).toBe(1);
    expect(snapshot().phase).toBe("waiting-for-exact-renderer");
    if (snapshot().draft?.settlement) {
      expect(snapshot().draft?.settlement?.settlementToken).toBe(targetToken);
    }
  });

  it("cancels an active drag without leaving a stuck waiting target", () => {
    render();
    act(() => snapshot().begin());
    frame(235);
    expect(snapshot().draft?.phase).toBe("dragging");
    act(() => snapshot().cancel());
    expect(snapshot().draft).toBeNull();
    expect(snapshot().phase).toBe("idle");
  });
});

describe("artboard-centered Size placement", () => {
  let loadedFont: LoadedFont;

  beforeAll(async () => {
    const bytes = readFileSync(resolve("tests/fixtures/Basic-Regular.ttf"));
    loadedFont = await parseFontBuffer(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, "Basic-Regular.ttf");
  });
  afterAll(() => { loadedFont = undefined as unknown as LoadedFont; });

  it.each([180, 188, 189, 190, 235, 540])("has no horizontal threshold or drift at Size %i", (size) => {
    const target = resolveArtboardCenteredTypographySize(baseState, null, size);
    expect(target.visualCenter.x).toBeCloseTo(target.projectedArtboard.width / 2, 8);
    expect(target.visualCenter.y).toBeCloseTo(target.projectedArtboard.height / 2, 8);
  });

  it("uses identical placement for runtime preview and final focused commit", () => {
    for (const size of [100, 148, 189, 235, 540]) {
      const runtime = resolveArtboardCenteredTypographySize(baseState, null, size);
      const committed = applyTypographySizePlacement(baseState, runtime);
      const final = resolveArtboardCenteredTypographySize(committed, null, size);
      expect(committed.artboard).toEqual(runtime.projectedArtboard);
      expect(committed.textOffsetY).toBeCloseTo(runtime.project.textOffsetY, 8);
      expect(final.originX).toBeCloseTo(runtime.originX, 8);
      expect(final.baselineY).toBeCloseTo(runtime.baselineY, 8);
      expect(final.visualCenter).toEqual(runtime.visualCenter);
      expect(planArtboardExpansionToText(runtime.project, runtime.geometry).changed).toBe(false);
    }
  });

  it("shrinks to 100 inside the enlarged 540 artboard without moving off center", () => {
    const large = resolveArtboardCenteredTypographySize(baseState, null, 540);
    const settled = applyTypographySizePlacement(baseState, large);
    const small = resolveArtboardCenteredTypographySize(settled, null, 100);
    expect(small.projectedArtboard).toEqual(large.projectedArtboard);
    expect(small.visualCenter.x).toBeCloseTo(large.projectedArtboard.width / 2, 8);
    expect(small.visualCenter.y).toBeCloseTo(large.projectedArtboard.height / 2, 8);
  });

  it("uses the same artboard-center rule for parsed fonts", () => {
    const project = {
      ...baseState,
      font: {
        family: loadedFont.metadata.family,
        fullName: loadedFont.metadata.fullName,
        fileName: loadedFont.metadata.fileName,
        unitsPerEm: loadedFont.metadata.unitsPerEm,
        ascender: loadedFont.metadata.ascender,
        descender: loadedFont.metadata.descender,
      },
    };
    for (const size of [100, 189, 540]) {
      const target = resolveArtboardCenteredTypographySize(project, loadedFont, size);
      expect(target.geometry?.hasOutlines).toBe(true);
      expect(target.visualCenter.x).toBeCloseTo(target.projectedArtboard.width / 2, 8);
      expect(target.visualCenter.y).toBeCloseTo(target.projectedArtboard.height / 2, 8);
      expect(target.layoutBounds.y + target.layoutBounds.height / 2).toBeCloseTo(target.projectedArtboard.height / 2, 8);
    }
  });
});

describe("Size preview authority", () => {
  const context: RenderContext = { timeMs: 0, frame: 0 };
  const previewSettings = { fpsCap: 30 as const, pauseWhenHidden: true, reducedMotion: false, backend: "svg-dom" as const, quality: "full" as const };

  const viewportMarkup = (project: ProjectState, geometry: ReturnType<typeof generateRendererGeometry>, interactionDraft: TypographySizeDraft | null) => renderToStaticMarkup(createElement(Viewport, {
    state: project,
    context,
    geometry,
    textGeometry: null,
    exportDiagnostics: null,
    exportWarnings: [], performanceWarnings: [], glyphLayoutTimeMs: 0, substrateError: null,
    substrateBackendStatus: {
      phase: "idle", requestId: 0, requestedBackend: "cpu-main", activeBackend: "cpu-main", workerCapability: null,
      fallbackCode: null, fallbackReason: null, timing: null, activeRequestId: null, latestRequestedId: 0,
      pendingRequestCount: 0, coalescedRequestCount: 0, droppedObsoleteRequestCount: 0, skippedObsoleteRequest: false,
    },
    previewDiagnostics: { estimatedFps: 30, frameTimeMs: 33.3, timingValidity: "valid", clockState: "static" },
    previewBackend: "svg-dom", previewSettings, previewRunning: false, canvasSample: null,
    onCanvasSample: () => undefined, onCanvasFailure: () => undefined, diagnosticsMode: "full", interactionDraft,
  }));

  it("mounts the bounded matching renderer synchronously without a blank or typography-only frame", () => {
    const source = resolveSettledTypographyPlacement(baseState, null);
    const target = projectTypographySizeFromPlacement(source, 540);
    const frozenGeometry = generateRendererGeometry(baseState, context);
    const visualRevision = createFrozenRendererRevision(baseState, frozenGeometry, "visual:flow:148", source, 1);
    const draft: TypographySizeDraft = {
      phase: "waiting-for-exact-renderer",
      draftSize: 540,
      target,
      projectedArtboard: target.projectedArtboard,
      renderInput: createDraftRenderInput(visualRevision, target, 1),
      visualRevision,
      settlement: null,
      interactionId: 1,
    };
    const markup = viewportMarkup(baseState, frozenGeometry, draft);
    expect(markup).toContain('data-draft-renderer-preview="flow"');
    expect(markup).toContain('data-size-draft-phase="waiting-for-exact-renderer"');
    expect(markup).toContain('data-projected-scene=""');
    expect(markup).not.toContain('id="generated-artwork"');
    expect(markup).toContain('transform="translate(');
    expect(markup).toContain('data-geometry-revision="visual:flow:148"');
    expect(markup).toContain('data-mask-revision="visual:flow:148"');
    expect(markup).toContain('data-gesture-start-size="148"');
    expect(markup).toContain('font-size="148"');
    expect(markup).not.toContain('font-size="540"');
    expect(markup).not.toContain('data-draft-typography-preview');
    expect(markup).not.toContain('class="ghost-text"');
  });

  it("keeps the complete draft revision unchanged while committed exact geometry rebuilds hidden", () => {
    const source = resolveSettledTypographyPlacement(baseState, null);
    const target = projectTypographySizeFromPlacement(source, 540);
    const frozenGeometry = generateRendererGeometry(baseState, context);
    const visualRevision = createFrozenRendererRevision(baseState, frozenGeometry, "visual:frozen:148", source, 9);
    const draft: TypographySizeDraft = {
      phase: "waiting-for-exact-renderer",
      draftSize: 540,
      target,
      projectedArtboard: target.projectedArtboard,
      renderInput: createDraftRenderInput(visualRevision, target, 9),
      visualRevision,
      settlement: null,
      interactionId: 9,
    };
    const committed = applyTypographySizePlacement(baseState, target);
    const exactGeometry = generateRendererGeometry(committed, context);
    const pendingMarkup = viewportMarkup(committed, exactGeometry, draft);
    expect(pendingMarkup).toContain('data-geometry-revision="visual:frozen:148"');
    expect(pendingMarkup).toContain('data-mask-revision="visual:frozen:148"');
    const projectedX = baseState.artboard.width / 2 - target.projectedArtboard.width / 2;
    const projectedY = baseState.artboard.height / 2 - target.projectedArtboard.height / 2;
    expect(pendingMarkup).toContain(`viewBox="${projectedX} ${projectedY} ${target.projectedArtboard.width} ${target.projectedArtboard.height}"`);
    expect(target.projectedArtboard.width).toBeGreaterThan(baseState.artboard.width);
    expect(pendingMarkup).not.toContain('id="generated-artwork"');

    const exactMarkup = viewportMarkup(committed, exactGeometry, null);
    expect(exactMarkup).toContain('id="generated-artwork"');
    expect(exactMarkup).not.toContain('data-draft-renderer-preview');
    expect(exactMarkup).not.toContain('data-size-draft-phase');
  });

  it("identifies every renderer family and keeps each draft plan bounded", () => {
    for (const renderer of ["flow", "ripple", "dots", "sdf-flow", "sdf-streamlines", "sdf-contours", "sdf-halftone", "wave-contours", "glyph-diffuser"] as const) {
      const project = { ...baseState, renderer };
      const source = resolveSettledTypographyPlacement(project, null);
      const target = projectTypographySizeFromPlacement(source, 235);
      const frozen = createFrozenRendererRevision(project, generateRendererGeometry(project, context), `visual:${renderer}`, source, 7);
      const input = createDraftRenderInput(frozen, target, 7);
      const plan = planDraftRendererPreview(renderer);
      expect(input.snapshot.rendererId).toBe(renderer);
      expect(input.snapshot.geometryRevisionKey).toContain(renderer);
      expect(plan.maxMarks).toBeLessThanOrEqual(800);
      expect(plan.maxBackingPixels).toBeLessThanOrEqual(960_000);
      expect(plan.maxFps).toBeLessThanOrEqual(20);
    }
  });

  it("coarsens dense geometry to a bounded Canvas mark set", () => {
    const geometry = generateRendererGeometry({ ...baseState, renderer: "dots", density: 100, maxNodes: 10_000 }, context);
    expect(sampleDraftGeometry(geometry, 32)).toHaveLength(Math.min(32, geometry.geometries.length));
  });

  it.each([148, 188, 189, 190, 235, 540])("keeps projected Size %i at the captured screen center without changing the camera", (size) => {
    const camera = { a: 2.25, b: 0, c: 0, d: 2.25, e: 137, f: -44 };
    const target = resolveArtboardCenteredTypographySize(baseState, null, size);
    const capturedWorld = { x: baseState.artboard.width / 2, y: baseState.artboard.height / 2 };
    const projectedWorld = { x: target.projectedArtboard.width / 2, y: target.projectedArtboard.height / 2 };
    const presentation = resolveProjectedScenePresentation(camera, capturedWorld, projectedWorld);
    const correctedScreen = mapWorldPoint(camera, {
      x: projectedWorld.x + presentation.deltaWorld.x,
      y: projectedWorld.y + presentation.deltaWorld.y,
    });
    expect(correctedScreen.x).toBeCloseTo(presentation.capturedCenterScreen.x, 8);
    expect(correctedScreen.y).toBeCloseTo(presentation.capturedCenterScreen.y, 8);
    expect(camera).toEqual({ a: 2.25, b: 0, c: 0, d: 2.25, e: 137, f: -44 });
  });
});

function expectUnrelatedStateEqual(actual: ProjectState, before: ProjectState) {
  const strip = (state: ProjectState) => {
    const { fontSize: _fontSize, textOffsetY: _textOffsetY, artboard: _artboard, ...unrelated } = state;
    return unrelated;
  };
  expect(strip(actual)).toEqual(strip(before));
  const changed = Object.keys(actual).filter((key) => JSON.stringify(actual[key as keyof ProjectState]) !== JSON.stringify(before[key as keyof ProjectState]));
  expect(changed.every((key) => ["fontSize", "textOffsetY", "artboard"].includes(key))).toBe(true);
}
