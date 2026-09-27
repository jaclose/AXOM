# Deferred features and prerequisites

## Application Checker

- Admissions probability, school tiers, estimated competitive scores and heuristic activity-hour targets: not supported by sufficiently reliable school-specific evidence. Do not ship the collected heuristic estimates as requirements.
- Automatic eligibility decisions: need structured rules, application cycle, residency/citizenship exceptions and refreshed official evidence. First increment supports manual source review.
- Residency-program intelligence: requires a separate actual program dataset; medical-school rows are not residency evidence.
- Full refresh of all roster schools and unresolved duplicate/campus decisions: retain missingness/conflicts and an incremental import path.
- Accreditation, ECFMG and financial-aid advice: high-stakes, changing policies require a dedicated primary-source review.

## Shared leaderboards

- Friend invitations, private cohort membership and live multi-user standings: require authenticated shared storage, row-level security, explicit scope-limited consent, revocation/deletion and multi-account tests.
- Anki Leaderboard add-on integration: no API contract or verified connection yet. Logged cards are not advertised as add-on data.
- Public/global ranks, unsolicited comparisons and pressure-based notifications: outside this iteration; no default public participation.
- Anti-abuse and time-zone policies for shared comparisons: establish before social rankings go live.

## Onboarding

- Free-text interpretation suggestions: deterministic only, original text retained, preview and confirmation required. Explicit controls come first.
- Additional recommendation-engine changes: preserve the existing personalization work; do not introduce new scoring in this increment.

## Other workstreams

- Browser coverage beyond desktop Chrome: Safari/WebKit and Firefox were not verified in this increment.
- Existing reminder notification styling has weak contrast in the light theme and can cover content until dismissed. The new-page selected controls were fixed; a global notification-theme pass remains separate.
- Production build still reports large-chunk warnings. No broad bundle refactor or dependency change is included.

Cloud deployment and production account verification, PWA/offline hardening, native packaging, knowledge graph, AI tutoring, simulator expansion, PDF/OCR expansion and unrelated redesign remain outside this task. Existing implementation is not evidence of production deployment. No deployment, commit or push is included.
