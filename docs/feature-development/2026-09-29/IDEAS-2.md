<!-- Imported planning baseline from ideas3; its reported checks describe that branch only. Current Ideas 2 evidence is appended below. -->
# AXOM — IDEAS 2
## High-Fidelity Product / UX / Integration Upgrade

Work directly on the existing AXOM codebase.

This is an **implementation task**, not just a design proposal.

The objective is to make AXOM feel substantially more integrated, automatic, refined, persistent, and native—especially around studying, productivity tracking, soundscapes, timers, goals, notifications, focus environments, and system-level interactions.

Do **not** simply bolt new cards onto the dashboard.

Preserve the existing visual identity and architecture where they are good, but aggressively improve weak UX, low-fidelity controls, fragile interactions, duplicated manual workflows, and inconsistent design.

The finished experience should feel like one coherent premium product.

---

# 0. AGENT + SKILL ORCHESTRATION

Use the strongest available agents/skills instead of attempting the entire task in one undifferentiated pass.

If an exact skill is unavailable in the active session, continue using the nearest equivalent rather than stopping.

### Phase 1 — Repository reconnaissance

Use:
- `explore`
- `research` where current third-party behavior needs verification

Inspect before modifying:

- dashboard architecture
- global layout / route hierarchy
- persistent application shell
- productivity logging
- study sessions
- cards/questions
- Anki integration
- Noji integration
- Quizlet integration if present
- soundscapes
- Spotify integration
- timer/Pomodoro architecture
- goals/targets
- exam dates
- Hub Folders
- notifications
- Resend templates
- light/dark theme system
- Tauri/native APIs
- persistence layer
- Supabase schema/RPCs where applicable
- analytics/event architecture
- tests

Map the current data flow before changing it.

Do not create parallel systems when AXOM already has the beginnings of one.

---

# 1. DESIGN QUALITY PASS

Use the available skills where appropriate:

- `redesign-existing-projects`
- `high-end-visual-design`
- `design-taste-frontend`
- `gpt-taste`
- `web-interface-guidelines`

The target is **high fidelity**, not generic SaaS UI.

Avoid:

- cheap gradients
- excessive glow
- arbitrary glassmorphism
- giant empty cards
- duplicated information
- inconsistent border radii
- tiny low-quality icons
- unnecessary labels
- buttons that look interactive but do nothing
- hard-coded dark-mode remnants in light mode
- dashboard clutter
- gimmicky animation

Prioritize:

- hierarchy
- typography
- spacing
- restraint
- micro-interactions
- useful animation
- information density
- clear state changes
- native-feeling controls
- contextual UI
- persistence
- responsiveness
- accessibility

All changes must work across desktop widths and sensible mobile/tablet breakpoints where AXOM supports them.

---

# 2. “LOCKED IN” SYSTEM — GLOBAL + PERSISTENT

The existing “Locked In” feedback/message should become a persistent global experience.

## Required behavior

When Locked In is triggered:

- it must remain visible until the user explicitly interacts with it
- it must NOT disappear because of route/navigation changes
- it should appear regardless of what AXOM page the user is currently viewing
- render it through the persistent application shell rather than inside an individual page
- use a portal/global overlay layer if appropriate

### Placement

Use a polished responsive presentation:

Desktop:
- upper-center or central upper region
- visually prominent
- not blocking primary content
- not covering important navigation

Small screens:
- reposition appropriately
- maintain safe areas
- never make controls unreachable

It should feel more like an AXOM system-level state than a toast.

Do not use a standard disposable snackbar.

---

# 3. FIX LOCKED-IN TIME LANGUAGE

There is currently misleading language such as:

> “5h to go”

when no actual timer is running.

I discovered this is apparently referring to how much remains toward a daily goal.

That distinction must become explicit.

### If an actual timer is running

Examples:

- `52 min remaining`
- `Locked in · 1h 14m`
- `Current focus session · 38 min left`

### If NO timer is running but a target remains

Say something like:

- `2h 15m remaining toward today's study goal`
- `You’re 68% of the way to today's target`
- `1h 40m left toward Study`

Never visually imply that a timer is counting down.

### If there is no active timer and no meaningful target data

Use natural contextual copy such as:

- Hope you're productive.
- Make this one count.
- Put in a clean session.
- Build the day.
- Keep moving.
- One good block at a time.
- Do the work worth remembering.
- Make the next hour useful.

Add a meaningful pool of AXOM-native phrases so it does not repeatedly show the same sentence.

Avoid corny productivity clichés.

---

# 4. QUOTE SYSTEM REDESIGN

The quotes at the top of AXOM are good conceptually but currently too visually passive.

Rework the container.

It should become:

- more visually intentional
- better typography
- beautiful spacing
- integrated into AXOM's design language
- recognizable without dominating the dashboard

Consider:

- subtle quotation mark treatment
- author/source hierarchy
- tasteful entrance transitions
- very subtle background treatment
- responsive typography

## AXOM Originals

Add substantially more **original AXOM-written quotes**.

Do not copy copyrighted quote collections.

Original lines should feel:

- intelligent
- restrained
- ambitious
- reflective
- precise
- disciplined
- occasionally philosophical
- appropriate for medicine, learning, creation, research, and difficult work

Avoid fake attribution.

Store original AXOM lines distinctly from sourced quotations.

---

# 5. SPOTIFY — PERMANENT SOUND ENVIRONMENT

The Spotify experience currently has several problems.

### Current problems

1. Spotify playback does not properly appear in the bottom media/sound pill.
2. Spotify listening is not properly represented/tracked.
3. Leaving the Soundscapes page causes the Spotify iframe/player to refresh.
4. Returning to the page therefore destroys continuity.
5. The Spotify section requires too much manual reopening/reloading.

Fix the architecture, not merely the UI.

---

# 6. KEEP SPOTIFY PLAYER MOUNTED

Spotify should behave as persistent application infrastructure.

The player should NOT be destroyed/remounted on ordinary route changes.

Investigate moving the playback/player owner into:

- persistent application layout
- global media provider
- global portal
- equivalent persistent React architecture

The Soundscapes page can show/control the player, but navigation elsewhere should not destroy the underlying playback state.

### Important

Research the current official Spotify embed / IFrame API / SDK behavior before implementing deeper playback telemetry.

Do not invent playback events or fake “playing” state.

If Spotify exposes supported playback events, use them.

If full telemetry requires authorization or Spotify Web Playback SDK credentials, architect it cleanly and document what is actually available.

---

# 7. BOTTOM MEDIA PILL

When Spotify is playing through AXOM, the persistent media pill should recognize it.

Display useful information where available:

- source: Spotify
- track
- artist
- artwork
- play/pause state
- elapsed state if officially available
- shortcut back to Soundscapes

The same architecture should support AXOM-native audio sources.

Do not hard-code special behavior directly into the pill.

Create a normalized media-session abstraction if one does not already exist.

Example conceptual model:

```ts
type MediaSource =
  | "spotify"
  | "jazz"
  | "lofi"
  | "soundscape"
  | "frequency"
  | "local";

interface AxomMediaSession {
  source: MediaSource;
  title?: string;
  subtitle?: string;
  artwork?: string;
  isPlaying: boolean;
  duration?: number;
  currentTime?: number;
}
```

Adapt this to the existing code rather than duplicating the model if equivalent architecture already exists.

---

# 8. SOUNDSCAPES SHOULD FEEL PERMANENT

The Soundscapes page should be populated without requiring me to repeatedly initialize things manually.

Spotify content:

- persists
- does not refresh unnecessarily
- updates its catalog/recommendations at most once per day where appropriate

Also create/support clearly differentiated libraries for:

- Jazz
- Lo-fi
- Ambient
- Nature
- Deep Focus
- Frequencies / tone-based focus audio
- AXOM Originals

Do not create giant duplicated lists.

Use a consistent browse/search/favorite/recent model.

---

# 9. PRODUCTIVITY AUTO-LOGGING

This is important.

If studying happens **inside AXOM**, AXOM should know about it automatically.

The user should not have to manually record study work AXOM itself just observed.

Automatically log:

### Questions

Questions completed through:

- AXOM native question interface
- supported integrations
- future UWorld/AMBOSS-style simulator modes where AXOM owns the activity

Capture appropriate fields such as:

- count
- correct
- incorrect
- skipped
- duration
- source/mode
- subject/topic if available
- date/time

### Cards

Cards reviewed through:

- AXOM native cards
- Anki integration
- Noji integration
- Quizlet integration where supported

Capture:

- cards reviewed
- session duration
- source
- deck if appropriate
- performance data where available

Do not count the same event twice.

---

# 10. UNIFIED STUDY EVENT MODEL

If the current architecture is fragmented, move toward a normalized event system.

Conceptually:

```ts
StudyActivity {
  id
  userId
  type
  source
  startedAt
  endedAt
  durationSeconds
  quantity
  correct
  incorrect
  metadata
}
```

Types might include:

- flashcards
- questions
- pomodoro
- reading
- lecture
- manual
- practiceExam

Sources might include:

- axom
- anki
- noji
- quizlet
- imported
- manual

Use existing schema if equivalent.

Do not perform unnecessary schema churn.

---

# 11. PRODUCTIVITY PAGE

Automatically recorded work should immediately contribute to the Productivity screen.

The user should be able to see something like:

**Today**
- 186 cards reviewed
- 42 questions completed
- 3h 48m focused study
- 4 Pomodoros
- 74% Study target

Manual logging should remain available for activities AXOM could not observe.

But manual logging should become the exception rather than the primary workflow.

---

# 12. EXAM COUNTDOWN SYSTEM

Create a proper exam countdown widget.

It should support two distinct concepts:

## STEP 1

The user can configure:

- Step 1 date
- optional target date if exact booking has not occurred

Display:

- days remaining
- exam name
- date
- visual urgency progression

Because Step 1 is a major long-horizon examination, it should begin visually changing much earlier than module exams.

Example progression:

- far away → calm/neutral
- ~6 months → subtle indication
- ~3 months → clear awareness
- ~1 month → high prominence
- ~2 weeks → strong urgency
- final days → unmistakable

Do not make the interface psychologically obnoxious.

Urgency should increase through:

- accent
- contrast
- typography
- subtle motion where appropriate

—not giant warning banners.

---

# 13. MODULE EXAMS

Allow one or more upcoming module exams.

User can:

- add exam
- rename it
- set date
- edit date
- remove it
- mark complete

### Weighting behavior

If there is only **one** active module exam, AXOM can reasonably assume it is the primary near-term academic deadline.

Therefore:

- begin the visible urgency transition around ~10 days out

Possible progression:

- >10 days → normal
- 10 days → subtle shift
- 7 days → stronger
- 3 days → strong
- 1 day → highest

If several module exams are simultaneously active:

- show each independently
- avoid making every card bright red
- use proximity + priority
- emphasize the nearest relevant exam

Step 1 remains a strategically higher-level deadline.

---

# 14. COUNTDOWN UI

Create an elegant split layout:

```text
┌───────────────────────────┬───────────────────────────┐
│ STEP 1                    │ MODULE                    │
│ 184 days                  │ 8 days                    │
│ Mar 31, 2027              │ Renal / Module Exam       │
└───────────────────────────┴───────────────────────────┘
```

It should collapse intelligently on small screens.

Dates should be editable either:

- directly in the widget
- or through a clearly linked configuration surface

Do not hide configuration behind obscure menus.

---

# 15. HIGHLIGHTING BUG

Current bug:

If text already contains a highlight, attempting to start or extend another selection across the highlighted region does not work correctly.

Fix it properly.

Expected behavior:

A user should be able to:

1. highlight text
2. later select text beginning outside that highlight
3. drag across the existing highlight
4. include additional text
5. apply/extend the annotation

The final result should merge overlapping or adjacent compatible highlight ranges rather than creating broken nested markup.

Avoid fragile DOM-only annotation state.

If AXOM currently models highlighting with raw nested HTML spans, assess whether a range-based annotation model is more robust.

Add regression tests for:

- selection across an existing highlight
- partially overlapping highlight
- highlight removal
- adjacent highlights
- multiline highlighting
- persistence after reload

---

# 16. FOCUS ENVIRONMENTS / BACKGROUND EXPERIENCES

I want AXOM to support optional immersive environments.

Think:

- WindowSwap
- Quilt/Zoom-style experiences
- ambient web scenes
- local wallpaper/video environments
- other high-quality focus experiences

Create a concept such as:

**Focus Spaces**

or an equivalent AXOM-native name.

A space can be:

- AXOM-native visual
- local video
- supported remote webpage
- ambient environment
- wallpaper-style scene

---

# 17. EXPANDABLE EMBED CONTAINER

For a compatible website:

Initial state:

- clean card/container

Click:

- expands toward the top/content area

Then:

- user can enter immersive/fullscreen mode

When expanded/fullscreen:

- AXOM timer remains accessible
- soundscape pill remains accessible
- controls become smaller and repositioned so they do not interfere

Think floating minimal HUD rather than normal dashboard controls.

---

# 18. DO NOT HACK AROUND WEB SECURITY

Some sites prohibit framing using:

- CSP
- `frame-ancestors`
- `X-Frame-Options`

Research/test candidates.

If a site legally/technically cannot be embedded:

- do not circumvent its security policy
- offer an elegant external-opening experience instead
- preserve the AXOM focus session if possible

WindowSwap should be tested explicitly.

---

# 19. LOCAL APP INTEGRATION

For macOS tools such as wallpaper applications or other focus utilities:

Do not pretend a normal browser can embed arbitrary native macOS windows.

Determine what AXOM's Tauri/native layer can actually support.

Possible supported behavior:

- launch application
- reveal/open local content
- use AXOM-owned local video assets
- open external focus experience
- retain AXOM timer/media controls

Clearly separate:

**Web AXOM capabilities**

from

**Native AXOM capabilities**

---

# 20. LIGHT MODE REBUILD

Light mode needs a quality pass.

Problems:

- too bright
- harsh white
- dark-mode artifacts remain
- some surfaces/controls were clearly designed for dark mode first
- inconsistent contrast

Perform a systematic theme audit.

Search for:

- hard-coded hex colors
- hard-coded `white`
- hard-coded dark backgrounds
- inline colors
- dark-only shadows
- SVG fill/stroke values
- charts that ignore theme
- modal/popover remnants
- editor surfaces
- hover states
- borders
- form controls

Create/fix semantic design tokens.

Example categories:

- background
- surface-1
- surface-2
- surface-elevated
- text-primary
- text-secondary
- text-muted
- border
- accent
- accent-muted
- destructive
- success
- warning

Light mode should feel more like:

- warm paper
- premium productivity software
- restrained contrast

rather than a giant white webpage.

Do not simply tint everything beige.

Maintain WCAG-appropriate contrast.

---

# 21. TARGETS + TRACKERS — REARCHITECT THE RELATIONSHIP

Currently Targets and Trackers feel too disconnected.

I want the tracker to essentially become the **simplified progress view of the target**.

## Targets

Targets define intent.

Examples:

Study:
- 4 hours/day

Questions:
- 40/day

Cards:
- 200/day

Gym:
- 4/week

Reading:
- 5/week

---

# 22. AUTOMATIC STUDY TARGET

The primary **Study** target is special.

It should be connected to the Pomodoro/focus timer.

If I study using the native AXOM timer:

that time automatically increments the Study target.

I should NOT manually record those minutes afterward.

The Study target itself should remain a protected/system target.

The user can modify:

- icon
- required amount
- per-day vs per-week configuration where appropriate

But should not accidentally convert it into some unrelated target type and break automation.

---

# 23. CUSTOM TARGETS

Other targets can be flexible.

Examples:

Gym:
- 4 sessions/week

Questions:
- 40/day

Anki:
- 200 cards/day

Research:
- 5h/week

Allow sensible units:

- minutes
- hours
- repetitions
- sessions
- count

Support days off / schedules where appropriate.

For example:

Study:
- Mon–Sat
- Sunday off

or:

Gym:
- 4 sessions per week

Do not force daily streak logic onto weekly behaviors.

---

# 24. TRACKER UI

Tracker view should be simple.

Example:

```text
Study       3h 14m / 4h       81%
Questions   31 / 40           78%
Cards       186 / 200         93%
Gym         3 / 4 this week   75%
```

Clicking a tracker can open the richer Target details.

Do not duplicate the entire target editor inside every tracker.

---

# 25. PRODUCTIVITY DASHBOARD LAYOUT

The Pomodoro/focus timer currently needs better spatial importance.

Desired hierarchy:

1. Weekly overview
2. Monthly overview
3. Pomodoro/focus timer
4. Activity/logging detail

The Pomodoro timer should appear **above the Activity Log**.

### Desktop behavior

Think Tetris-like responsive card composition.

Top:

```text
┌────────────────────┬────────────────────┐
│ Weekly Overview    │ Monthly Overview   │
└────────────────────┴────────────────────┘
```

Immediately beneath that:

```text
┌─────────────────────────────────────────┐
│           Pomodoro / Focus              │
└─────────────────────────────────────────┘
```

The timer can begin visually aligned under Weekly and, when expanded/running, grow naturally across the available width beneath Weekly + Monthly.

Do not create awkward dead space.

Use CSS Grid intelligently rather than absolute positioning hacks.

---

# 26. HUB FOLDERS

Uploads work, but the current folder cards/icons/buttons feel low-quality and some controls are nonfunctional.

Redesign them.

## Native behavior

When AXOM knows the path of a local Hub Folder:

Clicking the primary folder action should actually:

- open that folder in Finder

and optionally expose:

- Reveal in Finder
- Copy path
- Open in Terminal

if appropriate.

Use the existing Tauri/native command layer.

Do not expose unsafe arbitrary shell execution.

Validate/sanitize local paths.

### Browser fallback

If AXOM is running purely as a website and cannot open the local Finder path:

- do not render a fake working button
- clearly indicate native-only behavior
- provide whichever browser-safe alternative exists

---

# 27. HUB FOLDER VISUAL QUALITY

Improve:

- folder icon
- action iconography
- hover states
- empty state
- file counts
- last modified display
- sync/import state
- click targets
- typography
- loading state
- error state

Use a consistent icon library already present in AXOM if possible.

Do not mix unrelated icon styles.

---

# 28. “PUT MY HEAD DOWN” ALARM

Add/improve the short-rest / head-down alarm concept.

I should be able to configure:

- duration
- alarm sound
- volume
- optional fade-in
- vibration/system notification if supported
- whether soundscape pauses or ducks

Allow saved presets.

Examples:

- 10 min reset
- 20 min power nap
- 30 min rest

---

# 29. ALARM SOUNDS / ASSETS

Investigate whether macOS/Apple system alert sounds may be referenced legally and technically from the local system without redistributing Apple's copyrighted assets.

Do NOT package Apple's proprietary sound files into AXOM without confirming redistribution rights.

If the native app can call a system sound safely, expose supported system tones.

Also support AXOM/user-provided sounds.

### Tell me exactly what assets are still needed

At the end of implementation, produce a section:

## Assets I need from Jafar

For any sound files required from me, specify:

- purpose
- file format
- preferred duration
- stereo/mono
- sample rate if relevant
- naming convention

Preferred accepted formats should include sensible standards such as:

- `.wav`
- `.m4a`
- `.mp3`

Do not require proprietary tooling.

---

# 30. FREQUENCY / FOCUS AUDIO

Support a clean category for:

- ambient frequency tracks
- binaural-style focus tracks where provided
- continuous tones where appropriate

If simple tones can be generated responsibly through Web Audio rather than shipping huge files, investigate that option.

Keep claims scientifically conservative.

Do not tell users a frequency “increases IQ” or medically treats a condition.

---

# 31. RESEND EMAIL REDESIGN

Audit every user-facing transactional email currently sent via Resend.

Bring them into the AXOM visual system.

Examples may include:

- account verification
- OTP / magic link
- welcome
- password reset
- account/security notices
- important notifications
- study summaries if they exist

Create reusable email components/templates instead of separately styled HTML blobs.

Goals:

- excellent mobile rendering
- clean typography
- AXOM identity
- safe email CSS
- accessible text
- plain-text fallback where supported
- concise copy
- no cheesy marketing aesthetic

Security emails must prioritize clarity over decoration.

---

# 32. NOTIFICATION SYSTEM

Upgrade browser/native notifications.

I want AXOM notifications to feel like AXOM rather than generic application noise.

For browser:

Use supported browser notification mechanisms properly.

Audit:

- Notification API
- Service Worker
- push support
- permission handling
- notification click behavior
- duplicate prevention
- application state when opened

For Tauri/native desktop:

Use supported native notification APIs.

Where OS restrictions allow customization, use AXOM assets/copy.

Where macOS/Chrome controls the visual rendering, accept that limitation rather than faking a custom OS notification.

Inside AXOM itself, however, create polished AXOM notification surfaces.

---

# 33. NOTIFICATION DEEP LINKS

Notifications should go somewhere useful.

Examples:

`Study target almost complete`
→ Productivity / target

`Module exam in 3 days`
→ exam countdown / study planning

`Rest timer finished`
→ active timer

`Question block completed`
→ session results

Never send users to a generic dashboard if a meaningful destination exists.

---

# 34. PERSISTENCE

These features must survive:

- reload
- navigation
- app restart where expected
- account sign-in on another device where appropriate

Decide intentionally which state belongs in:

- component state
- global state
- local persisted state
- IndexedDB/localStorage
- Supabase/account data

Do not put everything in localStorage.

Examples:

Likely account-level:
- exam dates
- targets
- tracked study activity
- user preferences where cross-device behavior matters

Likely local/device-level:
- device-specific Hub Folder paths
- native application integrations

Document this distinction.

---

# 35. ANALYTICS / EVENT INTEGRITY

Automatic productivity logging must be trustworthy.

Prevent:

- duplicate events
- route-remount duplicates
- timer resume double-counting
- duplicate imported card reviews
- accidental double logging from integrations
- timezone/day-boundary mistakes

Use stable event IDs/idempotency where appropriate.

All dates should use a consistent canonical representation.

Display them in the user's local timezone.

---

# 36. PERFORMANCE

Do not solve persistence by keeping the entire application alive forever.

For Spotify/media specifically, persist only the architectural layer necessary to preserve media state.

Profile:

- route transitions
- dashboard render
- soundscape page
- productivity charts
- large activity history
- timers

Avoid unnecessary polling.

The “refresh once per day” content behavior should use caching/staleness logic, not a constantly running timer.

---

# 37. ACCESSIBILITY

Run the UI through `web-interface-guidelines` or equivalent.

Check:

- keyboard navigation
- focus rings
- modal focus containment
- color contrast
- light mode contrast
- icon-only button labels
- screen-reader text
- reduced motion
- hover-only interactions
- touch target size
- tooltip accessibility

Urgency colors for exams must never be the sole information carrier.

---

# 38. PLAYWRIGHT / INTERACTION TESTING

Use `playwright-cli` and existing browser test infrastructure.

Do not only unit-test this work.

At minimum test:

### Locked In
- appears globally
- survives route change
- persists until interaction
- correct copy with timer
- correct copy without timer
- correct goal-remaining labeling

### Spotify
- Soundscape navigation does not unnecessarily recreate player
- bottom pill receives media state where supported
- page navigation does not destroy AXOM-owned state

### Productivity
- native question completion logs
- native flashcard review logs
- Pomodoro time updates Study target
- reload does not duplicate events

### Exams
- create/edit/delete exam
- Step 1 date persists
- module date persists
- urgency state changes correctly

### Highlights
- selection crosses an existing highlight

### Hub folders
- native folder action uses native API correctly

### Theme
- dark mode
- light mode
- system mode if supported

### Layout
- desktop
- narrower desktop
- tablet-sized viewport
- mobile where supported

---

# 39. TASK AGENT — BUILD VALIDATION

Use the task/build agent for:

- typecheck
- lint
- unit tests
- integration tests
- Playwright
- production build
- Tauri/native build checks where practical

No feature is complete merely because TypeScript compiles.

---

# 40. RUBBER-DUCK REVIEW

After implementation, use the `rubber-duck` agent on the completed design and architecture.

Ask it specifically to look for:

- unnecessary complexity
- duplicate state
- misleading UI
- accidental manual workflows
- data double counting
- poor information hierarchy
- brittle media persistence
- route lifecycle mistakes
- unnecessary schema changes
- inaccessible interactions

Fix meaningful findings before concluding.

---

# 41. CODE REVIEW

Then use `code-review`.

Review:

- architectural consistency
- React state ownership
- race conditions
- event lifecycle
- persistence
- tests
- regressions
- dead code
- unused components
- brittle effects
- unnecessary dependencies

Resolve meaningful findings.

---

# 42. SECURITY REVIEW

Use `security-review`.

Pay particular attention to:

- Tauri filesystem/open-folder commands
- arbitrary path handling
- URL launching
- external embedded content
- iframe sandboxing
- Supabase writes
- RLS
- notification payloads
- Spotify OAuth/token handling if introduced
- Resend credentials
- HTML/email injection
- imported highlight content
- external URLs

Never expose:

- service-role key
- Resend secret
- Spotify client secret
- private credentials

to the client bundle.

---

# 43. DO NOT BREAK EXISTING FEATURES

Before major changes, identify existing behaviors dependent on the touched architecture.

Preserve:

- accounts
- auth
- onboarding
- question engine
- cards
- productivity data
- soundscapes
- current timers
- updater/native app
- Hub imports
- routing
- responsive behavior

Avoid broad rewrites unless there is a real architectural reason.

---

# 44. MIGRATIONS

If the database must change:

- create explicit migration
- maintain RLS
- use least privilege
- consider existing records
- avoid destructive migration
- document the new data model

Do not mutate production tables manually.

---

# 45. VISUAL BAR

I want this to feel like:

**AXOM becoming a coherent operating environment for studying**, not a collection of widgets.

That means the interactions should connect:

```text
Questions
        ↓
Study Activity
        ↓
Productivity
        ↓
Targets
        ↓
Weekly / Monthly Progress


Flashcards
        ↓
Study Activity
        ↓
Productivity


Pomodoro
        ↓
Study Time
        ↓
Study Target


Exam Dates
        ↓
Countdown
        ↓
Planning / urgency


Spotify / Lo-fi / Jazz
        ↓
Media Session
        ↓
Persistent media pill


Hub Folder
        ↓
Native filesystem
        ↓
Finder / AXOM resources
```

Build shared systems instead of isolated visual features.

---

# 46. UX PRINCIPLE

The app should infer what it reasonably can from actions the user already took.

If AXOM:

- timed the study session
- served the question
- showed the flashcard
- knows the exam date
- opened the file
- started the audio

then AXOM should generally not ask the user to manually type the same information afterward.

Automation should remove bookkeeping.

---

# 47. IMPORTANT THIRD-PARTY RESEARCH

Use the `research` agent where appropriate and rely primarily on current official documentation for:

- Spotify Embed / IFrame API
- Spotify playback APIs if necessary
- Tauri filesystem/shell/opener capabilities
- Chrome/browser Notifications
- web push
- Resend
- iframe security limitations
- relevant macOS system sound APIs

Do not build integrations from assumptions.

---

# 48. IMPLEMENTATION SEQUENCE

Use this order unless repository architecture strongly suggests another:

### A. Architecture
1. inspect
2. map global shell/state
3. map data/persistence
4. identify current bugs

### B. Unified foundations
5. study activity model
6. target/tracker relationship
7. persistent media architecture
8. global Locked In architecture

### C. Features
9. auto productivity logging
10. Spotify persistence
11. bottom media pill
12. exam countdown
13. Pomodoro/targets integration
14. dashboard layout
15. highlighting fix
16. Hub folders
17. alarms/audio
18. focus environments
19. notifications
20. Resend email redesign

### D. Polish
21. light mode
22. quote system
23. microcopy
24. animation/micro-interactions
25. responsive behavior

### E. Verification
26. Playwright
27. build/tests
28. rubber-duck review
29. code review
30. security review
31. final cleanup

---

# 49. DO NOT STOP AT A PLAN

After reconnaissance, implement as much of this request as is technically appropriate in the repository.

Do not return a giant plan without modifying code.

If a feature is blocked by an external credential, asset, browser security rule, or user-provided file:

1. implement everything around the blocker
2. leave the architecture ready
3. identify the exact blocker
4. tell me exactly what I must provide

Do not leave unrelated features unfinished merely because one integration is blocked.

---

# 50. FINAL REPORT

At the end give me a concise but complete engineering report:

## Implemented
Exact features completed.

## Architecture
Important architectural changes.

## UX improvements
Meaningful behavior/design changes.

## Automatic tracking
Exactly what AXOM now records automatically.

## Persistence
What persists locally vs account-wide.

## Third-party limitations
Spotify / iframe / browser / OS restrictions discovered.

## Assets I need from Jafar
Exact files, formats, purpose, and recommended specs.

## Tests
Commands/tests executed and results.

## Review findings
Meaningful findings from:
- rubber-duck
- code review
- security review

and what was fixed.

## Remaining work
Only genuine blockers or intentional follow-ups.

## Files changed
Important files/directories.

## Commit
Do **not** push or merge unless explicitly authorized.

If the working tree was clean when you began, create logical checkpoint commits if that matches the repository workflow, but report exactly what you committed.

---

# FINAL PRODUCT STANDARD

Do not optimize this for merely “working.”

Optimize it for:

- coherent architecture
- automation
- stability
- premium visual execution
- low maintenance
- persistent state
- native-feeling interaction
- excellent information hierarchy
- trustworthy study analytics
- minimal redundant user input
- long-term extensibility

When forced to choose between adding another decorative widget and making two existing systems intelligently communicate, choose the integration.

AXOM should increasingly feel like the system that understands what the user is doing—not another application the user has to maintain.