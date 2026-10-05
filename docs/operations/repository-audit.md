# Repository context migration audit

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

Context budgets use characters/4 as an explicitly approximate token estimate, not a
model tokenizer. AGENTS and AI_STATE each have a 12,000-character ceiling; tool bridges
1,500 each. Initial AGENTS + AI_STATE are roughly 2,300 estimated tokens rather than
a mandatory 161 KB directions preload. User/global instructions and the task are
additional context beyond this repository's control.

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
generated/cache/log paths and loose root media. Fragment/external-link validation is
out of scope; old frozen evidence and branch-only historical links are intentionally
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
