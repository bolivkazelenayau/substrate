import { useCallback, useEffect, useRef, useState } from "react";
import type { RenderContext } from "../types";
import { updateTimingAverage } from "../engine/animationTiming";

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
  const averageFrameTime = useRef(0);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden) lastCommit.current = null;
      setDiagnostics((current) => ({ ...current, hidden: document.hidden }));
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!running) {
      lastCommit.current = null;
      return;
    }

    let animationFrame = 0;
    const minimumFrameTime = 1000 / fpsCap;
    const tick = (now: number) => {
      if (pauseWhenHidden && document.hidden) {
        lastCommit.current = null;
      } else if (lastCommit.current === null) {
        lastCommit.current = now;
      } else {
        const elapsed = now - lastCommit.current;
        if (!Number.isFinite(elapsed) || elapsed <= 0) {
          lastCommit.current = now;
          animationFrame = requestAnimationFrame(tick);
          return;
        }
        if (elapsed >= minimumFrameTime) {
          lastCommit.current = now;
          const timing = updateTimingAverage(averageFrameTime.current, elapsed);
          averageFrameTime.current = timing.averageFrameMs;
          setContext((current) => ({ timeMs: current.timeMs + elapsed, frame: current.frame + 1 }));
          setDiagnostics({
            estimatedFps: timing.fps,
            frameTimeMs: timing.averageFrameMs,
            hidden: document.hidden,
            timingValidity: timing.validity,
          });
        }
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [fpsCap, pauseWhenHidden, running]);

  const reset = useCallback(() => {
    lastCommit.current = null;
    averageFrameTime.current = 0;
    setContext({ timeMs: 0, frame: 0 });
    setDiagnostics((current) => ({ ...current, estimatedFps: 0, frameTimeMs: 0, timingValidity: "valid" }));
  }, []);

  return { context, diagnostics, reset };
}
