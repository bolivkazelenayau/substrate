import { useCallback, useEffect, useRef, useState } from "react";
import type { LoadedFont } from "../engine/fontLoader";
import type { GeometryGroup } from "../engine/geometry";
import {
  resolveSizeSettlementReadiness,
  type SizeSettlementBlockedReason,
  type SizeSettlementTarget,
} from "../engine/sizeSettlement";
import {
  applyTypographySizePlacement,
  projectTypographySizeFromPlacement,
  resolveArtboardCenteredTypographySize,
  resolveSettledTypographyPlacement,
  type TypographySizePlacement,
} from "../engine/typographySizePlacement";
import type { ProjectState } from "../types";
import {
  createDraftRenderInput,
  createFrozenRendererRevision,
  type DraftRenderInput,
  type FrozenRendererRevision,
} from "../engine/draftRendererPreview";

export type TypographySizePhase = "idle" | "dragging" | "waiting-for-exact-renderer";

export interface TypographySizeDraft {
  phase: Exclude<TypographySizePhase, "idle">;
  draftSize: number;
  target: TypographySizePlacement;
  projectedArtboard: ProjectState["artboard"];
  renderInput: DraftRenderInput;
  visualRevision: FrozenRendererRevision;
  /** Immutable settlement target captured from the committed document. */
  settlement: SizeSettlementTarget | null;
  interactionId: number;
}

export interface TypographySizeDraftOptions {
  loadedFont: LoadedFont | null;
  visualRevision: {
    geometry: GeometryGroup;
    geometryRevisionKey: string;
  };
  /**
   * Authoritative pipeline identity, derived from the committed ProjectState.
   * The hook captures an immutable settlement target from these keys and waits
   * for the live output keys to catch up. None of these values may be a mutable
   * ref or a draft-preview key.
   */
  authoritative: {
    rendererId: ProjectState["renderer"];
    requiresSubstrate: boolean;
    documentKey: string;
    typographyInputKey: string;
    typographyOutputKey: string | null;
    /** Substrate input key for the committed document; `null` when not required. */
    substrateInputKey: string | null;
    /** Live substrate output key; `null` until the worker reports a result. */
    substrateOutputKey: string | null;
    /** Live renderer input key, built from the live substrate output. */
    currentRendererInputKey: string;
    /** Settled renderer input key, built from the substrate input key. */
    settledRendererInputKey: string;
  };
  onRuntimeLayout?: () => void;
}

/** One immutable visual revision, local Size projection, one exact commit. */
export function useTypographySizeDraft(
  project: ProjectState,
  updateProject: (next: ProjectState | ((current: ProjectState) => ProjectState)) => void,
  options: TypographySizeDraftOptions,
) {
  const [draft, setDraftState] = useState<TypographySizeDraft | null>(null);
  const draftRef = useRef<TypographySizeDraft | null>(null);
  const snapshotRef = useRef<FrozenRendererRevision | null>(null);
  const requestedSizeRef = useRef<number | null>(null);
  const layoutFrameRef = useRef<number | null>(null);
  const swapFrameRef = useRef<number | null>(null);
  const snapshotSequenceRef = useRef(0);
  const interactionSequenceRef = useRef(0);
  const activeInteractionRef = useRef(0);
  const settlementTokenRef = useRef(0);
  const latest = useRef({ project, updateProject, options });
  latest.current = { project, updateProject, options };

  const setDraft = useCallback((next: TypographySizeDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  const cancelLayoutFrame = useCallback(() => {
    if (layoutFrameRef.current !== null) cancelAnimationFrame(layoutFrameRef.current);
    layoutFrameRef.current = null;
  }, []);

  const cancelSwapFrame = useCallback(() => {
    if (swapFrameRef.current !== null) cancelAnimationFrame(swapFrameRef.current);
    swapFrameRef.current = null;
  }, []);

  const ensureSnapshot = useCallback(() => {
    if (snapshotRef.current) return snapshotRef.current;
    const current = latest.current;
    const typography = resolveSettledTypographyPlacement(current.project, current.options.loadedFont);
    snapshotRef.current = createFrozenRendererRevision(
      current.project,
      current.options.visualRevision.geometry,
      current.options.visualRevision.geometryRevisionKey,
      typography,
      ++snapshotSequenceRef.current,
    );
    return snapshotRef.current;
  }, []);

  const buildDraft = useCallback((size: number, phase: TypographySizeDraft["phase"]) => {
    const snapshot = ensureSnapshot();
    latest.current.options.onRuntimeLayout?.();
    const target = projectTypographySizeFromPlacement(snapshot.typography, size);
    const interactionId = activeInteractionRef.current || ++interactionSequenceRef.current;
    activeInteractionRef.current = interactionId;
    return {
      phase,
      draftSize: target.size,
      target,
      projectedArtboard: target.projectedArtboard,
      renderInput: createDraftRenderInput(snapshot, target, interactionId),
      visualRevision: snapshot,
      settlement: null,
      interactionId,
    } satisfies TypographySizeDraft;
  }, [ensureSnapshot]);

  const begin = useCallback(() => {
    cancelLayoutFrame();
    cancelSwapFrame();
    ensureSnapshot();
    // A new gesture supersedes any pending settlement target so its in-flight
    // rAF cannot swap in stale artwork while a new draft is being assembled.
    settlementTokenRef.current += 1;
    activeInteractionRef.current = ++interactionSequenceRef.current;
    requestedSizeRef.current = null;
    // Deliberately do not publish a frame here. The first input publishes its
    // requested Size synchronously, so an old-size draft can never flash.
  }, [cancelLayoutFrame, cancelSwapFrame, ensureSnapshot]);

  const publishRequestedSize = useCallback(() => {
    const requested = requestedSizeRef.current;
    if (requested === null) return;
    setDraft(buildDraft(requested, "dragging"));
  }, [buildDraft, setDraft]);

  const update = useCallback((size: number) => {
    cancelSwapFrame();
    requestedSizeRef.current = size;
    if (draftRef.current?.phase !== "dragging") {
      if (!activeInteractionRef.current) begin();
      // First input is synchronous; later input in the gesture is coalesced.
      publishRequestedSize();
      return;
    }
    if (layoutFrameRef.current !== null) return;
    layoutFrameRef.current = requestAnimationFrame(() => {
      layoutFrameRef.current = null;
      publishRequestedSize();
    });
  }, [begin, cancelSwapFrame, publishRequestedSize]);

  const flush = useCallback(() => {
    cancelLayoutFrame();
    publishRequestedSize();
  }, [cancelLayoutFrame, publishRequestedSize]);

  const commitProject = useCallback((draftSize: number) => {
    updateProject((current) => {
      // The committed patch uses the canonical artboard-centered placement so
      // the authoritative document is self-consistent: auto-grow does not need
      // to refine it afterwards. The draft preview keeps its layout-free
      // projection; only the focused release patch performs one glyph layout.
      const placement = resolveArtboardCenteredTypographySize(current, latest.current.options.loadedFont, draftSize);
      return applyTypographySizePlacement(current, placement);
    });
  }, [updateProject]);

  const commit = useCallback(() => {
    flush();
    const currentDraft = draftRef.current;
    if (currentDraft?.phase !== "dragging") return;
    const waiting: TypographySizeDraft = { ...currentDraft, phase: "waiting-for-exact-renderer", settlement: null };
    requestedSizeRef.current = null;
    activeInteractionRef.current = 0;
    settlementTokenRef.current += 1;
    setDraft(waiting);
    commitProject(currentDraft.draftSize);
  }, [commitProject, flush, setDraft]);

  const cancel = useCallback(() => {
    cancelLayoutFrame();
    requestedSizeRef.current = null;
    activeInteractionRef.current = 0;
    const current = draftRef.current;
    // After a focused commit, the settlement owns the post-release lifecycle.
    // A duplicate settle (pointerup + lostpointercapture + blur) must not reset
    // or re-capture the waiting target. Only an active drag cancels.
    if (current?.phase === "waiting-for-exact-renderer") {
      return;
    }
    cancelSwapFrame();
    snapshotRef.current = null;
    setDraft(null);
  }, [cancelLayoutFrame, cancelSwapFrame, setDraft]);

  const reset = useCallback((size: number) => {
    cancelLayoutFrame();
    cancelSwapFrame();
    if (!snapshotRef.current) ensureSnapshot();
    activeInteractionRef.current = ++interactionSequenceRef.current;
    const waiting = buildDraft(size, "waiting-for-exact-renderer");
    requestedSizeRef.current = null;
    activeInteractionRef.current = 0;
    settlementTokenRef.current += 1;
    setDraft(waiting);
    commitProject(waiting.draftSize);
  }, [buildDraft, cancelLayoutFrame, cancelSwapFrame, commitProject, ensureSnapshot, setDraft]);

  const authoritative = options.authoritative;
  useEffect(() => {
    const current = draftRef.current;
    if (current?.phase !== "waiting-for-exact-renderer") return;
    if (project.fontSize !== current.draftSize) return;

    // Part A: capture one immutable settlement target from the committed
    // document. Derived only from authoritative input keys, never from draft
    // state, old geometry, or mutable refs.
    let target = current.settlement;
    let nextDraft: TypographySizeDraft | null = null;
    if (target === null) {
      if (!authoritative.typographyOutputKey) return;
      target = {
        settlementToken: settlementTokenRef.current,
        rendererId: authoritative.rendererId,
        requiresSubstrate: authoritative.requiresSubstrate,
        draftSize: current.draftSize,
        documentKey: authoritative.documentKey,
        typographyInputKey: authoritative.typographyInputKey,
        expectedTypographyOutputKey: authoritative.typographyOutputKey,
        substrateInputKey: authoritative.requiresSubstrate ? authoritative.substrateInputKey : null,
        rendererInputKey: authoritative.settledRendererInputKey,
      };
      nextDraft = { ...current, settlement: target };
      draftRef.current = nextDraft;
    }

    // Part E: a newer gesture supersedes a stale settlement target.
    if (target.settlementToken !== settlementTokenRef.current) {
      return;
    }

    // Part B: pure readiness resolver against the immutable target.
    const readiness = resolveSizeSettlementReadiness({
      target,
      currentDocumentKey: authoritative.documentKey,
      currentTypographyOutputKey: authoritative.typographyOutputKey,
      currentSubstrateOutputKey: authoritative.requiresSubstrate ? authoritative.substrateOutputKey : null,
      currentRendererInputKey: authoritative.currentRendererInputKey,
    });

    if (import.meta.env.DEV && (globalThis as typeof globalThis & { __SUBSTRATE_SIZE_SETTLEMENT_DEBUG__?: boolean }).__SUBSTRATE_SIZE_SETTLEMENT_DEBUG__) reportSettlementDev(target, authoritative, readiness);

    if (!readiness.ready) {
      // Persist the captured target so the next authoritative change re-runs
      // this effect with a non-null settlement.
      if (nextDraft) setDraft(nextDraft);
      return;
    }

    // Atomic swap-in-one-frame requires the draft ref to already carry the
    // target; the rAF callback re-reads it from the live ref.
    if (nextDraft) setDraft(nextDraft);

    // Part C: atomic visibility swap in one frame. There is no dependency on
    // draft-preview cleanup, Canvas disposal, diagnostics, or bitmap work.
    cancelSwapFrame();
    swapFrameRef.current = requestAnimationFrame(() => {
      swapFrameRef.current = null;
      const active = draftRef.current;
      if (active?.phase !== "waiting-for-exact-renderer") return;
      if (active.settlement === null) return;
      if (active.settlement.settlementToken !== settlementTokenRef.current) return;
      const final = resolveSizeSettlementReadiness({
        target: active.settlement,
        currentDocumentKey: authoritative.documentKey,
        currentTypographyOutputKey: authoritative.typographyOutputKey,
        currentSubstrateOutputKey: authoritative.requiresSubstrate ? authoritative.substrateOutputKey : null,
        currentRendererInputKey: authoritative.currentRendererInputKey,
      });
      if (!final.ready) return;
      snapshotRef.current = null;
      setDraft(null);
    });
    return cancelSwapFrame;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    authoritative.currentRendererInputKey, authoritative.documentKey, authoritative.rendererId,
    authoritative.requiresSubstrate, authoritative.settledRendererInputKey, authoritative.substrateInputKey,
    authoritative.substrateOutputKey, authoritative.typographyInputKey, authoritative.typographyOutputKey,
    cancelSwapFrame, draft?.settlement, project.fontSize, setDraft,
  ]);

  useEffect(() => () => {
    cancelLayoutFrame();
    cancelSwapFrame();
  }, [cancelLayoutFrame, cancelSwapFrame]);

  return {
    phase: draft?.phase ?? "idle" as TypographySizePhase,
    draft,
    effectiveSize: draft?.draftSize ?? project.fontSize,
    begin,
    update,
    commit,
    cancel,
    reset,
  };
}

let settlementDevSerial = 0;
function reportSettlementDev(
  target: SizeSettlementTarget,
  authoritative: TypographySizeDraftOptions["authoritative"],
  readiness: { ready: boolean; blockedReason: SizeSettlementBlockedReason | null },
) {
  const serial = ++settlementDevSerial;
  console.debug("[size-settlement]", serial, {
    settlementToken: target.settlementToken,
    phase: "waiting-for-exact-renderer",
    targetDocumentKey: target.documentKey,
    currentDocumentKey: authoritative.documentKey,
    targetTypographyOutputKey: target.expectedTypographyOutputKey,
    currentTypographyOutputKey: authoritative.typographyOutputKey,
    targetSubstrateInputKey: target.substrateInputKey,
    currentSubstrateOutputKey: authoritative.substrateOutputKey,
    targetRendererInputKey: target.rendererInputKey,
    currentRendererInputKey: authoritative.currentRendererInputKey,
    requiresSubstrate: target.requiresSubstrate,
    draftPreviewVisible: true,
    exactArtworkVisible: false,
    exportReady: readiness.ready,
    blockedReason: readiness.blockedReason,
  });
}