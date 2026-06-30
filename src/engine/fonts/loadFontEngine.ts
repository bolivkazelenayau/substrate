import type { FontEngine } from "./fontEngineTypes";

let cachedFontEnginePromise: Promise<FontEngine> | null = null;

export function loadFontEngine(): Promise<FontEngine> {
  cachedFontEnginePromise ??= import("./opentypeFontEngine")
    .then(({ openTypeFontEngine }) => openTypeFontEngine)
    .catch((error: unknown) => {
      cachedFontEnginePromise = null;
      throw error;
    });
  return cachedFontEnginePromise;
}
