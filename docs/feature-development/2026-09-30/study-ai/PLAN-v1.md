# Wave 2 · Study: course schedule, Q-bank generation, flashcards, Tutor mode (PLAN v1)

Branch `feat/wave2-study-ai`, cut from `main` after Wave 1.1. Owner: Claude (engine, prompts, review UI) with Codex (ExamRunner / ExamSimulator mounts). Sources: JD's Wave 2 go-ahead (after-setup G), IDEAS-4.md (I4-01), docs/UNIVERSAL-QUESTION-IMPORT-ENGINE.md, MANIFEST section D.

## Goal

From a lecture to good questions and cards, with the student in control of accuracy: nothing generated counts until it is reviewed, and tutoring teaches instead of giving answers away.

## Scope (v1)

0. **Course schedule by cohort (Ideas 4, I4-03..I4-06), first because it needs no AI.**
   - Import asks the cohort (A: Curie, Galen, Taylor; B: Hippocrates, Metrodora; C: Blackwell, Fleming; D: McIndoe, Peabody), in the setup style on the shared Choice primitives (I4-04).
   - Reads SGU's Outlook "Weekly Agenda Style" PDF exports: one week per page, two day-columns side by side (split by x position, not by text), the cohort legend printed on every page. Event lines follow `<start> - <end> <tags>: <course> <kind> <n>[ - <title>] (<room>)`; tags are one or more of A-D, `ABCD`, or `ITI ABCD`; kinds include numbered lectures, flipped classrooms, `SG` small groups, `IMCQ`, orientation; deadline-only lines carry a single time (for example an ExamSoft quiz closing at 11:55 pm). Keep only the chosen cohort's events plus shared ones. Fixture: a synthetic PDF in the same layout (JD's real schedule never enters the repository).
   - Separate from Course Tracker: this is "what is on your plate" (exams, small groups, iMCQs, eSOFTs, OSCE/OSPE, SOAP notes). Download as .ics (I4-05); the calendar feeds Up Next and exam countdowns.
   - Skip tracker, optional (I4-06): allowances per kind (for example 31 lectures, 10 small groups, 3 eSOFTs, 6 iMCQs), a quiet remaining count where the schedule shows those sessions.


1. **Generation pipeline.** Lecture or file in -> AXOM reads the material -> recommends a sensible card and question count and depth -> generates basic and cloze cards (image occlusion where the source has labelled images) and exam-style questions with explanations.
2. **Verification built in.** Every generated item lands in a review queue with its source excerpt; the student accepts, edits or rejects; unreviewed items never enter scores or schedules. Medical content is labelled AI-generated until reviewed.
3. **Tutor mode AI (I4-01).** A `tutor` feature on the existing AI proxy: explain reasoning, why an answer is wrong, compare alternatives, a four-rung hint ladder (nudge, concept, eliminate one, full reasoning) where the answer needs an explicit "Show me", every reply grounded in the stem, choices, explanation and linked source.
4. **Decks.** AXOM native deck, plus honest Anki export (never advertise Anki as complete before it is).
5. **Exam UIs.** Keep an original AXOM identity for UWorld-, AMBOSS-, Examplify- and Step-style modes; no pixel copies.

## Not in v1

Live Anki sync beyond export; paid model calls without JD's approval (build against recorded fixtures first).

## Verification

verify:all; golden-file tests for generation parsing and the hint ladder (no answer before "Show me"); review-queue e2e (generate -> review -> only accepted items appear in Question Bank); cost guard: generation requires an explicit button per batch.

## Coordination

ExamRunner, ExamSimulator and TutorUtilityDock are Codex's: Claude ships the tutor panel and engine, Codex mounts it. The AI proxy (api/ai.ts) gains one feature id; secrets stay server-side.

## Open decisions for JD

- Which model/provider pays for generation and tutoring, and a per-day budget.
- Whether generated questions may be shared between users later (licensing of source lectures).
