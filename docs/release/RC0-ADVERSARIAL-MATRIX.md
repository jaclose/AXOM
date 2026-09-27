# Beta RC0 adversarial matrix

This is the release-engineering evidence index for the local beta checkpoint.
`PASS` means the scenario has automated evidence in this branch. `BLOCKED`
means the test requires an unavailable local Supabase runtime; it is not a
claim about hosted production behavior.

| # | Area | Scenario | Evidence | Result |
|---:|---|---|---|---|
| 1 | Account/database | unauthenticated revision push | `db/migrations/003_accounts_sync_sharing_v1.sql` | BLOCKED — local Supabase unavailable |
| 2 | Account/database | Account A cannot read Account B revisions | migration RLS policies | BLOCKED — local Supabase unavailable |
| 3 | Account/database | Account B cannot update Account A share | migration RLS policies | BLOCKED — local Supabase unavailable |
| 4 | Account/database | anonymous share token resolution is bounded | `databaseMigration.test.ts` | BLOCKED — local Supabase unavailable |
| 5 | Account/database | idempotent retry does not duplicate a revision | `syncCoordinator.test.ts`, migration RPC | BLOCKED — local Supabase unavailable |
| 6 | Account/database | stale base revision is preserved as a conflict | `syncCoordinator.test.ts`, migration RPC | BLOCKED — local Supabase unavailable |
| 7 | Account/database | revision retention keeps latest 60 canonical rows | migration RPC retention query | BLOCKED — local Supabase unavailable |
| 8 | Account/database | oversized snapshot is rejected | migration RPC size check | BLOCKED — local Supabase unavailable |
| 9 | Account/database | malformed share payload is rejected | migration RPC format check | BLOCKED — local Supabase unavailable |
| 10 | Account/database | revoked/random/malformed token cannot retrieve a share | share RPC predicate | BLOCKED — local Supabase unavailable |
| 11 | Application Checker | schema v1 upgrades to v2 | `applicationSchools.test.ts` | PASS |
| 12 | Application Checker | duplicate IDs are rejected, including malformed first rows | `applicationSchools.test.ts` | PASS |
| 13 | Application Checker | duplicate canonical names remain a warning | `applicationSchools.test.ts` | PASS |
| 14 | Application Checker | stale verified records become needs-refresh | `applicationSchools.test.ts` | PASS |
| 15 | Application Checker | future timestamps are rejected | `applicationSchoolPipeline.test.ts` | PASS |
| 16 | Application Checker | malformed URL/provenance findings are reported | `applicationSchoolPipeline.test.ts` | PASS |
| 17 | Application Checker | incremental merge preserves absent fields | `applicationSchools.test.ts` | PASS |
| 18 | Application Checker | material disagreements remain field conflicts | `applicationSchools.test.ts` | PASS |
| 19 | Application Checker | 271/500/1000 records parse without quadratic work | `applicationSchools.test.ts` | PASS |
| 20 | Application Checker | redirected merge output remains valid JSON | `applicationSchoolPipeline.test.ts` | PASS |
| 21 | Question import | 50 clean MCQs | `questionBankStress.test.ts` | PASS |
| 22 | Question import | 200 clean MCQs | `questionBankStress.test.ts` | PASS |
| 23 | Question import | 500 clean MCQs | `questionBankStress.test.ts` | PASS |
| 24 | Question import | A./A)/A:/A- boundaries | `questionAdversarialMatrix.test.ts` | PASS |
| 25 | Question import | A–E options | `questionAdversarialMatrix.test.ts` | PASS |
| 26 | Question import | multiline stems and options | `questionAdversarialMatrix.test.ts` | PASS |
| 27 | Question import | answer key at document end | `questionAdversarialMatrix.test.ts` | PASS |
| 28 | Question import | separate answer/explanation source | `questionAdversarialMatrix.test.ts` | PASS |
| 29 | Question import | textual answer mapping | `questionAdversarialMatrix.test.ts` | PASS |
| 30 | Question import | numeric answer remains reviewable | `questionAdversarialMatrix.test.ts` | PASS |
| 31 | Question import | repeated question numbers | `questionAdversarialMatrix.test.ts` | PASS |
| 32 | Question import | numbered lists inside vignettes | `questionAdversarialMatrix.test.ts` | PASS |
| 33 | Question import | numbered/lettered explanations | `questionAdversarialMatrix.test.ts` | PASS |
| 34 | Question import | headers, footers, page numbers, copyright | `questionAdversarialMatrix.test.ts` | PASS |
| 35 | Question import | malformed middle question remains visible | `questionAdversarialMatrix.test.ts` | PASS |
| 36 | Tracker/Command Brief | 2,000 tracker-item ranking | `recommendationFactors.test.ts` | PASS |
| 37 | Tracker/Command Brief | snoozed work stays out until due | `recommendationFactors.test.ts` | PASS |
| 38 | Tracker/Command Brief | pass target changes completion evidence | `recommendationFactors.test.ts` | PASS |
| 39 | Tracker/Command Brief | difficulty and assessment urgency are explicit factors | `recommendationFactors.test.ts` | PASS |
| 40 | Tracker/Command Brief | stable tie-break and contribution sum | `commandBrief.test.ts` | PASS |
| 41 | Tracker/Command Brief | completed scheduled targets are omitted | `commandBrief.test.ts` | PASS |
| 42 | Tracker/Command Brief | low-readiness evidence changes effort, not truth | `commandBrief.test.ts` | PASS |
| 43 | Recovery/PWA | local backup validates before replacement | `backup.test.ts`, `storageRecovery.test.ts` | PASS |
| 44 | Recovery/PWA | corrupt/unsupported backup is rejected | `backup.test.ts` | PASS |
| 45 | Recovery/PWA | attachment metadata/bytes round-trip safely | `questionAttachments.test.ts` | PASS |
| 46 | Recovery/PWA | offline Daily Games reopens with state | `verify-daily-games-offline.mjs` | PASS |
| 47 | Recovery/PWA | service worker excludes `/api/` responses | `web/public/sw.js` inspection | PASS |
| 48 | Mobile/a11y | 390/430/768/1280 viewport Question/Tutor paths | Playwright 12-test suite | PASS |
| 49 | Mobile/a11y | focus return and no horizontal overflow | `question-bank-persistence.spec.ts` | PASS |
| 50 | Mobile/a11y | keyboard answer selection and utility operation | `question-bank-persistence.spec.ts` | PASS |

The ten database scenarios remain explicit blockers until Docker is running and
the official Supabase local stack can apply migrations 001–003. No hosted
credentials are present in this worktree, so those rows must not be relabeled
`PASS` by inference.
