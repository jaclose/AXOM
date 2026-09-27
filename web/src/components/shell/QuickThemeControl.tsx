import { Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { setThemePreference, type ThemePreference } from "../../lib/theme";
import { useThemePreference } from "../../lib/useThemePreference";
import { ICON_SIZE } from "../../lib/iconSize";
import { PALETTES, customPaletteDefinition, setPalettePreference } from "../../lib/palette";
import { usePalettePreference, useResolvedTheme } from "../../lib/useAppearance";
import { useUi } from "../../lib/uiStore";
import { PaletteSwatch, onRadioGroupKeyDown } from "./AppearanceStudio";

const THEME_OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  detail: string;
  icon: typeof Sun;
}> = [
  { value: "light", label: "Light", detail: "Warm paper", icon: Sun },
  { value: "dark", label: "Dark", detail: "Graphite", icon: Moon },
  { value: "system", label: "System", detail: "Match device", icon: Monitor },
];

export function QuickThemeControl() {
  const preference = useThemePreference();
  const current = THEME_OPTIONS.find((option) => option.value === preference) ?? THEME_OPTIONS[2];
  const CurrentIcon = current.icon;
  const palette = usePalettePreference();
  const resolved = useResolvedTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const titleId = useId();

  function close(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    selectedRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close(true);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      close(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="quick-theme-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="user-icon-btn"
        aria-label={`Theme: ${current.label}. Choose appearance`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={`Theme: ${current.label}`}
        onClick={() => open ? close(true) : setOpen(true)}
      >
        <CurrentIcon size={ICON_SIZE.emphasis} aria-hidden="true" />
      </button>

      {open && (
        <div id={panelId} className="quick-theme-popover" role="dialog" aria-labelledby={titleId}>
          <div className="quick-theme-head">
            <div>
              <div id={titleId} className="quick-theme-title">Appearance</div>
              <div className="quick-theme-current">Current: {current.label}</div>
            </div>
            <button type="button" className="quick-theme-close" onClick={() => close(true)} aria-label="Close appearance menu">
              <X size={ICON_SIZE.body} aria-hidden="true" />
            </button>
          </div>
          <fieldset className="quick-theme-options">
            <legend className="quick-theme-legend">Theme</legend>
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const selected = preference === option.value;
              return (
                <label className={`quick-theme-option ${selected ? "on" : ""}`} key={option.value}>
                  <input
                    ref={selected ? selectedRef : undefined}
                    type="radio"
                    name={`${panelId}-theme`}
                    value={option.value}
                    checked={selected}
                    onChange={() => {
                      setThemePreference(option.value);
                      close(true);
                    }}
                  />
                  <Icon size={ICON_SIZE.body} aria-hidden="true" />
                  <span><b>{option.label}</b><small>{option.detail}</small></span>
                </label>
              );
            })}
          </fieldset>
          <div className="quick-palette-row" role="radiogroup" aria-label="Accent palette" onKeyDown={onRadioGroupKeyDown}>
            {[...PALETTES, customPaletteDefinition(palette.customAccent ?? "")].map((definition) => {
              const selected = palette.id === definition.id;
              return (
                <button
                  key={definition.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  aria-label={`${definition.label} palette — ${definition.pairing}`}
                  title={`${definition.label} · ${definition.pairing}`}
                  className={selected ? "on" : ""}
                  onClick={() => setPalettePreference({ id: definition.id, customAccent: palette.customAccent })}
                >
                  <PaletteSwatch input={resolved === "light" ? definition.light : definition.dark} size="sm" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="quick-theme-more"
            onClick={() => {
              close(false);
              useUi.getState().requestSettings("appearance");
            }}
          >
            All appearance options
          </button>
        </div>
      )}
    </div>
  );
}
