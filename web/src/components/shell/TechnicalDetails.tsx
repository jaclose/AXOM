// JD (Ideas 1): Settings speak plainly; "anything else that is technical can
// be opened with a drop down arrow if they are interested."
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";

export function TechnicalDetails({ children, label = "Technical details" }: { children: ReactNode; label?: string }) {
  return (
    <details className="technical-details">
      <summary><ChevronRight size={ICON_SIZE.body} aria-hidden="true" /> {label}</summary>
      <div className="technical-details-body">{children}</div>
    </details>
  );
}
