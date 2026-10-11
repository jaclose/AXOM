Do **both**, but with a strict division:

**Resend = delivery infrastructure. AXOM = intelligence, personalization, design system, scheduling, user preferences, and data.**

Resend already gives you Templates with variables/versioning, Broadcasts, Audiences, unsubscribe handling, Topics for category-level subscriptions, and webhooks. :chatgpt-content-reference{index="0"}

For AXOM, I would **not** try to build the whole experience manually inside the Resend dashboard. Build the primary email system in AXOM with **React Email + Resend**, then use Resend Broadcasts for occasional manually written announcements/essays. Resend explicitly supports React Email and dynamic templates. :chatgpt-content-reference{index="1"}

### The split I recommend

| Type | Where it should originate |
|---|---|
| Verify email / password / security | Supabase/AXOM → Resend |
| DailyWord / DoctorDle / Pathordle reminders | AXOM automation → Resend |
| Weekly performance report | AXOM data → Resend |
| Monthly report | AXOM data → Resend |
| Exam countdown | AXOM → Resend |
| Personalized “you’re falling behind”/“great week” | AXOM logic → Resend |
| New essay you wrote | AXOM Admin or Resend Broadcast |
| Major product announcement | Resend Broadcast |
| AXOM Wrapped | AXOM generates personalized experience → Resend teaser |
| Subscription management | AXOM + Resend Topics |
| Bounce/spam/unsubscribe events | Resend webhook → AXOM |

There is one important design constraint: **email itself is a terrible place for complex animation**. JavaScript is effectively off-limits and CSS support varies widely between Gmail, Outlook, Apple Mail, etc. So don't make the actual AXOM Wrapped live entirely inside an email.

Instead:

**Email → gorgeous personalized teaser → “Open your AXOM Wrapped” → axom.info/wrapped/2026**

The webpage can then have the glass, animated orb, moving gradients, counters, 3D transitions, sound, cards sliding around, individualized colors, etc.

The email should still look premium, but it should degrade flawlessly.

---

# Copy this into your AXOM coding worker

```text
You are implementing AXOM's production-grade personalized email and communications platform.

PROJECT
AXOM is a premium academic operating system with Supabase, Resend, a web app, and desktop/native functionality.

The goal is NOT simply to add a few emails.

Build a coherent AXOM Communications system supporting:

1. Beautiful branded transactional emails
2. Personalized automated study emails
3. Weekly/monthly performance reports
4. Daily game reminders
5. Editorial/essay announcements from Jafar
6. Product announcements
7. AXOM Wrapped
8. User-controlled communication preferences
9. Unsubscribe handling
10. Data export/account deletion workflows
11. Email analytics and delivery state
12. Future extensibility without tying AXOM irreversibly to Resend

IMPORTANT ARCHITECTURAL PRINCIPLE

Resend is the DELIVERY PROVIDER.

AXOM remains the source of truth for:
- user preferences
- personalization
- notification rules
- study analytics
- scheduling
- message generation
- communication history
- privacy settings
- account deletion/export state

Do not scatter direct Resend API calls throughout the application.

Create one centralized email/communications layer.

==================================================
PHASE 0 — DISCOVERY
==================================================

Before implementing:

Inspect the existing repository for:

- Resend integration
- Supabase auth
- profiles/user settings
- accent/theme preferences
- profile/avatar/orb assets
- notification settings
- analytics/activity tables
- QBank attempts
- Anki/activity data
- DailyWord
- DoctorDle
- Pathordle
- Radiordle
- existing cron/scheduler infrastructure
- Edge Functions
- email-related environment variables
- account deletion/export code
- webhook infrastructure

Reuse existing canonical systems.

DO NOT create:
- a second analytics system
- duplicate user profile state
- duplicate notification state
- duplicate study statistics
- unnecessary parallel architecture

Use the existing data model wherever possible.

Document what already exists before modifying it.

==================================================
CORE ARCHITECTURE
==================================================

Create a centralized communication service similar to:

packages/email/
  components/
  templates/
  themes/
  renderer/
  personalization/
  providers/
    resend.ts
  scheduling/
  preferences/
  analytics/
  webhooks/
  types/

or the equivalent structure appropriate to the existing repository.

Expose one canonical API such as:

sendAxomEmail({
  userId,
  type,
  variables,
  scheduledFor?,
  metadata?
})

All application emails should eventually flow through this service.

Before any send:

1. Resolve user
2. Resolve email
3. Resolve email category/topic
4. Check consent/preferences
5. Check global suppression
6. Check Resend suppression/bounce state where relevant
7. Gather required personalization
8. Render branded email
9. Send through provider
10. Record send
11. Process delivery events later through webhook

No frontend component should directly possess a Resend API key.

==================================================
EMAIL CATEGORIES
==================================================

Define explicit communication categories.

MANDATORY / TRANSACTIONAL

- authentication
- password/security
- account
- privacy/data export
- deletion confirmation
- billing if applicable

OPTIONAL

- daily_learning
- daily_games
- weekly_report
- monthly_report
- exam_reminders
- essays_from_jafar
- product_updates
- research_news
- marketing

Users must be able to independently control optional categories.

"Unsubscribe from all optional emails" must NOT disable:
- authentication
- security
- critical account messages

Integrate Resend Topics where appropriate.

Synchronize unsubscribe events between Resend and AXOM.

==================================================
PERSONALIZATION
==================================================

Every applicable email should be personalized.

Create a canonical EmailPersonalizationContext such as:

{
  userId,
  firstName,
  displayName,
  email,

  accentColor,
  accentColorSecondary,
  themeMode,

  orbVariant,
  orbImageUrl,
  avatarUrl,

  timezone,
  locale,

  preferredName,

  currentCourse,
  currentTerm,

  examName,
  examDate,
  daysUntilExam,

  streak,
  studyMinutes,
  questionsCompleted,
  accuracy,
  accuracyDelta,
  ankiReviews,
  strongestTopic,
  weakestTopic,

  doctorDleState,
  pathordleState,
  radiordleState,
  dailyWordState
}

Do not require every email to populate every field.

Each template declares what it needs.

Fallback gracefully when data is unavailable.

Never render:
"Hello undefined"

Use sensible fallbacks such as:
"Hi there,"
or another AXOM-consistent fallback.

==================================================
VISUAL DESIGN SYSTEM
==================================================

Emails should feel unmistakably AXOM.

Target:
premium
academic
futuristic
calm
precise
minimal
high-end
not SaaS-template generic
not gamer-looking
not neon cyberpunk

Create reusable React Email components.

Suggested components:

<AxomEmail>
<AxomHeader>
<AxomOrb>
<GlassCard>
<MetricCard>
<MetricGrid>
<ProgressBar>
<InsightCard>
<AchievementCard>
<GameCard>
<CourseCard>
<EssayCard>
<CTAButton>
<Divider>
<AxomFooter>
<UnsubscribeFooter>

The email must inherit the USER'S selected AXOM accent.

Examples:

user accent = violet
→ violet-tinted highlights

user accent = cyan
→ cyan accents

user accent = amber
→ amber accents

Do not redesign the entire email background for each color.

Maintain AXOM's core neutral visual identity and use the accent selectively.

==================================================
GLASSMORPHISM
==================================================

Create an EMAIL-SAFE interpretation of AXOM glassmorphism.

Do NOT assume backdrop-filter, advanced CSS filters, JS, WebGL, or unsupported browser effects will work in email clients.

Use:

- layered backgrounds
- subtle gradients
- borders
- controlled shadows
- translucent-looking static surfaces
- pre-rendered assets where necessary

The result should still look intentional when opened in:
- Gmail web
- Gmail mobile
- Apple Mail
- Outlook
- dark mode
- light mode

Build graceful fallbacks.

==================================================
AXOM ORB
==================================================

Use the CURRENT canonical AXOM Orb asset.

Do not use an old logo if the repository contains a newer Orb asset.

Support dynamic orb variants where the design system allows it.

The Orb can appear:
- top header
- profile/identity element
- Wrapped hero
- achievement treatment

Use hosted production-safe image URLs.

Use alt text.

==================================================
EMAIL TYPES
==================================================

Implement the foundation and templates for:

1. WELCOME

Subject concept:
"Welcome to AXOM, {{firstName}}."

Introduce AXOM beautifully and minimally.

CTA:
Enter AXOM

--------------------------------------------------

2. DAILY GAME REMINDER

Personalized based on enabled games.

Examples:

"Your DoctorDle is waiting."

"Today's Pathordle is ready."

"Four cases. One streak to protect."

Show:
- current streak
- yesterday result if available
- today's available games

Buttons:
Play DoctorDle
Play Pathordle
Play Radiordle
Open DailyWord

Do NOT guilt users.

--------------------------------------------------

3. WEEKLY AXOM REPORT

Subject examples should be dynamically generated from performance.

Examples:

"Jafar, you answered 428 questions this week."

"Your AXOM week: 81% accuracy and climbing."

"Renal improved. Cardio needs another pass."

Display personalized metrics:

- study time
- questions answered
- accuracy
- accuracy delta
- Anki reviews
- consistency
- streak
- strongest topic
- weakest topic
- most improved topic
- course progress

Generate an intelligent concise narrative.

Example:

"You made your biggest gain in renal pathology this week:
accuracy increased from 68% → 81%.

Cardiovascular pharmacology remains your highest-yield weakness."

Avoid fake motivational language.

Make insights evidence-based from actual stored data.

CTA:
View full report

--------------------------------------------------

4. MONTHLY REPORT

More comprehensive than weekly.

Include:
- month overview
- total study time
- questions
- accuracy
- trend
- strongest systems
- weakest systems
- consistency
- Anki
- course progress
- noteworthy achievements

Generate a high-quality personalized report.

--------------------------------------------------

5. ESSAYS FROM JAFAR

Create a separate opt-in category:

"Essays & Notes from Jafar"

Possible sender display:

Jafar from AXOM

Prefer an AXOM-domain sending address.

Allow Reply-To to be configured independently.

Template:

Orb / author identity
Essay title
Short excerpt
Hero image if present
Estimated reading time
Read Essay CTA

Example:

"Why medical school made me rethink productivity"

Personalize greeting where appropriate without making editorial content creepy.

Allow these to be triggered through:

- AXOM admin composer
OR
- Resend Broadcasts

Provide a clean path for both.

--------------------------------------------------

6. PRODUCT UPDATE

For new AXOM features.

Examples:
- Anki Lab
- QBank updates
- new learning modes
- new integrations

Keep optional and unsubscribable.

--------------------------------------------------

7. EXAM COUNTDOWN

Only if enabled.

Examples:

"12 days until your FTCM final."

Show relevant progress without unnecessary noise.

Potential metrics:

Questions completed
Remaining high-yield topics
Recent accuracy
Review queue

CTA:
Open Exam Plan

--------------------------------------------------

8. INACTIVITY / RETURN EMAIL

Use cautiously.

Do not spam.

Example:

"Your course is still here."

Avoid manipulative streak-loss language.

Respect notification frequency.

--------------------------------------------------

9. EXPORT READY

"Your AXOM data is ready."

Provide secure expiring download link.

Never attach sensitive full exports directly unless there is a strong architectural reason.

--------------------------------------------------

10. ACCOUNT DELETION

Include:
- deletion requested
- deletion date
- cancellation link if grace period exists
- completed confirmation

==================================================
AXOM WRAPPED
==================================================

Build the email side of an AXOM Wrapped system.

DO NOT attempt to implement the entire experience inside email.

Email should be an elegant personalized teaser.

Example:

"Jafar, this was your year in AXOM."

Show 3–5 teaser metrics:

12,842
questions answered

87%
peak system accuracy

142 hours
focused

Renal
most improved system

Create a personalized hero image or static card where appropriate using:
- their AXOM accent
- Orb
- their statistics
- personalized typography/layout

CTA:

OPEN MY AXOM WRAPPED

Destination:

/wrapped/[year]

The actual Wrapped web experience should support:
- animation
- transitions
- interactive slides
- dynamic charts
- motion
- richer visual effects
- personalized accent colors
- individualized results

Architect the data contract so the email and web Wrapped use the SAME canonical Wrapped dataset.

Example:

WrappedData {
  year
  userId
  questionsAnswered
  accuracy
  strongestSystem
  mostImprovedSystem
  totalStudyMinutes
  longestStreak
  coursesCompleted
  gamesPlayed
  achievements[]
  milestones[]
  accent
}

Do NOT calculate separate statistics for email and web.

==================================================
EMAIL CUSTOMIZATION SETTINGS
==================================================

Create:

Settings
→ Notifications & Communications
→ Email

User should be able to control:

Daily learning emails
Daily game reminders
Weekly report
Monthly report
Exam reminders
Essays from Jafar
Product updates
Research/news
Marketing

For applicable categories allow:

frequency
day
preferred time
timezone

Examples:

Weekly report:
Sunday
8:00 AM

Daily reminder:
7:00 PM

Support:
unsubscribe individual category
unsubscribe all optional communication

==================================================
PRIVACY & DATA
==================================================

Create/extend:

Settings
→ Privacy & Data

Sections:

DOWNLOAD YOUR DATA

"Create a portable backup of your AXOM account."

Request export

ACCOUNT DELETION

Before deletion ask:

"Would you like a copy of your AXOM data first?"

Actions:

Download my data
Continue without backup
Cancel

Do not falsely promise deletion of legally required records.

Use the application's canonical deletion policy.

==================================================
ADMIN COMMUNICATION CENTER
==================================================

Create an internal/admin AXOM email composer if the existing admin architecture supports it.

Admin should be able to:

- choose template
- choose audience
- preview
- send test
- schedule
- edit subject
- edit preview text
- edit content
- add CTA
- add image
- select communication category/topic
- inspect recipient estimate
- prevent accidental transactional/marketing category mismatch

Support variables such as:

{{firstName}}
{{displayName}}
{{currentCourse}}
{{examName}}

For complex personalized reports, use application-generated emails rather than trying to manually configure thousands of individual values.

==================================================
RESEND INTEGRATION
==================================================

Use Resend for:

- transport
- delivery
- contact/audience integration
- topics
- unsubscribe infrastructure
- broadcasts where useful
- delivery analytics/webhooks
- template support where useful

Do not make Resend the sole database for communication preferences.

AXOM should retain its own canonical communication preference model and synchronize where appropriate.

Implement webhook processing for relevant events:

delivered
bounced
complained
clicked
opened where supported/configured
unsubscribed

Webhook endpoint must:
- verify authenticity according to current Resend guidance
- be idempotent
- safely handle retries
- record event state
- update suppression state where appropriate

==================================================
DATA MODEL
==================================================

Inspect existing schema before creating tables.

Add only what is needed.

Likely concepts:

communication_preferences
email_jobs
email_send_log
email_events
email_suppressions
email_campaigns
email_template_metadata

Do NOT create these blindly if equivalent tables already exist.

Apply appropriate RLS.

Users may access only their own preferences/history where product UX exposes it.

Service-only email processing should use secure server-side privileges.

==================================================
QUEUE / SCHEDULING
==================================================

Do not send large campaigns synchronously from the frontend.

Use existing server/Edge Function/queue infrastructure.

Support:

queued
scheduled
processing
sent
suppressed
failed

Make operations idempotent.

Prevent duplicate weekly reports.

Use user timezone when determining scheduled delivery.

==================================================
EMAIL-SAFE PERSONALIZED VISUALS
==================================================

For advanced charts or Wrapped graphics, consider server-rendered image assets.

Examples:

weekly performance chart
monthly heatmap
Wrapped hero card
achievement art

Do NOT expose private data in publicly guessable URLs.

Use secure storage patterns appropriate to the existing architecture.

==================================================
DELIVERABILITY
==================================================

Inspect current sending domain configuration.

Keep transactional and optional communication logically separated.

Preferred identities might include:

AXOM <hello@...>
AXOM Reports <reports@...>
Jafar from AXOM <jafar@...>

Do not hard-code these until the existing verified Resend domain is inspected.

Support configurable Reply-To separately from From.

Include required unsubscribe behavior for applicable emails.

Never include unsubscribe language in authentication/security emails unless appropriate.

==================================================
COPY QUALITY
==================================================

Avoid:

"Hey superstar!"
"Crushing it!"
"You're unstoppable!"
generic AI praise
excess emojis
fake urgency
shame
manipulative streak messaging

AXOM's voice:

intelligent
precise
personal
calm
slightly cinematic
academic
premium
human

Preferred:

"Your renal accuracy improved 13 points this week."

Not:

"AMAZING JOB! You absolutely crushed renal! 🔥🔥🔥"

==================================================
TESTING
==================================================

Test:

- user with first name
- user without name
- different accent themes
- dark/light email clients where feasible
- missing statistics
- new user with no activity
- high-activity user
- unsubscribed user
- globally unsubscribed user
- bounced address
- timezone scheduling
- duplicate job protection
- webhook retries
- invalid webhook
- Wrapped data consistency
- account export
- deletion lifecycle

Send development/test emails only to safe test recipients.

Do not accidentally broadcast during implementation.

==================================================
DELIVERABLES
==================================================

At completion provide:

1. concise architecture summary
2. changed files
3. database migrations
4. environment variables required
5. Resend dashboard actions I must perform manually
6. screenshots/previews of major templates if feasible
7. testing results
8. remaining risks
9. next recommended implementation stage

Do not leave placeholder architecture presented as production complete.

Prefer a narrow, maintainable implementation over a giant disconnected email subsystem.
```

## What you should actually configure in Resend

You already have the correct areas visible in your screenshots. Use **Templates** for reusable branded templates, **Broadcasts** for things like a new essay or major AXOM announcement, **Audience/Topics** for subscription categories, and **Webhooks** to report unsubscribes/bounces/etc. back to AXOM. Resend's Broadcast editor can already use contact variables such as first name, and Templates support dynamic variables and versioning. :chatgpt-content-reference{index="2"}

I'd create Topics approximately like:

```text
Study Reports
Daily Games
Exam Reminders
Essays from Jafar
AXOM Product Updates
Research & News
```

Resend now supports per-topic unsubscribe preferences rather than forcing users into a single all-or-nothing subscription state, and its unsubscribe page can be branded. :chatgpt-content-reference{index="3"}

For your own essays, I would send something like:

**Jafar from AXOM**  
`jafar@axom.info`

rather than from your actual personal Gmail. You can set your personal/AXOM address as the **Reply-To** if you want responses to come directly to you.

### The design I think fits AXOM best

The top of the email should have the updated AXOM Orb floating over a very subtle radial glow using the user's accent. Then:

```text
AXOM

Good morning, Aynaz.

YOUR WEEK
──────────────────────────

428 questions
81% accuracy
+7.2% vs last week

[ personalized visual ]

Most improved
RENAL

Needs another pass
CARDIOVASCULAR PHARMACOLOGY

"You made your largest gain in renal pathology.
Your next highest-yield opportunity is autonomic
pharmacology."

          OPEN YOUR REPORT
```

The bottom becomes almost invisible:

```text
You're receiving Weekly AXOM Reports.

Manage preferences · Unsubscribe from reports · Privacy
```

Not a generic newsletter footer.

And the **Wrapped** deserves more ambition:

```text
                 [ AXOM ORB ]

             JAFAR, THIS WAS
                 YOUR YEAR.

                 12,842
              QUESTIONS

                  87%
             PEAK ACCURACY

              RENAL ↑ 21%
             MOST IMPROVED

          OPEN YOUR 2026 WRAPPED
```

Clicking it opens the full-screen cinematic experience in AXOM. That's where you use the animations, moving Orb, glass cards, stats flying into place, personalized accent, sound if desired, and shareable result cards.

That separation is important: **make the inbox beautiful; make AXOM itself spectacular.**