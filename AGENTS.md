# AXOM agent operating policy

Canonical repository policy for Codex, Claude Code and Copilot. User instructions
take precedence. Optimize correct implementation, reasoning and validation per token.

## Orient and retrieve

Start with only **AGENTS + [AI_STATE](docs/AI_STATE.md) + task**. Check
`git status --short --branch`, `git rev-parse --short HEAD`, and `git worktree list`.
State describes a dated checkout, never another branch or production.

Before expanding context ask: **QUESTION** (what is unknown?), **NEED** (does it
affect this task?), **SOURCE** (smallest authority?), **SCOPE** (which section?).
Search filenames/symbols with `rg` before reading. Use [INDEX](docs/INDEX.md) only
when location or authority is unclear. Retrieve the relevant doc, source region,
tests, then necessary contracts. Dependency relevance beats directory proximity.
Stop retrieving when evidence is sufficient to implement safely; correctness wins.

Do not preload directions, archives, source trees, all branches/worktrees, previous
sessions or the Obsidian graph. Graph links are optional retrieval routes: normally
one relevant semantic hop, then reassess. Historical claims are not current behavior.
Filter logs and large files; do not reread understood material. For noisy commands,
write output to `/tmp/axom-<task>.log`, inspect the exit code and relevant `rg`/`tail`
regions. A passing log excerpt cannot hide a failing command.

## Protect before editing

- Read only current ownership/contracts and relevant latest entries in
  `/Users/jd/Developer/AXOM-coordination/BOARD.md` when available. Its linked state
  brief may resolve ownership conflicts; do not ingest its branch history by default.
  If unavailable, use local state and report uncertain ownership.
- Check the [maintenance registry](docs/operations/repository-audit.md#maintenance-registry)
  for the affected area. **ACTIVE means no opportunistic cleanup.** Do only authorized
  feature work there; register discovered cleanup with its owner and safe condition.
  DEFERRED becomes READY FOR MAINTENANCE only after that condition is verified.
  A clean checkout or absent registry entry does not prove an area is unowned.
- Preserve unrelated tracked, staged, untracked and ignored files, including package
  and lockfile changes. Use an isolated branch/worktree for broad work. Do not switch
  branches or stash in a dirty worktree; never reset, bulk-stage or rewrite history.
  Stage reviewed, named paths only. Never delete, overwrite or bulk-move user material
  without authority; uncertain provenance is REVIEW_REQUIRED.
- This repository is public: no credentials, personal study data, private PDFs, phone
  numbers or unlicensed media. Do not print secrets. No paid action, outbound message,
  push, merge to main or production deployment without explicit authority. JD pushes.

## Implement with focused tools

Confirm intended behavior, affected files and invariants; make the smallest coherent
change in the existing stack. No speculative refactors, dependency upgrades or source
moves. Check installed APIs. Preserve Noctyrium storage identifiers and coordinate
schema changes through the [data contract](docs/architecture/data-model.md).

Default to **zero subagents** for inspection, search, tests and mechanical edits.
Delegate only isolated broad investigation or genuinely independent parallel analysis
with a concrete benefit; internally state why doing it here is inefficient. Bound the
scope/output, use the cheapest suitable available model, and avoid recursive spawning.

Load skills only when explicitly requested or materially useful, never from keywords
alone. Design routers/specialists apply to actual visual or interaction production,
not maintenance, documentation, data or routine logic fixes. For UI work use the
[design contract](docs/design/DESIGN.md), existing components and setup-form standard;
plain language, no em dashes, lucide icons. Finish with interface review and browser checks.

## Validate by impact

Run the narrowest meaningful check first, then affected tests, typecheck/lint, build
and relevant integration checks. Fix introduced regressions; do not rerun unrelated
suites for trivial edits. Commands and environment caveats: [testing](docs/operations/testing.md).

- Docs/instructions/tooling: `npm run test:repo` and `npm run repo:check`.
- Full web integration/release: `cd web && npm run verify:all`.
- UI: changed controls, desktop/mobile, console and reduced motion in a real browser.
- Native: compile and exercise the changed path. Real account tests require authority
  for external effects; mocks never establish live success.

Report passed, failed, skipped and unrun checks. Local implementation, validation,
commit, push and deployment are separate states.

## Document, hand off, stop

**One coherent task = one session.** For an independent task use a fresh session.
At a major phase boundary update AI_STATE, checkpoint authorized scope, then compact
or end. Do not keep a conversation alive as the only store of useful knowledge or
claim to create/clear a session when the tool cannot do so.

ORIENT → LOCATE → RETRIEVE → PROTECT → IMPLEMENT → VALIDATE → DOCUMENT →
GRAPH (only meaningful architecture relationships) → HANDOFF → CHECKPOINT → STOP.

One concept has one canonical explanation. Put durable behavior in the domain doc,
architectural choices in decisions, and deferred cleanup in the registry. Preserve
reasoning with provenance before replacing it; archive uncertainty, never erase it.
Use [directions](docs/directions/README.md) only for ideas/execution history; preserve
new ideas verbatim and index them, and record shipment only on actual shipment.
Governance IDs and owner decisions retain authority. Choose routed locations for new
files; do not add duplicate manuals, random root notes or speculative instruction files.

Keep [AI_STATE](docs/AI_STATE.md) a small rolling handoff: dated checkout, protected
work, blockers, relevant decisions, validation and next action. Replace stale narrative
with canonical links. Keep permanent rules here and bridges tiny. The repository gate
enforces bootstrap size, not total client/global context or actual agent reading.
Before finishing run `repo:check`, review the scoped diff and hand off honestly. Stop;
do not start the next feature in this session.
