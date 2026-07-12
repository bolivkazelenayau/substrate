import { useCallback, useEffect, useRef, useState } from "react";
import { sizeDraftPolicy, type SizeDraftPolicy } from "../engine/sizeRendererDraftPolicy";
import type { RendererId } from "../types";
import {
  activeTraceGestureId,
  beginTraceGesture,
  endTraceGesture,
  interactionTraceEnabled,
  traceEvent,
} from "../dev/interactionTrace";

export type SizeInteractionState =
  | { phase: "idle"; presentedSize: number }
  | { phase: "dragging"; gestureId: number; baseSize: number; draftSize: number; draftPolicy: SizeDraftPolicy }
  | { phase: "settling"; gestureId: number; committedSize: number };

export interface SizeRangeHandlers {
  onPointerDown: (value: number, pointerId: number, element: HTMLInputElement) => void;
  onInput: (value: number, eventType: "input" | "change") => void;
  onPointerUp: (value: number, pointerId: number) => void;
  onLostPointerCapture: (value: number) => void;
  onBlur: (value: number) => void;
  onKeyDown: (value: number) => void;
  onKeyUp: (value: number) => void;
  onDoubleClickReset: (value: number, defaultValue: number) => void;
}

export function useSizeInteraction(
  committedFontSize: number,
  rendererId: RendererId,
  onCommit: (fontSize: number) => void,
) {
  const gestureSeqRef = useRef(0);
  const activeGestureRef = useRef<number | undefined>(undefined);
  const finishedGesturesRef = useRef<Set<number>>(new Set());
  const baseFontSizeRef = useRef(committedFontSize);
  const latestSizeRef = useRef(committedFontSize);
  const rafRef = useRef<number | null>(null);
  const draftFrameCountRef = useRef(0);
  const phaseRef = useRef<SizeInteractionState["phase"]>("idle");
  const keyboardGestureRef = useRef(false);

  const [interaction, setInteraction] = useState<SizeInteractionState>({
    phase: "idle",
    presentedSize: committedFontSize,
  });

  const publishInteraction = useCallback((next: SizeInteractionState) => {
    phaseRef.current = next.phase;
    setInteraction(next);
  }, []);

  useEffect(() => {
    if (interaction.phase !== "idle") return;
    latestSizeRef.current = committedFontSize;
    baseFontSizeRef.current = committedFontSize;
    publishInteraction({ phase: "idle", presentedSize: committedFontSize });
  }, [committedFontSize, interaction.phase, publishInteraction]);

  const cancelScheduledDraft = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const emitDraftFrame = useCallback((nextSize: number, gesture: number) => {
    const started = performance.now();
    latestSizeRef.current = nextSize;
    draftFrameCountRef.current += 1;
    setInteraction((current) => {
      if (current.phase !== "dragging" || current.gestureId !== gesture) return current;
      return { ...current, draftSize: nextSize };
    });
    const durationMs = performance.now() - started;
    traceEvent({
      stage: "size.draft.raf",
      phase: "instant",
      gestureId: gesture,
      inputKey: `size:${nextSize}`,
      durationMs,
      counts: { draftFrames: draftFrameCountRef.current },
      detail: { draftFontSize: nextSize, baseFontSize: baseFontSizeRef.current },
    });
    traceEvent({
      stage: "size.draft.frame",
      phase: "instant",
      gestureId: gesture,
      inputKey: `size:${nextSize}`,
      durationMs,
      counts: { draftFrames: draftFrameCountRef.current },
      detail: { baseFontSize: baseFontSizeRef.current, draftFontSize: nextSize },
    });
  }, []);

  const scheduleDraftFrame = useCallback((nextSize: number) => {
    const gesture = activeGestureRef.current;
    if (gesture === undefined || phaseRef.current !== "dragging") return;
    latestSizeRef.current = nextSize;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const currentGesture = activeGestureRef.current;
      if (currentGesture === undefined || phaseRef.current !== "dragging") return;
      emitDraftFrame(latestSizeRef.current, currentGesture);
    });
  }, [emitDraftFrame]);

  const supersedeSettling = useCallback((nextGestureId: number) => {
    if (phaseRef.current === "settling") {
      traceEvent({
        stage: "size.gesture.superseded",
        phase: "instant",
        gestureId: nextGestureId,
        detail: { previousPhase: "settling" },
      });
    }
  }, []);

  const beginGesture = useCallback((value: number, pointerId: number | undefined, element?: HTMLInputElement) => {
    cancelScheduledDraft();
    finishedGesturesRef.current.clear();
    gestureSeqRef.current += 1;
    const nextGestureId = gestureSeqRef.current;
    supersedeSettling(nextGestureId);
    activeGestureRef.current = beginTraceGesture({ value, pointerId: pointerId ?? -1 }) ?? nextGestureId;
    baseFontSizeRef.current = committedFontSize;
    latestSizeRef.current = value;
    draftFrameCountRef.current = 0;
    if (element && pointerId !== undefined && element.setPointerCapture) {
      try { element.setPointerCapture(pointerId); } catch { /* unsupported */ }
    }
    publishInteraction({
      phase: "dragging",
      gestureId: nextGestureId,
      baseSize: committedFontSize,
      draftSize: value,
      draftPolicy: sizeDraftPolicy(rendererId),
    });
    traceEvent({
      stage: "size.gesture.start",
      phase: "instant",
      gestureId: nextGestureId,
      inputKey: `size:${value}`,
      detail: { pointerId: pointerId ?? -1, baseFontSize: committedFontSize, draftPolicy: sizeDraftPolicy(rendererId) },
    });
    traceEvent({
      stage: "size.interaction",
      phase: "start",
      gestureId: nextGestureId,
      detail: { phase: "dragging", baseFontSize: committedFontSize },
    });
    traceEvent({
      stage: "native.size.pointerdown",
      phase: "instant",
      gestureId: nextGestureId,
      inputKey: `size:${value}`,
      detail: { pointerId: pointerId ?? -1, baseFontSize: committedFontSize },
    });
  }, [cancelScheduledDraft, committedFontSize, publishInteraction, rendererId, supersedeSettling]);

  const finishGesture = useCallback((gestureId: number, reason: string, releasedValue: number) => {
    if (finishedGesturesRef.current.has(gestureId)) {
      traceEvent({
        stage: "size.gesture.finish.duplicateIgnored",
        phase: "instant",
        gestureId,
        detail: { reason, value: releasedValue },
      });
      return;
    }
    if (activeGestureRef.current !== gestureId && phaseRef.current === "idle") return;
    finishedGesturesRef.current.add(gestureId);
    cancelScheduledDraft();

    const finalSize = latestSizeRef.current;
    traceEvent({
      stage: "size.gesture.finish.request",
      phase: "instant",
      gestureId,
      inputKey: `size:${releasedValue}`,
      detail: { reason, finalSize },
    });
    traceEvent({
      stage: "native.size.pointerup",
      phase: "instant",
      gestureId,
      inputKey: `size:${releasedValue}`,
      detail: { reason, finalSize },
    });
    endTraceGesture(gestureId, { reason, value: finalSize });

    const shouldCommit = phaseRef.current === "dragging" && finalSize !== committedFontSize;
    if (shouldCommit) {
      traceEvent({
        stage: "size.gesture.finish.commit",
        phase: "instant",
        gestureId,
        inputKey: `size:${committedFontSize}`,
        outputKey: `size:${finalSize}`,
        detail: { fields: "fontSize", reason },
      });
      traceEvent({
        stage: "size.interaction.commit",
        phase: "instant",
        gestureId,
        inputKey: `size:${committedFontSize}`,
        outputKey: `size:${finalSize}`,
        detail: { fields: "fontSize" },
      });
      onCommit(finalSize);
      publishInteraction({ phase: "settling", gestureId, committedSize: finalSize });
      traceEvent({
        stage: "size.settling.start",
        phase: "instant",
        gestureId,
        detail: { committedSize: finalSize },
      });
      traceEvent({
        stage: "size.interaction",
        phase: "instant",
        gestureId,
        detail: { phase: "settling", targetFontSize: finalSize },
      });
    } else {
      publishInteraction({ phase: "idle", presentedSize: committedFontSize });
      traceEvent({
        stage: "size.idle",
        phase: "instant",
        gestureId,
        detail: { reason: "no-op" },
      });
      traceEvent({
        stage: "size.interaction",
        phase: "end",
        gestureId,
        detail: { phase: "idle", reason: "no-op" },
      });
    }

    if (activeGestureRef.current === gestureId) {
      activeGestureRef.current = undefined;
    }
    keyboardGestureRef.current = false;
  }, [cancelScheduledDraft, committedFontSize, onCommit, publishInteraction]);

  const completeSettlement = useCallback(() => {
    if (interaction.phase !== "settling") return;
    if (committedFontSize !== interaction.committedSize) return;
    publishInteraction({ phase: "idle", presentedSize: committedFontSize });
    traceEvent({
      stage: "size.exact.visible",
      phase: "instant",
      gestureId: interaction.gestureId,
      detail: { committedSize: committedFontSize },
    });
    traceEvent({
      stage: "size.idle",
      phase: "instant",
      gestureId: interaction.gestureId,
      detail: { reason: "settled" },
    });
    traceEvent({
      stage: "size.interaction",
      phase: "end",
      gestureId: interaction.gestureId,
      detail: { phase: "idle", reason: "settled" },
    });
  }, [committedFontSize, interaction, publishInteraction]);

  const recordNativeInput = useCallback((nextValue: number, eventType: "input" | "change") => {
    const gesture = activeGestureRef.current ?? activeTraceGestureId();
    traceEvent({
      stage: "size.input.raw",
      phase: "instant",
      gestureId: gesture,
      inputKey: `size:${nextValue}`,
      detail: { eventType, value: nextValue },
    });
    traceEvent({
      stage: "native.size.input",
      phase: "instant",
      gestureId: gesture,
      inputKey: `size:${nextValue}`,
      detail: { eventType, value: nextValue },
    });
    if (phaseRef.current === "dragging" && activeGestureRef.current !== undefined) {
      scheduleDraftFrame(nextValue);
      return;
    }
    if (phaseRef.current === "idle" && eventType === "change") {
      if (nextValue !== committedFontSize) {
        const gestureId = ++gestureSeqRef.current;
        traceEvent({
          stage: "size.gesture.finish.commit",
          phase: "instant",
          gestureId,
          inputKey: `size:${committedFontSize}`,
          outputKey: `size:${nextValue}`,
          detail: { fields: "fontSize", reason: "keyboard-change" },
        });
        onCommit(nextValue);
        publishInteraction({ phase: "settling", gestureId, committedSize: nextValue });
        traceEvent({ stage: "size.settling.start", phase: "instant", gestureId, detail: { committedSize: nextValue } });
      }
    }
  }, [committedFontSize, onCommit, publishInteraction, scheduleDraftFrame]);

  const requestFinish = useCallback((reason: string, releasedValue: number) => {
    const gesture = activeGestureRef.current;
    if (gesture === undefined) return;
    finishGesture(gesture, reason, releasedValue);
  }, [finishGesture]);

  const handlers: SizeRangeHandlers = {
    onPointerDown: (value, pointerId, element) => beginGesture(value, pointerId, element),
    onInput: recordNativeInput,
    onPointerUp: (value, pointerId) => {
      traceEvent({
        stage: "native.size.pointerup",
        phase: "instant",
        gestureId: activeGestureRef.current,
        inputKey: `size:${value}`,
        detail: { pointerId },
      });
      requestFinish("pointerup", value);
    },
    onLostPointerCapture: (value) => requestFinish("lostpointercapture", value),
    onBlur: (value) => {
      traceEvent({
        stage: "native.size.blur",
        phase: "instant",
        gestureId: activeGestureRef.current,
        inputKey: `size:${value}`,
      });
      requestFinish("blur", value);
    },
    onKeyDown: (value) => {
      if (phaseRef.current !== "idle" || keyboardGestureRef.current) return;
      keyboardGestureRef.current = true;
      beginGesture(value, undefined);
    },
    onKeyUp: (value) => {
      if (!keyboardGestureRef.current) return;
      requestFinish("keyup", value);
    },
    onDoubleClickReset: (value, defaultValue) => {
      cancelScheduledDraft();
      const gesture = activeGestureRef.current ?? ++gestureSeqRef.current;
      traceEvent({
        stage: "native.size.reset",
        phase: "instant",
        gestureId: gesture,
        inputKey: `size:${value}`,
        outputKey: `size:${defaultValue}`,
        detail: { canonicalDefault: defaultValue, valueBefore: value },
      });
      if (activeGestureRef.current !== undefined) {
        finishGesture(activeGestureRef.current, "reset", value);
      }
      if (defaultValue !== committedFontSize) {
        traceEvent({
          stage: "size.gesture.finish.commit",
          phase: "instant",
          gestureId: gesture,
          inputKey: `size:${committedFontSize}`,
          outputKey: `size:${defaultValue}`,
          detail: { fields: "fontSize", reason: "reset" },
        });
        onCommit(defaultValue);
        publishInteraction({ phase: "settling", gestureId: gesture, committedSize: defaultValue });
        traceEvent({ stage: "size.settling.start", phase: "instant", gestureId: gesture, detail: { committedSize: defaultValue } });
      } else {
        publishInteraction({ phase: "idle", presentedSize: defaultValue });
        traceEvent({ stage: "size.idle", phase: "instant", gestureId: gesture, detail: { reason: "reset-no-op" } });
      }
      latestSizeRef.current = defaultValue;
      keyboardGestureRef.current = false;
      activeGestureRef.current = undefined;
    },
  };

  useEffect(() => () => cancelScheduledDraft(), [cancelScheduledDraft]);

  return { state: interaction, handlers, completeSettlement };
}

export const sizeInteractionTraceEnabled = interactionTraceEnabled;