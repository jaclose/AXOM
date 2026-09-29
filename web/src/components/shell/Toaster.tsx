// Renders the global toast stack (bottom-right; full width above the safe area
// on phones). Mounted once at the app root. Placement and light-theme colors
// are in components.css ("Notification layer").
import { CheckCircle2, Info, AlertTriangle, X, ArrowRight } from "lucide-react";
import { useToasts, type Toast } from "../../lib/toast";
import { ICON_SIZE } from "../../lib/iconSize";
import { useReducedMotion } from "../../lib/motion";
import { useExitingList } from "../../lib/useExitingList";

/** Matches the toast-evaporate keyframes in pages.css. */
export const TOAST_EXIT_MS = 560;
const toastKey = (toast: Toast) => toast.id;

const ICON = {
  success: CheckCircle2,
  warn: AlertTriangle,
  info: Info,
} as const;

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const hold = useToasts((s) => s.hold);
  const release = useToasts((s) => s.release);
  // Dismissed notices leave the store at once but stay in place here while
  // they evaporate (blur, lift, fade, collapse), so nothing blinks out.
  const entries = useExitingList(toasts, toastKey, useReducedMotion() ? 0 : TOAST_EXIT_MS);
  if (!entries.length) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {entries.map(({ item: toast, leaving }) => {
        const Icon = ICON[toast.tone];
        const actions = toast.actions?.length
          ? toast.actions
          : toast.actionLabel && (toast.href || toast.onAction)
            ? [{ label: toast.actionLabel, href: toast.href, onAction: toast.onAction }]
            : [];
        return (
          <div
            className={`toast toast-${toast.tone}${leaving ? " is-leaving" : ""}`}
            key={toast.id}
            role="status"
            aria-hidden={leaving || undefined}
            // Auto-dismiss waits while the notice is being read or operated.
            onMouseEnter={() => hold(toast.id, "hover")}
            onMouseLeave={() => release(toast.id, "hover")}
            onFocus={() => hold(toast.id, "focus")}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) release(toast.id, "focus");
            }}
          >
            <span className="toast-icon"><Icon size={ICON_SIZE.emphasis} /></span>
            <div className="toast-body">
              <b>{toast.title}</b>
              {toast.body && <span>{toast.body}</span>}
              {actions.length > 0 && (
                <div className="toast-actions" role="group" aria-label={`${toast.title} actions`}>
                  {actions.map((action, index) => action.href ? (
                    <a
                      className="toast-action"
                      href={action.href}
                      key={`${action.label}-${index}`}
                      onClick={() => { action.onAction?.(); dismiss(toast.id); }}
                    >
                      {action.label} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
                    </a>
                  ) : (
                    <button
                      className="toast-action"
                      type="button"
                      key={`${action.label}-${index}`}
                      onClick={() => { action.onAction?.(); dismiss(toast.id); }}
                    >
                      {action.label} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label={`Dismiss ${toast.title}`}>
              <X size={ICON_SIZE.body} aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
