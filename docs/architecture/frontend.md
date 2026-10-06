---
tags:
  - axom/architecture
authority: canonical
---
# Frontend and lifecycle

**Boundary:** Vite/React/TypeScript in `web/`; Zustand stores model workspace and
feature state. Installed versions are in `web/package.json`, not this document.

| Need | Start here |
| --- | --- |
| Bootstrap, storage migration/downgrade protection, hydration | `web/src/main.tsx`, `lib/storageMigrations.ts`, `lib/storeHydration.ts` |
| Hash routing, setup gates, always-mounted services | `web/src/App.tsx` (`PAGES`) |
| Route UI | `web/src/pages/` then relevant `components/<feature>/` |
| Shared primitives and style tokens | `web/src/components/ui/`, `web/src/styles/theme.css`, [design contract](../design/DESIGN.md) |
| Desktop integration | `web/src/services/`, root `src-tauri/src/`, `scripts/tauri.mjs` |
| Browser acceptance fixtures | `web/e2e/fixtures.ts`, `web/playwright.config.ts` |

Bootstrap runs storage migrations and waits for hydration before exposing the workspace.
Keep persistent shell services mounted across route changes. Workspace persistence belongs
in the [data boundary](data-model.md); feature stores such as soundscapes have their own
lifecycle. Avoid coupling a page's render cycle to long-lived audio or sync resources.

Route failures, update chunk recovery and first-run setup are distinct states. Retrieve
`App.test.tsx`, hydration/storage tests or the affected E2E rather than treating a successful
build as proof of these flows. UI changes use existing tokens/primitives, keyboard paths,
reduced motion and the setup form standard.

Known coordination hotspots: `App.tsx`, `DashboardPage.tsx`, `ProductivityPage.tsx`,
`FocusDock.tsx` and `store.ts`. Check current ownership before editing them.
