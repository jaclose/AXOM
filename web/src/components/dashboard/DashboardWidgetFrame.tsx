import { Settings2 } from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import "../../styles/dashboard-widgets.css";
import { ICON_SIZE } from "../../lib/iconSize";

export type DashboardWidgetFrameSize = "small" | "medium" | "large" | "extra-large";

export type DashboardWidgetField = {
  id: string;
  label: string;
  checked: boolean;
  description?: string;
  disabled?: boolean;
};

/** A behaviour toggle, as opposed to a shown detail. */
export type DashboardWidgetOption = {
  id: string;
  label: string;
  checked: boolean;
  description?: string;
};

export type DashboardWidgetFrameSettings = {
  size: DashboardWidgetFrameSize;
  fields: Record<string, boolean>;
  /** Present only when the widget offers options. */
  options?: Record<string, boolean>;
};

type DashboardWidgetFrameProps = {
  widgetId: string;
  title: string;
  size: DashboardWidgetFrameSize;
  children: ReactNode;
  fields?: readonly DashboardWidgetField[];
  options?: readonly DashboardWidgetOption[];
  allowedSizes?: readonly DashboardWidgetFrameSize[];
  settingsDescription?: string;
  className?: string;
  onSave: (settings: DashboardWidgetFrameSettings) => void;
};

const SIZE_OPTIONS: ReadonlyArray<{
  value: DashboardWidgetFrameSize;
  label: string;
  description: string;
}> = [
  { value: "small", label: "Small", description: "A compact glance." },
  { value: "medium", label: "Medium", description: "The standard view." },
  { value: "large", label: "Large", description: "More detail and context." },
  { value: "extra-large", label: "Extra large", description: "The fullest view." },
];

function fieldState(fields: readonly { id: string; checked: boolean }[]) {
  return Object.fromEntries(fields.map((field) => [field.id, field.checked]));
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>([
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[href]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(","))).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

export function DashboardWidgetFrame({
  widgetId,
  title,
  size,
  children,
  fields = [],
  options = [],
  allowedSizes = SIZE_OPTIONS.map((option) => option.value),
  settingsDescription,
  className = "",
  onSave,
}: DashboardWidgetFrameProps) {
  const reactId = useId().replace(/:/g, "");
  const panelId = `dashboard-widget-settings-${widgetId}-${reactId}`;
  const headingId = `${panelId}-heading`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draftSize, setDraftSize] = useState<DashboardWidgetFrameSize>(size);
  const [draftFields, setDraftFields] = useState<Record<string, boolean>>(() => fieldState(fields));
  const [draftOptions, setDraftOptions] = useState<Record<string, boolean>>(() => fieldState(options));
  const sizeOptions = SIZE_OPTIONS.filter((option) => allowedSizes.includes(option.value));

  useLayoutEffect(() => {
    if (editing) {
      if (panelRef.current) focusableElements(panelRef.current)[0]?.focus();
      return;
    }
    if (restoreFocusRef.current) {
      restoreFocusRef.current = false;
      triggerRef.current?.focus();
    }
  }, [editing]);

  function openSettings() {
    setDraftSize(size);
    setDraftFields(fieldState(fields));
    setDraftOptions(fieldState(options));
    setEditing(true);
  }

  function closeSettings() {
    restoreFocusRef.current = true;
    setEditing(false);
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettings();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = focusableElements(panelRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function saveSettings() {
    onSave({ size: draftSize, fields: { ...draftFields }, ...(options.length ? { options: { ...draftOptions } } : {}) });
    closeSettings();
  }

  return (
    <article
      className={`dashboard-widget-frame dashboard-widget-frame--${size} ${editing ? "is-configuring" : ""} ${className}`.trim()}
      data-widget-id={widgetId}
      data-widget-size={size}
      data-luster={editing ? undefined : ""}
      aria-label={`${title} widget`}
    >
      <div className="dashboard-widget-frame__front" hidden={editing}>
        <button
          ref={triggerRef}
          className="dashboard-widget-frame__settings-trigger"
          type="button"
          aria-label={`Customize ${title}`}
          aria-expanded={editing}
          aria-controls={panelId}
          onClick={openSettings}
        >
          <Settings2 aria-hidden="true" size={ICON_SIZE.emphasis} />
        </button>
        <div className="dashboard-widget-frame__content">{children}</div>
      </div>

      <div
        ref={panelRef}
        id={panelId}
        className="dashboard-widget-frame__settings"
        role="region"
        aria-labelledby={headingId}
        hidden={!editing}
        onKeyDown={handlePanelKeyDown}
      >
        <div className="dashboard-widget-frame__settings-head">
          <div>
            <h3 id={headingId}>Customize {title}</h3>
            {settingsDescription && <p>{settingsDescription}</p>}
          </div>
        </div>

        <fieldset className="dashboard-widget-frame__control-group">
          <legend>Widget size</legend>
          <div className="dashboard-widget-frame__size-options">
            {sizeOptions.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={`${panelId}-size`}
                  value={option.value}
                  checked={draftSize === option.value}
                  onChange={() => setDraftSize(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {fields.length > 0 && (
          <fieldset className="dashboard-widget-frame__control-group">
            <legend>Shown details</legend>
            <div className="dashboard-widget-frame__field-options">
              {fields.map((field) => (
                <label key={field.id}>
                  <input
                    type="checkbox"
                    checked={draftFields[field.id] ?? false}
                    disabled={field.disabled}
                    onChange={(event) => setDraftFields((current) => ({
                      ...current,
                      [field.id]: event.target.checked,
                    }))}
                  />
                  <span>
                    <strong>{field.label}</strong>
                    {field.description && <small>{field.description}</small>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {options.length > 0 && (
          <fieldset className="dashboard-widget-frame__control-group">
            <legend>Options</legend>
            <div className="dashboard-widget-frame__field-options">
              {options.map((option) => (
                <label key={option.id}>
                  <input
                    type="checkbox"
                    checked={draftOptions[option.id] ?? false}
                    onChange={(event) => setDraftOptions((current) => ({
                      ...current,
                      [option.id]: event.target.checked,
                    }))}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="dashboard-widget-frame__actions">
          <button className="gbtn" type="button" onClick={closeSettings}>Cancel</button>
          <button className="gbtn primary" type="button" onClick={saveSettings}>Save</button>
        </div>
      </div>
    </article>
  );
}
