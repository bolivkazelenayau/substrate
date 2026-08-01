import type { ProjectState } from "../types";
import { baseState, presetIds } from "./presets";
import {
  CURRENT_PROJECT_VERSION,
  validateProject,
  type ProjectValidationResult,
} from "./projectSchema";

type UnknownRecord = Record<string, unknown>;
type HistoricalProjectVersion = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type ProjectImportErrorCode =
  | "invalid-json"
  | "unsupported-schema"
  | "missing-historical-field"
  | "migration-failed"
  | "latest-validation-failed";

export class ProjectImportError extends Error {
  readonly code: ProjectImportErrorCode;

  constructor(code: ProjectImportErrorCode, message: string) {
    super(message);
    this.name = "ProjectImportError";
    this.code = code;
  }
}

export interface HistoricalProjectCandidate extends UnknownRecord {
  version?: number;
}

export type ProjectStateCandidate = ProjectState;

type ProjectStateV9Candidate = Omit<ProjectState, "version" | "displayDislocation"> & { version: 9 };

const { displayDislocation: _displayDislocation, ...baseStateV9Fields } = baseState;
const baseStateV9Template: ProjectStateV9Candidate = {
  ...baseStateV9Fields,
  version: 9,
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOwn = (record: UnknownRecord, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function identifyHistoricalVersion(input: UnknownRecord): HistoricalProjectVersion {
  if (input.version === undefined) return 1;
  if (typeof input.version !== "number" || !Number.isInteger(input.version) || input.version < 1) {
    throw new ProjectImportError(
      "unsupported-schema",
      "Unsupported schema version: expected a positive integer or an omitted v1 version.",
    );
  }
  if (input.version > CURRENT_PROJECT_VERSION) {
    throw new ProjectImportError(
      "unsupported-schema",
      `Unsupported schema version ${input.version}; this app supports v1 through v${CURRENT_PROJECT_VERSION}.`,
    );
  }
  return input.version as HistoricalProjectVersion;
}

function requiredField(
  input: UnknownRecord,
  version: HistoricalProjectVersion,
  key: string,
  expected: "string" | "finite number" | "object" | "array",
): unknown {
  if (!hasOwn(input, key)) {
    throw new ProjectImportError(
      "missing-historical-field",
      `Schema v${version} is missing required historical field "${key}".`,
    );
  }
  const value = input[key];
  const valid = expected === "string"
    ? typeof value === "string"
    : expected === "finite number"
      ? typeof value === "number" && Number.isFinite(value)
      : expected === "array"
        ? Array.isArray(value)
        : isRecord(value);
  if (!valid) {
    throw new ProjectImportError(
      "missing-historical-field",
      `Schema v${version} field "${key}" must be a ${expected}.`,
    );
  }
  return value;
}

function requireTemplateKeys(
  input: UnknownRecord,
  template: UnknownRecord,
  version: HistoricalProjectVersion,
  prefix = "",
) {
  for (const [key, templateValue] of Object.entries(template)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!hasOwn(input, key)) {
      throw new ProjectImportError(
        "missing-historical-field",
        `Schema v${version} is missing required current field "${path}".`,
      );
    }
    const value = input[key];
    if (Array.isArray(templateValue)) {
      if (!Array.isArray(value)) {
        throw new ProjectImportError(
          "missing-historical-field",
          `Schema v${version} field "${path}" must be an array.`,
        );
      }
    } else if (isRecord(templateValue)) {
      if (!isRecord(value)) {
        throw new ProjectImportError(
          "missing-historical-field",
          `Schema v${version} field "${path}" must be an object.`,
        );
      }
      requireTemplateKeys(value, templateValue, version, path);
    }
  }
}

function validateHistoricalMinimum(
  input: UnknownRecord,
  expectedVersion?: HistoricalProjectVersion,
): HistoricalProjectCandidate {
  const version = identifyHistoricalVersion(input);
  if (expectedVersion !== undefined && version !== expectedVersion) {
    throw new ProjectImportError(
      "unsupported-schema",
      `Expected schema v${expectedVersion} but received v${version}.`,
    );
  }

  // The released v1-v8 import boundary accepted a loose object containing only
  // an optional numeric `version`; validateProject then supplied defaults and
  // repaired field types. Requiring authored fields here would reject documents
  // that those releases accepted, before their migrations can run.
  if (
    version < CURRENT_PROJECT_VERSION
    && typeof input.app === "string"
    && isRecord(input.state)
    && !hasOwn(input, "text")
    && !hasOwn(input, "renderer")
  ) {
    throw new ProjectImportError(
      "unsupported-schema",
      `Unsupported project format "${input.app}": expected SUBSTRATE project fields at the JSON root.`,
    );
  }

  // v9 was the first exact persisted shape. Keep validating it against its
  // historical field set while v10 adds Display Dislocation independently.
  if (version === 9) {
    requireTemplateKeys(input, baseStateV9Template as unknown as UnknownRecord, version);
  }
  if (version === CURRENT_PROJECT_VERSION) {
    requireTemplateKeys(input, baseState as unknown as UnknownRecord, version);
  }

  return input as HistoricalProjectCandidate;
}

function validateLatestProjectState(input: unknown): ProjectState {
  if (!isRecord(input)) {
    throw new ProjectImportError("latest-validation-failed", "Latest project validation failed: expected an object.");
  }
  if (input.version !== CURRENT_PROJECT_VERSION) {
    throw new ProjectImportError(
      "latest-validation-failed",
      `Latest project validation failed: expected schema v${CURRENT_PROJECT_VERSION}.`,
    );
  }
  try {
    requireTemplateKeys(
      input,
      baseState as unknown as UnknownRecord,
      CURRENT_PROJECT_VERSION,
    );
  } catch (error) {
    throw new ProjectImportError(
      "latest-validation-failed",
      `Latest project validation failed: ${errorMessage(error)}`,
    );
  }
  return input as unknown as ProjectState;
}

export function parseProjectDocumentText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ProjectImportError("invalid-json", `Invalid JSON syntax: ${errorMessage(error)}`);
  }
}

export function parseImportedProjectJson(input: unknown): UnknownRecord {
  if (!isRecord(input)) {
    throw new ProjectImportError("invalid-json", "Invalid project document: the JSON root must be an object.");
  }
  return input;
}

export function validateProjectV10Shape(input: unknown): ProjectStateCandidate {
  const parsed = parseImportedProjectJson(input);
  validateHistoricalMinimum(parsed, 10);
  return validateLatestProjectState(parsed);
}

export function validateProjectV9Shape(input: unknown): ProjectStateV9Candidate {
  const parsed = parseImportedProjectJson(input);
  validateHistoricalMinimum(parsed, 9);
  return parsed as unknown as ProjectStateV9Candidate;
}

export function validateProjectV8Shape(input: unknown): HistoricalProjectCandidate & { version: 8 } {
  const parsed = parseImportedProjectJson(input);
  validateHistoricalMinimum(parsed, 8);
  requiredField(parsed, 8, "text", "string");
  requiredField(parsed, 8, "renderer", "string");
  const artboard = requiredField(parsed, 8, "artboard", "object") as UnknownRecord;
  requiredField(artboard, 8, "width", "finite number");
  requiredField(artboard, 8, "height", "finite number");
  return parsed as HistoricalProjectCandidate & { version: 8 };
}

export function validateProjectV7Shape(input: unknown): HistoricalProjectCandidate & { version: 7 } {
  const parsed = parseImportedProjectJson(input);
  validateHistoricalMinimum(parsed, 7);
  requiredField(parsed, 7, "text", "string");
  requiredField(parsed, 7, "renderer", "string");
  return parsed as HistoricalProjectCandidate & { version: 7 };
}

export function migrateAndRepairProject(input: unknown): ProjectValidationResult {
  const parsed = parseImportedProjectJson(input);
  const raw = parsed;
  const version = identifyHistoricalVersion(raw);
  validateHistoricalMinimum(raw, version);

  let result: ProjectValidationResult;
  try {
    result = validateProject(raw);
  } catch (error) {
    throw new ProjectImportError(
      "migration-failed",
      `Project migration failed for schema v${version}: ${errorMessage(error)}`,
    );
  }

  validateLatestProjectState(result.project);

  const warnings = [...result.warnings];
  if (raw.version === undefined) {
    warnings.unshift("Project omitted a schema version and was interpreted as legacy schema v1.");
  }
  const knownFields = new Set(Object.keys(baseState));
  const ignoredFields = Object.keys(raw).filter((key) => !knownFields.has(key)).sort();
  if (ignoredFields.length > 0) {
    warnings.push(`Ignored unsupported project fields: ${ignoredFields.join(", ")}.`);
  }
  if (typeof raw.preset === "string" && !presetIds.includes(raw.preset as ProjectState["preset"])) {
    warnings.push(`Preset "${raw.preset}" is not recognized and was loaded as "Custom".`);
  }

  return { project: result.project, warnings };
}

export function importProjectState(input: unknown): ProjectState {
  return migrateAndRepairProject(input).project;
}
