# Directions

User ideas, execution tracking and historical progress live here. For a normal coding
session start with [AGENTS](../../AGENTS.md) and [AI_STATE](../AI_STATE.md).
This directory is retrieved only for a relevant idea, branch or historical question.

## Locate the relevant record

| Need | Read only |
| --- | --- |
| An idea's ID/status/owner | Search [01-ideas/INDEX.md](01-ideas/INDEX.md), then the matching verbatim note |
| A branch's last recorded work | Search [IN-FLIGHT.md](02-progress/IN-FLIGHT.md); verify with Git |
| A particular shipped change | Search [major](02-progress/1-MAJOR.md), [updates](02-progress/2-UPDATES.md), or [hotfixes](02-progress/3-HOTFIXES.md) |
| A known implementation trap | Matching agent note in [03-notes](03-notes/) |
| Completion evidence or parked work | [Completed](04-COMPLETED.md) or [future](05-FUTURE.md) |
| What governs feature priority (since 2026-10-04) | [Learning Intelligence doctrine](../product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md), then the [Ideas 1 to 6 reconciliation](../product/IDEAS-RECONCILIATION-2026-10-04.md) |
| The first implementation wedge | [Question-first plan](../feature-development/2026-10-04/QUESTION-FIRST-PLAN.md), then the [Decode sequence](../feature-development/2026-10-04/DECODE-IMPLEMENTATION.md) |

Do not read all rows, notes or progress files to begin a localized task. Historical
status and branch ownership can drift; the current checkout and coordination board
must be checked before edits. Governance retains product-authority ownership.

## When JD sends new ideas

1. Save them word for word as the next `01-ideas/IDEAS-N.md` (never edit a verbatim file).
2. Add each actionable idea to `01-ideas/INDEX.md` with the next ID (`I<N>-<nn>`), a status of `NEW`, and its area.
3. Give it a home: a branch plan (`PLANNED`), or `05-FUTURE.md`.

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
