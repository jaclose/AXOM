# 001: Progressive repository context

**Status:** accepted by the user's repository migration request, 2026-10-05.

**Context:** Short agent files still triggered reading the whole directions tree.
Large product-memory ledgers, dated implementation reports and conflicting setup
instructions consumed context without reliably describing the current checkout.

**Decision:** AGENTS.md is the canonical policy. Claude explicitly imports only AGENTS and AI_STATE; Copilot has a small bridge.
A session begins with that policy, AI_STATE and the task, then retrieves through INDEX.
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

New independent tasks normally use fresh sessions. Same-task follow-ups may stay in
the current session. A concise repository handoff replaces large catch-up prompts;
scoped commits require task authorization and never imply push/deployment authority.
