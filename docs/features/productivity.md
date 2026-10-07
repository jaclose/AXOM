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
