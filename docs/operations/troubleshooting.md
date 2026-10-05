# Targeted troubleshooting

| Symptom | Check first |
| --- | --- |
| jsdom `localStorage.clear` failure on a newer Node | Use Node 22 from `.nvmrc`; Node 26's process-global experimental web storage caused prior failures. Only on a supporting runtime, `NODE_OPTIONS=--no-experimental-webstorage` is a diagnostic workaround. |
| Account upload retries / HTTP 500 | [Account incident](../release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md), `syncFailure.ts` and migration deployment status. Do not restore an old workspace over local work. |
| Old JS chunk fails after deployment | [Update policy](../UPDATE-POLICY.md), `lazyWithFallback.ts`, `webUpdates.ts`, build metadata/precache; run update checks. |
| Browser E2E sees the wrong checkout | Inspect port 5187 and `AXOM_E2E_BASE_URL`; Playwright can reuse a running server. Use a dedicated local server/port. |
| Docs and source disagree | Current code/tests establish behavior; governance establishes intended product authority. Follow [archive locator](../archive/README.md) for dated evidence, preserving the disagreement rather than inventing resolution. |
| Media marked optimized without transformed bytes | See [soundscapes/media boundary](../features/soundscapes.md); preserve originals and verify actual derivatives. |

Filter a failing log to the error/test plus surrounding lines. Keep full logs in ignored
artifacts or outside the repository; don't paste thousands of passing lines into context.
