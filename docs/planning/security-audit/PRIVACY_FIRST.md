# AXOM Security & Privacy Audit Plan

Since AXOM is a "Private Academic Operating System," privacy is the primary product. This document defines the security boundaries to ensure user data never leaks.

## 1. The "Local-First" Boundary
The core principle is that **Study Data $\neq$ Cloud Data**.

### Data Isolation
- **Vault Data**: Stored in `IndexedDB` / `SQLite` locally. Never sent to a server unless the user explicitly triggers a "Cloud Backup."
- **API Keys**: AI provider keys are stored in `localStorage` (encrypted via a user-defined master key if implemented) and are only sent to the specific provider's endpoint.

### The "Leak" Prevention Matrix
| Potential Leak | Mitigation | Verification |
| :--- | :--- | :--- |
| **AI Prompt Leaks** | Strip PII (Personally Identifiable Info) before sending prompts to Cloud AI. | Log all outgoing prompts to a local-only debug console. |
| **XSS Attacks** | Use React's default escaping; avoid `dangerouslySetInnerHTML` for user-provided card content. | Audit all `innerHTML` calls in `AnkiLabPage`. |
| **Cross-Site Scripting** | Implement a strict Content Security Policy (CSP) in `index.html`. | Verify CSP headers on the deployed Vercel instance. |

## 2. The "Cloud Backup" Trust Model
When the user opts into Cloud Backup:
- **Client-Side Encryption**: Data is encrypted with a user-key *before* it leaves the machine.
- **Zero-Knowledge**: The server stores only encrypted blobs; AXOM cannot read the user's study history.

## 3. Local-AI Security
For Ollama users:
- **Endpoint Validation**: Ensure the `localEndpoint` matches `localhost` or `127.0.0.1` to prevent "SSRF" (Server Side Request Forgery) where the app is used to probe the user's internal network.
