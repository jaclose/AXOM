// The setup style as shared primitives (JD, Ideas 4: the setup flow "is the
// standard and more for all fill in information boxes"). Tiles, chips,
// segments and summaries render the exact markup setup has always used
// (styles/choice.css), so Settings, schedule import and journal setup match it
// by construction instead of by restyling.
import { useId, type ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { ICON_SIZE } from "../../lib/iconSize";
import { onRadioGroupKeyDown } from "../shell/AppearanceStudio";
import "../../styles/choice.css";

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  detail?: string;
  icon?: LucideIcon;
}

type TileSelection<T extends string> =
  | { multiple: true; selected: readonly T[]; onToggle: (id: T) => void }
  | { multiple?: false; value: T; onChange: (id: T) => void };

/**
 * Big, tappable choices with an icon, a label and a one-line detail. Single
 * choice is a radio group (arrow keys move); multiple choice is a group of
 * toggle buttons. The label is the accessible name; the detail describes it.
 */
export function ChoiceTiles<T extends string>(props: {
  options: readonly ChoiceOption<T>[];
  /** "four" and "six" are setup's grids; "fluid" fits any container (Settings). */
  columns?: "four" | "six" | "fluid";
  compact?: boolean;
  label?: string;
  labelledBy?: string;
} & TileSelection<T>) {
  const { options, columns = "four", compact = false, label, labelledBy } = props;
  const idBase = useId();
  const multiple = props.multiple === true;
  return (
    <div
      className={`setup-tiles ${columns}`}
      role={multiple ? "group" : "radiogroup"}
      aria-label={label}
      aria-labelledby={labelledBy}
      onKeyDown={multiple ? undefined : onRadioGroupKeyDown}
    >
      {options.map((option) => {
        const on = multiple ? props.selected.includes(option.id) : props.value === option.id;
        const Icon = option.icon;
        const detailId = option.detail ? `${idBase}-${option.id}` : undefined;
        const selection = multiple
          ? { "aria-pressed": on }
          : { role: "radio" as const, "aria-checked": on, tabIndex: on ? 0 : -1 };
        return (
          <button
            key={option.id}
            type="button"
            {...selection}
            aria-label={option.label}
            aria-describedby={detailId}
            className={`setup-tile ${compact ? "compact" : ""} ${on ? "on" : ""}`}
            onClick={() => (multiple ? props.onToggle(option.id) : props.onChange(option.id))}
          >
            {Icon && <Icon size={compact ? ICON_SIZE.emphasis : ICON_SIZE.control} strokeWidth={1.5} aria-hidden="true" />}
            <b>{option.label}</b>
            {option.detail && <small id={detailId}>{option.detail}</small>}
            {on && <span className="setup-tile-check" aria-hidden="true"><Check size={ICON_SIZE.microInline} strokeWidth={2.5} /></span>}
          </button>
        );
      })}
    </div>
  );
}

/** A short row of mutually exclusive values (passes, timing, theme). */
export function ChoiceSegment<T extends string | number>({ options, value, onChange, label, labelledBy, wide = false }: {
  options: ReadonlyArray<{ value: T; label: ReactNode; ariaLabel?: string }>;
  value: T;
  onChange: (value: T) => void;
  label?: string;
  labelledBy?: string;
  wide?: boolean;
}) {
  return (
    <div className={`setup-segment ${wide ? "wide" : ""}`} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onRadioGroupKeyDown}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button key={String(option.value)} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            aria-label={option.ariaLabel} className={on ? "on" : ""} onClick={() => onChange(option.value)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Wrapping single-choice chips (setup's focus picker). */
export function ChoiceChips<T extends string>({ options, value, onChange, label, labelledBy }: {
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
  label?: string;
  labelledBy?: string;
}) {
  return (
    <div className="setup-chips" role="radiogroup" aria-label={label} aria-labelledby={labelledBy} onKeyDown={onRadioGroupKeyDown}>
      {options.map((option) => {
        const on = option.id === value;
        return (
          <button key={option.id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
            className={`setup-chip ${on ? "on" : ""}`} onClick={() => onChange(option.id)}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export type ChoiceSummaryRows = Array<[label: string, value: string]>;

/** What the choices will build, as quiet label/value rows. */
export function ChoiceSummary({ rows, live = false, className = "" }: { rows: ChoiceSummaryRows; live?: boolean; className?: string }) {
  return (
    <dl className={`setup-summary ${className}`} aria-live={live ? "polite" : undefined}>
      {rows.filter(([, value]) => value).map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}
