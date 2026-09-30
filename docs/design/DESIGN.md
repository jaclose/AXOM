# AXOM design contract

The rules both agents (Claude, Codex) and any contributor follow when they add or change UI. It describes what the code already does; when the code and this file disagree, fix one of them in the same change. Older notes: `docs/planning/ux-standards/DESIGN_LANGUAGE.md`.

Brand: unframed metal mark, ΛXOM wordmark, quiet tagline ("Private academic OS"). Canonical reference: `AXOM_Opening_Cinematic_v1/`.

## 1. Voice

- Plain language first. Anything technical (storage engines, checksums, credentials, IDs) goes behind `TechnicalDetails` (closed by default).
- No em dashes in UI copy. Use a full stop, a comma, or a colon.
- Honest about what AXOM knows. If it cannot see something (doctordle.org, Anki without AnkiConnect), say "AXOM only knows what you tell it". Never claim a feature works when it is a draft.
- Short. Titles are a few words; bodies are one sentence where possible.
- Second person, calm, never guilt. "Later" and "Not today" are always valid answers.

## 2. Tokens (web/src/styles/theme.css)

Use tokens, not literals. Every token has a light and a dark value; palettes change the accent.

| Group | Tokens |
|---|---|
| Accent | `--accent-rgb` (use as `rgb(var(--accent-rgb))` or `rgba(var(--accent-rgb), a)`), `--accent-hi-rgb`, `--gold`, `--gold-line`, `--gold-soft` |
| Text | `--text`, then `--text-80` down to `--text-30` for quieter text |
| Surfaces | `--glass-card-fill`, `--glass-card-border`, `--surface-1`, `--surface-2`, `--hairline`, `--hairline-soft` |
| Radii | `--radius-xs` 6, `--radius-sm` 10, `--radius-md` 13, `--radius-lg` 16, `--radius-xl` 22, `--radius-pill` |
| Type | `--font-display` (Poppins) for headings, `--font-ui` for body, `--font-mono` for versions and codes; sizes `--fs-micro` 9 to `--fs-hero` 44; weights `--fw-*` |
| Depth | `--shadow-card`, `--shadow-floating`, `--shadow-overlay`; blur `--blur-panel`, `--blur-soft` |

Gotcha: `rgba(var(--x))` only works for the `*-rgb` tokens (comma triplets). `color-mix(in srgb, var(--gold) 20%, transparent)` works for any colour token.

Light theme: any surface with a hard-coded dark gradient needs a `:root[data-theme="light"]` override (cream `#fffdf9 -> #f4eee3`, border `rgba(var(--ink-rgb), 0.16)`).

## 3. Surfaces and primitives (reuse before you build)

| Need | Use | Where |
|---|---|---|
| Card | `GlassCard` (+ `PanelHeader`) | components/ui/primitives.tsx |
| Buttons | `GButton` (`variant="primary"`, `size="sm"`), `GhostButton`; plain `a.gbtn` for links | primitives.tsx |
| Status chip | `Tag` (`tone`) | primitives.tsx |
| Dialog | `Modal` (portals to `document.body`) | components/ui/Modal.tsx |
| Notice | `pushToast` (tone, `actionLabel` + `onAction` for Undo, `dedupe`) | lib/toast.ts, Toaster.tsx |
| Pointing at one element | `CoachMark` (ripple + aimed bubble, non-modal) | components/shell/CoachMark.tsx |
| Inline prompt on a page | `.standup-prompt-card` + `.standup-prompt-head` (icon, title, one line, actions under the text) | pages.css |
| Small ask at the top of the screen | `.guide-offer` / `.game-checkin` family | tour.css, checkin.css |
| Technical layer | `TechnicalDetails` | components/shell/TechnicalDetails.tsx |
| Dashboard widget | catalog entry in lib/dashboardWidgets.ts + `DashboardWidgetFrame` | components/dashboard |
| Exit animation for lists | `useExitingList` | lib/useExitingList.ts |
| Reorder without jumping | `useSettledOrder` | lib/useSettledOrder.ts |
| Time that updates | `useClockNow("minute" / "second")` | lib/clock.ts |

Icons: lucide-react only, sized with `ICON_SIZE` tiers (`microInline` 12, `body` 14, `emphasis` 16, `control` 20, `display` 24).

## 4. Layers (z-index)

| z | Layer |
|---|---|
| 60-90 | Sidebar drawer, dock, popovers |
| 95-97 | Coach marks, "Overwhelmed?", game check-ins (under dialogs on purpose) |
| 100 | `Modal` scrim |
| 140 | Focus check-in |
| 200-220 | Pomodoro page glow, toasts |
| 260 | Guide offer |
| 300-400 | Guided tour, Promise |
| 1500+ | Full-screen soundscape opener, exam simulator, opening film |

## 5. Nudges (coach marks, reminders, check-ins)

- One at a time. Every optional nudge checks `shellBusy()` (lib/shellBusy.ts): no nudge over a dialog, the tour, the guide offer, the Promise, another nudge, or a focused text field.
- Never modal, never steal focus, always dismissible with Escape or a visible button, always announced politely.
- Each nudge shows once, with a gap between nudges (coach: 3 min), and is dropped when the learner already did the thing (TipKit rule).
- Every nudge family has an off switch and a way back (Help > Show page hints again; Doctordle page reminder toggle).
- Per-device courtesy state lives in localStorage under a versioned key (`axom.coach.v1`, `axom.guideOffer.v1`, `axom.doctordle.v1`); workspace data lives in the store.

## 6. Motion

- Respect `prefers-reduced-motion`: every keyframe animation has a reduced branch (opacity only, or static).
- Ease out for entrances (`cubic-bezier(.22, 1, .36, 1)`), 0.2-0.5 s for UI, up to 0.9 s for a one-time moment.
- Ripples grow by a spread (`box-shadow 0 0 0 16px`), not a scale, so wide and small targets look the same.
- Hover luster is loud once, quiet after (`data-luster-seen`).

## 7. Layout

- Breakpoints: 560 (phone), 880 (sidebar becomes a drawer), 1320 (top-bar quote moves under the title).
- Verify every UI change at 1440 x 900 and 390 x 844, dark and light, before commit.
- The page scrolls inside `.surface-scroll`; never scroll the shell.

## 8. Code rules that protect the design

- Schema stays at 34 unless coordinated on the board. New fields are optional and added to all three normalizers (lib module, store.ts, backup.ts).
- Shell code stays light: Daily Games code must not enter the App chunk (`npm run quality` runs verify-daily-games-bundle).
- Default layouts that change (sidebar, dashboard) ship a versioned, one-time upgrade that respects user edits (`NAV_LAYOUT_VERSION`, `DASHBOARD_DEFAULTS_REVISION`).
- Licensing: no third-party wallpapers or media without a licence; external games are linked, never embedded.
