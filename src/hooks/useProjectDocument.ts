import { useCallback, useRef, useState } from "react";
import { baseState } from "../engine/presets";
import { migrateAndRepairProject } from "../engine/projectImport";
import type { ProjectState } from "../types";
import {
  activeTraceGestureId,
  interactionTraceEnabled,
  recordTraceProjectCommit,
  traceEvent,
  traceKey,
} from "../dev/interactionTrace";

export function serializeProjectDocument(project: ProjectState): string {
  return JSON.stringify(project, null, 2);
}

type ProjectUpdate = ProjectState | ((current: ProjectState) => ProjectState);

export function useProjectDocument() {
  const [project, setProjectState] = useState<ProjectState>(baseState);
  const revisionRef = useRef(0);
  const setProject = useCallback((update: ProjectUpdate) => {
    setProjectState((current) => {
      const next = typeof update === "function" ? update(current) : update;
      if (interactionTraceEnabled) {
        const changedFields = (Object.keys(current) as Array<keyof ProjectState>)
          .filter((field) => current[field] !== next[field])
          .map(String);
        const gestureId = activeTraceGestureId();
        const commitCount = recordTraceProjectCommit(gestureId);
        const revisionBefore = revisionRef.current;
        const revisionAfter = revisionBefore + 1;
        revisionRef.current = revisionAfter;
        traceEvent({
          stage: "project.patch",
          phase: "instant",
          gestureId,
          inputKey: traceKey(current),
          outputKey: traceKey(next),
          documentKey: traceKey(next),
          counts: { commitCount },
          detail: {
            fields: changedFields.join(","),
            revisionBefore,
            revisionAfter,
            fontSizeBefore: current.fontSize,
            fontSizeAfter: next.fontSize,
            artboardBefore: `${current.artboard.width}x${current.artboard.height}`,
            artboardAfter: `${next.artboard.width}x${next.artboard.height}`,
          },
        });
      }
      return next;
    });
  }, []);
  const importUnknown = useCallback((input: unknown) => {
    const result = migrateAndRepairProject(input);
    setProject(result.project);
    return result;
  }, [setProject]);
  return { project, setProject, importUnknown };
}
