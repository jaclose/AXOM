# Historical knowledge locator

Available context is not active context. Retrieve history for a specific question,
idea ID, decision or failure; never load this entire collection as startup context.
Archive means preserved reasoning, not rejected reasoning or permission to delete it.

| Historical material | Where / how to retrieve |
| --- | --- |
| Exact guidance replaced during the context migration | [Snapshot manifest](2026-10-05-context-migration/manifest.json), base `9f29327`; original path plus SHA-256 maps to preserved bytes |
| Old root README file:line citations | [Original README](2026-10-05-context-migration/README.md); for other revisions use `git show <commit>:README.md` |
| Old web README | [Original web README](2026-10-05-context-migration/web/README.md) |
| Earlier data/lifecycle/AI proposals | [Data](2026-10-05-context-migration/docs/architecture/DATA_STRATEGY.md), [lifecycle](2026-10-05-context-migration/docs/architecture/LIFECYCLE.md), [AI](2026-10-05-context-migration/docs/architecture/AI_INFRA.md) |
| Verbatim ideas, execution and per-agent notes | [Directions router](../directions/README.md) |
| Dated implementation plans | [Feature-development](../feature-development/); search date/feature, then one plan/progress file |
| Product reconstruction evidence | [AXOM-0002A entry](../product-memory/AXOM-0002A/README.md); search an ID in `UNIT-ANCHORS.md`/`INDEXES.md`, then only the matching ledger block |
| Candidate packages/disposition proposals | [0002C](../product-memory/AXOM-0002C/README.md), [0002C1](../product-memory/AXOM-0002C1/README.md); not approved backlog records |
| Older release checkpoints | [Pre-alpha contract](../PRE-ALPHA-CONTRACT.md), [Wave 6 plan](../WAVE-6-PLAN.md); dated intent, not current implementation/release status |
| Original product/audit evidence retained at root for line citations | [FEATURES](../../FEATURES.md), [ROADMAP](../../ROADMAP.md), [implementation audit](../../IMPLEMENTATION_AUDIT.md), [detailed report](../../ASK_DETAILED_REPORT.md), [research](../../PRODUCT_RESEARCH_AND_OPPORTUNITIES.md) |
| Existing visual audit evidence | `artifacts/`, `bugs/`, product-memory evidence directories; inspect only the relevant artifact |

Do not rewrite archived prose or shift product-memory source lines to modernize it.
Resolve outdated claims in active canonical documents, and link to the preserved version.
Relative paths inside exact snapshots retain their original meaning from the original
location recorded in the manifest. They are not new operational runbooks.

Some root evidence remains in place intentionally: moving it would break hundreds of
file-and-line citations. The migration moved only the unreferenced competitive report
to [product research](../product/research/AXOM_Competitive_Intelligence_Report.md).
The [repository audit](../operations/repository-audit.md) classifies ambiguous media,
large files and legacy code without deleting any of them.
