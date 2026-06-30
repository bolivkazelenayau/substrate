import { useState } from "react";

export function useExportController() {
  const [exporting, setExporting] = useState(false);
  return { exporting, setExporting };
}
