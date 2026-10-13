Use **AXOM Pulse**.

It fits the product better than “Wrapped” because it is medical without being gimmicky, implies measurement over time, works visually with the Orb, and can become a recognizable AXOM-owned experience.

The annual experience becomes:

> **PULSE 2026**  
> Your year in medicine, measured.

I would reserve **Pulse** specifically for the major retrospective experience so you don't dilute it by calling every weekly email a Pulse.

Weekly = **Weekly Report**  
Monthly = **Monthly Report**  
Annual / term-defining cinematic experience = **AXOM Pulse**

Other names I considered were **AXOM Vitals**, **AXOM Casefile**, **AXOM Readout**, and **AXOM Chart**. Pulse is the strongest combination of medicine, motion, personalization, and premium branding.

You could eventually have:

> PULSE // 2026  
> PULSE // Term 4  
> PULSE // Year One

with each one generated from a canonical snapshot of the user's learning history.

---

# Full AI implementation prompt

Copy this into the AXOM coding agent:

```text
You are implementing AXOM's production-grade Communications, Email,
Personalization, Privacy, and AXOM Pulse systems.

This is a real production feature.

Do not build a decorative prototype.
Do not create isolated demo components.
Do not duplicate existing AXOM systems.

============================================================
PRODUCT CONTEXT
============================================================

AXOM is a premium academic operating system with a strong initial focus
on medical education.

The product already has or is developing systems involving:

- Supabase
- authentication/accounts
- course templates
- QBank
- question attempts
- Anki integration
- study analytics
- study sessions
- DailyWord
- DoctorDle
- Pathordle
- Radiordle
- dashboards
- user personalization
- themes/accent colors
- AXOM Orb identity
- productivity/activity tracking
- web + desktop/native functionality
- Resend email delivery

The goal is to create a coherent communications platform that feels like
a native part of AXOM rather than a newsletter service bolted onto it.

============================================================
CORE PRINCIPLE
============================================================

RESEND IS THE DELIVERY INFRASTRUCTURE.

AXOM owns:

- communication preferences
- user consent
- notification categories
- personalization
- study analytics
- reporting
- message generation
- scheduling
- email history
- communication logic
- privacy controls
- export state
- deletion state
- AXOM Pulse generation

Do NOT scatter direct Resend calls across the application.

Create one canonical communications layer.

============================================================
PHASE 0 — REPOSITORY DISCOVERY
============================================================

Before making changes, inspect the repository.

Find the canonical implementation for:

- Supabase auth
- profiles
- user names
- avatars/profile images
- AXOM Orb assets
- theme/accent preferences
- notification preferences
- course enrollment
- course templates
- QBank
- question_attempts
- analytics
- study sessions
- Anki activity
- exams
- calendar/deadlines
- streaks
- achievements
- DailyWord
- DoctorDle
- Pathordle
- Radiordle
- existing Edge Functions
- cron jobs
- queues
- scheduled jobs
- Resend integration
- email environment variables
- webhooks
- account export
- account deletion
- privacy settings
- Settings UI
- admin tools

Use:

search
→ locate canonical implementation
→ targeted read
→ design
→ implement

Do NOT preload huge unrelated files.

Do NOT create:

- duplicate analytics
- duplicate profile data
- duplicate theme state
- duplicate notification preferences
- duplicate game statistics
- duplicate study reports
- a second data graph
- a parallel user system

Reuse existing canonical state.

Before implementation, produce a concise internal architecture map.

============================================================
SYSTEM ARCHITECTURE
============================================================

Create or extend a centralized communications package appropriate to the
existing repository.

Conceptually:

packages/email/
    components/
    templates/
    rendering/
    personalization/
    themes/
    reports/
    pulse/
    providers/
        resend.ts
    scheduling/
    preferences/
    suppression/
    analytics/
    webhooks/
    types/

features/settings/communications/

features/privacy/

features/admin/communications/

Adapt this to the actual repo structure.

Do not force these exact directories if AXOM already has a canonical
organization pattern.

============================================================
CANONICAL SEND API
============================================================

All AXOM application-generated emails should eventually flow through one
canonical server-side interface similar to:

sendAxomEmail({
    userId,
    type,
    category,
    variables?,
    scheduledFor?,
    metadata?
})

or an equivalent strongly typed implementation.

The process must be:

1. Resolve user
2. Resolve verified email address
3. Resolve communication category
4. Resolve preferences
5. Check consent
6. Check suppression
7. Check bounce/complaint state
8. Gather personalization context
9. Resolve template
10. Render email
11. Send through provider
12. Record send attempt
13. Save provider message ID
14. Receive delivery events asynchronously
15. Update delivery state

Frontend code must NEVER receive a Resend secret API key.

============================================================
EMAIL CATEGORIES
============================================================

Create explicit communication categories.

TRANSACTIONAL / ESSENTIAL:

auth
security
account
privacy
data_export
account_deletion
billing_if_applicable

OPTIONAL:

daily_learning
daily_games
weekly_report
monthly_report
exam_reminders
essays_from_jafar
product_updates
research_news
marketing

Users must be able to independently toggle optional categories.

"Unsubscribe from all optional emails"

must NOT disable:

- authentication emails
- password resets
- security alerts
- critical account communications
- privacy/export/deletion communications
- legally necessary notices

Model this properly in the database and service layer.

============================================================
RESEND TOPICS
============================================================

Prepare AXOM to synchronize applicable optional categories with Resend
Topics.

Suggested topics:

- Study Reports
- Daily Games
- Exam Reminders
- Essays from Jafar
- Product Updates
- Research & News

Do not make Resend the sole source of truth.

AXOM's preference state remains canonical.

Synchronize changes safely where relevant.

============================================================
PERSONALIZATION CONTEXT
============================================================

Create a strongly typed personalization context.

Something conceptually similar to:

EmailPersonalizationContext {
    userId
    firstName
    displayName
    preferredName
    email

    avatarUrl
    orbImageUrl
    orbVariant

    accentColor
    accentSecondary
    themeMode

    timezone
    locale

    currentCourse
    currentTerm

    nextExamName
    nextExamDate
    daysUntilExam

    studyMinutesThisWeek
    studyMinutesPreviousWeek

    questionsCompletedThisWeek
    questionsCompletedPreviousWeek

    accuracyThisWeek
    accuracyPreviousWeek
    accuracyDelta

    ankiReviews
    ankiDue
    retention

    strongestTopic
    weakestTopic
    mostImprovedTopic

    streak

    doctorDle
    pathordle
    radiordle
    dailyWord
}

Do not require every field for every message.

Templates declare their dependencies.

Missing data must degrade gracefully.

Never output:

Hello undefined
NaN%
0 hours when no valid data exists
missing image blocks
broken statistics

Use intelligent fallbacks.

============================================================
AXOM EMAIL DESIGN SYSTEM
============================================================

Build reusable React Email components or the best email-safe equivalent
compatible with the current AXOM stack.

Emails should feel unmistakably AXOM.

Visual direction:

premium
minimal
academic
medical
precise
calm
futuristic
high-end
editorial
slightly cinematic

Avoid:

generic SaaS newsletter styling
neon gamer aesthetics
excess gradients
cheap glass effects
giant rounded cards everywhere
excess emojis
overly playful gamification
fake Apple imitation

============================================================
AXOM ORB
============================================================

Locate and use the CURRENT canonical AXOM Orb.

Do not recreate an older asset.

The Orb should act as the email identity/avatar.

Possible placements:

- centered hero
- top-left identity mark
- profile-style icon
- Pulse hero
- achievement visual

Images must use production-safe hosted URLs.

Use width/height constraints and useful alt text.

============================================================
USER ACCENT PERSONALIZATION
============================================================

AXOM users already select an accent/design identity.

Email should inherit that identity.

Examples:

violet accent
→ restrained violet highlights

cyan accent
→ restrained cyan highlights

amber accent
→ restrained amber highlights

red accent
→ restrained red highlights

Do not recolor every surface.

The base email remains a sophisticated neutral AXOM system.

Accent should affect things such as:

- Orb halo
- border highlights
- CTA
- tiny graph accents
- progress indicators
- headings
- metric emphasis

============================================================
EMAIL-SAFE GLASSMORPHISM
============================================================

Create an email-safe interpretation of AXOM glass.

Do NOT rely on:

- JavaScript
- WebGL
- backdrop-filter
- complex CSS filters
- hover interactions
- browser-only animation

Instead use:

- subtle layered backgrounds
- fine borders
- controlled shadows
- gradients
- translucent-looking static surfaces
- careful typography
- rendered graphics when necessary

The design must remain excellent in:

- Gmail web
- Gmail mobile
- Apple Mail
- Outlook
- light mode
- dark mode

Graceful degradation is mandatory.

============================================================
TYPOGRAPHY
============================================================

Use email-safe typography.

Prioritize visual hierarchy rather than unusual fonts.

Examples:

AXOM
small identity label

Good morning, Jafar.
large editorial heading

YOUR WEEK
small metadata label

428
large metric

Questions answered
supporting text

Keep spacing disciplined.

============================================================
CORE EMAIL COMPONENTS
============================================================

Create reusable components similar to:

AxomEmail
AxomHeader
AxomIdentity
AxomOrb
GlassPanel
MetricCard
MetricGrid
MetricRow
ProgressBar
MiniChart
InsightCard
AchievementCard
GameCard
CourseCard
EssayCard
ExamCard
CTAButton
SecondaryButton
Divider
Footer
PreferenceFooter

Use semantic naming matching the repo.

============================================================
WELCOME EMAIL
============================================================

Create a polished welcome email.

Subject concept:

Welcome to AXOM, {{firstName}}.

Content should be minimal.

Explain AXOM succinctly.

Use current Orb.

Primary CTA:

Enter AXOM

Do not overwhelm the user with feature lists.

============================================================
DAILY GAME EMAIL
============================================================

Create an optional Daily Games email.

Possible subjects:

Your DoctorDle is waiting.

Today's cases are ready.

Your daily diagnostic set is live.

Dynamically include only enabled/available experiences:

DoctorDle
Pathordle
Radiordle
DailyWord

Show relevant state when available:

current streak
yesterday performance
today availability

Example:

DOCTORDLE
3-day streak

PATHORDLE
Ready

RADIORDLE
Ready

DAILYWORD
Today's concept is available

Do not use shame or artificial urgency.

============================================================
WEEKLY REPORT
============================================================

Create a highly personalized weekly report.

Possible dynamic subject examples:

Jafar, you answered 428 questions this week.

Your week: 81% accuracy and climbing.

Renal improved. Cardio needs another pass.

Your AXOM weekly report is ready.

Data may include:

- total study time
- questions completed
- question accuracy
- accuracy change
- Anki reviews
- Anki retention
- streak
- consistency
- course progress
- strongest topic
- weakest topic
- most improved topic
- game results
- meaningful milestones

Generate a concise evidence-based narrative.

Example:

"Renal pathology was your largest improvement this week, rising from
68% to 81%. Cardiovascular pharmacology remains your highest-yield
weakness based on recent question performance."

Never invent insights.

No metric should appear unless supported by canonical data.

Avoid:

"You crushed it!"
"You're unstoppable!"
"AMAZING WEEK 🔥"

Use measured language.

CTA:

View full report

============================================================
MONTHLY REPORT
============================================================

Build a deeper monthly review.

Include where data exists:

- study time
- question volume
- accuracy
- trend
- strongest system
- weakest system
- most improved system
- consistency
- Anki statistics
- course completion
- games
- notable achievements
- comparison to previous month

Allow a richer visual card/chart.

CTA:

View monthly analysis

============================================================
ESSAYS FROM JAFAR
============================================================

Create a dedicated optional communication category:

Essays & Notes from Jafar

Preferred sender display concept:

Jafar from AXOM

Do not automatically use a personal Gmail address.

Use an AXOM-domain sending identity once verified.

Support configurable Reply-To separately.

Essay email structure:

AXOM identity
author identity
title
short excerpt
optional hero image
estimated reading time
CTA

Example:

Why medical school made me rethink productivity

6 min read

[ Read essay ]

This must support either:

A. creation through an AXOM admin/editor interface

or

B. Resend Broadcasts

Design the architecture so both can coexist.

============================================================
PRODUCT UPDATES
============================================================

Optional Product Updates category.

Examples:

Anki Lab
new QBank mode
new course templates
DoctorDle release
major integrations

Keep product updates concise and relevant.

============================================================
EXAM REMINDERS
============================================================

Optional.

Possible subject:

12 days until your FTCM final.

Email may show:

exam date
days remaining
recent question accuracy
questions completed
priority systems
high-yield review queue

Do not pretend AXOM can guarantee readiness.

Use phrasing such as:

"Based on your recent AXOM activity..."

CTA:

Open Exam Plan

============================================================
INACTIVITY EMAIL
============================================================

Use cautiously.

Do not spam.

Do not manipulate streak anxiety.

Possible:

Your course is still here.

A short re-entry email can include:

where they left off
next relevant task
course progress

Frequency should be conservative.

============================================================
PRIVACY EMAILS
============================================================

Implement:

Data export requested
Data export ready
Deletion requested
Deletion scheduled
Deletion cancelled
Deletion completed

Never send sensitive exports as email attachments unless the existing
security model explicitly supports this.

Prefer secure expiring download links.

============================================================
AXOM PULSE
============================================================

The former "Wrapped" concept is now officially called:

AXOM PULSE

Display branding as:

PULSE // 2026

or

AXOM PULSE 2026

Primary tagline:

YOUR YEAR IN MEDICINE, MEASURED.

Do NOT refer to it as Wrapped anywhere in customer-facing UI.

Internal migration names can remain temporarily only if necessary.

============================================================
WHAT AXOM PULSE IS
============================================================

AXOM Pulse is AXOM's premium personalized retrospective experience.

It can eventually exist at multiple scopes:

PULSE // TERM
PULSE // YEAR
PULSE // 2026

The flagship version is annual.

It should feel like:

medical telemetry
academic identity
personal progression
a cinematic record of effort and growth

It must NOT look like a Spotify clone.

============================================================
PULSE DATA MODEL
============================================================

Create one canonical Pulse dataset.

Conceptual schema:

PulseData {
    version
    scope
    periodStart
    periodEnd

    userId

    displayName
    accent
    orbVariant

    studyMinutes
    studyDays
    longestSession

    questionsAnswered
    questionsCorrect
    overallAccuracy

    accuracyTrend

    strongestSystem
    weakestSystem
    mostImprovedSystem

    biggestAccuracyGain

    ankiReviews
    ankiRetention
    cardsMatured

    coursesWorked
    coursesCompleted

    doctorDleGames
    pathordleGames
    radiordleGames
    dailyWordDays

    longestStreak
    activeDays

    milestones[]
    achievements[]

    interestingStats[]
}

Only include fields supported by existing data.

Never fabricate unavailable metrics.

The email and interactive Pulse experience MUST use this same dataset.

Do not calculate separate email statistics.

============================================================
PULSE EMAIL
============================================================

Pulse email is a teaser.

Do not attempt to reproduce the entire experience inside email.

Possible subject:

Jafar, your AXOM Pulse is ready.

or:

PULSE // 2026

Hero:

AXOM Orb
personal accent glow

PULSE // 2026

JAFAR,
THIS WAS YOUR YEAR.

YOUR YEAR IN MEDICINE,
MEASURED.

Then 3–5 personalized teaser statistics.

Example:

12,842
QUESTIONS

87%
PEAK SYSTEM ACCURACY

142 HOURS
FOCUSED

RENAL
MOST IMPROVED

CTA:

OPEN MY PULSE

Destination:

/pulse/2026

or canonical equivalent.

============================================================
PULSE INTERACTIVE EXPERIENCE
============================================================

Build or architect the future route:

/pulse/[period]

The actual website experience may use:

- animation
- motion
- cinematic transitions
- dynamic graphs
- scrolling scenes
- Orb transformations
- glass surfaces
- personalized accent
- full-screen layouts
- share cards
- sound if explicitly enabled

Unlike email, this environment can use full browser capabilities.

Suggested sequence:

1. Orb emergence

2. PULSE // 2026

3. user's name

4. total time

5. total questions

6. accuracy progression

7. strongest system

8. most improved system

9. weakest/highest-opportunity area

10. Anki

11. course journey

12. games

13. streak/consistency

14. milestones

15. closing identity card

Final example:

JAFAR DABBAGH

12,842 questions
142 focused hours
81 active days
+19% renal improvement

PULSE // 2026
AXOM

Avoid exaggerated ranking claims unless cohort data actually exists.

============================================================
PULSE VISUAL LANGUAGE
============================================================

Do not copy Spotify Wrapped.

Instead draw from:

medical telemetry
ECG rhythm
clinical monitors
diagnostic imaging
biomedical instrumentation
academic manuscripts
precision instrumentation
medical charting
high-end scientific visualization

Use these abstractly.

Do NOT make it look like a hospital EMR.

Potential motifs:

- pulse lines
- signal traces
- radial measurements
- structured grids
- waveform motion
- subtle scanning effects
- diagnostic labels
- measured progression

The AXOM Orb remains the central identity object.

============================================================
SHAREABLE PULSE CARDS
============================================================

Architect export/share cards.

Examples:

My year in medicine.

12,842 questions
87% peak accuracy
Renal +21%

PULSE // 2026
AXOM

Allow:

download image
copy image
share if supported

Never expose sensitive study data publicly without explicit user action.

============================================================
COMMUNICATION SETTINGS
============================================================

Build or extend:

Settings
→ Notifications & Communications
→ Email

Potential UI:

EMAIL COMMUNICATIONS

Study

[✓] Daily learning reminders
[✓] Daily Games
[✓] Weekly Report
[✓] Monthly Report
[✓] Exam reminders

Editorial

[ ] Essays & Notes from Jafar

AXOM

[✓] Product updates
[ ] Research & News

Each applicable category may support:

frequency
preferred day
preferred send time
timezone

Example:

Weekly Report
Sunday
8:00 AM

Daily Games
6:00 PM

Provide:

Unsubscribe from all optional emails

Explain clearly that essential account/security communication remains
enabled.

============================================================
PERSONALIZATION PREVIEW
============================================================

Where appropriate, Settings should let users preview how AXOM
communications will appear with their current accent.

Do not implement an excessively complex editor for normal users.

Users personalize through their existing AXOM design settings.

============================================================
PRIVACY & DATA CENTER
============================================================

Build or extend:

Settings
→ Privacy & Data

Sections:

YOUR DATA

Download a copy of your AXOM data.

[ Request export ]

COMMUNICATIONS

Control the emails AXOM sends you.

[ Manage communications ]

ACCOUNT

Delete your AXOM account and eligible associated data.

[ Delete account ]

============================================================
DELETE ACCOUNT FLOW
============================================================

When deletion begins:

DELETE AXOM ACCOUNT

Before you go, would you like a copy of your AXOM data?

[ Download my data ]

[ Continue without backup ]

[ Cancel ]

Then:

- verify identity where appropriate
- explain consequences
- require deliberate confirmation
- schedule deletion according to canonical policy
- offer cancellation during grace period if supported
- send appropriate transactional confirmation

Do NOT claim that every byte disappears instantly if backup/legal/security
retention means otherwise.

============================================================
DATA EXPORT
============================================================

Export should use canonical AXOM data.

Possible structure:

axom-export/
    profile.json
    preferences.json
    courses.json
    study-sessions.json
    question-attempts.json
    performance.json
    flashcards/
    notes/
    uploads/
    games/
    pulse/

Only include appropriate user-owned/exportable data.

For large exports:

- generate asynchronously
- place securely
- create expiring link
- notify user when ready

============================================================
ADMIN COMMUNICATION CENTER
============================================================

If AXOM has or supports an internal admin architecture, build a
Communications area.

Capabilities:

Create message
Select communication type
Select audience
Choose template
Edit subject
Edit preview text
Edit body
Add image
Add CTA
Preview desktop/mobile
Preview dark/light where practical
Preview personalization
Send test
Schedule
Send
View delivery status

Audience examples:

All eligible users
Specific course
Specific cohort
Selected users
Custom filtered segment

Do not let arbitrary admin filtering become a security hole.

============================================================
ADMIN TEMPLATE VARIABLES
============================================================

Support safe variables such as:

{{firstName}}
{{displayName}}
{{currentCourse}}
{{examName}}
{{daysUntilExam}}

Do not permit arbitrary unsanitized execution.

Complex weekly/monthly/Pulse emails should be generated by application
logic rather than a human manually filling hundreds of fields.

============================================================
ESSAY PUBLISHING WORKFLOW
============================================================

Create a clean workflow for Jafar-authored essays.

Possible architecture:

Publish essay
→ create canonical AXOM essay/article
→ choose "Email subscribers"
→ generate email preview
→ send test
→ schedule/broadcast
→ recipient receives personalized email
→ CTA opens canonical article

Do not duplicate the entire article solely inside Resend.

Resend may deliver the broadcast.

AXOM should retain article identity and metadata.

============================================================
EMAIL JOBS
============================================================

Do not synchronously send large campaigns from a browser request.

Use existing queue/Edge Function/worker infrastructure.

Model states such as:

queued
scheduled
processing
sent
delivered
suppressed
failed
bounced
complained

Implement idempotency.

A weekly report must not accidentally send twice.

A webhook retry must not create duplicate event records.

============================================================
SCHEDULING
============================================================

Use the user's timezone.

Examples:

Weekly Report:
Sunday 08:00 local time

Daily Games:
18:00 local time

Monthly Report:
first Sunday / selected preference

Do not schedule everything using server UTC without converting.

============================================================
SUPPRESSION
============================================================

Create centralized suppression logic.

Suppress optional messages when:

- category disabled
- all optional disabled
- hard bounce
- spam complaint
- address invalid
- account deletion pending where appropriate
- explicit suppression exists

Never bypass suppression from an individual feature.

============================================================
RESEND WEBHOOKS
============================================================

Implement webhook processing for relevant Resend events.

Examples:

sent
delivered
bounced
complained
opened
clicked
failed
suppressed
unsubscribe events where applicable

Use the exact current event model supported by the installed/current
Resend API.

Do not assume outdated names.

Webhook handler must:

- verify authenticity/signature
- safely parse payload
- be idempotent
- tolerate retries
- record provider event ID
- update email_send status
- update suppression where appropriate

============================================================
DATABASE
============================================================

Inspect schema before adding anything.

Potential concepts:

communication_preferences
email_jobs
email_send_log
email_events
email_suppressions
email_campaigns
pulse_snapshots

Only create missing concepts.

Prefer extending existing canonical tables when appropriate.

Apply proper RLS.

Users should only be able to access their own preference/history data.

Provider/admin jobs must use appropriate server-side privileges.

============================================================
EMAIL HISTORY
============================================================

Consider a user-facing history where useful.

Example:

Communications

Weekly Report
Delivered Oct 6

Monthly Report
Delivered Oct 1

AXOM Pulse 2026
Available

Do not expose unnecessary provider debugging metadata.

============================================================
EMAIL-SAFE GRAPHICS
============================================================

For visuals that email clients cannot render consistently, support
server-generated static images.

Potential examples:

weekly chart
monthly trend
Pulse hero
achievement card
study heatmap

Use secure generation/storage.

Never create predictable public URLs containing private academic data.

============================================================
SECURITY
============================================================

Requirements:

No Resend API secret in frontend bundles.

No service-role Supabase key in frontend.

Signed links for sensitive actions.

Expiring data-export links.

Unsubscribe links must not expose easily forgeable user identity.

Validate all admin operations.

Rate-limit sensitive endpoints where appropriate.

Sanitize user-supplied/author-supplied email content.

Avoid HTML injection.

============================================================
DELIVERABILITY
============================================================

Inspect actual Resend configuration before hard-coding sender identity.

Possible identities:

AXOM <hello@axom.info>

AXOM Reports <reports@axom.info>

Jafar from AXOM <jafar@axom.info>

Account/Security <account@axom.info>

Use only verified sending domains/addresses.

Support Reply-To independently.

Keep optional/editorial communication logically separate from critical
transactional mail.

============================================================
COPY STYLE
============================================================

AXOM email writing should feel:

intelligent
measured
personal
precise
human
calm
premium
medical/academic where relevant

Avoid:

"Hey superstar!"
"You're killing it!"
"CRUSHED IT 🔥"
"You'll lose your streak!"
fake urgency
excess exclamation marks
generic LLM motivation

Preferred style:

"Your renal accuracy increased 13 points this week."

"Cardiovascular pharmacology remains your highest-yield review area."

"Your DoctorDle is ready."

"Your AXOM Pulse is available."

============================================================
ANALYTICS
============================================================

Track meaningful communications metrics without turning AXOM into an
email surveillance product.

Potential aggregate metrics:

send
delivery
bounce
complaint
unsubscribe
open if supported and appropriate
click if supported and appropriate

Do not let open tracking become a dependency for product-critical state.

============================================================
ACCESSIBILITY
============================================================

Require:

alt text
reasonable contrast
semantic hierarchy
readable mobile width
buttons large enough to tap
no meaning conveyed solely through color
fallback text for images

============================================================
TESTING
============================================================

Test at minimum:

USER PERSONALIZATION

- user with name
- user without first name
- different accents
- avatar present
- avatar missing
- new Orb
- missing optional personalization

REPORTS

- new user with no history
- low activity
- high activity
- partial statistics
- weekly delta positive
- weekly delta negative
- missing comparison period

COMMUNICATION SETTINGS

- category subscribed
- category unsubscribed
- unsubscribe all optional
- transactional mail still works

SUPPRESSION

- hard bounce
- complaint
- invalid address

SCHEDULING

- multiple timezones
- daylight/timezone correctness
- duplicate prevention

PULSE

- sufficient annual data
- sparse data
- missing Anki data
- missing game data
- personalized accents
- email and web experience use identical snapshot

WEBHOOKS

- valid signature
- invalid signature
- duplicate webhook
- retry
- unknown event

PRIVACY

- export
- secure download expiration
- deletion requested
- deletion cancelled
- deletion completed

EMAIL CLIENTS

Preview representative templates for:

- Gmail desktop
- Gmail mobile
- Apple Mail
- Outlook
- light appearance
- dark appearance

============================================================
NO ACCIDENTAL BROADCASTS
============================================================

Critical:

DO NOT send a real broadcast during implementation.

Use explicit safe test recipients only.

Any production broadcast requires deliberate operator action.

============================================================
MIGRATIONS
============================================================

Database migrations must:

- be additive where possible
- avoid destructive changes without justification
- document rollback implications
- preserve existing user state
- preserve current auth flow

============================================================
IMPLEMENTATION ORDER
============================================================

Work in this order unless the existing architecture requires another
sequence:

1. Audit current infrastructure

2. Establish canonical communication types/preferences

3. Centralize Resend provider

4. Implement send pipeline

5. Build reusable AXOM email design components

6. Implement Welcome email

7. Implement communication settings

8. Implement unsubscribe/suppression

9. Implement Resend webhooks

10. Implement Weekly Report

11. Implement Daily Games

12. Implement Monthly Report

13. Implement Essays from Jafar

14. Implement Exam Reminders

15. Implement privacy/export/deletion email flows

16. Implement AXOM Pulse data snapshot

17. Implement Pulse email

18. Architect/build Pulse interactive experience

19. Add admin communications tools if compatible

20. Test and document

============================================================
QUALITY BAR
============================================================

Do not implement a giant disconnected feature dump.

Prefer:

small reusable primitives
strong typing
canonical data flow
existing AXOM systems
minimal duplication
clear security boundaries
email-client compatibility
premium UX
maintainability

Do not introduce mock statistics into production.

Do not calculate study performance differently in each feature.

Do not couple core AXOM logic directly to Resend.

Resend should be replaceable later with limited provider-layer changes.

============================================================
FINAL REPORT
============================================================

At completion provide:

1. Architecture implemented

2. Existing systems reused

3. Files added

4. Files changed

5. Database migrations

6. New routes

7. New Edge Functions/server functions

8. New environment variables

9. Resend features used

10. EXACT manual actions I need to perform in the Resend dashboard

11. Templates implemented

12. Screenshots/previews if practical

13. Tests run

14. Results

15. Anything not yet production-ready

16. Security concerns

17. Deliverability concerns

18. Recommended next phase

19. A short AXOM Communications architecture diagram

20. A short AXOM Pulse architecture diagram

Do not claim completion for anything that remains placeholder-only.

Stop before requiring unknown secrets or destructive production actions
and tell me exactly what operator action is required.
```

One branding detail I'd lock in now:

**Product name:** AXOM Pulse  
**Annual title:** `PULSE // 2026`  
**Descriptor:** `Your year in medicine, measured.`  
**CTA:** `Open My Pulse`  
**Route:** `/pulse/2026`

That gives you a naming system you can own rather than feeling like an imitation of another company's year-in-review feature.

After you give that prompt to the AI and it audits/implements the code, **send me its final report or simply say “give me the Resend steps.”** Then I'll walk you through exactly what to configure in your Resend dashboard—Domains, senders, Topics, Broadcasts, Templates, Webhooks, unsubscribe behavior, API keys, test emails, and what should *not* be configured there.