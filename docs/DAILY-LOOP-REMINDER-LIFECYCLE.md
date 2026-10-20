# Daily-loop reminder lifecycle

Status: morning Daily Check-In and evening closeout delivery implemented in
Wave 5.5D. Reminders are optional, device-local, and non-blocking.

## Preferences and defaults

The profile stores additive reminder preferences in the IndexedDB-first
workspace:

- Daily Check-In enabled, default `08:00` local time;
- evening closeout enabled, default `20:30` local time;
- individually configurable enabled state and time;
- optional quiet hours, disabled by default, with `22:00`–`07:00` defaults
  when enabled.

Malformed times normalize to the safe defaults. Times are interpreted in the
browser’s local calendar/time context; there is no server alarm or cloud push.

## Eligibility policy

`evaluateDailyLoopReminder` recomputes the current local day on every check. A
morning signal is eligible only after its preferred time, before the closeout
boundary, and while today has no saved `DayPlan`. A closeout signal is eligible
only after its preferred time and while today has no canonical `DailyCloseout`.

After the evening boundary, closeout takes precedence. A late first open cannot
show a stale morning check-in and then immediately show a closeout. Disabled,
completed, already shown, or skipped reminders produce no signal.

Quiet hours suppress delivery without marking the pending reminder shown or
skipped. Daytime and overnight intervals are supported; the start is inclusive
and the end is exclusive. Equal start/end times mean no quiet interval rather
than an accidental all-day mute. A pending reminder may be reconsidered after
quiet hours only while it still belongs to the current local day—it is never
carried into the next day as a stale prompt.

## Delivery and reconciliation

`DailyLoopReminderWatcher` is mounted at the app root. It reconciles on mount,
once per minute, window focus, `pageshow`, and return to visible state. This
catches browser sleep or backgrounding without a global persisted clock.

Before publishing a bottom-corner toast, the watcher marks the signal shown.
That ordering prevents React StrictMode replay and simultaneous lifecycle events
from producing duplicate messages. The toast is optional and offers:

- open the relevant Dashboard check-in or closeout;
- snooze for 30 minutes;
- skip that reminder for the local day.

The Dashboard also has a persistent in-context Daily Check-In/closeout surface.
Opening from the toast targets the same local day through a small UI request;
it does not create a plan or Journal entry merely by opening.

## Device reminder ledger

The device ledger stores one bounded record for the current local day with an
independent check-in and closeout disposition:

- `pending`, optionally with `snoozedUntil`;
- `shown`;
- `skipped`.

Only the date, disposition, and timestamps are kept in localStorage under the
frozen AXOM metadata key. No workspace, intention, Journal, question, task, or
activity payload is stored there. If browser storage is blocked, an in-memory
fallback still deduplicates the current session. A new local day receives a
fresh ledger.

## Check-In and closeout effects

Daily Check-In remains optional. Saving records the user’s explicit intention,
up to three win conditions, and optional study-block, priority, obstacle,
personal-note, and commitment context. “Use my targets” creates an explicit plan
from the selected targets; AXOM does not infer one. Skip leaves the day neutral.

Quick closeout reads the canonical Day at a Glance selector and asks for what
went well, one win, an obstacle, an unfinished loop, tomorrow’s first task, and
optional energy. It can save a Journal entry only when the user opts in and only
when that day does not already have one. “Expand into full notebook” opens the
same day without overwriting existing writing.

The reminder ledger controls presentation only. It never deletes activity,
marks a target complete, rewrites a Journal page, or changes Command Brief until
the user saves an actual plan or closeout.

## Past-day reflection inbox

Dashboard's Reflection inbox offers Later (four hours), Not today, and Dismiss
these days. Dismiss remembers only the exact currently eligible dates in
device/account-scoped localStorage; reload and day rollover do not restore their
reminders. New missed dates remain eligible. The shell catch-up watcher observes
the same preferences, including changes from another tab.

Dismissal never changes Journal entries, day plans, logs or completion. Its toast
offers Undo; failed saves remain visible and failed Undo offers Retry Undo.
Token-specific Undo markers cannot erase a newer dismissal in another tab. This
is a browser-local preference, not an account-synced Journal mutation.
