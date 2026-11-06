# Deployment and updates

This page routes procedures; it does not establish live deployment state. JD retains
release ownership; the owner-approved unified release gateway may commit, push, merge
and publish a validated bundle within the authorization below. Passing tests alone
never authorizes an unrelated, destructive or unreviewed release.

| Need | Canonical procedure / implementation |
| --- | --- |
| Native packaging, signing, updater feed | [Desktop release](../DESKTOP-RELEASE.md), \`scripts/release.mjs\`, \`.github/workflows/release.yml\`, \`.github/workflows/update-feed.yml\` |
| Coordinated edition names and intake fields | [AXOM FORGE release nomenclature](release-nomenclature.md) |
| General coding, ownership and IDE practice | [Engineering SOP](engineering-sop.md) |
| Web update consent/recovery/offline behavior | [Update policy](../UPDATE-POLICY.md), `web/src/lib/webUpdates.ts`, `web/public/sw.js` |
| Accounts configuration/migrations | [Account setup](../ACCOUNTS-SETUP.md), `supabase/config.toml`, `supabase/migrations/` |
| Cloud AI function/secrets | [Cloud AI](../CLOUD-AI.md), `supabase/functions/ai-proxy/` |

Vercel uses the repository root: `vercel.json` installs root + web dependencies,
builds the web app and serves `web/dist`. `.vercelignore` intentionally limits uploads;
shared release-note scripts and the AI proxy core are included for builds/tests.
Root `api/` compatibility rewrites still exist; account/data name-login handlers return
410. They are not the account provisioning path.
The SPA fallback excludes `/assets/`. If a deployment no longer contains a hashed
JavaScript or CSS file, the request must fail as a 404 instead of serving HTML under
an asset URL. Asset responses use Vercel's revalidation default rather than a
one-year browser cache rule, so a transient missing-file response cannot stay
cached as an immutable app file.

`npm run release:doctor` checks local release prerequisites. `npm run release:web`
creates the web package; `npm run release` runs the native release path as documented.
Generated packages live under ignored `dist/releases/`. Versions are coordinated by
release scripts; don't hand-edit one manifest to simulate a release.

Older setup/runbook status is dated evidence. Check the live project before assuming
migrations, SMTP, secrets, signing, updater feed or URLs are configured. The [October
account incident](../release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md) documents a database
failure and repair; its existence does not prove the migration is deployed.

## AXOM unified release gateway

**Release authority name: AXOM FORGE.** The guide to named release families,
technical versions and source-packet expectations is [release nomenclature](release-nomenclature.md).
FORGE operates independently of MOTHERSHIP engineering coordination and APEX PRIME
academic source integration; its release state and decisions belong to issue
[#140](https://github.com/jaclose/AXOM/issues/140).


**Standing operating standard (owner-authorized 2026-11-06):** combine compatible
feature-branch work into one coherent, tested release instead of independently
publishing each completed PR. This is a release coordination mandate, not blanket
approval for destructive operations, secret handling or exposing private material.
The gatekeeper owns the final release decision; feature owners retain their scoped
work until integration is accepted.

### Release train and ownership

1. **Inventory:** Read `AGENTS.md`, relevant `AI_STATE.md` sections, the live
   MOTHERSHIP coordination issue #106, APEX issue #101, active PR ownership, exact
   current `main`, dependency and environment status. Every candidate is a pinned
   branch+head SHA; record PR, owner, affected files, tests, migration/order, risk and
   independent release blockers. Include only finished, explicitly approved scope.
2. **Select and freeze:** Maintain a single release issue/manifest identifying
   INCLUDED, HELD, SUPERSEDED or ALREADY_IN_MAIN. Freeze a cutoff revision for
   each included branch; later edits go to the next train unless their owner
   re-qualifies the full integration. Never incorporate a draft, a failing branch,
   open reviewer/security objection, unknown license, private fixture, missing
   permission, or unresolved data migration by default.
3. **Integrate:** Create an isolated `release/YYYY-MM-DD-<slug>` branch from the
   current `main`. Integrate source commits while preserving their provenance,
   keeping source PR links and exact SHAs in the manifest. Deduplicate already-
   merged patches. Explicitly resolve file/behavior/schema conflicts and test
   both sides; never silently choose the later branch or change an active PR's base
   or force-push its head. Respect owner claims for APEX, MOTHERSHIP, Community,
   Productivity/Soundscapes and live database/mail workstreams.
4. **Validate one candidate:** First run affected unit/regression tests and
   migration/contract checks, then `npm run test:repo`, `npm run repo:check`,
   `cd web && npm run verify:all` and the relevant native/security/dependency
   and deployment-input checks from [validation routes](testing.md). Run real
   browser smoke tests at 1440px, 390px and 320px for affected controls,
   accessibility/reduced motion, signed-in/offline behavior, account isolation,
   persistence and save/refresh safety. Require every mandatory GitHub CI job
   green on the **exact combined release head**, not merely on source branches.
5. **Preview and risk gate:** Check the exact Vercel preview, its origin, console,
   asset availability and main workflows. For Supabase changes, validate intended
   project/environment, RLS/authorization, migration sequencing, backwards
   compatibility, recoverability and production application separately. Resend
   templates, email schedules, credentials and customer mail are separate staged
   acceptance gates. A green deploy never proves any of these. Record a tested
   rollback or forward-repair strategy before publication; do not pretend a
   database or leaked message can be rolled back by reverting web code.
6. **Publish once:** Recheck `main` SHA and all integration inputs immediately
   before release. If any input changed, re-integrate and re-run impacted gates.
   Open one final integration PR to `main` with manifest, approval, checks,
   migration order and rollback evidence. Merge the validated integration PR,
   not each feature branch separately. Coordinate one production deployment;
   verify actual deployed commit/build and then run live smoke/readback checks.
7. **Close and report:** Publish one release note with included/superseded/held
   PRs, merge SHA, exact check run URLs, verification limitations, migration and
   deployment status, follow-up owners, production verification and rollback.
   Close source PRs only after confirming their changes were included; preserve
   author attribution and history references. Pending work remains in the next
   train, not falsely reported as shipped.

### Gate outcomes and exceptional releases

States: `CANDIDATE` → `FROZEN` → `INTEGRATED` → `VERIFIED` → `MERGED` →
`DEPLOYED` → `LIVE_ACCEPTED`. Use `HELD` and a concrete blocker/retest owner
where needed. A task is never `DEPLOYED` solely because its branch was pushed.

**Stop the line** for a failed required check, a head/base mismatch, conflicting
migration, unexplained data change, unverified security/privacy boundary, missing
rollback, or inaccessible production state. Publish a **separate emergency
hotfix** only when delaying a security/data-integrity repair would be worse; record
why it bypassed normal batching, test its isolated scope, and reconcile it into the
next train. Do not batch high-risk changes simply to increase release size.

The gatekeeper's standing permission covers routine reversible commits, pushes,
PR coordination and merging after these gates are satisfied. Production migrations,
outbound customer emails, paid services, irreversible deletion, and any operation
outside owner authorization require their own explicit authorization and verified
provider access. If tools cannot execute or verify a stage, report it as blocked,
not completed.
