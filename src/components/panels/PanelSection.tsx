import type { ReactNode } from "react";

interface PanelSectionProps {
  children: ReactNode;
  className?: string;
}

export interface PipelineStageProps extends PanelSectionProps {
  id: string;
  number?: string;
  title: string;
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

export function PipelineStage({ id, number, title, children, className = "" }: PipelineStageProps) {
  return (
    <section className={`control-section pipeline-stage ${className}`.trim()} data-stage={id}>
      <div className="section-heading" data-stage-heading="true">
        {number && <span>{number}</span>}
        <h2>{title}</h2>
      </div>
      <div className="pipeline-stage-content">{children}</div>
    </section>
  );
}

export function DiagnosticsPanel({ children, className = "" }: PanelSectionProps) {
  return <PanelSection className={`debug-section ${className}`.trim()}>{children}</PanelSection>;
}
