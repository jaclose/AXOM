# AXOM Release Readiness Checklist (Pre-Beta)

This checklist defines the "Definition of Done" for the Pre-Beta package. No release is pushed until every "Critical" item is verified.

## 1. Core Loop Stability (Critical)
- [ ] **Session Integrity**: Verify that a browser crash or hard reload does not wipe an active Pomodoro/Study session.
- [ ] **Vault Migration**: Test upgrading from v0.0.1-alpha to v0.0.1-prebeta with existing dummy data.
- [ ] **Anki-QBank Bridge**: Verify that failing a question correctly flags related Anki cards as "Urgent."
- [ ] **Storage Limits**: Verify that the app remains performant with 10,000+ Anki cards in the local vault.

## 2. Intelligence Integration (High)
- [ ] **Data-Driven Checker**: Verify `ApplicationCheckerPage` loads JSON manifests without hard-coded strings.
- [ ] **Ollama CORS**: Document and automate the `OLLAMA_ORIGINS` setup guidance for new users.
- [ ] **AI Validation**: Ensure no AI-generated card can bypass the "User Review" gate.

## 3. Package Shell & Delivery (High)
- [ ] **CI/CD Pipeline**: GitHub Action successfully builds and deploys to Vercel on `main` push.
- [ ] **Version Polling**: `UpdateAvailableWatcher` correctly detects a version bump in `version.json`.
- [ ] **Native Wrapper**: Tauri build produces a runnable `.app` with correct iconography.

## 4. UX & Polish (Medium)
- [ ] **Responsive Audit**: Verify all "GlassCard" layouts work on mobile (400px) and ultra-wide monitors.
- [ ] **Theme Cohesion**: Verify `BRAND_COLORS` are applied consistently across all new "Under Construction" pages.
- [ ] **Onboarding Flow**: Ensure the `OnboardingWizard` correctly leads the user to the Dashboard.
