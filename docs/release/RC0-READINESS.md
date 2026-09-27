# AXOM Beta RC0 readiness

Checkpoint branch: `feat/accounts-sync-v1`

Starting SHA for this release-engineering pass: `8987d0a4ec071ec5911b9750bd4111b7e06787b3`.
The final checkpoint SHA is reported by Git after the validated commit; this
document is intentionally not a self-referential hash.

## RC0 state

**RC0 LOCALLY VALIDATED — LIVE CLOUD VALIDATION REQUIRED**

The local-first product, Question Bank import/review/Tutor path, recovery path,
PWA offline path, Application Checker contract, and deterministic scale tests
are green in this worktree. Hosted account protection is not claimed as tested:
Docker's daemon and Compose plugin are unavailable, and no Supabase URL/key or
linked production project is present.

## Supported beta paths

- local onboarding, course/schedule review, Tracker, Suggested Moves, Journal,
  Question Bank, Question Sets, Tutor, annotations, notes, results, and local
  backup/restore;
- structured text, pasted text, PDF/DOCX extraction seams, review-first
  question finalization, batch/mass import, duplicate warnings, and source
  provenance;
- deterministic school-dataset parsing, validation, normalization, and
  incremental merge through the commands in
  [`APPLICATION-SCHOOL-DATASET.md`](../APPLICATION-SCHOOL-DATASET.md);
- installable PWA shell and local offline reopening for supported cached
  assets.

## Unproven or blocked

- **P1 — live account security:** migrations 001–003, Supabase Auth, RLS,
  revision idempotency, conflicts, retention, restore, and private-share
  attacks require a running local or hosted Supabase project. The source audit
  is present; runtime execution is `BLOCKED`, never inferred as `PASS`.
- **P1 — external school data:** no factual 271-school export is checked into
  this repository. The contract and executable validator are ready for the
  external scraper handoff, but the Application Checker displays an honest
  empty/error state until a reviewed export is placed at
  `web/public/application-schools.json`.
- **P1 — attachment cloud semantics:** workspace JSON is protectable; binary
  question attachments remain device-local unless included in a portable
  backup. The Account surface now says this explicitly.
- **P2 — scanned-PDF OCR and visual answer-mark recognition:** no fabricated
  OCR/vision claim is made.
- **P2 — production deployment, public beta operations, and cloud observability:**
  configuration and operational ownership are still required.

## Data-safety statement

Local Vault remains authoritative for interaction. Portable JSON export and
local safety snapshots remain available. Restore validates before replacement
and records a new revision when cloud protection is configured. Account sync
must not be described as active until the server acknowledges a revision.

## Validation evidence

- Full unit suite: **136 files / 1,187 tests passed**.
- Focused RC tests: **63 tests passed** for dataset, CLI, scale, and parser
  adversarial coverage.
- API typecheck, web typecheck, lint: **passed**.
- Playwright: **12/12 passed**.
- Production build: **passed**.
- Offline verification: **passed**.
- Production dependency audit (`npm audit --omit=dev`): **0 vulnerabilities**.
- Main application chunk: **591,226 bytes raw / 170,302 bytes gzip**.
- Application Checker route: **12.44 KB raw / 4.21 KB gzip**, lazy-loaded.
- Diff check: **passed**.

The production audit (`npm audit --omit=dev`) is clean. A full audit reports
four high transitive development-tool findings: `brace-expansion` via
`eslint → minimatch`, `postcss` and `nanoid` via `vite → postcss`, and
`undici` via `jsdom`. They are not in the shipped browser bundle or a
production dependency path; non-breaking fixes are available, but
`npm audit fix` was intentionally not run and no dependency files were
mutated during this pass.

## External school-data handoff

```bash
npm run schools:validate -- path/to/medical-schools-export.json \
  --now 2026-08-11T00:00:00Z
npm run schools:merge -- web/public/application-schools.json \
  path/to/incremental-export.json \
  --output web/public/application-schools.json
```

The validator reports declared/actual/unique counts, valid/incomplete/
unknown/conflicting/stale/rejected rows, duplicate IDs/names, malformed URLs,
provenance, future timestamps, numeric fields, and unsupported program types.
Unsafe errors return exit code 1 and never write an output file.

## Product Owner manual sequence (20 minutes)

1. Open a fresh browser and complete onboarding.
2. Create/import a course schedule; inspect Tracker and Suggested Moves.
3. Open Question Bank and import one clean SGU-style text file.
4. Import a messy file and review only unresolved cards.
5. Add several files through Mass Import; inspect source/provenance warnings.
6. Finalize a set, start Tutor, answer a question, highlight twice, erase once.
7. Type a note, navigate away and back, then refresh.
8. Open Results, review incorrect, and verify the explanation mapping.
9. Export a backup; change one record; restore/merge in a clean browser state.
10. Run the school validator on the scraper export, then reload Application
    Checker and inspect status/source freshness.
11. If cloud credentials are configured, sign in, explicitly associate this
    device, wait for `PROTECTED`, take the account offline, reconnect, then
    inspect history/conflict/restore behavior.

## One-week risk question

The failure most likely to hurt five real beta students is assuming that a
green-looking account state means every binary attachment is cloud-protected.
The UI now states the limitation, and the immediate next action is to exercise
live Supabase protection plus a portable attachment backup with real users.

## Upstream decision

`origin/main` is one commit ahead only because of the unrelated Higgsfield
tooling commit `29aded0`. It is intentionally not merged into this feature
branch; cosmetic divergence is safer than importing unrelated tooling into RC0.
