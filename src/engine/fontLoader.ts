import { parse, type Font } from "opentype.js";
import type { FontMetadata } from "../types";

export interface LoadedFont {
  font: Font;
  metadata: FontMetadata;
}

function localizedName(names: Record<string, string> | undefined, fallback: string) {
  if (!names) return fallback;
  return names.en ?? Object.values(names)[0] ?? fallback;
}

export function parseFontBuffer(buffer: ArrayBuffer, fileName: string): LoadedFont {
  if (!/\.(ttf|otf)$/i.test(fileName)) {
    throw new Error("Choose a .ttf or .otf font file.");
  }
  let font: Font;
  try {
    font = parse(buffer);
  } catch {
    throw new Error("The selected file could not be parsed as an OpenType font.");
  }

  const family = localizedName(font.names.fontFamily, fileName.replace(/\.(ttf|otf)$/i, ""));
  const fullName = localizedName(font.names.fullName, family);
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0) {
    throw new Error("The font has invalid units-per-em metrics.");
  }

  return {
    font,
    metadata: {
      family,
      fullName,
      fileName,
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascender,
      descender: font.descender,
    },
  };
}

export async function loadFontFile(file: File): Promise<LoadedFont> {
  const buffer = await file.arrayBuffer();
  const loaded = parseFontBuffer(buffer, file.name);
  try {
    const face = new FontFace(loaded.metadata.family, buffer.slice(0));
    await face.load();
    document.fonts.add(face);
  } catch {
    // Outline extraction remains valid even if browser font registration fails.
  }
  return loaded;
}

export function validateLoadedFont(loaded: LoadedFont) {
  return Boolean(
    loaded.font
    && loaded.font.glyphs.length > 0
    && loaded.metadata.family
    && Number.isFinite(loaded.metadata.unitsPerEm)
    && loaded.metadata.unitsPerEm > 0,
  );
}
