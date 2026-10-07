# Codex: Ideas 2

Working branch: feat/ideas2-integration. Schema 34. No merge, push or production changes.

Evidence remains in docs/feature-development/2026-09-29/PROGRESS.md and MANIFEST.md until branch integration. Claude's directions index is authoritative on main; do not copy older branch statuses over it wholesale.

Verified locally: highlight range merging (691c23a), persistent top Locked In overlay and fade (a89819e), native normalized activity and duplicate-counting regression (1a2961b), Hub Finder actions and device-local paths (05d08c6 plus final QA follow-up).

JD checkpointed remaining work as 0061ca3. That is implementation, not blanket verification. Local recovery, browser output and node_modules symlinks have been untracked without deleting files (4d5c277); earlier history is unchanged.

Latest steering prioritizes a 20-experience immersive website browser. Reuse the existing shell-owned FocusSpaceHost, one active sandboxed frame, in-app expansion/fullscreen, and existing timer/audio controls. Verify headers and usage terms; do not bypass sites that refuse framing. Keep supported in-app experiences separate from external-only references. No paid services or generated media required.
