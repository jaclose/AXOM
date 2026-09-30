# Wave 2 · Home: accounts nudge, Up Next, widgets, Wrapped (PLAN v1)

Branch `feat/wave2-home`, cut from `main` after Wave 1.1. Owner: Claude. Sources: JD's Wave 2 go-ahead (Priorities 3-4, after-setup A, B, D), IDEAS-3.md, IDEAS-4.md (I4-02), MANIFEST.md.

## Goal

The first week in AXOM feels guided and alive: the dashboard tells you what to do next and why, widgets use their space well at every size, and each week ends with a Wrapped worth opening. A student who saves real work is invited to protect it with an account, once, elegantly.

## Scope (v1)

1. **Save your progress** (P3). After the first meaningful data with no account (study log, question import, saved soundscape, course item, journal entry), a glass banner slides down from the top: "Save your progress. Make a free account so AXOM follows you to any device." Create account opens Settings > Account; Not now snoozes 7 days; a second Not now retires it to Settings. Never while a modal, tour, Promise or focus layer is up (shellBusy). Never when signed in or when accounts are not configured. Reduced motion: fade only.
2. **Account restore** (P4). Prove "I signed in on a new device and my AXOM came back": fresh profile + sign-in pulls the latest cloud revision; a device with local work gets the existing conflict choice, never a silent overwrite. Unit coverage on the sync coordinator; a live check needs JD's go-ahead (production project).
3. **Up Next and recovery** (A). Up Next adapts to yesterday (unfinished item, missed target), offers a two-minute start when the day is stalled, and a recovery plan after missed days that shrinks the ask instead of stacking it. Every suggestion keeps its "Why?".
4. **Widget primitive** (B). One widget contract with size-specific layouts (small, medium, wide, tall), shared empty/loading states, custom link widgets, and edit previews. First widgets on it: Clock (I4-02: digital or analog, time zone, next exam days, running Pomodoro/soundscape), Weekly (more life), Journal (a keyframe of the new desk), Daily games (Daily Word + Doctordle split).
5. **Wrapped** (D). Weekly, monthly and yearly stories from real logs: a full-width header on the dashboard when a week closes, saved in Reports ("It's in Reports if you want to see it again"). Honest low-data states.
6. **Tracker order TODO** (C, from JD): trackers move up by share of today's target completed, settled 10 s after the last tap.
7. **Tracker boxes start at 4** (Ideas 3): Study, Practice questions, Lectures, plus the card app if chosen. Needs Codex's sign-off on the tracker model (board).

## Not in v1

Journal desk and Library (branch `feat/wave2-journal-library`), Q-bank AI and Tutor (branch `feat/wave2-study-ai`), Codex's targets/ledger/soundscape work.

## Verification

`npm run verify:all`, focused unit tests per slice, browser renders at 1440 and 390, dark and light, two palettes, reduced motion; e2e for the banner (appears once after first data, snoozes, never when signed in) and for Wrapped (week close header -> Reports).

## Coordination

Board before touching `DashboardPage.tsx`, `store.ts`, `types.ts`, `TrackerManager.tsx`. Targets data stays Codex's; Wrapped reads it.

## Open decisions for JD

- Banner copy and whether it may return after 30 days if still no account.
- Live account-restore check against the production Supabase project (credentials, real data).
