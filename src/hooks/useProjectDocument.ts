import { useCallback, useState } from "react";
import { baseState } from "../engine/presets";
import { migrateAndRepairProject } from "../engine/projectImport";
import type { ProjectState } from "../types";

export function serializeProjectDocument(project: ProjectState): string {
  return JSON.stringify(project, null, 2);
}

export function useProjectDocument() {
  const [project, setProject] = useState<ProjectState>(baseState);
  const importUnknown = useCallback((input: unknown) => {
    const result = migrateAndRepairProject(input);
    setProject(result.project);
    return result;
  }, []);
  return { project, setProject, importUnknown };
}
