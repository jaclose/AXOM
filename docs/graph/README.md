---
tags:
  - axom/navigation
authority: navigation
---
# Repository graph guide

Open Obsidian → **Open folder as vault** → select `AXOM/docs/`. Start at
[AXOM System Map](AXOM-System-Map.md), or open Graph view. The files shown are the
repository documents themselves; no copies, sync service, plugins or account are needed.
Engineering and personal medical knowledge remain separate vaults.

## Scope and authority

The graph is a locator, not another specification. Existing documents retain their
authority and source/test pointers. A link is not proof a proposed feature shipped or
that two systems share storage. Source paths such as `web/src/` are repository-relative
IDE pointers outside this vault; they are deliberately not fabricated Obsidian nodes.
Root `AGENTS.md` also remains outside the vault. [INDEX](../INDEX.md) is the task router.

| Minimal property | Meaning |
| --- | --- |
| `tags` | One `axom/<category>` tag for graph filtering: feature, architecture, decision, operations, navigation, or state. |
| `authority` | `canonical` for current domain documentation, `navigation` for maps/routers, `current-state` for the rolling handoff. Existing governance and dated caveats still apply. |

Only selected useful documents receive metadata. No source-file notes or duplicate
relationship lists are generated. Frozen [historical originals](../archive/README.md)
remain untouched; their location/provenance marks them as historical, not current rules.
Future generated relationship reports must identify themselves as `authority: generated`
and name their source/revision; generated evidence never overrides authored semantics.

## Relationships and retrieval

Ordinary relative Markdown links work in GitHub and Obsidian. Link labels and the
small relationship tables explain roles such as **persists through**, **lifecycle
contract**, **storage boundary**, and **governed by**. Obsidian's built-in graph and
backlinks derive link edges automatically; the visual edges themselves are untyped.
Read the source note to distinguish dependency, related concept and historical evidence.

Use the graph only when it resolves a location/relationship question. Inspect the
target, select relevant direct edges, and follow at most one semantic hop initially.
Another hop requires an unresolved question. Never load the map, all neighbors or the
whole graph by default. The canonical agent rule lives in `AGENTS.md`.

## Portable defaults and local state

Two small optional vault settings are versioned:

- `.obsidian/app.json` makes newly inserted links relative Markdown for interoperability.
- `.obsidian/graph.json` starts with `tag:#axom` and existing targets only, keeping the
  initial human view focused on curated nodes. Clearing the filter reveals the wider vault.

Workspaces, layout, plugins, themes, other Obsidian state and `.trash/` are ignored.
The hygiene gate also rejects accidentally staged personal state. Keep the two shared
files minimal if Obsidian adds local preferences; inspect their diffs before committing.
No global settings, existing vaults, community plugins or personal files are configured.
The docs still work without these settings and without Obsidian.

## Maintenance and limits

Update canonical notes directly. Add metadata/edges only when they make the right source
easier to find; prefer an existing domain router over another map. New graph Markdown is
covered by `npm run repo:check`, along with category/authority metadata and required
routers; archives stay hash-protected. The category hubs link existing notes, not
generated source-file nodes. Active work routes through the
[maintenance registry](../operations/repository-audit.md#maintenance-registry). Do not bulk-rewrite old
notes or let Obsidian rename preserved files to tidy the graph.

Automatic doc-link relationships already provide a useful baseline. Import/test/API edge
extraction is deferred: it needs reliable module resolution and cannot infer semantic
authority from imports. No graph database, MCP, embeddings or generated snapshot is needed.
Use the next 10–20 real tasks to decide whether this lightweight route is insufficient.

Compatibility references: Obsidian's [Markdown links](https://help.obsidian.md/links),
[properties](https://help.obsidian.md/properties), [link settings](https://help.obsidian.md/settings)
and [graph view](https://help.obsidian.md/plugins/graph).
