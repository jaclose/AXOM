# AXOM Application Checker dataset handoff

The external school scraper must emit one JSON file at:

`web/public/application-schools.json`

The file is a versioned envelope. AXOM accepts schema version `1` for backward
compatibility and upgrades it in memory; new exports should emit version `2`.

```json
{
  "schemaVersion": 2,
  "sourcePipelineVersion": "scraper-2026-08-10",
  "generatedAt": "2026-08-10T12:00:00Z",
  "recordCount": 271,
  "schools": [
    {
      "id": "stable-source-id",
      "canonicalName": "Example School of Medicine",
      "name": "Example School of Medicine",
      "alternateNames": ["Example SOM"],
      "programType": "md",
      "degree": "MD",
      "location": "Example, NY",
      "website": "https://example.edu",
      "applicationPlatform": "AMCAS",
      "prerequisiteCategories": ["biology", "chemistry"],
      "mcatPolicy": "Required",
      "casperPolicy": "Unknown",
      "previewPolicy": "Unknown",
      "letters": "Three letters required",
      "deadline": "2026-10-15",
      "tuition": "Unknown",
      "classSize": 120,
      "missionNotes": "Unknown",
      "verificationStatus": "verified",
      "sources": [
        {
          "url": "https://example.edu/admissions/requirements",
          "title": "Admissions requirements",
          "retrievedAt": "2026-08-10T11:30:00Z"
        }
      ],
      "updatedAt": "2026-08-10T11:30:00Z"
    }
  ]
}
```

Rules:

- `id`, `canonicalName`, `verificationStatus`, and `sources` are required.
- `Verified` records must have at least one valid HTTPS/HTTP source and a
  retrieval timestamp.
- Use `Unknown` for missing admissions facts. Do not infer or backfill them.
- `programType` should be `md`, `do`, `md/do`, `residency`, `phd`, `masters`,
  `pa`, `nursing`, or `other`.
- Retrieval timestamps must be ISO date-times and must not be in the future.
- Keep `recordCount` equal to the number of submitted rows.
- A partial run is valid. Rejected rows are reported while valid rows remain
  usable.
- Do not reuse a canonical school under multiple IDs without investigating the
  duplicate-name warning.

Executable validation and merge commands:

```bash
# Validate an external scraper export. Warnings are reported; unsafe errors
# return exit code 1 and never write an output file.
npm run schools:validate -- path/to/medical-schools-export.json \
  --now 2026-08-11T00:00:00Z

# Normalize a safe export directly to the application handoff path.
npm run schools:validate -- path/to/medical-schools-export.json \
  --output web/public/application-schools.json

# Merge a safe incremental export. Existing values are never erased; material
# disagreements remain field-level conflicts for review.
npm run schools:merge -- web/public/application-schools.json \
  path/to/incremental-export.json \
  --output web/public/application-schools.json
```

The validator reports schema version, declared/actual/unique counts, valid,
incomplete, unknown, conflicting, stale, rejected, duplicate, provenance,
timestamp, URL, numeric, and program-type findings. It exits non-zero when
the parser reports an unsafe error (including rejected records). Duplicate
canonical names and stale sources are warnings so an intentionally partial
dataset can still be inspected. The merge command refuses unsafe inputs and
preserves provenance and conflicts deterministically.

The scraper handoff vocabulary is deliberately conservative:

- `unknown`: the source was checked but did not state the fact.
- `not-required`: the source explicitly says the requirement does not apply.
- `not-applicable`: the field does not apply to this program.
- `not-reported`: the source was not checked or did not provide a usable value.

Do not turn any of these states into a guessed boolean. Keep the original
source evidence and retrieval timestamp. `verificationStatus` describes the
record's overall evidence state; it does not mean a school requirement is
present or absent.

Validation and regression procedure:

```bash
cd /Users/jd/Developer/AXOM-accounts-v1/web
npm test -- --run src/lib/applicationSchools.test.ts
npm run typecheck
npm run lint
npx playwright test e2e/beta-finishing-surfaces.spec.ts
```

The pure boundary is `parseApplicationSchoolDataset` in
`web/src/lib/applicationSchools.ts`. Incremental scraper output must be merged
with `mergeApplicationSchoolDatasets`; missing incoming fields do not erase
existing fields, and conflicting material values remain visible as field-level
conflicts instead of silently replacing trusted data.
