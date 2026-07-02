import * as v from "valibot";
import type { ProjectState } from "../types";
import { validateProject, type ProjectValidationResult } from "./projectSchema";

const importedProjectSchema = v.looseObject({
  version: v.optional(v.number()),
});

const projectV8ShapeSchema = v.looseObject({
  version: v.literal(8),
  artboard: v.object({
    width: v.number(),
    height: v.number(),
  }),
  text: v.string(),
  renderer: v.string(),
});

export type ProjectStateCandidate = v.InferOutput<typeof projectV8ShapeSchema>;

export function parseImportedProjectJson(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Project must be a JSON object.");
  }
  return v.parse(importedProjectSchema, input);
}

export function validateProjectV8Shape(input: unknown): ProjectStateCandidate {
  return v.parse(projectV8ShapeSchema, input);
}

export const validateProjectV7Shape = validateProjectV8Shape;

export function migrateAndRepairProject(input: unknown): ProjectValidationResult {
  return validateProject(parseImportedProjectJson(input));
}

export function importProjectState(input: unknown): ProjectState {
  return migrateAndRepairProject(input).project;
}
