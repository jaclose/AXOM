---
tags:
  - axom/operations
authority: canonical
---
# Repository maintenance and context audit

## Maintenance registry

This is the single cleanup register, extending the existing audit. Coordination owns
live tasks; this table owns deferred cleanup. Search the relevant path/status rather
than reading the audit history. Paths are repository-relative; some exist only in the
owner's worktree. The status applies to cleanup, not permission to implement a feature.

- **ACTIVE = ACTIVE_DO_NOT_TOUCH:** no opportunistic cleanup; record opportunities here.
- **DEFERRED = DEFERRED MAINTENANCE:** blocked on ownership, evidence or review.
- **READY = READY FOR MAINTENANCE:** safe condition has been verified; eligible for a
  separate authorized cleanup task. It is not deletion, publication or merge approval.
- Normal development areas need no row. Check status/ownership anyway; absence is not
  evidence that files are safe. Live owner evidence takes precedence over a stale row.

At feature handoff, the owner checks related rows. Once work is integrated and the
relevant checkout is clean, verify every other safe condition, change ACTIVE/DEFERRED
to READY and date the evidence. Do not auto-clear protection merely because a branch
was merged, time passed, or a checkout appears clean. Completed rows may be removed
only with a commit/progress locator preserving the outcome. Every cell is required;
use UNKNOWN with a reason when ownership is unresolved. No source TODO scatter.

| Area / path | Status | Owner / task | Why protected | Cleanup opportunity | Safe condition | Date / reference |
| --- | --- | --- | --- | --- | --- | --- |
| `web/src/lib/course-engine/`, `web/src/lib/learning-intelligence/`, `web/src/components/tracker/`, `web/src/pages/CourseTrackerPage.tsx`, `web/e2e/` | ACTIVE | Claude / canonical integration owner | Course branch 093bb65 integrated at 7c069ea; newer course/calendar/ranking work continues on integration | Review adapters and test placement after integration | Owner handoff, feature integrated, relevant files clean and contracts settled | 2026-10-07: clean Course handoff; integration c8f6ceb; recovery matrix |
| `web/src/components/questions/`, `web/src/pages/QuestionWorkspacePage.tsx`, `web/src/lib/questions.ts`, `web/src/lib/quiz.ts`, `web/src/lib/questionImport.ts` | ACTIVE | Exam fidelity, Course Engine and Decode owners | Overlapping practice, import and analysis work | Consolidate shared practice/import boundaries when implementations settle | All three owners settle overlap, work integrated and affected files clean | 2026-10-07: BOARD ownership and state brief |
| `web/src/lib/store.ts`, `web/src/lib/types.ts`, `web/src/lib/backup.ts`, `web/src/lib/localVault.ts`, `web/src/App.tsx` | ACTIVE | Shared workspace contracts / coordinate first | Save-path and scope changes; schema 34 | Domain extraction only when behavior and persistence invariants are proved | Contract owners agree, branches integrated, regression coverage and clean files | 2026-10-07: live Course/Decode status and BOARD shared contracts |
| `web/src/lib/decode*.ts`, `web/src/lib/decode/`, `web/src/lib/ai/`, `docs/product/`, `docs/feature-development/`, `docs/directions/` | ACTIVE | Integration owner; Codex prototype / question-first draft | Old runtime checkpoint a33a01e is clean but untested; new Decode port active on integration; question-first draft dirty | Compare remaining prototype intent with the canonical Decode contract; preserve verbatim ideas | Owner integrates or explicitly hands off; no historical reasoning discarded | 2026-10-07: a33a01e and c8f6ceb; recovery matrix; safety snapshot retained |
| `web/src/lib/media/`, `web/src/lib/soundscapes/`, `web/src/pages/SoundscapesPage.tsx`, `web/public/`, `design/` | ACTIVE | Copilot media pipeline; Claude soundscapes; Codex focus/media | Processing, audio lifecycle and immersive work overlap | Shared audio lifecycle, device-store boundary and media-source duplication review | Media owners settle seams, work integrated and licensing established | 2026-10-07: BOARD media integration and ownership sections |
| `package.json`, `package-lock.json`, `web/package.json`, `web/package-lock.json` | ACTIVE | Media pipeline / dependency recovery | Dependency-only WIP 8dd9391 parked; also present in mixed commit 93badf8 | Review duplicate/unused dependencies in a separate task | Recovery complete, owners release files and dependency changes clean | 2026-10-07: main checkout and BOARD state brief |
| `AGENTS.md`, `.gitignore`, `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/`, `src-tauri/permissions/` | ACTIVE | JD / original checkout recovery; Codex context-protocol draft | Original mixed checkout and context draft remain dirty; stash is partly recovered and retained; user Bases protected | Maintenance integrated only in recovery staging; canonical owner must incorporate it; review Bases by owner | JD settles branch recovery; do not apply/drop stash or overwrite other worktrees | 2026-10-07: original 93badf8, context-protocol status, BOARD incident entry |
| `Resource/`, `examsoft/`, `blue-prints/`, `blueprints/`, `NCRS_Master_Deck.html`, `NCRS_Summary_Sheets.html` | DEFERRED | JD / ownership and publication review | REFERENCE and REVIEW_REQUIRED; licences and personal provenance unresolved | Classify retention and any future relocation; largest reference directories dominate tracked size | Owner reviews provenance, publication rights and retention; explicit move/delete authority | 2026-10-07: Git blob inventory; no private content opened |
| `AXOM_Opening_Cinematic_v1/`, `AGAIN*. .m4a`, `web/public/cinematics/`, `web/public/soundscapes/` | DEFERRED | JD + media owners | Intentional source/runtime duplicates may have stable URLs | Four exact source/output duplicate groups above 500 KB | Media work released; ownership, source preservation and runtime references proved | 2026-10-07: Git blob identity comparison |
| `Sources/`, `Resources/`, `Package.swift`, `web/src-tauri/`, `axom/`, `scripts/legacy/`, `db/` | DEFERRED | UNKNOWN / legacy ownership review | LEGACY, not deletion-approved; release/scripts and archive citations may depend on paths | Trace callers and mark retirement boundaries | Prove no active callers, preserve historical locators, obtain owner decision | 2026-10-07: existing architecture/archive routes and metadata audit |
| `artifacts/`, `bugs/`, `scripts/startup-ident/` | DEFERRED | UNKNOWN / historical evidence review | Existing generated evidence and two tracked Python caches are baseline exceptions | DELETE_CANDIDATE for reproducible caches only; archive useful evidence | Verify provenance/reproducibility and obtain removal authority; never regenerate baseline to hide failures | 2026-10-07: existing exact-path hygiene baseline |
| `web/src/components/shell/AppearanceStudio.tsx`, `web/src/components/shell/CinematicSettings.tsx` | DEFERRED | Settings owner / keyboard helper | Prior audit reported a cycle; not revalidated in this maintenance pass | Extract the keyboard helper only if cycle still exists | Owner releases settings scope; reproduce cycle and prove keyboard behavior | 2026-10-05: source organization findings below |

Current branch/worktree disposition: [recovery matrix](branch-recovery-2026-10-07.md).
The following maintenance report describes its original dated checkpoint.

## Maintenance pass 2026-10-07

Scope: repository instructions, documentation routes, Obsidian metadata/defaults,
ignore rules and the existing Node hygiene gate. No runtime source moves, dependency
edits, installs, private-file reads, deletes, push or deployment. Base `42eeacb` was
chosen because `93badf8` in the original checkout has committed conflict markers and
an incomplete context migration. The board leaves branch/stash recovery to JD.
The existing graph-only additions from `93badf8` were carried onto the intact base;
no runtime files from that mixed commit were copied.

The original audit classifications below remain useful: KEEP source/config/tests;
ARCHIVE historical explanations; IGNORE new generated output; REVIEW_REQUIRED unknown
reference/legacy material; ACTIVE_DO_NOT_TOUCH owner work. MOVE: none in this pass.
No proposed deletion was executed. Old root reports stay to preserve file:line citations.

Inventory at base: 1,275 tracked blobs, 457,228,394 bytes; 12 files exceed 5 MiB.
`Resource/` is 183.2 MB and `examsoft/` 127.8 MB, classified as reference material
requiring provenance/publication review. Cinematic originals remain media-owner scope.
Four duplicate blob groups exceed 500 KB; duplication is evidence, not deletion authority.
The original checkout's 1,254 regular Git candidate files were hashed before edits for
a later unchanged check. Ignored private directories were not traversed or copied.

The policy now makes zero-agent defaults, material skill activation and phase/session
boundaries explicit. Shared Claude/Copilot bridges remain tiny and unchanged on this
base. Installed skills/global settings are retained, not duplicated or modified.
Prior policy/handoff provenance: `git show 42eeacb:AGENTS.md` and
`git show 42eeacb:docs/AI_STATE.md`; original graph handoff: `93badf8:docs/AI_STATE.md`.
The earlier immutable archive manifest remains unchanged.

Strategic checkpoint research confirmed the shared-file approach. Current
[Claude documentation](https://code.claude.com/docs/en/memory#remove-an-earlier-agents-md-workaround)
says explicit AGENTS imports are deduplicated even with native AGENTS support;
retain the import bridge for compatibility. [VS Code instructions](https://code.visualstudio.com/docs/agent-customization/custom-instructions)
remain harness-dependent; repository checks measure the routed set, not guaranteed
client loading. [Codex discovery](https://developers.openai.com/codex/guides/agents-md)
does not make arbitrary linked docs a preload. [Obsidian Markdown links](https://help.obsidian.md/links)
fit the single-vault approach. The relevant saved resource,
[Playwright CLI skills](https://playwright.dev/agent-cli/skills), supports existing
browser workflows; no browser adapter is needed for a non-UI maintenance diff.
Chrome bookmarks were filtered locally; Safari access was unavailable. No private
bookmark inventory was copied into Git. Local tools: Node 22.23.1, Codex 0.160.1,
Claude Code 2.1.292. No new MCP, dependency or agent framework was justified.

Validation on Node 22.23.1: 43 focused repository tests and all 62 root tests passed;
`repo:check` passed with 30 active documents, zero route/registry/conflict/metadata
errors and all 10 preserved snapshots matching. The graph has 18 curated notes and
24 map edges; all nine checked heading routes resolve and both portable JSON defaults
parse. Native Obsidian rendering was not rerun; this is structural graph verification.
`git diff --check` passed. All 1,254 hashed files in the original checkout are unchanged;
the maintenance diff contains no runtime, dependency, lockfile, CI or archive-snapshot edits.

The first optional root-test run passed 61/62: the real signature fixture lacked its
Tauri CLI in the fresh worktree. Reusing the already installed CLI 2.11.5 through an
ignored local symlink (matching this branch's lockfile) yielded 62/62, without installing
or changing packages. Full application build/typecheck/lint/E2E and live services were
not run because no runtime-affecting file changed. No live client-loading claim is made.

Bootstrap at `42eeacb`: 3,489 → 2,351 estimated tokens (33% smaller); Claude
3,559 → 2,421; Copilot 3,568 → 2,430. AGENTS: 2,226 → 1,589; AI_STATE:
1,263 → 762. The original damaged checkout measured 3,541 for the pair and its hygiene
command failed on a missing baseline file. That checkout remains untouched. These are
character-based repository estimates, not measured model spend or total prompt size.

No maintenance commit changes another worktree or resolves the mixed commit/stash.
The next integration step depends on JD's recovery decision. This checkpoint remains
local on `codex/ai-maintenance-2026-10-07`; locate it with
`git log -1 -- scripts/repository-hygiene.mjs`. Start later feature work in a fresh session.

## Context migration 2026-10-05

Date: 2026-10-05. Base: `9f29327` (`feat/media-pipeline-v1`).
Implementation: isolated `codex/repository-context-protocol` worktree. This report
records repository evidence and scope; it does not establish a production release.

## Findings and implemented boundary

The root agent instructions were short but transitively required all directions/history.
The 17 directions Markdown files occupied 161,413 bytes; feature-development added
98,434 bytes, and product-memory 1,405,242 bytes. These remain available on demand.
No verbatim idea, governance file or product-memory source was rewritten or deleted.

AGENTS is now the canonical operating policy. Claude imports that policy and AI_STATE explicitly; Copilot contains small links
to the common protocol. AI_STATE is a dated, bounded handoff. INDEX routes to one relevant feature,
architecture, operation or history source. Existing detailed contracts are linked rather
than copied into new manuals. No nested instruction files were needed.

Root/web readmes and three short architecture documents described obsolete accounts,
schema or persistence behavior. Exact originals were preserved first in the [snapshot
manifest](../archive/2026-10-05-context-migration/manifest.json), including original path
and SHA-256. Historical file-and-line references can resolve those snapshots or Git
history. Instruction snapshots use `.txt` suffixes to avoid becoming nested agent policy.

The competitive report had no inbound tracked references and moved byte-for-byte from
the root to `docs/product/research/`. Other root evidence retains its original paths
because hundreds of archive citations depend on them. The new category structure adapts
to those existing contracts; it is intentionally not a wholesale rename.

## Repository inventory and classification

At baseline: 1,241 tracked files, approximately 457 MB. File names/sizes and targeted
text were inspected; private untracked study PDFs/media were not opened.

| Area / root material | Class | Decision and dependency evidence |
| --- | --- | --- |
| `web/src`, `web/public`, `web/scripts`, `web/e2e` | KEEP | Active app, licensed runtime assets, frontend tooling and browser tests; no runtime moves |
| Root `src-tauri`, `scripts/tauri.mjs` | KEEP | Canonical native wrapper; release and CI depend on these paths |
| `api`, `lib/api`, `db` | KEEP | Compatibility handlers/helpers and legacy migrations; active accounts use Supabase; preserve deployed tombstones |
| `supabase` | KEEP | Current account migrations, auth templates, AI function and CLI config |
| Root/web package manifests/locks, TS/Vite/test configs, `.nvmrc` | KEEP | Build/install/test contracts; lockfiles searched only for specific dependency questions |
| `.github/workflows`, `vercel.json`, `.vercelignore`, `.gitattributes` | KEEP | CI/release/deployment assumptions; hygiene added to web CI; deploy upload allowlist unchanged |
| `.agents/skills`, `.claude/skills`, `skills-lock.json`, `.claude/settings.json` | KEEP | Installed tool skills and canonical symlinks/permissions; not duplicated copies to delete |
| `AGENTS`, `CLAUDE`, Copilot instructions | KEEP + ARCHIVE | New common context protocol; exact old instructions retained as non-injected snapshots |
| `README`, `web/README`, three older architecture notes | KEEP + ARCHIVE | Current routes replace stale claims; exact historical text retained |
| `AXOM_Competitive_Intelligence_Report.md` | MOVE | Now `docs/product/research/`; same hash; no inbound references found |
| `FEATURES`, `ROADMAP`, `IMPLEMENTATION_AUDIT`, `ASK_DETAILED_REPORT`, `PRODUCT_RESEARCH_AND_OPPORTUNITIES` | KEEP | Historical root evidence with numerous file:line citations; archive router classifies them |
| `CHANGELOG`, `current_version.txt` | KEEP | Release tooling inputs; do not move for visual symmetry |
| `docs/governance`, `docs/design`, current feature contracts | KEEP | Stable authority IDs, design implementation contract and established links |
| `docs/directions`, `docs/feature-development` | KEEP | Verbatim ideas/execution history; directions checker hardcodes existing paths |
| `docs/product-memory`, historical release/wave/planning docs | KEEP | Institutional evidence, proposals and dated checkpoints; retrieve by ID/heading |
| `artifacts`, `bugs` | KEEP + IGNORE new output | Existing audit evidence retained; new generated artifacts stay local by default |
| `AXOM_Opening_Cinematic_v1`, `design`, `data` | KEEP | Original asset variants, production tooling and data; duplication may be intentional source/output pairing |
| `Package.swift`, `Sources`, `Resources`, `axom`, `scripts/legacy`, `web/src-tauri` | KEEP / REVIEW_REQUIRED for retirement | Legacy native/tooling surfaces; no speculative deletion or bulk move |
| `Resource`, `examsoft`, `blue-prints`, `blueprints` | REVIEW_REQUIRED | Large reference/source material, unclear redistribution/retention rights; no destructive cleanup |
| Root study HTML, RTF quote library, screenshots, `AGAIN*. .m4a` | REVIEW_REQUIRED | User/reference inputs or evidence; retain; do not infer licence or runtime irrelevance from filenames |
| `overview.json`, `overview_architecture.puml` | REVIEW_REQUIRED | Older architecture inventory; not current navigation authority; preserve until provenance/use is decided |
| Untracked root PDFs/audio/video, personal course folders | IGNORE / REVIEW_REQUIRED | Left in original checkout; protect against accidental public staging; not copied into the isolated branch |
| `node_modules`, build/dist/target caches, reports, `.env*`, provider cache | IGNORE | Generated/private data; additive ignore rules with `.env.example` exception |
| Tracked Python bytecode under startup-ident tooling | KEEP + IGNORE new output | Two existing caches grandfathered; no deletion during migration |

**DELETE:** none. Archive is a retrieval decision, not destruction or rejection of ideas.
The original checkout's unrelated package edits and private imports were untouched.

## Large-file and token policy

| Expensive material | Baseline size | Retrieval / disposition |
| --- | --- | --- |
| `docs/product-memory/AXOM-0002A/RECONSTRUCTION-LEDGER.md` | 592 KB | Search ID/anchors; read one record; do not split citation-bearing evidence |
| Product-memory indexes/source catalogs | 69–126 KB each | Search topic/ID and narrow region; remain canonical evidence |
| `web/public/application-schools.json` | 976 KB | Use dataset tooling/targeted record queries; do not ingest whole JSON |
| Root/web lockfiles | 259 / 186 KB at base | Keep for reproducibility; search exact package only |
| `web/src/lib/blueprintCatalog.ts` | 149 KB | Search a blueprint/system; data-heavy module, no arbitrary fragmentation |
| `web/src/lib/store.ts` | 136 KB / 2,857 lines | Locate action/migration; protect shared ownership and persistence invariants |
| CourseTracker/QuestionParse/ImportPanel/Dashboard | 77–100 KB | Retrieve relevant symbols; incremental feature work is the place to split responsibilities |
| `overview.json` | 122 KB | Historical inventory; active architecture map supersedes it for orientation |
| Reference PDFs/video | Up to 50 MB | Review ownership/licence; not code context; no automatic deletion |
| Skill references | Up to 88 KB | Load only when relevant skill is invoked |

Exact duplicates found: root `AGAIN*. .m4a` and runtime `again.m4a`; three cinematic
source/output pairs; app/notification icon PNGs. These are retained: source variants and
stable public asset URLs are not safe deletion candidates merely because bytes match.

The initial migration replaced a mandatory 161 KB directions preload with a small
policy/state pair. Current budgets and measurement limits are documented
[below](#bootstrap-measurement-and-enforcement-limits); `npm run repo:check` prints
live sizes rather than relying on a stale token count in documentation.

## Source organization findings

No runtime imports, asset URLs, database migrations or native configuration were moved.
The highest-value low-risk repair was making active boundaries unambiguous:
Supabase versus retired Vercel accounts, root versus web native shell, Local Vault versus
checkpoint SQLite, current AI provider versus old API wrappers.

A static relative-import scan of 372 non-test TS/TSX modules found one cycle:
`AppearanceStudio.tsx` renders `CinematicSettings.tsx`, which imports
`onRadioGroupKeyDown` back from AppearanceStudio. A future small change can move that
keyboard helper to the existing UI utility layer with keyboard regression coverage.
The scan excluded type-only imports and did not resolve dynamic imports, aliases or
all bundler edges; it is not a proof of global cycle absence.

Other deferred work:

1. Extract shared-store domains incrementally when changing them, preserving persisted
   selection/migrations and existing tests. Do not split the 2,857-line store by line count.
2. Audit legacy service/native/backend callers before retirement. `storageService.ts`
   still feeds current workspace snapshots; not every old-looking service is dead.
3. Review large reference assets and their licences separately from runtime asset sources.
   Keep binary movement/deletion out of an architectural context pass.

## Hygiene and maintenance

`npm run repo:check` uses Git's tracked plus non-ignored proposed-file inventory.
It does not crawl ignored private folders or node_modules. It validates small automatic
context files, relative links in active navigation/docs, unexpected files over 5 MiB,
generated/cache/log paths and loose root media. The maintenance section above adds required-route, registry, graph-metadata and
conflict-marker guards (active docs, .gitignore and package manifests). These guards
validate structure, not whether an owner has actually released an active area.
General fragment/external-link validation is out of scope; old frozen evidence and branch-only historical links are intentionally
outside active link checks.

The baseline records 45 exact existing paths with byte ceilings and rationales. It
allows preservation, not growth or a licence claim. New exceptions require deliberate
path-specific review. New generated output belongs in ignored output locations; do not
regenerate the baseline simply to suppress a failure. Existing tracked evidence remains
tracked even when a new ignore rule covers future output.

`npm run test:repo` covers missing links, encoded paths, budgets, generated paths,
large-file boundaries, grandfathered growth and the ignored-file boundary. The checker
runs before the local full web gate and in web CI; root release tests also include its
tests. No dependency was added. Build/deploy upload boundaries remain unchanged.

## Bootstrap measurement and enforcement limits

`repo:check` enforces 12,000 Unicode characters each for AGENTS and AI_STATE, 800
each for Claude/Copilot bridges, and 4,000 estimated tokens per repository bootstrap
profile. It sums `ceil(characters / 4)` per file, not a model tokenizer. Reports include
whitespace-delimited words, UTF-8 bytes, per-file budget results, startup-import status,
broken routing-link count and archive-integrity status. Missing files fail the check;
partial bootstrap sums are marked INCOMPLETE.

- **Bootstrap context:** AGENTS + AI_STATE, the required repository working set.
- **Claude effective bootstrap:** that pair plus CLAUDE bridge text, with its two
  required imports counted once. The separate import check rejects extra imports.
- **Copilot routed bootstrap:** that pair plus the Copilot bridge. This measures
  the required read set; a link does not guarantee a client's automatic preload.

These are repository estimates, not total prompt measurements. User/task text, global
or ancestor instructions, client-managed memory/rules, skills/tool definitions and
conversation/tool output can add context. Repository files cannot suppress these.
Other checkouts must contain the protocol to inherit it. Additional subtree instructions
or client-specific auto-load rules require their own scoped review; the fixed profiles
do not measure arbitrary client import graphs. The tracked instruction surfaces at this
checkpoint are root AGENTS, root CLAUDE and the Copilot bridge only.

AGENTS makes relevance-based retrieval mandatory, with a concrete unresolved question
before each expansion. CLI/CI can enforce budgets, known import boundaries, links and
preservation; they cannot prove an agent followed a reasoning checkpoint, prevent every
unnecessary tool read, or create a fresh session. No invasive read hook or external
telemetry was added. Keep canonical rules in AGENTS instead of duplicating them here.

AI_STATE's usual target is 1,000–3,000 estimated tokens, with shorter useful handoffs
allowed. Preserve essential current information: compress or route history first, and
review an explicit budget change if a legitimate task needs it. For the next 10–20
ordinary tasks, observe the printed bootstrap size, unjustified broad reads and ability
to resume from state. Change this system further only when those observations show a
problem; no new tracking service or per-task transcript is required.

## Strategic checkpoint: loading behavior and tools

The 2026-10-05 reassessment inspected the installed Codex CLI (0.159.2), Claude Code
(2.1.282), existing Git/Node/Playwright tooling, connected tool metadata and task-relevant
browser bookmarks. Private bookmark data was not copied into the repository.

Concrete improvement: a prose-only Claude bridge leaves loading AGENTS to model choice.
The [official Claude memory documentation](https://code.claude.com/docs/en/memory#share-one-file-with-other-coding-tools)
supports explicit imports and explains that imports expand into startup context. CLAUDE
therefore imports exactly AGENTS and AI_STATE. The hygiene checker validates that boundary
and the SHA-256 archive manifest; deeper context remains linked, not imported. It does
not claim to control every tool read or override managed/global instructions.

[Codex instruction discovery](https://developers.openai.com/codex/guides/agents-md)
loads ancestor guidance with a combined budget; no nested policy was needed here.
[Copilot repository instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
provide the corresponding bridge surface. Global/user settings were left unchanged.

The saved [Playwright skill documentation](https://playwright.dev/agent-cli/skills)
confirmed the existing browser test/debug capability. The installed test runner already
covers update recovery, offline state and app behavior, so a second browser stack adds
no benefit to this migration. No new MCP service, credentials or dependency was added.

Research also cautions against assuming larger context improves performance:
[Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988) reports increased cost without
general success improvements in its evaluated tasks. This does not measure AXOM. The
implementation therefore enforces small context and tests retrieval/provenance mechanics;
it does not claim a measured reduction in real agent spend or improved task success.

## Validation evidence

Final run: 2026-10-05, normal `AXOM` checkout, Node 22.23.1, base `9f29327` plus the
local migration and preserved inherited root dependency edits. That validation preceded
the separate context-architecture checkpoint. No Git merge, push or deployment occurred.

| Check | Result |
| --- | --- |
| Fresh isolated root/web installs | PASS; no dependency added by this migration |
| `cd web && npm run verify:all` | PASS, exit 0 in the normal checkout |
| Typecheck / ESLint / production build | PASS; existing large-chunk and mixed static/dynamic import warnings remain |
| Web unit tests | 231 files, 2,178 tests passed |
| Production update recovery / offline games | PASS, including saved workspace, user consent, recovery snapshot, other-tab isolation and offline reopening |
| Playwright E2E | 33 passed, one opt-in live-account test skipped (3.8 min) |
| Root `npm run test:release` | 45 passed, including 26 hygiene regression cases |
| `npm run typecheck:api` | PASS |
| `npm run directions:check` | PASS: 186 ideas, 60 commits |
| `npm run repo:check` | PASS: 28 active documents, 10 preserved snapshots |
| Archive / activation integrity | All 10 manifest entries match recorded hashes and base bytes; 49 scoped paths applied; 783 runtime files unchanged; inherited dependencies/lockfile and 22 private/reference files preserved |
| `git diff --check` | PASS |

The first isolated web run used Node 26 because of shell resolution and reproduced the
known experimental-global-localStorage/jsdom incompatibility. Explicit Node 22 resolved
it without a source change. The first isolated browser suite had one light-theme
settings-tab contrast reading (Emergency recovery at 1.04:1 while switching to Advanced).
The same spec passed 3/3 focused repeats on both base and migration checkouts; the final
full integrated run passed. This is recorded as an intermittent observation, not hidden
by retries or claimed as a repaired UI defect.

Native execution, live accounts, provider credentials and production deployment were
not exercised. No application source, database or live service mutation was made.
Full validation logs and the pre-application recovery capture are retained outside the
public repository under the local AXOM-coordination recovery folder.

## Session-policy follow-up and checkpoint

The owner requested fresh sessions for new independent tasks and a separate commit of
the context architecture. AGENTS now carries that policy for all tool bridges; no
duplicate prompt templates were added. The staged root package contains only the two
repository-check script additions. Existing dependency edits and the lockfile remain
outside the checkpoint. The policy-only follow-up uses the focused repository checks;
the full application gate above was already completed on the unchanged runtime tree.
Focused checks passed: `npm run repo:check`, 26 repository tests, and staged diff checks.
One original trailing space in the exact LIFECYCLE snapshot is preserved with a
file-specific whitespace attribute; its protected bytes and hash remain unchanged.
