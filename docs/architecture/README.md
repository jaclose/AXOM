---
tags:
  - axom/navigation
authority: navigation
---
# Architecture map

| Boundary | Implementation | Focused route |
| --- | --- | --- |
| Browser UI and app lifecycle | `web/src/main.tsx`, `web/src/App.tsx`, `pages/`, `components/` | [Frontend](frontend.md) |
| Workspace and portable data | `web/src/lib/{types,seed,store,localVault,backup}.ts` | [Data model](data-model.md) |
| Optional accounts, revisions, conflicts | `web/src/lib/account/`, `web/src/lib/sync/` | [Accounts contract](accounts-sync-v1.md) |
| Cloud functions and legacy compatibility | `supabase/`, `api/`, `lib/api/` | [Backend](backend.md) |
| Canonical native shell | Root `src-tauri/`, launched by `scripts/tauri.mjs` | [Desktop release](../DESKTOP-RELEASE.md) |
| Updates and recovery checkpoints | `webUpdates.ts`, `updateCheckpoint.ts`, `web/public/sw.js` | [Update policy](../UPDATE-POLICY.md) |
| Product subsystem | Page/component + relevant domain modules | [Feature router](../features/README.md) |

The web subtree's `src-tauri/` is superseded. `Sources/`, `Package.swift`, `Resources/`
and `scripts/legacy/` retain the original Swift app and tooling. Root `db/` is the
retired Vercel database, not the active Supabase migration directory. Do not relocate
these merely because both old and current versions exist; scripts and evidence use them.

Earlier `AI_INFRA`, `DATA_STRATEGY` and `LIFECYCLE` explanations mixed plans with current
claims. Their old paths now route to current contracts; exact originals remain in the
[archive](../archive/README.md). See the [audit](../operations/repository-audit.md) for
large-file and refactor candidates, not an instruction to undertake them.
