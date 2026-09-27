# AXOM Error & Recovery Matrix

To ensure "Low Maintenance," the app must handle every failure mode gracefully without requiring a developer to intervene.

| Failure Scenario | User Impact | Technical Mitigation | Recovery Action |
| :--- | :--- | :--- | :--- |
| **Ollama Offline** | AI features greyed out | `detectOllama` returns `ok: false` with detailed guidance. | Show "Install Ollama" onboarding link. |
| **CORS Blocked** | "Not Detected" error | Check for `TypeError: Failed to fetch` in console. | Trigger "Fix CORS" guide modal. |
| **Schema Mismatch** | App fails to boot | `storageMigrations.ts` detects version gap. | Run linear migrations $\rightarrow$ Snapshot fallback. |
| **Vault Corruption** | Data loss on load | `checksum.ts` fails on vault load. | Trigger "Restore from Backup" flow. |
| **Network Timeout** | AI response hangs | `AbortController` timer (2500ms) in `ollama.ts`. | Show "AI is taking too long" $\rightarrow$ Retry button. |
| **Storage Full** | Save failure | `IndexedDB` QuotaExceededError. | Trigger "Clean up old backups" or "Clear Cache" prompt. |
| **Invalid AI JSON** | App crash on response | Zod-like schema validation in `aiClient.ts`. | Auto-retry with "Format correction" prompt. |

## Recovery Tier Logic
1. **Silent Recovery**: App fixes the issue (e.g., Orphan Repair) and notifies the user via a "toast."
2. **Guided Recovery**: App identifies the issue and provides a "Fix it for me" button.
3. **Manual Recovery**: App provides a "Export data $\rightarrow$ Reset to starter data" option as a last resort.
