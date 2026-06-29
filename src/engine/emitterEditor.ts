import type { GlyphEmitterInstance } from "../types";

export const MAX_EMITTER_ROWS = 8;

export function nextEmitterId(rows: GlyphEmitterInstance[]) {
  const used = new Set(rows.map((row) => row.id));
  let suffix = 1;
  while (used.has(`emitter-${suffix}`)) suffix += 1;
  return `emitter-${suffix}`;
}

export function addEmitterRow(rows: GlyphEmitterInstance[]) {
  if (rows.length >= MAX_EMITTER_ROWS) return rows;
  const id = nextEmitterId(rows);
  return [...rows, {
    id,
    glyphId: "auto-first",
    enabled: true,
    weight: 1,
    phaseOffset: 0,
    radiusMultiplier: 1,
    label: `Emitter ${rows.length + 1}`,
  }];
}

export function duplicateEmitterRow(rows: GlyphEmitterInstance[], id: string) {
  if (rows.length >= MAX_EMITTER_ROWS) return rows;
  const index = rows.findIndex((row) => row.id === id);
  if (index < 0) return rows;
  const source = rows[index];
  const duplicate: GlyphEmitterInstance = {
    ...source,
    id: nextEmitterId(rows),
    label: `${source.label} copy`.slice(0, 32),
  };
  return [...rows.slice(0, index + 1), duplicate, ...rows.slice(index + 1)];
}

export function removeEmitterRow(rows: GlyphEmitterInstance[], id: string) {
  if (rows.length <= 1) return rows;
  return rows.filter((row) => row.id !== id);
}

export function updateEmitterRow(
  rows: GlyphEmitterInstance[],
  id: string,
  patch: Partial<GlyphEmitterInstance>,
) {
  return rows.map((row) => row.id === id ? { ...row, ...patch, id: row.id } : row);
}
