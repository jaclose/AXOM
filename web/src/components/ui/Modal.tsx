import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { GhostButton } from "./primitives";
import { ICON_SIZE } from "../../lib/iconSize";

export function Modal({
  title, onClose, children, footer, className = "", bodyClassName = "",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.contains(document.activeElement)) {
      focusableElements(dialog)[0]?.focus();
      if (!dialog.contains(document.activeElement)) dialog.focus();
    }

    const onKey = (e: KeyboardEvent) => {
      const openDialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (openDialogs[openDialogs.length - 1] !== dialog) return;
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = focusableElements(dialog);
      if (!focusable.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  // Portaled to <body>: a dialog opened from inside a list row (the Course
  // Tracker's study-plan editor) otherwise inherits the row's stacking
  // context and backdrop-filter, so later rows paint over it.
  return createPortal(
    <div className="modal-scrim" onMouseDown={onClose}>
      <div ref={dialogRef} className={`modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}>
        <div className="spread">
          <h3 id={titleId}>{title}</h3>
          <GhostButton onClick={onClose} aria-label="Close"><X size={ICON_SIZE.emphasis} /></GhostButton>
        </div>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function Field({
  label, ...rest
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="stack gap6">
      <span className="field-label">{label}</span>
      <input className="field" {...rest} />
    </label>
  );
}

export function TextAreaField({
  label, ...rest
}: { label: string } & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="stack gap6">
      <span className="field-label">{label}</span>
      <textarea className="field" {...rest} />
    </label>
  );
}

export function SelectField({
  label, children, ...rest
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="stack gap6">
      <span className="field-label">{label}</span>
      <select className="field" aria-label={label} {...rest}>{children}</select>
    </label>
  );
}
