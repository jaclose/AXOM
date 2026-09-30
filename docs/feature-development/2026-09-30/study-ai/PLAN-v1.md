# Wave 2 · Study AI: Q-bank generation, flashcards, Tutor mode (PLAN v1)

Branch `feat/wave2-study-ai`, cut from `main` after Wave 1.1. Owner: Claude (engine, prompts, review UI) with Codex (ExamRunner / ExamSimulator mounts). Sources: JD's Wave 2 go-ahead (after-setup G), IDEAS-4.md (I4-01), docs/UNIVERSAL-QUESTION-IMPORT-ENGINE.md, MANIFEST section D.

## Goal

From a lecture to good questions and cards, with the student in control of accuracy: nothing generated counts until it is reviewed, and tutoring teaches instead of giving answers away.

## Scope (v1)

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
