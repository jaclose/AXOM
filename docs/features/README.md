---
tags:
  - axom/navigation
authority: navigation
---
# Feature router

Choose one row. Existing feature contracts remain canonical at their established paths.

| Task | Orientation | Source entry |
| --- | --- | --- |
| Question import, bank, exams | [Questions](questions.md) | `pages/QuestionWorkspacePage.tsx`, `components/questions/` |
| Targets, timers, study accounting | [Productivity](productivity.md) | `pages/ProductivityPage.tsx`, `lib/pomodoro.ts` |
| Soundscapes, focus media, media pipeline | [Soundscapes](soundscapes.md) | `pages/SoundscapesPage.tsx`, `lib/soundscapes/`, `lib/media/` |
| Dashboard widgets/next action | [Widget contract](../DASHBOARD-WIDGET-ARCHITECTURE.md), [brief evidence](../COMMAND-BRIEF-EVIDENCE.md) | `pages/DashboardPage.tsx`, `lib/dashboardWidgets.ts`, `lib/commandBrief.ts` |
| Courses, tracker, schedule import | [Course design proposal](../COURSE-CENTRAL-ARCHITECTURE.md), not proof of live integrations | `pages/CoursesPage.tsx`, `pages/CourseTrackerPage.tsx`, `lib/courseScheduleImport.ts` |
| Journal | [Notebook contract](../JOURNAL-NOTEBOOK-ARCHITECTURE.md) | `pages/JournalPage.tsx`, `lib/journalNotebook.ts`, `lib/journalExtras.ts` |
| Anki | Existing code/tests; [AI boundary](../architecture/backend.md) if generation changes | `pages/AnkiLabPage.tsx`, `components/anki/`, `lib/ankiCards.ts`, `lib/ankiConnect.ts` |
| Settings/preferences | [Frontend lifecycle](../architecture/frontend.md), [data model](../architecture/data-model.md) | `components/shell/SettingsModal.tsx`, `SettingsSections.tsx` |
| Question analysis / new Course Engine | [Questions](questions.md), [active-work registry](../operations/repository-audit.md#maintenance-registry) | Branch-specific `lib/learning-intelligence/`, `lib/course-engine/`; absent at this base, verify owner branch first |
| Accounts/restore/sharing | [Accounts contract](../architecture/accounts-sync-v1.md) | `lib/account/`, `lib/sync/` |
| Application/pathway datasets | [School data](../APPLICATION-SCHOOL-DATASET.md), [pathway data](../APPLICATION-PATHWAY-DATASETS.md) | `lib/applicationChecker.ts`, `web/scripts/` from repository root |
| Cinematics and updates | [Cinematics](../CINEMATICS.md), [update policy](../UPDATE-POLICY.md) | `web/public/cinematics/`, `lib/webUpdates.ts` |

Source paths above are relative to `web/src/` unless qualified. Locate nearby tests by
filename; [testing](../operations/testing.md) supplies commands. Add a compact feature
map when the task needs one, not a speculative manual for every component.

## Course Tracker and import

Current entry: `web/src/pages/CourseTrackerPage.tsx`; focused test:
`web/src/pages/CourseTrackerPage.test.tsx`. Schedule parsing lives in
`web/src/lib/courseScheduleImport.ts` and its adjacent test. Course Engine and
template-loader work are protected on their owner branch; these existing paths do
not imply the new engine is integrated. Questions import follows the
[questions contract](questions.md), not the schedule parser.

## Settings and analysis

Settings checks start at `web/src/components/shell/SettingsModal.test.tsx`.
Analysis changes must first resolve the Course Engine/Decode ownership overlap in
the registry. Do not create parallel question-attempt or assignment stores.
