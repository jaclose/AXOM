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
