import { parse } from "opentype.js";
import type { FontEngine, ParsedFont } from "./fontEngineTypes";

export const openTypeFontEngine: FontEngine = {
  parse(buffer) {
    return parse(buffer) as unknown as ParsedFont;
  },
};
