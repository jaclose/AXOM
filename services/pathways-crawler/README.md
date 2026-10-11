# AXOM Pathways crawler

A runnable, resumable collection service for AXOM's existing Application Checker. Independent of the Vite app. It never modifies user workspaces, production data, or the original school dataset.

## Implemented

Imports all records in the existing school envelope with stable IDs retained. The inspected main-branch dataset declares 292 schools. No guessed replacement roster is bundled.

Evidence-candidate extraction covers 71 medical-school fields: admissions and class statistics; coursework; clinical/nonclinical experience, research and leadership; tuition, fees, funding and scholarships; curriculum and progression policies; recognition; clinical sites; outcomes; mission and institutional contacts. Separate definitions cover rotations (14), hospitals (8), residency (22), undergraduate (6), PA (6), and nursing (6). Only medical schools are initially enabled.

Durable SQLite jobs, worker lock, recoverable leases, bounded requests, robots rules, conditional HTTP, snapshots, change detection, source failure states, pause/resume, a read-only browser dashboard, review-gated exports, and macOS/Docker supervision files are included.

**The extractor identifies candidate passages, not automatically trustworthy normalized requirements.** It does not invent missing facts, infer activity-hour targets, estimate acceptance probabilities, or convert a class median to a cutoff. No model API is used in this release. No cloud publishing pipeline or production auto-update has been activated.

## Start locally

Python 3.11+ is required. From this service directory:

```bash
bash run-local.sh "$HOME/Developer/AXOM/web/public/application-schools.json"
```

Open `http://127.0.0.1:5488` in Chrome or another browser. This foreground worker stops when the terminal process is stopped.

For restart-on-crash and startup at login:

```bash
bash install-macos.sh "$HOME/Developer/AXOM/web/public/application-schools.json"
```

The installer copies the service into `~/Library/Application Support/AXOM/PathwaysCrawler`, creates an isolated virtual environment, imports the existing roster as private-capture targets, and installs the LaunchAgent `org.axom.pathways-crawler`. It does not edit your checkout, change branches, install paid services, or alter sleep settings.

**An awake, connected host is required.** Mac collection stops during sleep, shutdown, logout or loss of connectivity. Queue state persists. The browser can close without stopping an installed worker. A LaunchAgent starts at login, not before login. Use an always-on server for continuous availability.

Stop the installed service:

```bash
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/org.axom.pathways-crawler.plist"
```

Remove that specific plist to uninstall automatic startup. Collected data is retained.

## Optional PDF and Chromium

In the service's virtual environment:

```bash
python -m pip install -r requirements-optional.txt
python -m playwright install chromium
AXOM_BROWSER=1 python crawler.py serve
```

For the installed LaunchAgent, add `AXOM_BROWSER=1` to its environment and restart it after installing dependencies. `CHROMIUM_PATH` selects an existing Chromium executable. Chromium is not downloaded silently.

The renderer uses a fresh context without personal cookies, blocks service workers/downloads/WebSockets, disables browser DNS, and mediates bounded same-host GET requests through the HTTP safety layer. Third-party resources and authentication flows are not bypassed. Some sites will remain inaccessible.

PDF parsing is bounded and isolated. Scanned PDFs are flagged for visual review, not silently OCRed. Text beyond the document budget is not represented as fully reviewed. The default Docker image supports HTML and PDFs, not Chromium; browser mode requires a separately provisioned image/host and more memory.

## Always-on Docker host

```bash
export AXOM_SCHOOLS_FILE="/absolute/path/to/application-schools.json"
docker compose up -d --build
docker compose logs --tail=50
```

Persistent state uses a named volume. The dashboard port is bound to host loopback. For a remote server, use an SSH tunnel instead of exposing the unauthenticated research dashboard:

```bash
ssh -L 5488:127.0.0.1:5488 user@your-host
```

Then open `http://127.0.0.1:5488` locally. These files do not purchase a host or guarantee uptime.

## Controls and budgets

```bash
python crawler.py status
python crawler.py pause
python crawler.py resume
python crawler.py once --max-pages 20
python crawler.py retry-blocked --state needs-browser
```

Put `--db /path/to/crawler.sqlite` before the command for a nondefault database.

Defaults: one worker per database; successful-source refresh every 24 hours; at most 60 discovered pages per entity and depth 3; at least 3 seconds between a host's requests; 150 requests per host per UTC day; 2,000 total daily requests; 3 MB per response; 400,000 stored text characters per snapshot; and a 250 MB database/WAL cap. The cap pauses capture rather than filling the disk. Long-term retention/archival still needs an operator policy.

Transport failures and rate limits back off. 404s, access-denied pages, unreadable documents, robots denials and unknown redirect hosts remain explicit review states. Requeue a blocker after addressing its cause. The crawler does not bypass it.

## Permissions and evidence

`--allow-private-capture` is an operator instruction, **not a license, legal finding, or proof every historic source is official**. Review source terms before production-scale use. Public export is separately gated.

```bash
python crawler.py policy school.edu --fetch review --publication none --note "Terms review pending"
python crawler.py policy school.edu --fetch allow --publication none --note "Private capture reviewed; public reuse not approved"
```

WDOMS, AAMC, AMA/FREIDA, NRMP and ACGME Cloud hosts are blocked from automated fetching. Use separately permitted imports. Robots compliance is not a substitute for terms or licensing review.

DNS results are validated; connections use the checked public address while retaining TLS hostname validation. Private/literal-address targets, nonstandard ports, credentials, login paths, oversized documents and arbitrary cross-domain redirects are rejected. Unavailable robots rules fail closed. Runtime snapshots and databases are private files, not committed assets. CI uploads only aggregate status.

## Review and export

Candidates include an ID, source, capture time, field, title and contextual qualifiers. Review the source before approving a concise summary that preserves the cycle and applicant-category restrictions:

```bash
python crawler.py review CANDIDATE_ID --reviewer "editor-name" --value "Reviewed, source-supported summary"
python crawler.py policy school.edu --fetch allow --publication facts --note "Documented basis for publishing reviewed factual summaries"
python crawler.py export --output ./data/exports
```

The school handoff uses existing AXOM schema v2 and stable school IDs. Capture is not labeled official merely because it was scraped or reviewed. Unreviewed passages never become eligibility rules. Conflicting reviewed summaries remain marked.

**Publication lifecycle limitation:** this exporter is an initial/incremental handoff, not a complete cloud synchronization protocol. Before repeated production publication, implement stable source-field IDs and explicit invalidation of previously published facts that change or lose permission. Do not blindly append exports to production. Local approvals already reopen on source change; cloud invalidation remains to be connected.

From the AXOM repository root:

```bash
npm run schools:validate -- /absolute/path/to/application-schools.incremental.json
```

Do not replace the full production dataset with a partial export. Use the established merge workflow only after checking proposed diffs and invalidations. Main pushes remain the owner's action.

## Later stages

```bash
python crawler.py bootstrap /path/to/rotation-opportunities.json --module rotations --allow-private-capture
python crawler.py enable rotations
python crawler.py bootstrap /path/to/hospitals.json --module hospitals --allow-private-capture
python crawler.py enable hospitals
python crawler.py bootstrap /path/to/application-residency-programs.json --module residency --allow-private-capture
python crawler.py enable residency
```

Accepted arrays: `schools`, `programs`, `institutions`, `opportunities`, `facilities`. Each record needs a stable ID, a name (`canonicalName`, `programName`, or `name`), and a website or source array. A hospital affiliation is not an available rotation. Residency identifiers are retained; restricted directories are not scraped to invent a roster.

Later stages have shared collection/extraction plumbing, **not complete inventories or finished product interfaces**. Their shared export is `pathways.reviewed.json`. A residency-specific enrichment/validation adapter remains an integration task.

## Tests and deployment status

```bash
python -m py_compile crawler.py pdf_worker.py browser_worker.py
python -m unittest -v
```

The 54 regression tests use synthetic fixtures and no external requests. The GitHub workflow can bootstrap the existing roster and attempt eight live pages on this feature branch. That job is bounded, state is ephemeral, and it is not 24/7 hosting. Inspect its actual result before claiming a live crawl.

Inspected base: `5fbe8a4fbc58f7961f4986afabffe1ba34143333`. Existing contracts: `docs/APPLICATION-SCHOOL-DATASET.md`, `web/src/lib/applicationSchools.ts`, `web/src/lib/applicationResearch.ts`, and `docs/APPLICATION-PATHWAY-DATASETS.md`. Python was chosen to complement the existing research adapter with a package-free core, not to replace the frontend stack.

During preparation the remote Mac was offline and the connected Supabase account exposed only inactive projects. No permanent host, database project, paid service or production deployment is claimed as active. Installers and optional live browser capture require target-host verification.
