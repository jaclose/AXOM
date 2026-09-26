# Application Checker — residency and undergraduate/pre-med datasets

Status (2026-09-26): **Residency — importer and UI built; data not yet
imported. Undergraduate/pre-med — not collected.** The medical-school dataset
(`docs/APPLICATION-SCHOOL-DATASET.md`) is unchanged. AXOM never invents,
estimates, or backfills program facts.

## Residency programs

### Where the data comes from (researched 2026-09-26)

| Source | Use in AXOM | Notes |
| --- | --- | --- |
| **ACGME public program listing** ("ProgramListingAY….xlsx", ACGME Cloud → Explore Public Data) | **Identity + basics** for every accredited program: 10-digit ProgramCode, specialty (+3-digit code), subspecialty flag, program name, city/state, accreditation status, sponsor (+6-digit code), length of training, positions filled, academic year | Official; ~13,762 programs in 2024–25; ACGME describes the files as intended for research purposes and excludes personal names/addresses. Download manually — ACGME Cloud is a client-rendered app without a published API, so AXOM does not scrape it. |
| Each program's official website | Requirement facts: Step 2 CK minimum, COMLEX acceptance, visa sponsorship (J-1/H-1B), years-since-graduation limits, signals | Capture with URL + `retrievedAt` per fact. |
| FREIDA (AMA) | Cross-check program facts manually | Free to search; review the AMA terms before any automated collection. |
| Aggregators/rankings (e.g. residency.admit.org) | Discovery leads only | No cited sources or reuse terms were found on the rankings page; rankings/opinions are not requirement evidence. Do not scrape without permission. |

### Pipeline (built)

```bash
# From the repository root, after downloading the ACGME program listing:
npm run residency:import -- ~/Downloads/ProgramListingAY20242025.xlsx
#   → web/public/application-residency-programs.json (validated; codes zero-padded)
npm run residency:validate -- web/public/application-residency-programs.json
```

Options: `--dry-run`, `--output <path>`, `--source-url <url>`,
`--retrieved-at <ISO>`. CSV exports work too. Reload the app: Application
Checker → Residency shows the explorer (search, specialty, state,
residencies-vs-fellowships, save). Implementation:
`web/src/lib/residencyPrograms.ts`, `web/scripts/residency-pipeline.mjs`,
`web/src/components/applications/ResidencyExplorer.tsx`.

### File contract → `web/public/application-residency-programs.json`

```json
{
  "schemaVersion": 1,
  "pathway": "residency",
  "generatedAt": "2026-10-01T12:00:00Z",
  "academicYear": "2024-2025",
  "recordCount": 1,
  "programs": [
    {
      "id": "acgme-0140311024",
      "acgmeProgramId": "0140311024",
      "programName": "Example Medical Center Program",
      "specialty": "Internal medicine",
      "specialtyCode": "140",
      "isSubspecialty": false,
      "sponsorName": "Example Medical Center",
      "sponsorCode": "012345",
      "city": "Brooklyn",
      "state": "New York",
      "accreditationStatus": "Continued Accreditation",
      "trainingYears": 3,
      "positionsFilled": 54,
      "academicYear": "2024-2025",
      "website": "https://example.org/im-residency",
      "requirements": {
        "step2Minimum": "Unknown",
        "comlexAccepted": "Unknown",
        "visaSponsorship": "Unknown",
        "yearsSinceGraduation": "Unknown",
        "signals": "Unknown"
      },
      "verification": "official-listing",
      "sources": [
        { "url": "https://acgmecloud.org/analytics/explore-public-data/program-search", "title": "ACGME public program listing", "retrievedAt": "2026-10-01T11:00:00Z" }
      ]
    }
  ]
}
```

- `verification`: `official-listing` (identity from ACGME only) | `partial` |
  `verified` | `conflicting`.
- A scraper that enriches requirements should key on `acgmeProgramId`, fill
  only fields it can source, and add each page to `sources`.
- Saved programs reuse the Application Checker research entries
  (`schoolId: "acgme-<code>"`), so they survive reloads and portable backups.

## Undergraduate / pre-med → `web/public/application-undergrad-programs.json`

```json
{
  "schemaVersion": 1,
  "pathway": "undergraduate",
  "generatedAt": "2026-10-01T12:00:00Z",
  "recordCount": 1,
  "institutions": [
    {
      "id": "ipeds-123456",
      "ipedsId": "123456",
      "name": "Example University",
      "city": "Example",
      "state": "CA",
      "preHealthAdvising": "Unknown",
      "committeeLetter": "Unknown",
      "linkagePrograms": [],
      "earlyAssurancePrograms": [],
      "website": "https://example.edu/prehealth",
      "verificationStatus": "unverified",
      "sources": [
        { "url": "https://example.edu/prehealth", "title": "Pre-health advising", "retrievedAt": "2026-10-01T11:00:00Z" }
      ],
      "updatedAt": "2026-10-01T11:00:00Z"
    }
  ]
}
```

## How the app will use them

1. Validation mirrors `npm run schools:validate` (reject unsafe rows, keep valid
   ones, report warnings).
2. The Pathway switch in Application Checker enables the tab once a valid file
   exists; saved programs, review checkmarks, and backups reuse the same
   research-entry model as schools.
3. Learner comparisons (Step 2 score vs. stated minimum, visa needs vs.
   sponsorship) show as review items, never as admission predictions.
