import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderContext } from "../types";
import {
  advanceAnimationFrameBudget,
  shouldPublishAnimationDiagnostics,
  updateTimingAverage,
} from "../engine/animationTiming";
import { recordPreviewClockCommit } from "../engine/previewRuntimeDiagnostics";

export interface AnimationClockDiagnostics {
  estimatedFps: number;
  frameTimeMs: number;
  hidden: boolean;
  timingValidity: "valid" | "unstable" | "invalid";
}

export function useAnimationClock(running: boolean, fpsCap: 24 | 30 | 60, pauseWhenHidden: boolean) {
  const [context, setContext] = useState<RenderContext>({ timeMs: 0, frame: 0 });
  const [diagnostics, setDiagnostics] = useState<AnimationClockDiagnostics>({
    estimatedFps: 0,
    frameTimeMs: 0,
    hidden: document.hidden,
    timingValidity: "valid",
  });
  const lastCommit = useRef<number | null>(null);
  const previousRaf = useRef<number | null>(null);
  const accumulatorMs = useRef(0);
  const lastDiagnosticsPublish = useRef(0);
  const averageFrameTime = useRef(0);

  const resetSchedulingState = useCallback(() => {
    lastCommit.current = null;
    previousRaf.current = null;
    accumulatorMs.current = 0;
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) resetSchedulingState();
      setDiagnostics((current) => ({ ...current, hidden: document.hidden }));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [resetSchedulingState]);

  useEffect(() => {
    if (!running) {
      resetSchedulingState();
      return;
    }

    let animationFrame = 0;
    const minimumFrameTime = 1000 / fpsCap;
    const tick = (now: number) => {
      if (pauseWhenHidden && document.hidden) {
        resetSchedulingState();
      } else if (previousRaf.current === null) {
        previousRaf.current = now;
        lastCommit.current = now;
      } else {
        const rafDelta = now - previousRaf.current;
        previousRaf.current = now;
        const budget = advanceAnimationFrameBudget(accumulatorMs.current, rafDelta, minimumFrameTime);
        accumulatorMs.current = budget.remainderMs;
        if (budget.draw) {
          const elapsed = lastCommit.current === null ? budget.phaseDeltaMs : Math.min(now - lastCommit.current, 250);
          lastCommit.current = now;
          const timing = updateTimingAverage(averageFrameTime.current, elapsed);
          averageFrameTime.current = timing.averageFrameMs;
          const updateStart = performance.now();
          setContext((current) => ({ timeMs: current.timeMs + elapsed, frame: current.frame + 1 }));
          if (shouldPublishAnimationDiagnostics(now, lastDiagnosticsPublish.current)) {
            lastDiagnosticsPublish.current = now;
            setDiagnostics({
              estimatedFps: timing.fps,
              frameTimeMs: timing.averageFrameMs,
              hidden: document.hidden,
              timingValidity: timing.validity,
            });
          }
          recordPreviewClockCommit(elapsed, performance.now() - updateStart);
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [fpsCap, pauseWhenHidden, resetSchedulingState, running]);

  const reset = useCallback(() => {
    resetSchedulingState();
    lastDiagnosticsPublish.current = 0;
    averageFrameTime.current = 0;
    setContext({ timeMs: 0, frame: 0 });
    setDiagnostics((current) => ({ ...current, estimatedFps: 0, frameTimeMs: 0, timingValidity: "valid" }));
  }, [resetSchedulingState]);

  return { context, diagnostics, reset };
}
