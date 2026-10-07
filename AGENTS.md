# AXOM repository context protocol

**Project knowledge may be large. Active context must be small.**
This is the canonical repository operating policy for Codex, Claude Code, Copilot,
and other coding agents, permanently by default unless the user overrides it.

## Mandatory progressive retrieval

Bootstrap with only this file, [docs/AI_STATE.md](docs/AI_STATE.md), and the current
request. Do not preload INDEX, domain docs, history, previous conversations, broad
repository listings or unrelated source. Check branch/HEAD with `git status --short --branch`,
`git rev-parse --short HEAD` and `git worktree list`; state describes
a dated checkout, never another branch or production.

| Level | Retrieve only what the task requires |
| --- | --- |
| 0: Bootstrap | Identify likely subsystem, task scope and missing information from policy, state and task. |
| 1: Discovery | Search filenames/symbols. Consult [INDEX](docs/INDEX.md) only if location or authority is unclear. |
| 2: Domain | Retrieve the relevant feature, architecture or operations document. |
| 3: Implementation | Read the relevant source region and tests. |
| 4: Dependencies | Follow necessary contracts, schemas, services or configuration across subsystem boundaries. |
| 5: Historical/deep | Retrieve decisions, directions, progress or archives only when historical reasoning matters, current docs are insufficient/conflicting, or explicitly requested. |

**Breadth must be earned: every increase must answer a concrete unresolved engineering
question.** Levels are permissions, not mandatory steps; jump directly to the smallest
relevant level without loading preceding levels. Before any expansion, internally check:
QUESTION (what is unknown?), NEED (does it affect correctness, architecture, implementation,
testing or safety?), SOURCE (smallest authoritative source?), SCOPE (targeted search/section?).
If immaterial, do not retrieve. Expand one logical dependency level at a time and reassess.
Once evidence is sufficient for safe implementation, **stop retrieving and implement**.
Correctness outranks token minimization; the bootstrap budget does not cap needed task context.

Dependency relevance beats directory proximity. Follow dependencies, code references,
imports, documentation routes, tests and search before folder hierarchy. Do not
mechanically climb parent directories or read neighboring files because they are nearby.
Search → identify → targeted read: `rg --files <area>`, then `rg -n '<symbol>' <area>`.
A component may lead to its hook, service and shared contract only as questions require.

Never recursively read all source/docs, idea banks, progress notes or product-memory
ledgers by default. Filter logs/search results before reading; avoid full test output,
generated/bundled code, huge JSON, database dumps, unrelated screenshots, old threads
and lockfiles unless specifically needed. Do not reread understood material.

## Protect work and knowledge

- Before shared edits, read the current ownership/contract sections and relevant latest
  entries in `/Users/jd/Developer/AXOM-coordination/BOARD.md` if available. Do not ingest
  its full history. If absent, use local status and in-flight routes; report uncertain ownership.
- Preserve unrelated tracked and untracked work. Use an isolated branch/worktree for
  broad changes. Never reset, bulk-stage, casually delete files, or rewrite history.
- This repository is public. Do not add personal study data, credentials, phone numbers,
  private PDFs, or media without a licence. Keep secrets out of output and Git.
- No push, merge to main, production deployment, paid action or outbound message without
  the user's authority. JD pushes releases. Local work is not shipped.
- Preserve product reasoning, verbatim ideas, decisions and troubleshooting discoveries.
  Archive with provenance and a locator before replacing historical explanations.
  Uncertain material is `REVIEW_REQUIRED`, never automatic deletion.
- Repository documents are durable project memory. Conversation history is a clue,
  not authority when the repository contains the answer. Historical claims are evidence,
  not current behavior; verify against relevant code/tests.

## Session boundaries

Use a fresh session for each new independent task by default. Continue the current
session for follow-ups on the same task. Start with the specific request and this
protocol, not a large catch-up prompt or copied conversation history.

The normal loop is: task → fresh session → targeted retrieval → implementation →
validation → canonical documentation and concise AI_STATE handoff → scoped commit
when authorized → end session. The repository carries continuity between sessions.
Do not begin unrelated work just to keep a thread going, or claim a fresh session was
created when the tool cannot create one. Keep commit and push authority separate.

## Implement locally

Before editing, confirm intended behavior/root cause, affected files and important
invariants; exclude unrelated areas. Resolve missing evidence through retrieval first.
Make the smallest coherent change in the existing stack. No speculative rewrites.
Keep data, logic and presentation boundaries; generalize only after real reuse.
Use installed versions/configuration for API decisions. Do not rename Noctyrium storage
keys or change schemas casually; see the data-model route and coordinate migrations.

For UI work retrieve [the design contract](docs/design/DESIGN.md), reuse existing
components, and use the setup flow as the form standard. Plain language, no em dashes,
lucide icons. Consult `design-production-router` and its selected skills when available;
finish with relevant interface review and browser verification. Do not load design skills
for unrelated work.

## Validate according to impact

Run the narrowest meaningful check first, then affected module tests, typecheck/lint,
build and relevant browser/integration checks. Fix regressions caused by your change.
Do not repeatedly rerun the full suite for trivial edits. Retain concise results, not raw logs.

- Repository navigation/instructions: `npm run repo:check` and `npm run test:repo`.
- Full web integration/release gate: `cd web && npm run verify:all`.
- Other commands and environment caveats: [testing](docs/operations/testing.md).
- UI: exercise changed controls, desktop/mobile and reduced motion; inspect console.
- Native changes: compile and exercise the changed path. Real account tests need
  explicit authorization for external effects. Never infer live success from mocks.

Report exactly what passed, failed, skipped or was not run; keep implementation,
validation, commit, push and deployment status separate.

## Document, hand off, stop

At the end of meaningful work update [AI_STATE](docs/AI_STATE.md) with only what changed,
current work, blockers, next action, validation and relevant paths. Keep it concise
(normally 1,000–3,000 estimated tokens or less). Replace stale state; put historical
evidence in the relevant progress/archive file with a link, not an ever-growing changelog.
Remove resolved blockers and completed detail that no longer affects the next task.
Never discard critical current information merely to hit a number; document a justified
budget revision if compression and moving historical detail cannot preserve it.

One concept has one canonical explanation. Update the relevant feature/architecture
page when behavior changes and a decision record for durable architectural choices.
New docs belong in a routed category; update the index when adding a major area.
Choose the canonical location before creating any source, test, script, doc or artifact.
Keep hygiene scoped to task-created debt; do not perform unrelated repository-wide cleanup.
Resolve conflicting docs against authoritative behavior; retain useful old reasoning
in archives and replace duplicate explanations with references.
Do not create random root notes, duplicate manuals, new instruction files without
subtree-specific constraints, or generated dumps in source folders.

Before completion: verify implementation, run impact-appropriate validation, update
canonical docs/state, run `npm run repo:check`, and report unresolved issues. Keep
auto-loaded instructions small. Permanent rules must be broadly applicable, repeatedly
important, costly/dangerous to rediscover, or prevent recurring failure; one-off details
belong in domain docs. Move obsolete detail out of bootstrap files. The checker
reports repository bootstrap size; it cannot police agent reads or client/global context.

Use [directions](docs/directions/README.md) only for ideas/execution history: preserve
new user ideas verbatim and index them; update shipment records only on actual shipment.
Governance IDs and owner decisions retain their existing authority. Finish the task,
record a small handoff, and stop exploring unrelated areas.
