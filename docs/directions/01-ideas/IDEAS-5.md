# Ideas 5 (verbatim)

Notes JD sent on 2026-09-30 (evening). Never edit the quoted text; index entries live in INDEX.md as `I5-nn`.

One redaction, marked in place: the worked example in JD's mapping note quoted a question, its choices and its explanation from a private course quiz. The repository is public, so that text is replaced with placeholders. The structure of the example is unchanged.

## "Ideas 5 so far"

````
Ideas 5:


elegant sound when the locked in thing pops up.

Are you lcoked in? I am locked out as an option with the tired face emojoi


mapping of paste for gpt:
For AXOM mapping, use this exact field logic so there’s no ambiguity:

| AXOM field | Map from my output | What it contains |
|---|---|---|
| **Question / Stem** | Everything after `Question X` and before `A.` | Full clinical vignette + question |
| **Choice A** | `A.` | First answer option |
| **Choice B** | `B.` | Second answer option |
| **Choice C** | `C.` | Third answer option |
| **Choice D** | `D.` | Fourth answer option |
| **Choice E** | `E.` | Fifth answer option |
| **Choice F/G/H** | `F.` / `G.` / `H.` when present | Extra answer options |
| **Correct Answer** | `Answer:` | **Letter only**: `A`, `B`, `C`, etc. |
| **Explanation** | `Explanation:` | AXOM answer explanation |
| **Review / Tags** | `Review:` | Topic labels / source metadata |
| **Image / Attachment** | `Attachment:` | Associated source image filename |
| **Question Number** | `Question X` | Original ExamSoft question number |
| **Source** | Set manually | `Examsoft Quiz 4`, `5`, `6`, or `7` |

### Most important mapping rule

For each item:

```text
Question 17
[STEM]

A. ...
B. ...
C. ...
D. ...
E. ...

Answer: D
Explanation: ...
Review: ...
Attachment: image.png
```

Map it as:

```text
Question Number → 17

Question / Stem →
[STEM ONLY]

Choices →
A → ...
B → ...
C → ...
D → ...
E → ...

Correct Answer →
D

Explanation →
[everything after "Explanation:"]

Review / Tags →
[everything after "Review:"]

Attachment →
image.png
```

### Source mapping

Also keep the provenance clear:

```text
Examsoft Quiz 4
Source: NCRS Examsoft Quiz 4
Questions: 1–25

Examsoft Quiz 5
Source: NCRS Examsoft Quiz 5
Questions: 1–35

Examsoft Quiz 6
Source: NCRS Examsoft Quiz 6
Questions: 1–20

Examsoft Quiz 7
Source: NCRS Examsoft Quiz 7
Questions: 1–35
```

And critically:

```text
WITHOUT ANSWERS PDF
→ Question stem
→ Answer choices
→ Original formatting/content

WITH ANSWERS PDF
→ Correct-answer mapping ONLY

My generated content
→ Explanation
→ Review / tags
```

So AXOM should **not interpret the ✓ symbol itself**. I already converted the checkmark into:

```text
Answer: C
```

That `C` is what should map to **Correct Answer**.

For the two questionable source items, preserve the warning rather than treating them like normal verified answers:

```text
Quiz 4 Q17
Correct Answer from source: D
Status: SOURCE-KEY FLAG
```

```text
Quiz 6 Q12
Correct Answer: UNRESOLVED
Source marks: A and D
Status: SOURCE-KEY CONFLICT
```

For Q12 specifically, **do not map either A or D as a normal single correct answer until you manually resolve it.**

A clean AXOM confirmation screen should therefore look roughly like:

```text
SOURCE
Examsoft Quiz 7

QUESTION NUMBER
29

QUESTION
[question stem omitted: private course material]

ANSWER CHOICES
A  [choice omitted]
B  [choice omitted]
C  [choice omitted]
D  [choice omitted]
E  [choice omitted]

CORRECT ANSWER
C

EXPLANATION
[explanation omitted: private course material]

TAGS / REVIEW
[three short topic tags, one per line, omitted]

ATTACHMENT
None
```

That is the mapping I intended for all **115 questions**.








Also mapping and import of questions
````

## Mid-turn notes (2026-09-30, verbatim)

```
assigning sounds to things doesnt work - renaming doesnt work either - make sure this works properly
```
(Screenshot: Soundscapes > Your sounds on axom.info. Six of JD's own tracks; the "Where it lives" menu open on one of them with Your sounds ticked and 40 Hz Gamma highlighted.)

```
Sphere and animated circle should adjust to the colors of the background and needs to be better centered and fit the vibe and sound activated and beautiful and elegant
```
(Two screenshots: the Soundscapes hero with a blue smoke ring over a dark scene, and the fullscreen view where a thin ring sits low and off centre over a blue and orange light-streak scene.)

```
Make sure to report to me of new branches created and how many chnages are made and whent o combine and publish branches
```

```
Use the new pipeline we developed then take a look at the subsequent codex workflow:
```
(Followed by Codex's status on soundscape and Spotify persistence in the Ideas 2 worktree, and JD's strategic-checkpoint prompt: research, reassess, choose, execute, verify, improve, ship.)

(Screenshot, no words: Question Bank > Import Center on axom.info. "Examsoft Quiz 4 (With Answers).pdf" parsed into one question marked Invalid. The stem begins with the labels SOURCE:, QUESTION_NUMBER: and STEM:; "5 choices, answer missing, explanation present".)

```
Need to work on the proper examsoft UI as well as the amboss - The uworld is pretty good - but I need carbon copy examplify and examsoft and (amboss can be deffered) or removed.
also if you get. a question wrong - have it mark and X instyead of the checkmark - and continue working on making the questions easy to navigate and use
```

```
work on image display to be integrated soon and a full working import system please
```

```
also time spent is not correct when answered
```

## Work order of 2026-10-01 (verbatim)

JD's instructions for the checkpoint after Wave 1.3, sent on 2026-10-01. It restates some of the notes above and adds requirements for the exam simulator, the navigator, import robustness, images, verification and the production upload failure. Indexed as `I5-16` to `I5-33`.

````
Continue from the current AXOM repository state, not from the old Wave 1.3 branch table.

The Wave 1.3 checkpoint is useful historical context, but it is stale. Reconstruct current reality first from:

- `/Users/jd/Developer/AXOM-coordination/BOARD.md`
- `docs/directions/`
- all active worktrees
- `git status`
- `git log --oneline --graph --decorate --all`
- current `main` vs `origin/main`
- current branch ownership and overlap

The newer coordination state is:

- Claude owns Ideas 1 + 3 unless `BOARD.md` now says otherwise.
- Codex owns Ideas 2.
- `feat/ideas3-staging` had six Claude commits, the full suite was green, browser verification had been done, and nothing had yet been merged/pushed at that checkpoint.
- Schema stays at 34 unless explicitly coordinated.
- Small reversible commits.
- Do not casually edit overlapping files.
- `BOARD.md` is authoritative for ownership.
- Never treat an old pasted branch status as newer than the actual repo/BOARD.
- Do not destroy or discard untracked/user files.
- No `git clean`, `reset --hard`, force-push, or equivalent destructive shortcuts.
- JD is the final publisher unless a later explicit instruction changed that.

## 1. First reconcile what actually landed

Audit current `main` and the active feature branches against the old Wave 1.3 claims.

Specifically determine whether these are currently present, complete, tested, and still functioning:

- mapped multi-question paste import
- source/question-number preservation
- `Review:` → tags/review mapping
- answer-key conflict handling
- question attachments/images
- image display under the stem
- Your Sounds rename
- Your Sounds preset assignment
- soundscape sphere/orb improvements
- wrong-answer X instead of checkmark
- accurate per-question elapsed time
- Locked In appearance chime
- `I am locked out 😫`
- Daily Check-In rebuild
- persistent Spotify/media work
- account/sync work

Do not rewrite any of these simply because they appeared in the old TODO. Test current behavior first.

If later merges regressed any of them, repair the regression at the correct architectural layer and add a regression test.

## 2. Production regression gets priority if it still exists

The newer thread found production producing repeated Supabase HTTP 500s from:

`rpc/push_workspace_revision`

There were dozens of repeated failures in one production session.

Before integrating another large feature wave, check whether this has already been fixed.

If not:

- reproduce it
- identify the actual RPC/database/client mismatch
- inspect relevant migration/RLS/function permissions
- eliminate pathological retry behavior
- make failure bounded and observable
- add regression coverage
- verify local behavior
- verify production after the fix when deployment is authorized

Do not paper over a server failure with endless client retries.

If it is already fixed, document the actual fixing commit and move on.

## 3. Finish Claude-owned staged work before creating more branch sprawl

Inspect `feat/ideas3-staging`.

If the six-commit Ideas 1+3 batch is still coherent and 100% complete:

1. update it against current main safely
2. resolve only legitimate conflicts
3. run the complete AXOM gate
4. browser-test the actual affected UX
5. update Directions
6. prepare it as the next controlled wave

Do not merge an unfinished branch merely because most tests pass.

Do not duplicate Codex's Ideas 2 work.

If a required file is Codex-owned or being modified concurrently, coordinate through `BOARD.md`.

## 4. Ideas 5: formally bank these requirements now

Create/update Ideas 5 in `docs/directions/01-ideas/` and index every item so none of this disappears into chat history.

### Exam simulator

Highest priority is now:

**Examplify / ExamSoft fidelity.**

The existing UWorld mode is already reasonably good.

AMBOSS can be deferred or removed from the immediate wave.

I want the Examplify/ExamSoft experience to be extremely faithful in:

- overall layout
- question pane proportions
- typography hierarchy
- answer-choice spacing
- selected-answer state
- strikeout behavior if applicable
- flagging
- navigation
- question-number navigator
- progress state
- timer placement
- controls
- review state
- image positioning
- modal behavior
- keyboard behavior where appropriate
- responsive behavior

Match interaction/layout/color behavior, but do not copy their proprietary logo/artwork/assets.

Do not implement this as a completely separate exam engine.

The architecture should remain:

**shared Question Engine**
→ **behavior/exam profile**
→ **renderer/theme/layout**

Examplify/ExamSoft should be a high-fidelity profile over the shared engine wherever technically reasonable.

That prevents four simulators from diverging internally.

### Navigator

The exam question navigator needs real work.

It should make it effortless to:

- jump to any question
- understand answered/unanswered state
- see flagged questions
- see current question
- distinguish correct/incorrect during review
- understand progress at a glance

Do not clutter the actual testing state with information a real exam would not expose.

Testing state and review state must remain distinct.

### Wrong-answer state

When the learner answers incorrectly:

- show an **X**
- do not show a checkmark on the learner's incorrect selection
- separately indicate the correct answer in review/explanation mode

Verify every exam renderer/profile follows this consistently.

### Time spent

Re-audit timing.

Per-question time must represent actual active time spent on that question, including navigation away/back where the intended model requires it.

It must not show `00:00` simply because the question was just submitted.

Define timing semantics in one shared place and test them.

## 5. Import system must become production-grade

The parser should continue supporting the explicit AXOM mapping format rather than relying on visual checkmarks.

Canonical mapping:

- `Question X` → original question number
- stem → everything after `Question X` and before `A.`
- `A.` ... `H.` → choices
- `Answer:` → correct answer letter only
- `Explanation:` → explanation
- `Review:` → tags/review
- `Attachment:` → associated image
- source → assigned quiz/source metadata

The importer must preserve quiz provenance.

Examples:

- NCRS Examsoft Quiz 4
- NCRS Examsoft Quiz 5
- NCRS Examsoft Quiz 6
- NCRS Examsoft Quiz 7

Do not infer correctness from `✓`.

The transformed `Answer: C`-style field is authoritative unless the source is explicitly flagged.

Preserve known source-key problems:

- Quiz 4 Q17: source-key flag, source says D
- Quiz 6 Q12: unresolved; source marks A and D

For Quiz 6 Q12, do **not** silently select either answer.

The review/import UI should visibly surface source conflicts instead of normalizing them away.

### Import robustness

Test:

- one question
- 25+ questions pasted together
- 100+ questions
- variable A-E / A-H choices
- blank lines
- multiline stems
- multiline explanations
- multiline review/tags
- missing attachments
- attachments supplied in a different order
- duplicate filenames
- duplicate question numbers across different sources
- malformed records
- unresolved answers
- source-key flags

A malformed record should not cause the entire paste to become one giant question.

Give the user a clear review screen before commit/import.

## 6. Images

Continue the image pipeline.

Imported question images should:

- map deterministically from `Attachment:`
- preview during import review
- display correctly in the exam
- preserve aspect ratio
- expand/lightbox cleanly when useful
- avoid destroying question layout on mobile or desktop
- support common medical-image shapes and resolutions
- remain associated with the correct question through edits

The old Wave 1.3 limitation was that imported images remained local to the device.

Re-evaluate that limitation architecturally, but do not contaminate account-sync work or introduce large binary blobs into inappropriate database fields.

If cross-device image sync belongs in a later storage/media layer, design the boundary now and log the future work instead of hacking it into the current revision payload.

## 7. Soundscape / orb

Do not redo the orb blindly.

Use the current implementation and visually verify it in the real browser.

Requirements remain:

- properly centered
- true circular geometry where intended
- visually integrated with the current scene
- colors adapt intelligently to the background
- sound-reactive motion
- elegant rather than noisy
- no collisions at desktop/tablet/mobile widths
- reduced-motion support
- good dark/light behavior where applicable

Also explicitly verify the two bugs I reported:

- assigning a custom sound to a preset actually changes what that preset plays
- renaming a custom sound persists reliably

Test reload persistence.

## 8. Locked In

Preserve:

- elegant/quiet sound when Locked In appears
- `I am locked out` option with tired-face treatment

Do not make it obnoxious or gamified to the point of distraction.

Browser-verify the behavior, not unit tests only.

## 9. Use the improved visual workflow

For significant UI work, do not judge quality only from DOM measurements.

Use the actual browser and available visual/browser tooling.

For Examplify specifically, use the reference screenshots/research already gathered in the AXOM workflow. If a reference pack exists in Downloads/repo/docs, locate and use it rather than approximating from memory.

Build reusable visual regression/reference tooling if that materially reduces future guesswork.

The objective is not just “passes tests.” It should look correct.

## 10. Keep Directions authoritative

For every meaningful batch:

- update idea status
- update in-flight status
- record important architectural decisions
- record bugs/root causes
- move genuinely finished items to completed
- leave partial items clearly partial
- capture future work

Do not mark a feature completed because its first implementation exists.

## 11. Branch/wave discipline

Continue the controlled wave workflow I liked.

At the end of every substantial checkpoint, report:

| Branch | Owner | Commits vs main | Files changed | Verification | State | Merge recommendation |
|---|---|---:|---:|---|---|---|

Also report:

- new branches created
- why each was created
- number of commits
- approximate files changed
- what remains on each
- overlap/conflicts
- which branches are ready to combine
- which must stay isolated
- exactly when I should publish/push

If multiple branches are 100% complete and compatible, prepare a controlled integration wave rather than leaving finished branches scattered indefinitely.

Do not merge partial work just to reduce branch count.

## 12. Execution order

Use this order unless current repo evidence exposes a stronger dependency:

1. Reconstruct actual current state + BOARD ownership.
2. Verify whether the production `push_workspace_revision` failure remains.
3. Reconcile and finish Claude's already-staged Ideas 1+3 work.
4. Bank Ideas 5 completely.
5. Audit which Wave 1.3/import/exam fixes survived later merges.
6. Repair regressions.
7. Begin the Examplify/ExamSoft high-fidelity simulator + navigator on the appropriate non-conflicting branch.
8. Harden import/image behavior alongside the shared question engine.
9. Browser-test all affected flows.
10. Full verification gate.
11. Directions update.
12. Controlled wave integration only when genuinely complete.

Do not spend the turn merely planning. Inspect, execute, test, repair, and commit coherent checkpoints.

At the end, give me the full branch/wave report and explicitly tell me what is ready to combine and what I should publish.
````
