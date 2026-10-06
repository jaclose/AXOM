---
tags:
  - axom/architecture
authority: canonical
---
# Backend and AI boundaries

| System | Role | Relevant files / guide |
| --- | --- | --- |
| Supabase Auth + Postgres RPCs | Current optional accounts, protected revisions, devices, sharing | `web/src/lib/account/`, `web/src/lib/sync/`, [accounts contract](accounts-sync-v1.md) |
| Active database migrations | Tables, RLS, RPC privileges and quota policy | `supabase/migrations/`; [account setup](../ACCOUNTS-SETUP.md) |
| App AI provider boundary | Off/mock/Ollama/cloud selection and output validation | `web/src/lib/ai/index.ts` (`resolveActiveProvider`), `schemas.ts` |
| Cloud AI | User JWT, server quota, server-held upstream key | `supabase/functions/ai-proxy/{index,core}.ts`, [Cloud AI guide](../CLOUD-AI.md) |
| Vercel compatibility routes | Five retained handlers; `user`, `data`, `feedback` return 410 | `api/`, `lib/api/`, `vercel.json` |
| Legacy database | Historical name/PIN backend, not active account schema | `db/`; do not apply to Supabase account setup |

Components should use the existing provider interface, not embed API credentials or
call upstream models directly. Generated output is validated and review-gated.
Server-authoritative quota migrations supersede older client-limit assumptions in
setup prose. Read `20260928100000_make_ai_quota_server_authoritative.sql` when changing
quota behavior. This map describes repository code, not live keys, model availability
or deployed database state.

Do not treat every `web/src/services/` file as unused legacy code: `storageService.ts`
is used by current workspace snapshot code. `aiClient.ts`/`syncClient.ts` appear to have
no current import callers at baseline; removal needs a separate dependency audit.

Testing: `npm run typecheck:api`; `web/src/lib/ai/{ai,cloud}.test.ts`; account/sync tests
and PGlite migration replay. Run live-account tests only with authorization for their
external effects. [Deployment](../operations/deployment.md) routes actual setup steps.
