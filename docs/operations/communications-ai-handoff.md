# AXOM Communications and Pulse: implementation handoff

## Status and scope

**Implemented locally; provider activation pending.** Branch `feat/axom-communications-pulse`,
worktree `/Users/jd/Developer/AXOM-communications-pulse`, based on `c46ae207`.
The user required a local commit. No push, merge, deployment, email send or paid service
activation was authorized or performed. The requested Resend connection is the next
operator-owned step. Read the actual branch HEAD for the delivered commit.

The complete behavior/visual specification is [Communications](../features/communications.md).
The exact external actions are in [the activation runbook](communications-resend.md).
The local visual gallery is `artifacts/communications/index.html`; it is generated from
production email rendering, with explicitly fictional fixtures and real browser screenshots.

## Task-by-task result

| Prompt task | Delivered implementation | Remaining operator acceptance |
| --- | --- | --- |
| 1. Infrastructure audit | Existing stack/auth/reports/theme/games/exam/backup map in feature contract | Compare staging/production migration history |
| 2. Canonical types/preferences | Ten independent default-off options, essential categories, timing validation, RLS | Save/reload against actual deployed account |
| 3. Centralize Resend | One server-only provider adapter, disabled/test/live modes, three sender identities | Key permissions, verified domains, Reply-To |
| 4. Send pipeline | Durable jobs, worker lease, unique keys, pre-send eligibility, bounded retries/history | Cron timing, actual throughput and provider responses |
| 5. Design system | Shared React SSR/table primitives, two appearances, accent, authentic Orb, text alternative | Real Gmail/Apple Mail/Outlook rendering |
| 6. Welcome | Account-profile trigger; verification-aware defer; essential welcome | New disposable signup through actual Auth |
| 7. Settings | Working preferences, schedules, preview/download, history and status/error states | Authenticated save in production |
| 8. Unsubscribe/suppression | Signed capability, GET confirmation, POST one-click, all-optional off, address suppression | Actual inbox one-click behavior and bounce fixtures |
| 9. Webhooks | Raw-body Svix verification, dedupe/retry, early-event reconciliation, opt-out mirror | Resend endpoint registration and signed replay |
| 10. Weekly report | Shared completed-week snapshot and metric denominators/deltas | Latest real protected copy and inbox |
| 11. Daily Games | Enabled DailyWord and DoctorDle links, graceful missing data | Actual game availability; no external results claimed |
| 12. Monthly report | Completed month, comparison and email-safe bar rows | Real month data/inbox |
| 13. Essays | Canonical public article, secure studio, authored content/variables, two delivery paths | Author/publish approved content; choose one send path |
| 14. Exam reminders | Existing board-prep exam/date/route, 14/7/3/1-day triggers | A real upcoming plan in protected copy |
| 15. Export/deletion | Private async JSON export, signed downloads, grace/cancel/reauth, completion receipts | Retention review and disposable live deletion before activation |
| 16. Pulse snapshot | Versioned canonical adapter with immutable account period records | Confirm completeness/freshness of protected copy |
| 17. Pulse email | Teaser of same annual snapshot with deep link | Annual delivery and redirect on deployed host |
| 18. Pulse web | Cinematic Orb, evidence sections, mobile/light/dark/reduced-motion, opt-in PNG/JSON | Native-shell smoke and real account snapshot |
| 19. Admin tools | Server UUID allowlist, draft/preview/test/audience/schedule/cancel, Broadcast export | Assign actual admin UUID; consented test recipient |
| 20. Tests/docs/visuals | Unit/SQL/server/browser suites, 160 email variants, auth files, detailed guides | Real external integration and email-client matrix |

The missing external work is deliberately concrete. No credentials or mock production
statistics substitute for it. Unavailable data stays omitted: external Anki retention,
external game results, ambiguous longest session/streak and automatic course completion.
Device-only avatars are not uploaded or embedded into outbound mail.

## Files to review first

- `web/src/lib/communications/model.ts`: categories, timing, types and safe variables.
- `snapshot.ts` and `context.ts`: canonical report/attempt and exam-plan reuse.
- `email.tsx`: all 20 reusable templates and dependency gates.
- `server/provider.ts`: the only Resend HTTP adapter and signature verifier.
- `server/service.ts`: consent, snapshots, jobs, scheduling, contact sync, events.
- `server/privacy.ts`: private export and account removal state transitions.
- `server/campaigns.ts`, `server/handler.ts`: author/admin/API boundaries.
- `supabase/migrations/20261010000100_communications_pulse.sql`: additive state, RLS,
  atomic claims/publication, rate limit and welcome trigger.
- `supabase/functions/communications/{index.ts,service.js,deno.json}`: generated deployment.
- `supabase/templates/communications/*.html`: operator-installed Auth email templates.
- Five communication/privacy/Pulse/essay pages and scoped stylesheet.
- `web/e2e/communications-pulse.spec.ts`: actual UI journeys with a fake account API boundary.

The only shared product seams are App route/title registration and Settings account-tab
links. Existing Supabase config gets one function stanza. Vercel gets the Pulse redirect.
There are no package, lockfile, store, backup or local schema changes. Two exact-path
`.gitattributes` entries preserve intentional Markdown hard-break spaces in the verbatim
source prompts while keeping the remaining staged whitespace check strict.

## Verification ledger

### Privacy backup feedback continuation, 2026-10-13

Continues `64be987d`. The existing export API returns `missingBlobKeys`; Privacy
discarded that result and always reported success. Privacy now reports incomplete
media explicitly, preserves the warning through both deletion confirmation steps,
and clears it only after a complete retry. Successful feedback includes the image
count. Local backup no longer waits on a remote account refresh. The canonical
backup implementation and separately owned private-library/media files are untouched.

Current verification:

- `npm --prefix web test -- src/lib/backup.test.ts src/lib/questionAttachments.test.ts --maxWorkers=1`: **42 passed, 0 failed**, two files.
- `npm --prefix web run build`: **PASS**, including TypeScript and Daily Games isolation.
- Targeted ESLint on `web/src/pages/PrivacyPage.tsx` and `web/e2e/communications-pulse.spec.ts` with `--max-warnings=0`: **PASS**.
- The communications Playwright command below: **7 passed, 0 failed**.
- The new regression uses actual IndexedDB and downloaded JSON, with synthetic metadata
  referencing a missing image. It inspects the incomplete file, checks the warning
  through deletion preflight, restores real PNG bytes, downloads again and verifies
  both the embedded bytes and cleared warning. No real deletion or email is requested.
- A focused extension also passes at 390px light and 1440px dark, including an Enter-key
  retry, zero horizontal overflow and an inspected warning screenshot.
- Refreshed artifact integrity and email browser verification: **320 layouts**, **16
  static fallbacks**, **16 bounded-motion checks**, zero console issues.
- Refreshed gallery browser verification: **24 local links**, **64 control selections**,
  **2 video checks**, zero console issues. Artifact browser commands use the documented
  `AXOM_E2E_SOFTWARE_GRAPHICS=1` prefix.
- `npm run test:repo`: **43 passed, 0 failed**. `npm run repo:check` and `git diff --check`: **PASS**.

The gallery links the incomplete-backup screenshot. Older 83-test/320-email evidence
below remains dated to the previous checkpoint rather than being relabeled as a fresh
logic-suite run. Packaging still requires source-matching gallery browser reports.

Read-only integration preparation used `git merge-tree --write-tree`:

| Target snapshot | Text merge result |
| --- | --- |
| `main` at `5355e5e7` | Only `docs/AI_STATE.md` conflicts |
| Rolling integration at `a7a41073` | Only `docs/AI_STATE.md` conflicts |
| Academic library at `a039e872` | Only `docs/AI_STATE.md` conflicts |

App, Settings and migration changes did not produce text conflicts. The Settings
preview retained the newer backup/import behavior and communications links. No branch
was merged, no owner worktree was written, and the combined runtime was not tested.
An integration owner must update the state note and validate the chosen combined tree;
these dated previews are not permission to merge or proof of production compatibility.

### Strategic checkpoint, 2026-10-13

Continues committed optical revision `3ac16528`; the branch was clean on recovery.
No feature was restarted. The config audit again confirms `supabase/config.toml`
contains only five added lines relative to `c46ae207`, with no removed configuration.
This checkpoint does not alter App, Settings, Vercel, migrations or provider logic.

The deeper browser check found that React SSR escaped the CSS pseudo-element content
quotes, preventing the email sheen from appearing. The renderer now emits only its
static authored CSS as raw style text; personalized/author content remains escaped.
Inboxes get one 2.4-second sweep after a 0.6-second delay, then settle. Pulse retains
its recurring reflection and pause controls. This follows
[W3C pause/stop guidance](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
Saved Resend, Playwright and Motion resources were revisited; current
[Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys)
still supports the existing frozen-payload/23-hour retry boundary. No new dependency
or provider integration was justified.

The gallery previously linked outside its served directory. It now includes the five
linked canonical documents, with source/output hashes and recursive HTTP link checks.
The new packager uses the already-installed JSZip, requires committed source and fresh
browser evidence, writes a commit-qualified archive, and preserves previous deliveries.
It includes the complete feature patch from `c46ae207`; the next AI should continue the
existing branch, not reapply that patch or restart the original prompt.

| Current checkpoint check | Actual result |
| --- | --- |
| `npm --prefix web run typecheck` | PASS |
| Targeted ESLint command below | PASS; zero warnings |
| `npm --prefix web run build` | PASS; TypeScript and Daily Games isolation included |
| Focused four-file command below with `--maxWorkers=1` | 83 passed, 0 failed; four files |
| Communications Playwright command below | 6 passed, 0 failed; 1.5 minutes |
| `node scripts/verify-communications-previews.mjs` | 320 layouts/reduced-motion checks, 16 static fallbacks, 16 actual bounded-motion checks; zero console issues |
| `node scripts/verify-communications-gallery.mjs` | 23 local links, 64 control selections, 2 video checks; zero console issues |
| Build/Auth/preview generators and artifact integrity | PASS; 28 source inputs, 7 Auth/security files, 160 HTML variants |
| `npm run test:repo` | 43 passed, 0 failed |
| `npm run repo:check` and `git diff --check` | PASS |
| Negative integrity/packaging checks | Correctly reject stale copied documentation and uncommitted source |

```sh
web/node_modules/.bin/eslint web/src/lib/communications web/src/components/communications web/src/pages/CommunicationsPage.tsx web/src/pages/CommunicationsAdminPage.tsx web/src/pages/PrivacyPage.tsx web/src/pages/PulsePage.tsx web/src/pages/EssayPage.tsx web/e2e/communications-pulse.spec.ts --max-warnings=0
npm --prefix web test -- src/lib/communications/communications.test.ts src/lib/communications/server.test.ts src/lib/communications/database.test.ts src/lib/sync/supabaseMigrations.pglite.test.ts --maxWorkers=1
AXOM_E2E_CHANNEL=chrome AXOM_E2E_BASE_URL=http://127.0.0.1:5196 npm --prefix web run test:e2e -- e2e/communications-pulse.spec.ts --global-timeout=300000
```

Node 22.23.1 and installed Chrome were used. Desktop/mobile, light/dark, reduced motion,
settings, privacy, studio, essay and Pulse journeys were rerun against this tree.
Manual Playwright CLI review exercised gallery treatment/appearance/accent controls,
1440/390 layouts and console; regenerated Pulse dark and editorial light emails and
Pulse screenshots were visually inspected. All fixtures remain synthetic.
Two initial motion-verifier runs exposed the escaped-CSS defect; the repaired output
passes. The verifier pauses CSS before enabling motion, then seeks actual browser
animation states so host contention cannot exhaust the short effect before inspection.
An artifact refresh later hit a local-navigation timeout under host load above 300.
The final email/gallery commands use the test-only prefix
`AXOM_E2E_SOFTWARE_GRAPHICS=1` to reduce GPU contention; their JSON reports record this.
Navigation is bounded at 60 seconds, and every layout/motion assertion is retained.
This is Chrome layout/behavior evidence, not a hardware frame-rate measurement.
The six product journeys ran with the normal installed-Chrome configuration.

Active private/academic-library validators were respected; their completed process
reservation was released only after repeated live process/cwd checks. The final heavy
lane was released after the successful build and six journeys. Existing large-chunk
and mixed-import notices remain; no new browser console warning was introduced.
The older full-unit baseline below was not rerun. Real inbox/provider/native tests,
remote migration, live deletion and deployment remain outside this local checkpoint.

### Optical glass revision, 2026-10-11

Continues baseline commit `f936f7a8` on the same branch. JD requested more AXOM glass,
Orb identity and the occasional travelling sheen from the real Anki CSS. Four email
families, five product surfaces, share PNG and visual gallery are refreshed. Delivery,
consent, account data and migration contracts are unchanged. Read HEAD for the revision
commit; no external activation occurred.

| Current revision check | Result |
| --- | --- |
| `npm --prefix web run typecheck` | PASS |
| Targeted ESLint for communications modules/components, five pages and E2E | PASS; no warnings |
| `npm --prefix web run build` | PASS; includes TypeScript and Daily Games isolation |
| Focused four-file command below | 83 passed, 0 failed |
| Communications Playwright command below | 6 passed, 0 failed |
| `node scripts/verify-communications-previews.mjs` | 320 email viewports + 16 stylesheet-stripped fallbacks pass; zero console issues |
| Build / auth / preview generators and artifact integrity | PASS; 28 source inputs, 7 auth/security templates, 160 previews |
| `npm run test:repo` | 43 passed, 0 failed |
| `npm run repo:check` and `git diff --check` | PASS |

Browser acceptance covers moving sheen, visible pause/resume, offscreen pause, OS and
AXOM reduced motion, desktop/mobile, light/dark, classic and amethyst product accents,
and all four email accents. The new email-browser verifier is repeatable from source.
Visual review corrected a clipped Orb caption, weak light-mode accent text and missing
local motion controls. Artifact integrity caught spacer-coupled OTP insertion; the
named auth slot now guards that interface. `pulse-optical-motion.webm` shows the actual
Pulse interface with synthetic fixtures, with playback controls in the gallery.

Final browser rerun:

```sh
AXOM_E2E_CHANNEL=chrome AXOM_E2E_BASE_URL=http://127.0.0.1:5196 npm --prefix web run test:e2e -- e2e/communications-pulse.spec.ts --global-timeout=240000
```

One earlier expanded run timed out before any case ran during recorded host contention.
The bounded final rerun completed all six cases. Other tasks' build ownership was preserved.
Motion capture is repeatable via `scripts/capture-communications-motion.mjs`; its separate
Playwright video runtime and `ffmpeg` requirement affect artifact generation only.

The full 2,922-test quality suite below is the baseline evidence; it was not rerun for
this visual revision. Native and actual email-client/provider checks remain unrun.
Existing production-build notices about `webUpdates` mixed imports and large chunks
remain. No new application dependency or remote service configuration was added.

### Baseline implementation, f936f7a8

Finalization date: **2026-10-11**, Node **22.23.1**, isolated feature worktree above.
The commands below ran against the baseline implementation. All provider/network/account
boundaries in application E2E are synthetic. No real provider send is claimed.

| Command / check | Actual local result |
| --- | --- |
| `node scripts/build-communications.mjs` | PASS; generated Edge bundle from canonical TypeScript |
| `node scripts/render-communications-auth.mjs` | PASS; six Auth templates plus security template |
| `node scripts/preview-communications.mjs` | PASS; 20 templates × 2 appearances × 4 accents, plus 20 text alternatives |
| `node scripts/verify-communications-artifacts.mjs` | PASS; SHA-256 matches for 28 source inputs, generated bundle and seven Auth/security files; 160 HTML variants checked |
| `deno check --node-modules-dir=none --config supabase/functions/communications/deno.json supabase/functions/communications/index.ts` | PASS |
| `npm --prefix web run quality` | PASS; TypeScript, full ESLint, full Vitest and production build including Daily Games bundle isolation |
| Full Vitest within quality | **2,922 passed, 5 skipped, 0 failed; 293 files passed, 3 skipped** |
| Focused command below | **83 passed, 0 failed, 4 files**; includes communications/server/real-PGlite and existing Supabase migration tests |
| Communications Playwright command below | **6 passed, 0 failed**; installed Chrome, desktop/mobile, mocked account API |
| Playwright CLI email matrix | **320/320 passed**: all 160 variants at 390px and 660px, no overflow, broken images or missing title; representative screenshots inspected |
| `npm run test:repo` | **43 passed, 0 failed** |
| `npm run repo:check` | PASS; 0 problems, conflict markers or routing/metadata errors |
| `git diff --check` | PASS |
| Frontend production-bundle secret-boundary scan | No Resend API key, Supabase service-role or cron-secret variable names in browser JS |

```sh
npm --prefix web test -- src/lib/communications/communications.test.ts src/lib/communications/server.test.ts src/lib/communications/database.test.ts src/lib/sync/supabaseMigrations.pglite.test.ts
AXOM_E2E_CHANNEL=chrome AXOM_E2E_BASE_URL=http://127.0.0.1:5196 npm --prefix web run test:e2e -- e2e/communications-pulse.spec.ts --global-timeout=120000
```

Start `node scripts/dev-communications.mjs` before the browser command. Build scripts
must run before Auth/gallery generation; the integrity check fails if generated code
or Auth files no longer match their sources. Browser screenshots are regenerated by
this E2E spec; generated visuals are local artifacts rather than committed binaries.

Visual QA covered 1440 × 900 and 390 × 844: communications settings, privacy, studio,
public essay and Pulse. Pulse dark/light heroes, the complete scroll, and actual
1080 × 1350 PNG exports were inspected. The initial share export contains no name;
including a name requires checking the option. Email review included dark/light,
gold/teal/violet/rose, plaintext and the authentic Orb. Fixtures are explicitly synthetic.
Studio/essay links, standalone essay mobile padding and screenshot scroll position
were corrected after inspection.

Browser interactions cover preference save/all-off, preview/download, export/local
backup, deletion/cancellation/failure, keyboard activation, invalid template variables,
audience review, test/schedule/cancel, publication/Broadcast export, missing essay,
Pulse empty/motion/PNG/clipboard/share fallback/JSON. Normal app console errors and
warnings are asserted absent, except the single expected network 403 deliberately
injected in the reauthentication failure test. Native OS share-sheet delivery remains unverified.
Playwright tracing is disabled in this spec because its injected snapshot scripts
conflict with the intentionally script-free email iframe sandbox.

The five skipped tests belong to existing local/private QBank fixture suites; no new
communications tests are skipped. Build notices remain for the existing mixed
static/dynamic `webUpdates.ts` import and large application/spreadsheet chunks. The
Playwright launcher reports the shell's NO_COLOR/FORCE_COLOR conflict; this is separate
from the checked application console.

The initial broad run failed because borrowed dependency symlinks put a PDF worker
outside Vitest's file allowlist. A fresh `npm ci` then failed with ENOSPC. Only that
partial task-owned install was removed. An APFS copy of the existing web dependencies
resolved the file boundary without another large install; the source lockfile is byte
identical. One subsequent Chrome worker hung during shutdown after reporting all six cases; only
that task-owned runner was stopped. A bounded rerun exited cleanly with all six passing.
All final checks above passed afterward. No package/lockfile was modified.
The private-library heavy reservation was released only after live process inspection
confirmed its build/test had finished, not from the dated board entry alone.

**Not run / not established:** full unrelated Playwright suite, native Tauri launch,
remote Supabase/Postgres service execution, real SMTP/Resend, DNS verification, cron,
live webhook delivery, Gmail/Apple Mail/Outlook rendering, live account deletion.
The additive migration was replayed locally in PGlite, not applied to staging or production.

## Checkpoint research and improvements

The original branch was retained. Current primary documentation changed or confirmed
these concrete implementation decisions:

- [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys):
  freeze the complete request before sending; retries retain its exact body and stop
  within the 24-hour provider retention window. The local cutoff is 23 hours from first
  attempt. An interrupted fifth attempt and exhausted deletion receipt require review.
- [Contact Topic updates](https://resend.com/docs/api-reference/contacts/update-contact-topics)
  and [Broadcasts](https://resend.com/docs/api-reference/broadcasts/create-broadcast):
  use current Topics/Segments and native Broadcast unsubscribe variables. AXOM keeps
  canonical consent; generic Broadcast exports omit private course/exam information.
- [Supabase SMTP via Resend](https://resend.com/docs/send-with-supabase-smtp) and
  [Auth template variables](https://supabase.com/docs/guides/auth/auth-email-templates):
  preserve secure Supabase action/OTP variables; reauthentication is OTP-only.

Relevant saved Resend, Supabase and Playwright resources were inspected. Existing
Playwright plus real-renderer previews provided the useful local capability; no new
external account, MCP infrastructure or design-file dependency was needed. The native
computer-use browser was unavailable; installed Chrome through Playwright completed
visual review. The new integrity verifier makes future generated-bundle drift detectable.

Additional audit repairs: actual persisted exam-plan reuse, canonical active dates,
pre-send consent/address checks, restrictive private-export Storage policy, fresh
on-demand export links, terminal webhook ordering, bounded external-event reconciliation,
template isolation so editorial content cannot override a Pulse/report CTA, and a
deletion dependency guard that preserves Auth when a linked provider contact cannot
be removed without its credential.
Supabase config was compared with HEAD: **five lines added, zero removed**, with its
original configuration retained. App, Settings and Vercel changes remain narrowly scoped.

## Copy-ready next-AI brief

> Continue AXOM Communications and Pulse from `feat/axom-communications-pulse` in its
> isolated worktree. Read AGENTS, AI_STATE, docs/features/communications.md and
> docs/operations/communications-resend.md. Preserve active course/QBank/media work;
> do not overwrite App or Settings during integration. The requested feature is
> implemented and locally committed; do not rebuild it as a disconnected prototype.
> Rebuild the generated Edge bundle after source changes. Verify the actual target
> Supabase migration history before applying anything. The operator will configure
> verified Resend domains, keys, SMTP, ten opt-out Topics, signed webhooks, worker
> scheduling and administrator UUIDs. Start with disabled mode, then one explicit
> safe test recipient. Keep deletion disabled until disposable-account retention/cascade
> tests pass. Do not send a real campaign, push, merge or deploy without the user's
> authority. Distinguish local test evidence from staging/live results, and commit any
> completed follow-up changes using exact-path staging.

## Suggested activation order

1. Review the visual gallery and isolated commit, then integrate the small shared seams.
2. Configure staging according to the runbook and verify one consented recipient end to end.
3. Complete the real-client/retention matrix, activate deliberately and monitor queue age.

Term-level Pulse, richer authorized cohort targeting and external Anki/game ingestion are
future extensions. They are not required to activate this annual, canonical-data implementation.
