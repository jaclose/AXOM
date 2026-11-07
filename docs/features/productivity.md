---
tags:
  - axom/feature
authority: canonical
---
# Productivity and study accounting

**Purpose/user behavior:** Record meaningful study activity, run focus sessions, and
project that activity into daily/weekly targets without duplicate credit.

Persists through: [workspace data and compatibility](../architecture/data-model.md).

| Responsibility | Files under `web/src/` |
| --- | --- |
| Productivity UI | `pages/ProductivityPage.tsx`, `components/productivity/` |
| Timer lifecycle | `lib/pomodoro.ts`, shell/dock timer components |
| Target projection | `lib/targetContributions.ts` (`buildTargetContributionLedger`), `lib/dailySuccess.ts` |
| Daily boundaries | `lib/dailyRollover.ts` |
| Study streaks and AXOM Credits | `lib/studyStreaks.ts`, `components/shell/StudyStreakWatcher.tsx`, `components/productivity/StudyStreakMonitor.tsx` |
| Persisted mutations and types | `lib/store.ts`, `lib/types.ts` |

Canonical accounting semantics: [target contribution ledger](../TARGET-CONTRIBUTION-LEDGER.md).
Reminder lifecycle: [daily loop](../DAILY-LOOP-REMINDER-LIFECYCLE.md).
Use stable activity attribution and the existing source model; do not create a second
write merely to update a tracker. Coordinate shared store/timer/dock changes.

Limits: a remembered branch's implementation is not necessarily in this checkout.
Verify the actual event/source path before promising automatic lecture/card credit.
The older [Swift productivity architecture](../PRODUCTIVITY-ARCHITECTURE.md) is historical,
not the web implementation contract.

Tests: `web/src/lib/targetContributions.test.ts`, `pomodoroTrackerAttribution.test.ts`,
relevant productivity component tests and `web/e2e/productivity-tour-layout.spec.ts`.
Exercise timer attribution with a real event and duplicate/repeated-event edge case.

## Productivity V2 quick workflows

The first visible action is **self-report**, not a daily score. A named activity
can be logged without inventing minutes or quantity. Study, Questions, Anki,
Reading and Exercise are editable starting labels, not inferred completion.
Minutes and quantities are explicit user measurements; pressing Enter or Log
writes one activity through `logActivity`. The local-save receipt sits next to
the form. The timer's auto-log remains a separate source; do not enter the
same focus minutes twice.

**Your goals** is the light path over the same `dailySuccess` profile and
`evaluateDailySuccess` projection. Quick creation supports source-backed
study time/cards/questions/closeout goals, custom manual check-offs, and
custom exact-label self-report goals, with an amount and simple recurrence.
Manual completion writes a dated target override, not a study log. Linked
goals can populate the self-report label but never write an event until Log
is selected. Inline amount/schedule edits begin scoring under the new
settings today, without retroactively changing historical dates.

The original **Choose targets** editor remains the deliberate place for
specific weekdays, weights, source matching/corrections, linked habits and
review of provenance. Focus elapsed time and daily weighted-target progress
are different measurements; neither is a mastery claim. Current and historical
views preserve separate evidence and the historical view is read-only.

## AXOM V3 recurring personal goals (draft)

Personal rhythms share existing Habit receipts, tracker logs, and target
projections; they do **not** create a second event or grant synthetic minutes.
The `goalCadence.ts` selectors provide two recurrence forms:

- **Flexible weekly:** one distinct local training day is counted once, whether
  reported through Habit Tracker or explicitly linked tracker activity. Minimum
  and preferred thresholds are separate; rest days are not missed days. Weeks
  begin Monday. Partial initial weeks are capped to available local days.
  Completed-week thresholds are effective-dated in `Habit.weeklyRevisions`
  when updated, so prior weeks retain their original contract.
- **Named daily occurrences:** a single `HabitEntry` per local date stores
  separate `slotCheckIns` keyed by stable slot IDs. `setHabitSlot` upserts
  or clears only the selected occurrence and is idempotent. Unreported does not
  mean missed. The prayer template supplies five labels only, never predicted
  times, externally inferred completions, or spiritual judgments.

`Productivity/CadenceGoals.tsx` and `HabitTrackerPage.tsx` operate on the
same Habit and HabitEntry IDs. `Reports/CadenceGoalReport.tsx` is a read-only
projection and includes only habits explicitly marked `includeInReports`.
Sensitive named personal routines default to private and absent from Reports;
that checkbox does not authorize community sharing or external sync.

Daily academic scoring and the 80% streak/credit denominator intentionally
exclude unfinished `times-per-week` requirements; weekly results appear in
their cadence-specific view. The generic self-report form does not classify
an unlinked entry as academic study; an explicitly selected academic tracker
or the deliberate `logStudy` path provides that attribution.

Existing `HabitEntry` and `StudyLog` history is preserved; V3 fields are
additive. Cross-device reconciliation of simultaneous edits, rollback through
older clients, and authenticated cloud acceptance remain distinct release
requirements, not properties proved by component tests.

## Study streak and credits

The Productivity streak uses the same `evaluateDailySuccess(...).progress` percentage
shown by the daily bar. A scheduled day counts at 80% or more and earns one AXOM
Credit. Every third earned day in a continuous streak adds one bonus credit.
No eligible scheduled targets means no streak credit. The ledger stores dated
receipts, so reloads and repeated events do not award the same day again.
The reward streak starts when this ledger is first created. Older study records
remain intact, but current target settings are not applied retroactively to
mint credits for historical dates.

Each lane begins with two one-day freezes. Every two newly earned days in an
unbroken participation streak restore one spent freeze, capped at two. A
protected missed day carries the streak but does not advance the refill meter
or earn credits. Protection covers only a single missed day after a reported or
completed day; a second consecutive missed day ends the streak. Counts and
refill progress appear in Productivity, Daily Word, and Doctordle.
When protection is used, a dated notification links back to that lane.

Daily Word counts completed puzzles in its selected calendar time zone. Its
page, dashboard widget, and navigation rail use the same protected streak
selector. Doctordle has its own 05:00 UTC case boundary and its AXOM streak
uses only results the learner reports in AXOM. Opening the external site never
counts as a result. Its freeze data stays in its device-local log.

Existing journal unlocks and completed study session earnings remain spendable.
New completed sessions also earn credits once per unique session ID, alongside
the dated daily goal receipts and streak bonuses.

The Productivity page projects its next step from current target evaluation,
recorded activity, the running focus timer and actual local save failures. Duplicate
study-log identities are resolved globally before dates are selected; the newest
timestamp and a deterministic field tie-break select a record without changing
stored history. Question Bank runs use their stable session-linked activity ID;
unlinked finished runs from today and duplicate identities prompt review in Activity. Card
reviews and tracker pass events are shown as separate evidence, resolving each
identity to its latest valid timestamp before selecting the local date, without
inferring minutes or mastery. Period boundaries and activity shortcuts use the
same canonical study logs as the totals. Historical views are read-only and
current target settings apply to their target display. Trends require three
recorded dates; future calendar dates are unavailable and quiet dates are not
failures. Calendar labels use local dates rather than UTC date-only parsing.
