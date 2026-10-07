---
tags:
  - axom/navigation
authority: navigation
---
# AXOM System Map

Choose a relevant node, then use its source/test pointers. This map contains routes,
not feature specifications or an agent preload list. [Graph guide](README.md).

| Category | Relationship / next route |
| --- | --- |
| [Product](../product/README.md) | Governs terminology and intent |
| [Architecture](../architecture/README.md) | Locates implementation boundaries |
| [Features](../features/README.md) | Connects user tasks to source and tests |
| [Operations](../operations/README.md) | Defines safe development and validation |
| [Decisions](../decisions/README.md) | Explains durable architectural choices |

| Question / area | Canonical route |
| --- | --- |
| Import, review and practice questions | [Questions](../features/questions.md) |
| Course Tracker and schedule import | [Course routes](../features/README.md#course-tracker-and-import) |
| Question analysis and Course Engine | [Course Engine contract](../features/course-engine.md) |
| Settings and Decode boundary | [Settings/analysis routes](../features/README.md#settings-and-analysis) |
| Focus timing and study credit | [Productivity](../features/productivity.md) |
| Persistent audio, scenes and device media | [Soundscapes and media](../features/soundscapes.md) |
| App shell, routing and persistent service lifecycle | [Frontend](../architecture/frontend.md) |
| Local workspace, portable backup and compatibility | [Data model](../architecture/data-model.md) |
| Optional account revisions and conflict preservation | [Accounts and sync](../architecture/accounts-sync-v1.md) |
| AI providers, APIs and database boundaries | [Backend](../architecture/backend.md) |
| Why account protection remains additive | [Local workspace decision](../decisions/002-local-workspace-and-accounts.md) |
| Governing product/design sources | [Product authority router](../product/README.md) |
| Impact-appropriate checks and integration gates | [Testing](../operations/testing.md) |
| Active protection and later cleanup | [Maintenance registry](../operations/repository-audit.md#maintenance-registry) |
| Current checkout handoff | [AI state](../AI_STATE.md) |

Existing [architecture](../architecture/README.md), [feature](../features/README.md)
and [task](../INDEX.md) routers cover other routes. Retrieve
[history](../archive/README.md) only for a historical question. A node's incoming
backlinks aid discovery; they do not authorize reading every connected document.
