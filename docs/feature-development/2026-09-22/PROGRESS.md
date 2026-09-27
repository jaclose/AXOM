# Progress report

## Checkpoint: first feature increment implemented and verified locally

Date: September 22, 2026.

The owner requested renewed development of Application Checker, leaderboards and onboarding, preceded by recovery of the planning chat and four working documents. Discovery and the initial versions of FEATURES.md, PLAN.md, DEFERRED.md and this report were completed before production edits. This report now records the implemented first increment, not completion of the entire feature vision.

## Completed discovery

- Located the relevant planning discussions; links and recovered decisions are in FEATURES.md.
- Verified the continuation worktree and preserved the thirteen existing personalization paths. Starting HEAD `ba2b66d3da657ae82bc0ab11dcaa46dd7b503349`; no staged changes.
- Opened the continuation worktree with the VS Code command-line launcher.
- Located the real Phase 1 school research outside the repository. Direct CSV inspection found 294 roster rows and 60 admissions captures, rather than the stale 15-record coverage summary.
- Identified mixed field-level evidence and heuristic estimates that must not be presented as verified admissions requirements.
- Confirmed that the original leaderboard used fictional cohort entries and onboarding omitted supported methods from its save path; both were addressed below.

## Implementation status

| Workstream | Implemented and checked | Boundary |
| --- | --- | --- |
| Application Checker | Actual school research; search; program/status/research filters; saved schools; dated sources; persistent review checkmarks; incremental evidence conflict handling | Research preparation, not automatic eligibility or admissions probability |
| Leaderboards | Real current-week totals and personal standings over eight completed weeks; study-day/card/time measures; deterministic ties; reload behavior | No shared cohorts, fictional competitors, publication or Anki add-on connection |
| Onboarding | Eleven supported methods; optional usage/timing follow-ups; exact original text; resumable draft; editable Settings; preserved defaults and disabled-method descriptions | No automatic interpretation or inferred settings |
| Persistence | Optional additive profile fields; normalization; migration compatibility; portable backup parsing and merge protection | Existing account/save architecture; live cloud or cross-device operation not verified here |
| Browser experience | New flows tested in Chrome at desktop, tablet and mobile sizes; selected-control contrast repaired | Not cross-browser certification or a full AXOM redesign |

## Application research: what the numbers mean

- 294 original roster rows become **292 canonical school records**. The source explicitly marks `S0235` and `S0261` noncanonical; the adapter reports their exclusion without modifying originals.
- **60 schools** have collected research, containing **1,430 displayed fields**: 334 historical official-page captures and 1,096 unverified captures.
- Record states are **58 incomplete, 232 unknown, 2 conflicting, zero verified**. No archived collection label is promoted to a fresh verification today.
- Captures are dated July 19–22, 2026. Source dates/status are visible. A learner's checkmark means “I reviewed this evidence,” not “I satisfy the requirement.” Changed value, date, URL or capture status reopens a check.
- Field-level evidence is used only when its captured value matches the current row. A mismatch is downgraded to unverified evidence instead of borrowing an older official label.
- Heuristic competitiveness estimates, personal contacts, third-party estimated fields, financial-aid/accreditation claims and unrelated conflicts are excluded from the shipped asset.
- Records render in batches of 24; searching/filtering uses the complete dataset. The JSON is fetched separately by the checker, not embedded in the main application JavaScript.
- Dataset size: **653,246 raw bytes / 34,057 gzip bytes**. The validator's zero warnings confirms contract/provenance shape, not current accuracy of school policy.

Reproduce the deterministic adapter from the repository root without modifying the original CSVs:

```sh
python3 web/scripts/build-application-research.py "/Users/jd/Downloads/Scraper - GPT/Med_School_God_File_Phase1/csv_tables" /tmp/axom-application-schools.json
npm run schools:validate -- /tmp/axom-application-schools.json
```

Review the regenerated output before replacing the published dataset. Synthetic adapter tests cover quoted/newline source text, excluded duplicate rows, third-party estimates and mismatched field provenance.

## Findings repaired

| Area | Finding | Resolution / evidence |
| --- | --- | --- |
| Onboarding | Saving a rerun reconstructed a smaller method list and lost timings, labels and item-kind defaults | Preserve the complete normalized workflow; component test resumes Noji/Quizlet/Anki and confirms original text and overrides |
| Settings | Toggling a method reconstructed the list without existing metadata | Shared toggle preserves descriptions, labels and timing, including when disabled |
| Original text | Normalization silently truncated custom context at 500 characters | Keep original text, whitespace and line breaks; long-text component, reload and backup tests |
| Backup/restore | Portable import omitted study workflow and initially omitted application research | Explicit normalization in backup parsing; round-trip and merge tests; unchecked current research is not resurrected by an older merge |
| Evidence integrity | Stale field provenance could mark a changed value as officially captured | Require captured-value match; downgrade mismatch and test with a realistic synthetic CSV fixture |
| Standings | Mock cohort entries looked like live rankings | Remove fictional participants; calculate only the learner's recorded activity; exclude partial/future/invalid activity as appropriate |
| Selected controls | Saved-school and standings controls had weak light-theme selected contrast | Scoped theme-aware styles; inspected desktop/tablet/mobile screenshots |
| Setup confirmation | Clearing every method could be summarized as “No changes” | Show “No methods selected”; focused test verifies disabling does not erase descriptions |

Test setup was also corrected to respect the existing promise dialog/mobile menu, wait for responsive navigation to settle, and dismiss reminders through real controls before visual review. These were test-harness corrections, not hidden product repairs. An early full-unit run hit an existing short App test timeout under higher concurrency; the full suite passed with two workers, without weakening assertions or increasing that test's timeout.

## Fresh validation

Commands below run in `web/` unless noted. All results are from this increment.

| Check | Result | Exact count / notes |
| --- | --- | --- |
| Full unit/component suite | PASS | `npm test -- --maxWorkers=2`: **1,225 tests, 140 files**, final run 43.86 seconds |
| Focused feature coverage | PASS | Research adapter, evidence normalization, revisions/merges, backup round-trip, ranking periods/ties, onboarding rerun/draft and Settings preservation are included in the full green suite |
| Full browser suite | PASS | **17/17 distinct Chrome journeys**, 2.1 minutes; includes Question Bank import/Tutor persistence, account local safety, existing personalization and navigation |
| Final affected browser rerun | PASS | **3/3 new feature journeys**, 16.6 seconds, after the final onboarding-summary correction; these are repeats, not three additional distinct full-suite cases |
| Typecheck | PASS | `npm run typecheck` |
| Lint | PASS | `npm run lint` |
| Production build | PASS | `npm run build`; includes Daily Games bundle-isolation check |
| School dataset | PASS | Root: `npm run schools:validate -- web/public/application-schools.json`; **292 valid, 0 rejected, 0 errors, 0 warnings, 0 duplicate IDs/names, 0 malformed URLs** |
| Runtime / responsive | PASS in tested flows | Research and personal standings: **1440×900, 768×900, 430×880, 390×844**; onboarding and editable Settings: **390×844** |
| Console / runtime exceptions | PASS in tested scope | No captured console errors in the research journey; no uncaught page errors in the three new journeys; direct preview inspection also returned no errors |
| Diff checks | PASS | `git diff --check` and `git diff --cached --check`; nothing staged |
| Worktree isolation | PASS | Main and Question Import worktrees remain clean; continuation HEAD unchanged |

The installed Chrome channel was used because a bundled Playwright Chromium executable was unavailable. The temporary configuration `/tmp/axom-features-playwright.config.ts` extends the repository configuration, sets `use.channel` to `chrome`, uses the existing server, and sends review artifacts to `/tmp/axom-features-e2e-chrome`.

```sh
npm run test:e2e -- --config /tmp/axom-features-playwright.config.ts
npm run test:e2e -- --config /tmp/axom-features-playwright.config.ts e2e/feature-development.spec.ts
```

Nine new-flow screenshots were inspected across the specified sizes; they remain temporary, outside Git. The checker can show very long original policy text without page overflow. Standings have readable selected states and real week labels. Mobile onboarding retains accessible follow-ups and a reachable Continue control. Browser fixtures use isolated contexts and synthetic study logs, not the owner's records. Original school source files were read only.

The final build's main App chunk is **591,528 raw bytes / 170,513 gzip bytes** using the repository bundle checker. Vite's reported compression differs slightly. The separately loaded Application Checker route is about 16.35 kB raw / 5.45 kB gzip. No base-versus-feature bundle comparison was performed; the existing large-chunk warning remains. No dependency packages or lockfiles changed, and this run does not claim a fresh dependency-security review.

## Current repository state and exact scope

- Worktree: `/Users/jd/Developer/AXOM-accounts-v1`.
- Branch: `feat/accounts-sync-v1`.
- Starting and current HEAD: `ba2b66d3da657ae82bc0ab11dcaa46dd7b503349`.
- **26 tracked modified paths; 16 untracked files; zero staged paths.** Combined tracked diff: **638 insertions / 246 deletions**. Untracked file contents are not included in that Git diff stat.
- **42 combined worktree paths**, including the thirteen pre-existing personalization paths. This task touches **31 paths**, including two intentional overlaps (`studyPreferences.ts` and its test). It is not a clean, single-feature staged commit.
- Main: `main`, HEAD `29aded0263f865fcf84703ad97fbcf3d678f17ad`, clean.
- Question Import: `feat/question-import-reliability-v1`, HEAD `4e5e81d6110d65098fea7a96cd63d0e9f8f88d38`, clean.

Tracked paths touched in this increment (18):

```text
web/e2e/beta-finishing-surfaces.spec.ts
web/src/components/shell/OnboardingWizard.test.tsx
web/src/components/shell/OnboardingWizard.tsx
web/src/components/shell/SettingsModal.test.tsx
web/src/components/shell/SettingsModal.tsx
web/src/components/shell/SidebarAccessibility.test.tsx
web/src/components/shell/nav.ts
web/src/lib/applicationSchools.ts
web/src/lib/backup.test.ts
web/src/lib/backup.ts
web/src/lib/onboardingProgress.ts
web/src/lib/store.ts
web/src/lib/studyPreferences.test.ts
web/src/lib/studyPreferences.ts
web/src/lib/types.ts
web/src/pages/ApplicationCheckerPage.tsx
web/src/pages/LeaderboardsPage.tsx
web/src/styles/pages.css
```

New files from this increment (13):

```text
docs/feature-development/2026-09-22/DEFERRED.md
docs/feature-development/2026-09-22/FEATURES.md
docs/feature-development/2026-09-22/PLAN.md
docs/feature-development/2026-09-22/PROGRESS.md
web/e2e/feature-development.spec.ts
web/public/application-schools.json
web/scripts/build-application-research.py
web/src/components/shell/StudyMethodFollowUps.tsx
web/src/lib/applicationResearch.test.ts
web/src/lib/applicationResearch.ts
web/src/lib/applicationResearchAdapter.test.ts
web/src/lib/leaderboards.test.ts
web/src/lib/leaderboards.ts
```

Prior work preserved (13; the two studyPreferences files also receive scoped changes above):

```text
web/src/components/brief/CommandBrief.test.tsx
web/src/components/brief/CommandBrief.tsx
web/src/lib/commandBrief.test.ts
web/src/lib/commandBrief.ts
web/src/lib/recommendationFactors.test.ts
web/src/lib/recommendationFactors.ts
web/src/lib/studyPreferences.test.ts
web/src/lib/studyPreferences.ts
web/src/pages/CourseTrackerPage.test.tsx
web/src/pages/CourseTrackerPage.tsx
web/e2e/personalized-recommendations.spec.ts
web/src/lib/studyProgress.test.ts
web/src/lib/studyProgress.ts
```

## Manual test handoff

Development server is running at **http://127.0.0.1:5187/** from the continuation worktree. VS Code is opened on that worktree and the working documents.

1. Open Application Checker; filter to collected research and search a school.
2. Save it, expand available details, inspect the dated source, and check a reviewed field. Refresh; confirm the saved school and review persist. Uncheck it to reverse the review.
3. Open Leaderboards. Your own logged current-week totals appear; only completed weeks with activity enter personal standings. Switch study days/cards/time. An empty history is intentionally empty, not demo data.
4. In Settings → Personalization, select the methods you actually use. Enter method-specific timing and usage, including Noji or Quizlet. Close/reopen Settings and refresh.
5. Optionally rerun onboarding from Settings. Review the selected methods before finishing; existing item-kind defaults and original descriptions remain intact. Cancel if you do not want to apply changes.
6. Use the existing portable-save workflow when manually testing restore; do not overwrite the only copy of your real workspace. Automated backup tests already exercise the new fields in isolated data.

## Remaining limitations / next increment

See DEFERRED.md for the full list. The most important boundaries are current official source refresh and explicit learner-profile comparisons for the checker; authenticated, private, opt-in cohorts for shared leaderboards; and confirmed deterministic interpretation for onboarding. Safari/Firefox, live cross-device sync and production deployment remain unverified. Existing light-theme notification contrast and broad bundle optimization are separate follow-up work.

PLAN.md orders the next steps. This checkpoint is ready for Product Owner testing and continued scoped implementation, not a claim that shared rankings or automated admissions checking are complete.

## Change control

**No commit, push or deployment performed.** No changes to source workbooks, Product Memory, governance or dependencies. No new database schema version or destructive migration. The generated school JSON is an intentional reviewed application asset; build output, screenshots and temporary browser configuration are not staged. Any future commit must distinguish this increment from the preserved personalization work and receive authorization.
