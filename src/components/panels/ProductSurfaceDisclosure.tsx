import type { ReactNode } from "react";
import type { ProductSurface } from "../../engine/parameterOwnership";

interface ProductSurfaceDisclosureProps {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  surface?: ProductSurface;
  status?: string;
  testId?: string;
  className?: string;
}

export function ProductSurfaceDisclosure({
  label,
  open,
  onToggle,
  children,
  surface = "TUNING",
  status,
  testId,
  className = "",
}: ProductSurfaceDisclosureProps) {
  const contentId = `${testId ?? label.toLowerCase().replaceAll(" ", "-")}-content`;
  return (
    <div
      className={`surface-disclosure ${className}`.trim()}
      data-product-surface={surface}
      data-testid={testId}
    >
      <button
        type="button"
        className="surface-disclosure-summary"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={contentId}
      >
        <span aria-hidden="true">{open ? "▼" : "▶"}</span> {label}
        {status && <span className="surface-status"> · {status}</span>}
      </button>
      {open && <div id={contentId} className="surface-disclosure-content">{children}</div>}
    </div>
  );
}
