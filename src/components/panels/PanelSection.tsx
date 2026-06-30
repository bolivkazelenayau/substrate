import type { ReactNode } from "react";

interface PanelSectionProps {
  children: ReactNode;
  className?: string;
}

function PanelSection({ children, className = "" }: PanelSectionProps) {
  return <section className={`control-section ${className}`.trim()}>{children}</section>;
}

export const ArtworkPanel = PanelSection;
export const TypographyPanel = PanelSection;
export const FieldPanel = PanelSection;
export const AppearancePanel = PanelSection;
export const PreviewPanel = PanelSection;
export const ExportPanel = PanelSection;

export function DiagnosticsPanel({ children, className = "" }: PanelSectionProps) {
  return <PanelSection className={`debug-section ${className}`.trim()}>{children}</PanelSection>;
}
