# Agent 1 private academic source ledger

Run from the existing AXOM checkout (`~/Developer/AXOM-academic-library-v1`):

```bash
python3 scripts/qbank/test_source_ledger.py -v
python3 -u scripts/qbank/source-ledger.py --probe-pdfs 40 --max-hash-mb 48
export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"
node scripts/operations/academic-reconcile.mjs \
  --inventory-jsonl artifacts/qbank-6way-20261014/master-source-manifest.jsonl \
  --source-summary artifacts/qbank-6way-20261014/source-summary.json \
  --dispositions artifacts/qbank-6way-20261014/dispositions.json \
  --out artifacts/qbank-6way-20261014/agent1-integrator-gate.json
```

The Python scanner reads only the listed academic source roots (including top-level Downloads files selected by academic filename and SSD term folders). It does not edit sources, unpack ZIPs, upload files, change account state or install QBank questions. It writes only ignored private `artifacts/qbank-6way-20261014/**`. SHA cache keys include size and nanosecond mtime. In the expanded inventory, priority files over `--max-hash-mb` and low-priority references are explicitly unresolved rather than silently ignored.

The reports have **separate denominators**. `source-summary.json` counts document paths, hashed paths, unique hashes, native package folders and canonical banks, raw question headings, real parser-reviewed readiness, and curriculum activities separately. `dispositions.json` is the identity ledger for all *hashed* unique sources and the Agent 0 gate; unhashed priority exceptions remain gate blockers.

`native-package-canonical.json` and `agent-2-priority-batches.json` prioritize existing prepared GOER sources and structured TXT banks. `agent-2-import-inputs-deduplicated.json` preserves all mirrored source paths under a canonical byte-key; a mirrored copy is not a second bank. `archive-member-index.json` indexes ZIP central-directory metadata only: ZIP CRC32 is never treated as a secure checksum or imported source question.

`agent-2-assessed-source-ledger.json` reads the separate Agent 2 `role-2-import-audit.json` **only when available**, joining strict source SHA + known bank identity + per-source question totals. It populates local review and ready counts but explicitly leaves cloud receipt state unverified. It never makes speculative answer assignments. `raw-text-stem-reuse-hints.json` stores hashes and numbering metadata only, not source question text; repeated hashes are candidate duplicates until existing AXOM review confirms identity.

`tracker-activities.jsonl` and `coverage-matrix.csv` are source evidence and coverage triage, not an official school calendar or activity-install ledger. Only **explicit** source week evidence can be described as explicitly verified; inferred placement is not official.

**Only Agent 0 commits or merges.** These scripts contain no private question text or secrets, but academic file paths/hashes and all generated reports stay in ignored private artifacts. Verify `git check-ignore artifacts/qbank-6way-20261014/` and review pending changes before any commit. Do not upload protected school/commercial content to public/community locations without explicit authorization.
