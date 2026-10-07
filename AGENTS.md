# Agents working on AXOM

Start with `docs/directions/README.md`. It holds JD's ideas bank (verbatim notes plus an index with an ID, status and owner for every item), progress sorted by major updates, updates and hotfixes, what each branch is doing, per-agent notes, the completed log and future additions.

Before planning or coding, read `docs/product/AXOM-LEARNING-INTELLIGENCE-DOCTRINE.md`, `docs/directions/01-ideas/INDEX.md`, the relevant verbatim ideas and feature plan, and current in-flight/worktree state. The doctrine governs feature priority; `docs/product/IDEAS-RECONCILIATION-2026-10-04.md` preserves the full Ideas 1–6 roadmap. Question-first is the first implementation wedge, not the whole product.

- Coordination between agents: `/Users/jd/Developer/AXOM-coordination/BOARD.md` (outside the repository). Read it before editing shared files.
- Gate: `cd web && npm run verify:all` (typecheck, lint, unit tests, build, update and offline checks, Playwright e2e).
- The repository is public: no personal data, credentials, phone numbers, or media without a licence. Never push to main; JD pushes.
- Design and voice: `docs/design/DESIGN.md` (plain language, no em dashes, lucide icons). The setup flow is the visual standard for every fill-in form.
