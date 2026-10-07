# Directions

The one place that says what AXOM should become, what is done, and what comes next, so nobody works from guesswork. JD, Claude and Codex all start here.

**Current priority, 2026-10-04:** [Learning Intelligence doctrine](../product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md) governs the [complete Ideas 1–6 reconciliation and roadmap](../product/IDEAS-RECONCILIATION-2026-10-04.md). [AXOM Decode](../feature-development/2026-10-04/DECODE-IMPLEMENTATION.md) links term, module, week, lecture, question pattern, personal error and repair. [Questions first](../feature-development/2026-10-04/QUESTION-FIRST-PLAN.md) is the first implementation wedge, not the product endpoint. Current work includes private source-pack/Tutor architecture; runtime progress and validation must be reported separately. Preserve shipped work and other worktrees.

## Read in this order

0. **[Product doctrine](../product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md) and [current reconciliation](../product/IDEAS-RECONCILIATION-2026-10-04.md):** learning change leads; productivity supports it. Read the relevant feature plan and inspect actual branch/worktree ownership before editing.
1. **[01-ideas/INDEX.md](01-ideas/INDEX.md): the ideas bank.** Every idea JD has given, one row each, with an ID, a status and where it lives. The verbatim notes (IDEAS-1.md to IDEAS-6.md) sit beside it.
2. **[02-progress/](02-progress/): what has been built,** biggest first: [1-MAJOR.md](02-progress/1-MAJOR.md) (waves and flagship features), [2-UPDATES.md](02-progress/2-UPDATES.md) (smaller improvements), [3-HOTFIXES.md](02-progress/3-HOTFIXES.md) (bug fixes), and [IN-FLIGHT.md](02-progress/IN-FLIGHT.md) (what each branch is doing right now).
3. **[03-notes/](03-notes/): working notes** from each agent: decisions, conventions and traps worth remembering.
4. **[04-COMPLETED.md](04-COMPLETED.md): done and verified,** by wave.
5. **[05-FUTURE.md](05-FUTURE.md): possible future additions,** parked ideas, and anything waiting on JD.

## When JD sends new ideas

1. Save them word for word as the next `01-ideas/IDEAS-N.md` (never edit a verbatim file).
2. Add each actionable idea to `01-ideas/INDEX.md` with the next ID (`I<N>-<nn>`), a status of `NEW`, and its area.
3. Give it a home: a branch plan (`PLANNED`), or `05-FUTURE.md`.
4. Record its domain, thesis/problem, benefit, dependencies, priority, owner, source/date, related or superseded ideas, implementation links and tests in its feature record. Keep status distinct from verification; use the [Decode work records](../product/IDEAS-RECONCILIATION-2026-10-04.md) as the current example.

## When work ships

- Merging to main is done in numbered waves (Wave 1.1, 1.2, ...): each branch is finished and green on `npm run verify:all`, the branches are integrated on a `wave/x.y` branch, verified again, then merged into main. Only JD pushes (a push deploys production).
- On merge: update the item's status in the index (`SHIPPED`, or `VERIFIED` once exercised in a real browser), add a line to the right progress file, and move it to `04-COMPLETED.md`.
- A shared component change never counts as shipping the feature that sits on top of it.

## Ground rules that never change

- The repository is public: no personal data, schedules, phone numbers, credentials, or media we lack a licence for (YouTube-sourced audio, iWallpaper images, private PDFs).
- No developer phone number anywhere, ever. Crisis support routes to professional resources and a trusted contact the user adds.
- Workspace schema stays at 34 unless both agents agree on the board first.
- UI copy: plain language first, no em dashes, lucide icons.
- The setup flow is the visual standard for every fill-in form.

## Related

- Coordination with Codex: `/Users/jd/Developer/AXOM-coordination/BOARD.md` (outside the repo).
- Design contract: [../design/DESIGN.md](../design/DESIGN.md).
- Formal governance (constitution, registry, product backlog): [../governance/](../governance/).
- History of the Ideas 1-3 planning (manifest, plan, reconciliation, per-branch plans): [../feature-development/](../feature-development/).
