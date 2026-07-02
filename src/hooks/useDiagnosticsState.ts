import { useState } from "react";
import type { DiagnosticsMode } from "../types";

export function createDefaultDiagnosticsMode(): DiagnosticsMode {
  return "off";
}

export function useDiagnosticsState() {
  const [mode, setMode] = useState<DiagnosticsMode>(createDefaultDiagnosticsMode);
  return { mode, setMode, visible: mode !== "off", expanded: mode === "full" };
}
