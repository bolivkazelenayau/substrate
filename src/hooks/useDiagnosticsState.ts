import { useState } from "react";
import type { DiagnosticsMode } from "../types";

export function useDiagnosticsState() {
  const [mode, setMode] = useState<DiagnosticsMode>("compact");
  return { mode, setMode, visible: mode !== "off", expanded: mode === "full" };
}
