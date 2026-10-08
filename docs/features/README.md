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
| Questions with tables, images and equations in order; the import package; the DOCX template | [Question content](question-content.md) | `lib/question-content/`, `fixtures/qbank/` from repository root |
| Targets, timers, study accounting | [Productivity](productivity.md) | `pages/ProductivityPage.tsx`, `lib/pomodoro.ts` |
| Soundscapes, focus media, media pipeline | [Soundscapes](soundscapes.md) | `pages/SoundscapesPage.tsx`, `lib/soundscapes/`, `lib/media/` |
| Dashboard widgets/next action | [Widget contract](../DASHBOARD-WIDGET-ARCHITECTURE.md), [brief evidence](../COMMAND-BRIEF-EVIDENCE.md) | `pages/DashboardPage.tsx`, `lib/dashboardWidgets.ts`, `lib/commandBrief.ts` |
| Courses, tracker, schedule import | [Course design proposal](../COURSE-CENTRAL-ARCHITECTURE.md), not proof of live integrations | `pages/CoursesPage.tsx`, `pages/CourseTrackerPage.tsx`, `lib/courseScheduleImport.ts` |
| Course templates, file mapping, patterns, review | [Course engine and learning intelligence](course-engine.md) | `lib/course-engine/`, `lib/learning-intelligence/`, `components/questions/AnalysisPanel.tsx` |
| What a source teaches about a question; source tracing | [Decode](decode.md) | `lib/decode/` |
| Journal | [Notebook contract](../JOURNAL-NOTEBOOK-ARCHITECTURE.md) | `pages/JournalPage.tsx`, `lib/journalNotebook.ts`, `lib/journalExtras.ts` |
| Anki | Existing code/tests; [AI boundary](../architecture/backend.md) if generation changes | `pages/AnkiLabPage.tsx`, `components/anki/`, `lib/ankiCards.ts`, `lib/ankiConnect.ts` |
| Settings/preferences | [Frontend lifecycle](../architecture/frontend.md), [data model](../architecture/data-model.md) | `components/shell/SettingsModal.tsx`, `SettingsSections.tsx` |
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
template-loader work are integrated here; their canonical contract is
[Course Engine](course-engine.md). Cleanup remains protected by the registry. Questions import follows the
[questions contract](questions.md), not the schedule parser.

## Settings and analysis

Settings checks start at `web/src/components/shell/SettingsModal.test.tsx`.
Analysis uses the integrated Course Engine, and source analysis follows the
[Decode contract](decode.md). The older a33a01e prototype remains preserved and has been
ported by intent; nothing more is taken from it.
Check the registry and do not create parallel question-attempt or assignment stores.
