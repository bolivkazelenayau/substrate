import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  artboardExpansionTriggerKey,
  planArtboardExpansionToText,
  type ArtboardExpansionPlan,
} from "../engine/artboardExpansion";
import type { TextGeometry } from "../engine/glyphGeometry";
import type { ArtboardOverflowMode, ProjectState } from "../types";

export const AUTO_GROW_ARTBOARD_DEBOUNCE_MS = 120;

interface UseAutoGrowArtboardOptions {
  mode: ArtboardOverflowMode;
  project: ProjectState;
  textGeometry: TextGeometry | null;
  updateProject: (project: ProjectState) => void;
}

export interface AutoGrowArtboardState {
  plan: ArtboardExpansionPlan;
  pending: boolean;
  plannedArtboard: ProjectState["artboard"] | null;
  failureReason: string | null;
}

export function useAutoGrowArtboard({
  mode,
  project,
  textGeometry,
  updateProject,
}: UseAutoGrowArtboardOptions): AutoGrowArtboardState {
  const plan = useMemo(
    () => planArtboardExpansionToText(project, textGeometry),
    [project, textGeometry],
  );
  const latestRef = useRef({ project, textGeometry, updateProject });
  latestRef.current = { project, textGeometry, updateProject };
  const previousModeRef = useRef(mode);
  const modeJustEnabled = mode === "auto-grow" && previousModeRef.current !== "auto-grow";
  const timeoutRef = useRef<number | null>(null);
  const scheduledPlanKeyRef = useRef<string | null>(null);

  const authoritativeBoundsKey = artboardExpansionTriggerKey(plan);
  const pending = mode === "auto-grow" && plan.available && plan.changed;

  useLayoutEffect(() => {
    previousModeRef.current = mode;
    if (!modeJustEnabled || !plan.available || !plan.changed) return;

    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
      scheduledPlanKeyRef.current = null;
    }
    const latest = latestRef.current;
    const latestPlan = planArtboardExpansionToText(latest.project, latest.textGeometry);
    if (latestPlan.available && latestPlan.changed) {
      latest.updateProject(latestPlan.nextState);
    }
  }, [mode, modeJustEnabled, plan.available, plan.changed]);

  useEffect(() => {
    if (mode !== "auto-grow" || modeJustEnabled || !plan.available || !plan.changed) {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        scheduledPlanKeyRef.current = null;
      }
      return;
    }
    if (scheduledPlanKeyRef.current === authoritativeBoundsKey) return;

    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    scheduledPlanKeyRef.current = authoritativeBoundsKey;
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      scheduledPlanKeyRef.current = null;
      const latest = latestRef.current;
      const latestPlan = planArtboardExpansionToText(latest.project, latest.textGeometry);
      if (!latestPlan.available || !latestPlan.changed) return;
      latest.updateProject(latestPlan.nextState);
    }, AUTO_GROW_ARTBOARD_DEBOUNCE_MS);

    return () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        scheduledPlanKeyRef.current = null;
      }
    };
  }, [authoritativeBoundsKey, mode, modeJustEnabled, plan.available, plan.changed]);

  return {
    plan,
    pending,
    plannedArtboard: pending ? plan.nextState.artboard : null,
    failureReason: mode === "auto-grow" && !plan.available ? plan.reason ?? null : null,
  };
}
