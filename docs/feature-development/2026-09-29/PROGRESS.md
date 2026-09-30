<!-- Imported planning baseline from ideas3; its reported checks describe that branch only. Current Ideas 2 evidence is appended below. -->
# Progress (feat/ideas3-staging)

Updated 2026-09-30 00:30. Every commit passed `npm run quality` (typecheck, lint, full vitest, build) and was checked in a real browser (headless Chrome, dark theme, screenshots read back).

| Commit | Items | What changed |
|---|---|---|
| b96c5b8 | docs | Ideas 1-3 verbatim, manifest, staged plan, coordination |
| 1bce4b4 | I1-03, I3-28, Daily Word widget | Failed screens stay inside the shell (RouteErrorBoundary); chunk errors no longer swallowed; service worker precaches every route page; Modal portals to body (study-plan dialog no longer painted over); dead dailyGames flag gate removed |
| d7c9a93 | I3-37, I3-60, M-04 (visual) | Notices evaporate instead of blinking out; palette-aware graphite surface |
| 4a44d32 | M-01, M-02 | AXOM orb favicon (SVG + PNGs), rounded notification icon, live tab title + progress ring while a Pomodoro runs |
| dd5e5ba | I1-04, I1-17, I3-34 | 8-stop tour offered after the Promise ("Later" re-offers once after scrolling), gliding spotlight, lighter dim |
| 22857db | I3-01, I3-12, I3-26, I3-27, I3-35, I1-28, I1-29, I1-15, I1-22 (part) | Tracker order frozen while tapping (10 s settle), late-night band, natural import order, one-tap Not now + Undo, pause on headphone removal, Building page no longer shifts, About tabs, quieter luster after first hover, settings CTA on one line |
| d626082 | I3-39 | Focus-timer minutes count on the Study tracker, so topping up by hand no longer doubles the day (384 -> 736) |
| d0c502d | sweep, D1, D9 | Fixes from the light-theme and 390 px sweep; no developer phone number anywhere (D1); blue orb identified (D9) |
| 97a0d70 | docs | RECONCILIATION.md: strict status per item |
| 7a85fe0 | I3-54, I3-55, I3-56, I3-57 | Daily Word win card, numbered share text, on-board how-to (ENVOY/EBONY), back link, no page scroll |
| a77a59b | I3-53 | Daily Word hint ladder: key glow, then tile outline, then a confirmed reveal that keeps the streak |
| 937a991 | I1-23, I3-52, I3-58 | Sidebar: daily-use Tools, Misc folder for Tasks/Methods/Prompts/Hub folders, drag or Alt+Arrow reordering, one-time upgrade for saved profiles; Daily Word and Doctordle countdowns + streak; Application Checker opens on Residency for med tracks |
| 708e5aa | I3-27 | "Not now" no longer resets an item's review clock; Undo restores the exact order (found while verifying I3-27) |
| 2c24bf6 | I1-22 (part) | No em dashes left in Settings prose |
| c823b2a | I1-17 (part) | Reports gets a Help mini guide (4 stops), like Course Tracker, Question Bank and Productivity |
| d975e58 | F7 | docs/design/DESIGN.md, the shared design contract |
| 67eb5c0 | I1-22 (part), I1-32 | Settings: plain language first, a Technical details disclosure for the rest (Account, Data); Integrations copy says what Anki Lab really does |
| 362a7be | top bar | Clock and Refresh stay top-right under long subtitles (checked on 10 pages at 5 widths) |
| 3386844 | I3-59, I3-57 | Doctordle: "Did you get it?" when you're back (inline on its page), a dashboard reminder for regulars (Yes / No / Later / Don't show again), sidebar flame from your own check-ins, a real back link and today's case number |
| 120a7ba | I1-18, I1-19, F4, I3-18 | "Overwhelmed?" once after the guide and Promise (arrow + ripple to Customize); one first-visit hint per page on a reusable CoachMark; Help can bring hints back; signing the Promise -> tour offer verified |
| a030af0 | I1-21 | Dashboard: Daily Check-In, then the focus timer with a new Soundscape widget beside it, then targets, Question Bank, Course Tracker, Weekly; saved layouts carried forward once (defaultsRevision 2) |

Test count: 1,906 at baseline, 1,979 now.

## Next (Wave 1 remainder)

1. Soundscapes mini guide once Codex's page restructure lands (I1-17).
2. Wave 1 is otherwise clean; Wave 2 (onboarding rehaul, journal desk, Wrapped, library) waits for JD's go-ahead per the review.

## Waiting on JD

Decisions D1-D9 in PLAN.md (phone number in a public repo, iPad wallpapers licensing, NCRS hosting, drive links, generated assets, renal labs screenshot, blue orb check).


## Ideas 2 current session, 2026-09-30

Baseline: feat/ideas2-integration at c04272d, substantial inherited unstaged implementation. No Ideas 2 feature is SHIPPED + VERIFIED yet. Recovery patch and untracked files preserved in .coordination/recovery-* (never staged). Planning documents were missing here and restored from ideas3 as an attributed baseline. Current statuses and evidence follow in later entries.

### Checkpoint evidence

- Baseline reproduction: 32 manual + 352 Pomodoro minutes yields academic=384 but Study tracker=32. Coordinated Claude d626082 matcher makes both 384. Browser exercise retries the same observed 352-minute event through recordStudyActivity and logStudy: one event, total and tracker remain 384 after reload.
- Highlight baseline rejects extending a compatible mark as overlap. Current interval merge passes real Chrome pointer selection into/out of/across a mark, deletion and reload. Screenshots: /tmp/axom-ideas2-wavea-evidence.
- Spotify contract browser test creates exactly one iframe across Soundscapes/Productivity; observed playback drives dock, hide preserves instance, disconnect destroys it. This is a controlled API fixture, not evidence of authenticated Spotify playback.
- Locked In real scheduled prompt persists across routes/reload, distinguishes no goal / 42-minute daily study goal / active timer. Latest user instruction: stay until acted on, then fade. Unit test proves no unanswered timeout and 2200 ms response + 240 ms exit.
- Current full working-tree validation (Node 22.23.1): 201 test files / 1964 tests pass, typecheck, lint, production build pass. Existing bundle-size and mixed-static/dynamic-import build warnings remain. Original Node 26 run exposed its experimental global localStorage mismatch; reran with supported Node 22.
- Native canonical folder checks pass (2 Rust tests); explicit main-window permission boundary added after reviewing Tauri app-command defaults. Packaged/native interaction still pending.
- Concurrent edits appeared in this same worktree from two Codex CLI processes. Do not stage incoming tracker/soundscape changes without resolving ownership. No merge, push, deployment, schema change or credentials used.

### I2-06 annotation verification

- Compatible adjacent/overlapping highlights merge through a fixed-point interval union, preserving the oldest ID. Different colors/notes remain protected; all three question surfaces replace the resulting annotation set atomically. Dragging in erase mode no longer deletes a mark.
- Regression: old implementation rejected extending an existing highlight. Unit/component tests cover bridging marks, tone conflicts, persistent offsets and selection behavior. Real Chrome pointer drags verified plain selection, selection into/out of/across an existing mark, reload, keyboard deletion and reload again.
- Browser artifact: `/tmp/axom-ideas2-wavea-evidence/ideas2-wave-a-real-pointer-18a13-across-persisted-highlights/highlight-merged.png`. The new standalone `ideas2-highlights.spec.ts` retains this journey.
- Commit snapshot verification: 192 files / 1902 tests, typecheck, lint and production build passed on Node 22.23.1; Chrome journey passed against that isolated snapshot. Its temporary Vite harness explicitly allowed the existing symlinked dependencies. Existing bundle warnings remain. `git diff --check` passed.
