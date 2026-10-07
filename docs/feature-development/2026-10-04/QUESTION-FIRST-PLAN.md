# AXOM: questions first

Date: 2026-10-04. Status: **planning brief retained beneath the product doctrine**. Owner: Codex for this brief; implementation must reconcile the existing study, course, home and cinematic workstreams before edits.

**Hierarchy amendment, 2026-10-04:** the [Learning Intelligence doctrine](../../product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md) defines AXOM. The [Ideas 1–6 reconciliation](../../product/IDEAS-RECONCILIATION-2026-10-04.md) preserves the complete ecosystem, and [Decode implementation](DECODE-IMPLEMENTATION.md) supplies the expanded sequence. This question-first brief is the first wedge: it does not replace shared scope, Term/Module lenses, Tutor depth, personal reasoning/repair or cumulative study. Its original planning validation below remains historical, not evidence for new runtime work.

Source: [JD's Ideas 6](../../directions/01-ideas/IDEAS-6.md) and the accompanying master directive, especially sections 1, 6, 7, 10, 34 and 59. This amendment changes their delivery order and adds the new workflow. It does not reopen completed work or mark anything shipped.

## First workflow beneath the doctrine

**Build the question workflow first.** The first usable outcome is:

Upload sets → review import → assign course/module/week → put questions first → practice → see the same progress in Course Tracker → analyze recurring patterns → save a one-page exam review.

| Order | Deliverable | Exit condition |
|---|---|---|
| P0 | Verify and repair the question path's data integrity | Imported stems, choices, keys, evidence and set membership survive reload and backup/restore; attempts are counted once. Resolve confirmed data-loss or account blockers before proceeding. |
| P1a | Questions first + course/week linking | A student can prioritize questions, assign a set, launch it from the course week, answer, reload, and see consistent progress in both places. |
| P1b | AI question-pattern analysis | Analyze selected uploaded sets, show repeat themes and question styles with valid source references, then let the student review the findings. |
| P1c | One-page pre-exam review | Generate, review, save and print one readable page; surface the saved sheet the day before its exam. |
| Bounded brand slice | Supplied opening cinematic and sonic ident | Integrate the existing seven-second master, synchronized sound and reliable fallbacks when the remaining work is small; do not delay the intelligence engine. |
| Broader roadmap | Decode, Tutor, curriculum and execution depth, then Life OS/ecosystem | Follow the P0/P1/P1.5/P2/P3 order in the doctrine reconciliation; these remain part of the product and are not collectively demoted behind the cinematic. |

The small cinematic slice may be prepared independently once the question slice runs, but it must not delay P1. A general settings redesign, full schedule importer, new exam engine, journal rebuild, generated question bank or new AI infrastructure is not a prerequisite for this workflow. Existing exam and tutor modes remain the practice surfaces; enrich them with the shared source/analysis model rather than creating a separate engine.

## 1. Put the student's chosen activity first

The subsequent doctrine and blueprint (pp34–35) confirm both question-first development and a saved study priority such as **Questions first**, with reasons and user override. This is not a request to force every student into one method.

- Offer a simple activity priority using the existing study preferences. When Questions first is selected, put the next eligible question block at the top of the study recommendations with a short reason and a direct Start action.
- Apply it to the active course/module/week or explicitly selected exam scope. Prefer an unfinished block before starting another; do not change the order of questions inside a selected block.
- Preserve manual choices and pinned work. Let the student change the priority or choose a different activity now. Do not reshuffle cards during interaction or silently rewrite a customized dashboard.
- Empty state: offer Import questions or Choose a set. Do not invent a block when the scope has no questions. If all are answered, offer incorrect/flagged review or another activity.
- Saving, refresh and backup/restore retain the preference. Starting a recommendation alone records no completed work.

## 2. Link sets to courses, modules and weeks

- Keep one question library and stable question/set IDs. Assignment creates a relationship, not copied questions or a second progress ledger.
- Reuse the existing course IDs and canonical tracker paths; use `pathUtils.ts` for path matching and week parsing. Sort Week 2 before Week 10. Unknown weeks remain Unassigned, not guessed from upload dates.
- Allow manual assignment immediately. AI may suggest a destination with evidence and uncertainty, but a student confirms it before it changes the course tracker.
- Support mixed sets: a set can cover several weeks/modules, with question-level overrides where needed. Reassigning a set preserves its attempt history; deleting a link does not delete the source questions.
- In each course week, show linked sets, question count, answered count, remaining count and accuracy, plus Start/Resume and Review missed. Derive results from the canonical attempt policy, including repeat attempts, rather than incrementing another counter.
- Unresolved/conflicted keys can contribute to topic coverage, but must be visibly excluded from correctness-based recommendations until resolved. AI never silently changes a supplied answer.
- Bulk assignment is previewed and reversible. No duplicate tracker rows or counts when the same assignment is saved twice. Renames and removals must leave broken links visible and repairable.

## 3. Analyze what the uploaded questions repeatedly test

This feature analyzes existing questions; generating new questions is a separate, later feature.

The student chooses a course/module/exam and one or more uploaded sets, then selects Analyze patterns. Show the included sources and scope before analysis. Keep the original questions, explanations, source keys and import warnings intact.

For each supported pattern, return:

| Finding | Required evidence or behavior |
|---|---|
| Recurring concept/theme | Supporting question IDs, set IDs and source location where available; group by meaning, not just repeated words. |
| What the question asks | Diagnosis, mechanism, investigation, interpretation, treatment, adverse effect or another source-supported task. |
| How it is asked | Typical vignette structure, decisive clue, reasoning sequence and the discriminator between nearby answers. |
| Distractor traps | Explain why each relevant alternative fails and what changed clue would make it fit, only where the supplied material supports this. |
| Frequency | Compute counts in code from validated memberships, not model estimates. Show unique-question numerator/denominator and distribution across sets/sources. |
| Breadth | Topics and question types present across the selected scope; distinguish well-sampled, lightly sampled and unrepresented topics. |
| What to practice | Link the finding to actual questions, showing source frequency separately from the student's missed/slow/flagged history. |

Exact duplicate uploads must not inflate frequency. Likely paraphrase duplicates are shown for review rather than silently removed. Report raw and deduplicated sample sizes. A theme counts once per distinct question; one question may support several themes, so theme percentages need not sum to 100%.

Use wording such as “appears in 8 of 24 distinct uploaded questions across 3 sets.” This is **frequency in the selected material**, not a probability of appearing on the next exam. Do not label something “almost always tested” from an unrepresentative sample. Unless a curriculum or exam blueprint is supplied, unrepresented topics mean missing evidence, not topics that can safely be skipped.

### AI and evidence contract

- Extend `resolveActiveProvider()` and the existing local/cloud provider interfaces. Inspect the current study branch before implementing; do not build another provider selector or revive the older `services/aiClient.ts` path by default.
- Use a real configured provider for semantic analysis. Label mock output as demo; keyword counts are not AI pattern understanding. Manual organization, practice and saved reports remain usable when AI is off.
- Process all selected questions in bounded batches and combine results. Show analyzed/selected counts and partial status; never silently truncate the corpus to a prompt limit.
- Validate structured output, scope membership, source references and quoted evidence. Treat uploaded content as evidence, never as instructions. Reject unsupported findings and put answer/explanation conflicts in a review list.
- Store source revision/content fingerprints, provider/model, prompt version, generation time, analysis scope and review status. Changed questions, deleted sources or changed assignments mark affected reports stale and allow explicit regeneration.
- Imported explanations and AI reasoning remain distinguishable. Every factual teaching claim needs support from supplied content or an explicitly cited source; missing support produces a limitation, not invented medicine.
- Cloud analysis requires an explicit action that makes source transmission clear, with the existing quota/cost controls. No hidden background requests or paid provider activation. Local inference is available through the existing provider when configured.
- Loading, cancel, provider unavailable, quota, invalid output, incomplete batch and retry states retain source data and previous results. Save reviewed findings and sheets locally and include them in JSON export/backup.

## 4. One-page exam review

Generate a focused review for one selected exam/module, based on the chosen sets and reviewed findings. Ask for or use a confirmed exam date; do not infer one from filenames or upload time.

The page contains:

1. Exam/module, covered weeks, source/sample count and last generated date.
2. Highest-frequency supported patterns: **what they ask → decisive clue → reasoning → answer distinction**.
3. Important distractor traps and the student's repeated errors, when attempts exist.
4. A compact breadth checklist and known source conflicts or missing coverage.
5. Compact source references that open the relevant questions in the app.

Prioritize content to fit a single readable A4/Letter page. Do not satisfy one page by shrinking text into illegibility or clipping content. Keep lower-ranked findings in the full analysis, and disclose that the page is a selection. On phones, render a readable scrolling version; the print/export layout is one page.

Save the reviewed page. On the **calendar day before the exam in the student's timezone**, surface that saved sheet in the existing dashboard/Up Next area. This is not “exactly 24 hours before.” Date changes reschedule it; past exams do not generate nagging reminders. A missing date offers Set exam date; a missing sheet offers Generate review. The day-before prompt does not itself launch a billable AI request. Offline, open the last saved version with its date and stale status.

## 5. Opening cinematic: use the supplied masters

The original files remain in `/Users/jd/Developer/AXOM/` and are currently untracked. Media metadata was inspected with `ffprobe`; playback, visual quality, loudness and synchronization have not been tested in this pass.

| Supplied asset | Measured metadata | Intended role |
|---|---|---|
| `AXOM_ident_4K_30p_with_audio.mp4` | 7.000 s; H.264; 3840 × 2160; 30 fps; AAC stereo, 48 kHz; 4,995,052 bytes | Opening-film source with its own audio as the playback clock. |
| `AXOM_Sonic_Ident_7s_48k24.wav` | 7.000 s; PCM signed 24-bit; stereo, 48 kHz; 2,016,044 bytes | Lossless sonic master for production or a future audio-only use. Do not play alongside the MP4. |

Reuse `cinematics.ts`, `startupIntro.ts`, `data/cinematics.json`, the existing poster/import pipeline and Settings > Appearance > Opening film. Keep the masters intact; create separate appropriately sized web/native derivatives and record provenance in the asset manifest.

**Integration trap verified in code:** `scripts/import-cinematic.mjs` currently passes `-an` in both conversion and remux paths; even `--as-is` removes an embedded audio stream. `startupIntro.ts` also sets `muted` and `defaultMuted` to true. A video replacement alone cannot deliver this request's sound.

Preserve audio deliberately for the ident without changing the semantics of other films. Use the MP4's audio instead of a separately timed WAV. Honor sound preferences and browser autoplay restrictions; when audio cannot start with the film, play the muted version, with no delayed chime. A user-initiated preview can test sound from the beginning.

Keep existing opening frequency settings, reduced-motion bypass, click/Escape dismissal, liveness deadline and first-run handoff. A missing file, decode failure, blocked autoplay, offline start or interrupted playback must release the workspace and stop any audio. Verify mute/playback and cleanup in browser and packaged desktop before claiming support.

## Repository findings and implementation seams

Inspected base: `feat/media-pipeline-v1` at `9f29327`. This planning work is isolated in `codex/question-first-plan-2026-10-04`; no app code or media was changed.

| Existing location | Reuse / next inspection |
|---|---|
| `web/src/pages/QuestionWorkspacePage.tsx`, `web/src/lib/questions.ts`, question import/provenance modules | Set selection, stable records, review warnings, source evidence and attempt history. |
| `web/src/pages/CourseTrackerPage.tsx`, `web/src/lib/pathUtils.ts` | Course tree, existing priority field, normalized paths and numeric weeks; inspect current linkage needs before adding fields. |
| `web/src/lib/ai/index.ts`, `types.ts`, `schemas.ts`, `settings.ts` | Provider selection and reviewed structured output; add pattern analysis here. |
| Existing home/recommendation work | Add the saved activity preference to the recommendation policy, not independent ranking code in several views. |
| Existing store, normalization, backup and sync paths | Any new fields are additive and migration-safe; schema changes and shared edits follow the coordination contract. |
| Existing study and Ideas 2 worktrees | Reconcile the study AI plan and course-workflow branch before implementation. The coordination board is older than the current worktree list. |

These are integration seams, not proof that the new behavior exists. Inspect the actual implementation branch before coding, particularly shared `store.ts`, `types.ts`, course tracker, dashboard and exam surfaces. Do not overwrite other workstreams.

## Acceptance and verification

First interactive slice: import a synthetic multi-week set → confirm module/week assignment → choose Questions first → start and answer a block → open the course week → reload → confirm one consistent attempt count. Then add AI patterns and the exam sheet to that working path.

Required cases include Week 2 versus Week 10; mixed-module sets; unassigned questions; duplicate uploads; repeated assignment; a renamed/deleted module; a conflicted key; no attempt history; all questions completed; provider off; failed/canceled/partial analysis; nonexistent AI source references; stale reports; an exam-date change; timezone midnight; offline reopening; and backup/restore without duplicate progress.

For the sheet, inspect the exported artifact at A4 and Letter and assert one page, no clipped text, readable type and valid references. For AI, use recorded/synthetic fixtures for deterministic integration tests, plus an actual configured-provider run before claiming live AI verification. No private course files enter public fixtures.

For implemented web changes, run `cd web && npm run verify:all`; inspect 1440 × 900 and 390 × 844, keyboard/touch paths, light/dark, reduced motion, all new controls, and console output. Inspect and exercise the cinematic separately, including audio-denied and failure paths. Verify native claims in the packaged app.

The original planning pass only changed documentation. Its checks were `npm run directions:check`, local-link/ID checks and `git diff --check`; those do not establish runtime or AI correctness. Current Decode work reports its own verification separately.

Planning validation, 2026-10-04: directions check passed with 192 indexed ideas and 60 verified commit references; all 18 local Markdown links across the five changed documents resolve; I6-01 through I6-06 occur once each as PLANNED; whitespace and diff checks passed. The original checkout still has only the two supplied untracked media files. App build, browser, AI and playback checks were not run because this pass implements no runtime changes. The five documentation files are uncommitted and unpushed.
