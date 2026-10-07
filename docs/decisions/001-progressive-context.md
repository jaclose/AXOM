# 001: Progressive repository context

**Status:** accepted by the user's repository migration request, 2026-10-05.

**Context:** Short agent files still triggered reading the whole directions tree.
Large product-memory ledgers, dated implementation reports and conflicting setup
instructions consumed context without reliably describing the current checkout.

**Decision:** AGENTS.md is the canonical policy. Claude explicitly imports only AGENTS and AI_STATE; Copilot has a small bridge.
A session begins with that policy, AI_STATE and the task, then locates context through
search and/or INDEX. Expansion follows one logical dependency level and must answer a
concrete unresolved question. Folder proximity alone does not justify a read. The
conditional levels and implementation/completion checkpoints live only in AGENTS.
Existing governance, verbatim ideas and evidence retain their IDs/paths. Preserve exact
snapshots before replacing stale active instructions; uncertain assets require review.

**Reason:** Keep valuable reasoning available while limiting active context to the
current dependency surface. Repository memory must survive the conversation.

**Consequences:** Agents maintain a short dated handoff, update canonical docs rather
than duplicate explanations, and run lightweight budgets/link/artifact checks. Existing
historical paths are intentionally grandfathered where moving would break citations.
A new route does not approve product-memory proposals or ship another branch's work.

The checkpoint research replaced a prose-only Claude reference with supported `@path`
imports. See [loading evidence and limitations](../operations/repository-audit.md#strategic-checkpoint-loading-behavior-and-tools).
Instructions guide agents; automated checks enforce file budgets, import boundaries,
links and snapshot integrity, not every action an agent might take.
An aggregate 4,000 estimated-token budget includes the canonical pair and each tool's
bridge separately. Local telemetry reports words/bytes and approximate tokens without
dependencies or runtime tracking; [scope and limits](../operations/repository-audit.md#bootstrap-measurement-and-enforcement-limits)
distinguish the repository working set from the full client context.

New independent tasks normally use fresh sessions. Same-task follow-ups may stay in
the current session. A concise repository handoff replaces large catch-up prompts;
scoped commits require task authorization and never imply push/deployment authority.
