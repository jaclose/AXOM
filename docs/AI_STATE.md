---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

Snapshot: 2026-10-11, isolated `fix/deployment-input-reliability` in
`AXOM-deployment-reliability`, based on remote integration `baf340bd`.
Implementation commits `e2ebc8aa` and `af21e9b2` are pushed to the matching development
branch. Other workers, integration/main checkouts and private content were not edited.
This snapshot describes this branch, not production or another checkout.

## Focused deployment reliability

The original `c23e8c26` GOER allowlist is preserved. `npm run verify:deployment` creates
fresh deployment inputs from a committed Git revision, applies verified Vercel ignore
semantics, installs both package roots and executes vercel.json's build command.
The negative mode must reproduce real TS2307 missing-manifest errors. Seven regressions
cover the allowlist, exclusions, missing/case-mismatched files and build-script inclusion.
The build guard derives required manifests from the canonical bank imports; no content,
TypeScript checks, tests or application features were removed.

Node 22.23.1 / npm 10.9.8 is the pinned local/CI baseline. Both packages support the
same Node 22 range and npm version. Vercel remains configured for Node 22.x at the
repository root; its install command pins npm. Quality now covers integration pushes
and merge groups, keeps existing web/native checks, installs both roots and validates
API types. An existing browser assertion now waits for required IndexedDB-backed media
and checks decoded pixels instead of conditionally probing an immediate image count.

## Validation and handoff

Local macOS: both clean npm ci installations, 79 root tests (including seven deployment
regressions and 43 repository tests), API typecheck, hygiene and the actual native ZIP
import/practice/persistence browser journey pass. Original c23e8c2-parent ignore rules
reproduce all three real missing GOER imports. Disk-full interrupted the first web
install; the final fresh install passed after headroom recovered. Only session-owned
scratch/test data was reclaimed; learner data and other workers' files were preserved.

Linux CI at `af21e9b29580d8530a436ececd9b134fec928cbe`: filtered negative/positive builds
pass (1,050 versus 1,053 source files); native format/check plus 16 tests pass. Web
typecheck/lint/build, 2,910 tests (five skips), the ZIP browser journey, update recovery,
offline reopening and production audit threshold pass. All three jobs are green in
[CI run 38141538198](https://github.com/jaclose/AXOM/actions/runs/38141538198).
Exact evidence, dependency chains and
required remote settings are in [testing](operations/testing.md#vercel-deployment-inputs).

No existing dependency upgrades or forced overrides. Root warning packages are
whatwg-encoding 3.1.1, inflight 1.0.6, glob 8.1.0/10.5.0; none occur in web. Known
root development-tooling and web audit findings remain separately recorded. No remote
protection/ruleset/Vercel settings were changed. No production deployment, main merge,
private-library installation or hosted preview/browser acceptance is claimed.

Prior academic/library requirements remain recorded in the existing domain documents
and external AXOM-coordination coverage ledger. This focused task does not certify
that broader product delivery. Other active streams and recovery work remain protected.
Ready for integration-owner review; no merge was performed. Do not merge across active
work or infer production authorization. The documentation-only handoff records the
tested code revision above; it does not claim a new runtime validation or deployment.
