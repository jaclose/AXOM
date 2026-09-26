import { Clock3, Settings2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  analogClockAngles,
  clockPrecision,
  formatClockDate,
  formatClockTime,
  getZonedTimeParts,
  normalizeClockPreferences,
  normalizeTimeZonePreference,
  resolveTimeZone,
  useClockNow,
  type ClockPreferences,
  type ClockTicker,
  type TimeZonePreference,
} from "../../lib/clock";
import { useReducedMotion } from "../../lib/motion";
import { ICON_SIZE } from "../../lib/iconSize";

export interface ClockControlProps {
  clockPreferences?: ClockPreferences;
  timeZonePreference?: TimeZonePreference;
  onOpenPreferences: () => void;
  locale?: string;
  /** Test/host injection; production uses the shared singleton ticker. */
  ticker?: ClockTicker;
}

export function ClockControl({
  clockPreferences,
  timeZonePreference,
  onOpenPreferences,
  locale,
  ticker,
}: ClockControlProps) {
  const preferences = normalizeClockPreferences(clockPreferences);
  const timezone = normalizeTimeZonePreference(timeZonePreference);
  if (!preferences.enabled) return null;
  return (
    <LiveClockControl
      preferences={preferences}
      timeZonePreference={timezone}
      onOpenPreferences={onOpenPreferences}
      locale={locale}
      ticker={ticker}
    />
  );
}

function LiveClockControl({
  preferences,
  timeZonePreference,
  onOpenPreferences,
  locale,
  ticker,
}: {
  preferences: ClockPreferences;
  timeZonePreference: TimeZonePreference;
  onOpenPreferences: () => void;
  locale?: string;
  ticker?: ClockTicker;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const now = useClockNow(clockPrecision(preferences, open), ticker);
  const timeZone = resolveTimeZone(timeZonePreference);
  const time = formatClockTime(now, timeZone, preferences, locale);
  const date = formatClockDate(now, timeZone, locale);

  function closeClock(restoreFocus: boolean) {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeClock(true);
    };
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeClock(true);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="clock-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="clock-trigger"
        aria-label={`Open clock, ${time}, ${timeZone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => open ? closeClock(true) : setOpen(true)}
      >
        <Clock3 size={ICON_SIZE.emphasis} aria-hidden="true" />
        {preferences.showDigital && <time dateTime={now.toISOString()}>{time}</time>}
        {preferences.showDate && <span className="clock-trigger-date" aria-hidden="true">{date}</span>}
        {preferences.showTimezoneLabel && <span className="clock-trigger-zone" aria-hidden="true">{timeZone}</span>}
      </button>

      {open && (
        <div
          id={panelId}
          className="clock-popover"
          role="dialog"
          aria-labelledby={titleId}
        >
          <div className="clock-popover-head">
            <div>
              <div id={titleId} className="clock-popover-title">Clock</div>
              <div className="clock-popover-zone">{timeZone}</div>
            </div>
            <button ref={closeRef} type="button" className="clock-icon-button" onClick={() => closeClock(true)} aria-label="Close clock">
              <X size={ICON_SIZE.emphasis} aria-hidden="true" />
            </button>
          </div>

          {preferences.showAnalog && (
            <AnalogClock date={now} timeZone={timeZone} showSeconds={preferences.showAnalogSeconds} />
          )}

          <time
            dateTime={now.toISOString()}
            className={preferences.showDigital ? "clock-popover-time" : "clock-visually-hidden"}
          >
            {time}
          </time>
          {preferences.showDate && <div className="clock-popover-date">{date}</div>}

          <button
            type="button"
            className="clock-preferences-button"
            onClick={() => {
              setOpen(false);
              onOpenPreferences();
            }}
          >
            <Settings2 size={ICON_SIZE.body} aria-hidden="true" /> Clock preferences
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Keep a hand's angle monotonic so 354° → 0° animates forward by 6° instead
 * of sweeping backwards through a full turn.
 */
export function unwrapAngle(previous: number | undefined, next: number): number {
  if (previous === undefined) return next;
  const base = previous - ((previous % 360) + 360) % 360;
  let candidate = base + next;
  if (candidate < previous - 180) candidate += 360;
  if (candidate > previous + 180) candidate -= 360;
  return candidate;
}

function useContinuousAngle(angle: number): number {
  const previous = useRef<number | undefined>(undefined);
  const value = unwrapAngle(previous.current, angle);
  useEffect(() => { previous.current = value; }, [value]);
  return value;
}

export function AnalogClock({
  date,
  timeZone,
  showSeconds,
}: {
  date: Date;
  timeZone: string;
  showSeconds: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const angles = analogClockAngles(getZonedTimeParts(date, timeZone), showSeconds);
  const hour = useContinuousAngle(angles.hour);
  const minute = useContinuousAngle(angles.minute);
  const second = useContinuousAngle(angles.second);
  return (
    <svg
      className={`analog-clock ${reducedMotion ? "reduced" : ""}`}
      viewBox="0 0 100 100"
      aria-hidden="true"
      focusable="false"
    >
      <circle className="analog-clock-face" cx="50" cy="50" r="45" />
      {Array.from({ length: 12 }, (_, index) => (
        <line
          key={index}
          className="analog-clock-tick"
          x1="50"
          y1="8"
          x2="50"
          y2={index % 3 === 0 ? "14" : "11"}
          transform={`rotate(${index * 30} 50 50)`}
        />
      ))}
      {/* Hands rotate with a CSS transform around the view-box center (see
          .analog-clock-hand). Never combine an SVG rotate(a cx cy) attribute
          with a CSS transform-origin: the pivot is applied twice and the hand
          orbits (100,100) instead of the dial center. */}
      <line className="analog-clock-hand hour" x1="50" y1="50" x2="50" y2="28" style={{ transform: `rotate(${hour}deg)` }} />
      <line className="analog-clock-hand minute" x1="50" y1="50" x2="50" y2="18" style={{ transform: `rotate(${minute}deg)` }} />
      {showSeconds && (
        <line className="analog-clock-hand second" x1="50" y1="56" x2="50" y2="15" style={{ transform: `rotate(${second}deg)` }} />
      )}
      <circle className="analog-clock-pin" cx="50" cy="50" r="2.4" />
    </svg>
  );
}
