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
| Accounts/restore/sharing | [Accounts contract](../architecture/accounts-sync-v1.md) | `lib/account/`, `lib/sync/` |
| Application/pathway datasets | [School data](../APPLICATION-SCHOOL-DATASET.md), [pathway data](../APPLICATION-PATHWAY-DATASETS.md) | `lib/applicationChecker.ts`, `web/scripts/` from repository root |
| Cinematics and updates | [Cinematics](../CINEMATICS.md), [update policy](../UPDATE-POLICY.md) | `web/public/cinematics/`, `lib/webUpdates.ts` |

Source paths above are relative to `web/src/` unless qualified. Locate nearby tests by
filename; [testing](../operations/testing.md) supplies commands. Add a compact feature
map when the task needs one, not a speculative manual for every component.
