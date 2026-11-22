---
tags:
  - axom/state
authority: current-state
---
# AXOM current AI state

## Academic publication follow-up · 2026-11-22

JD explicitly requested completion of public account access, HOST approvals,
all submitted course trackers, CPR question sets and the wider prepared question
library. That instruction authorizes this scoped code release and the requested
content actions. It does not establish unresolved keys, clinical review or
distribution evidence that has not actually been checked.

This isolated branch is `fix/academic-publication-followup-20261122`, based on
`b9fe78be41b6c470b72a5a9af74e3b1d17641c33`. PR #1005 merged that revision into
main and production deployed it. The live `www.axom.info/version.json` returned
that commit and build `b9fe78be41b6-20261122010410532`. All six AXOM Quality CI
jobs passed the corresponding candidate; the merge tree matches the tested tree.
Original Mac worktrees, private source folders, exports and recovery snapshots
remain preserved. Do not reset or clean independent worktrees.

## Completed live content actions

All **18 tracker-only courses** were checked and approved through the genuine
signed-in HOST queue. Production readback confirms 18 shared, current, ready,
approved collections with exact-revision tracker review receipts. Their 938
activities retain 102 source-stated week assignments and 836 unstated weeks.
The queue displays no shared courses waiting for review. No activity week or
official calendar claim was invented.

The source-restored FTCM collection is shared and approved with **35 questions**,
76 images and two original PDFs. Both PDFs were downloaded through the live UI
and matched the preserved source bytes. One ordinary tutor answer was submitted;
choices, correction notes, rationale, printed key crop, image zoom and source-PDF
page rendering worked. The two superseded text-only Question Set Library entries
were returned for revision with a replacement reference; they were not deleted.
The one-question NB Block 2 Community submission was also genuinely checked and
approved. These are owner-session checks, not a new-learner acceptance claim.

CPR2 remains shared and approved with **186 ready questions**, 382 manifest files
and five original PDFs. The full live download failed during local persistence.
The later export still contains only the prior 32 Week 3 questions. Do not claim
all 186 were installed on this device or that a fresh account was tested.

## Follow-up implementation and preservation

[Academic library](features/academic-library.md) owns publication, account access
and reviewer contracts. Exact-current, immutable source revisions must update
already installed canonical questions without restoring obsolete explanations or
leaving newly held source questions graded. Preserve record identity, attempts,
notes, annotations, bookmarks, learner filing and set membership. Conflicting
local source edits require an explicit hold. Local ZIP review behavior and all
source/key/media approval gates remain conservative.

[Persistence](architecture/data-model.md) owns active workspace durability and
recovery. A full CPR2 download hit IndexedDB quota; its multi-megabyte plaintext
localStorage fallback also failed. The current in-memory workspace was exported
through the normal Saved Work route, checksum/ZIP integrity checked and saved
durably. That export includes 141 readable image attachments and two original
files; unavailable files remain references. It is not a complete or restore-tested
backup. Every older backup is preserved. Do not clear storage, sign out, prune
snapshots or silently discard required media to make a retry succeed.

The integrated follow-up adds bounded compressed active-state fallback and
explicit source revision reconciliation, with durability, account-isolation and
rollback tests. Both changes passed independent code review. The actual prior
77-question NCRS owner fixture retains every ID and learner history while applying
66 ready / 11 held source status. Reviewers can explicitly export exact stored
catalog/bank JSON and a full manifest without installing learner content; binary
sources are omitted and the export creates no approval evidence. Course cards
distinguish a tracker from a question collection. Full integration checks and
exact production release verification remain separate gates.

## Content still awaiting publication

Private, preserved candidates now contain NCRS **66 ready / 11 held**, RHPS IEA
**112 ready / 29 held**, and ER **one clarified question**. They retain original
source identities and visibly separate AXOM corrections from supplied text.
The actual application pipeline was exercised; RHPS still needs ordinary browser
image preflight. Do not publish these as corrected installed copies until the
source-update path is live and verified. No human-review evidence was fabricated.

A separate RHPS collection remains shared and pending with 393 technically ready
and 122 held questions. Recovery matched all 23 original PDFs and 58 images to
the current manifest. Its 24 current JSON files and 450 images remain unrecovered;
historical 514/524-question variants are not equivalent. Use the explicit stored
review export to obtain current banks after release. A withdrawn Community
submission is not proof that the academic collection itself is withdrawn.

The larger external-drive corpus has 17,559 declared question records, with only
782 technically ready and 16,777 held in the saved inventory. Its decision ledger
does not establish clinical/distribution clearance. Other candidate inventories
overlap and must not be summed into a reviewed 20,000-question public library.
The authorized Mac command service currently times out; no destructive storage or
device action was taken. Bounded archive recovery has not found the complete v7
payload. Preserve the source-only evidence and exact-source recovery artifacts.

## Validation and next action

Run the affected source-update, persistence and UI tests, typecheck/lint, build,
repository gates and the required integration release checks. Preserve original
test assertions and exact-file/hash verification. Local Chromium previously could
not create its required socket and the official download failed; use real CI
browser results rather than bypassing the environment restriction.

Production Supabase is `jofkmfwkidubxcutkwzf`. The additive tracker migration
`20261122002007_academic_tracker_review.sql` is applied with narrow grants and RLS;
question/explanation approval contracts remain intact. No unrelated migration was
applied. Code release, content approval, installed-copy correction and genuine
new-account acceptance are separate facts. No new-account credentials, provider
quota or source-review evidence may be invented or bypassed.

[FORGE #140](https://github.com/jaclose/AXOM/issues/140) remains the cross-workstream
release record. The [maintenance registry](operations/repository-audit.md#maintenance-registry)
and available coordination board retain ownership boundaries. Keep private PDFs,
question source records and learner backups outside this public repository.
