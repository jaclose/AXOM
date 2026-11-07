# AXOM Living Atlas V4 — passive, consented first-run personalization

Status: **source candidate in stacked draft PR #191**, based on companion PR #154. No production tracking, migration, Resend delivery or automatic account modification is enabled.

## Purpose: remove the quiz from the path of learning

The thirty-item academic-preference questionnaire is too much friction for default account creation, and its unvalidated scoring vectors should not be marketed as a personality diagnosis. Preserve it only as an optional exploration tool for learners who want to reflect or change their character.

AXOM's existing first-run setup already asks the learner their educational path, study tools, question timing and visual preferences. Those declared inputs should drive working product defaults first. An optional brief observation window can then refine an **interface preference** recommendation and introduce a fictional Atlas companion. A character is narrative packaging for a preference summary, **not a finding about who someone is**.

There is no reliable way to infer stable personality, clinical ability, motivation, mental health, intelligence or learning capacity from the first few clicks or scrolls. Early behavior is confounded by screen size, tutorials, curiosity, accessibility tools, unfamiliar navigation, prior experience and device speed.

## V4 product journey

1. **First-run setup** remains the existing three short screens (You / How you study / Make it yours). No required personality questionnaire is added.
2. On Make it yours, a clearly labelled **off-by-default opt-in** offers “Suggest an Atlas companion as I explore.” It says that only bounded, on-device first-use signals are counted. A learner can skip or decline.
3. After Enter AXOM, begin one six-minute window. Inputs are only the study-tool and question-timing choices the person actually **edited** and a small allowlist of deliberately performed actions. Unchanged defaults are not treated as user evidence.
4. At most two counts per action class are held in this tab's session storage. One optional 75%-depth milestone per long QBank/Tracker/Reports page can indicate content exploration, but **has no personality or preference ranking weight**. Never record coordinates, exact scroll positions, keys, pointer paths, text fields, Journal content, exam answers, email, URLs or event-by-event timestamps.
5. **Suggestion gate:** at least two distinct strong observations, two different semantic actions and sixty seconds of exploration. Without them, show no invented “best” personality; offer direct selection when the observation window ends.
6. The dashboard presents one **provisional** companion, two alternatives, a private “why this suggestion” explanation, and a link to choose any of the 25. The learner must explicitly keep a character; dismissing simply discards the session.
7. Accepting a character saves **only** the confirmed ID in local device storage under a verified account ID scope, or under the guest-device scope while signed out. No raw event data follows the account.
8. AXOM configuration suggestions are preview-only. They must not change grades, answer keys, study targets, community sharing, marketing preferences or persistent dashboard preferences without a separate action and undo.

## Evidence and restrictions

| Signal | Strength | Interpretation |
| --- | --- | --- |
| Deliberately changed question timing | High | Entry preference for practice versus source-first preparation |
| Deliberately changed study-tool selection | Moderate | Which tools/interfaces to prioritize, not cognitive ability |
| User-initiated start of a runnable QBank practice | Moderate | Immediate interaction intent, not enduring personality |
| User-initiated opening of reviewed source evidence | Moderate | Interaction with evidence; recorded only where a real semantic action is instrumented |
| QBank / Course Tracker / Reports navigation | Weak | Which section they explored, not what they believe |
| Saved dashboard customization | Engagement only | They exercised control; no trait is inferred |
| One long-page scroll-depth milestone | Engagement only | No ranking weight whatsoever |
| Accent / palette / system theme | Cosmetic | Never a personality inference |
| First-session speed, idle time, pointer movement | Not collected | Highly confounded |
| Journal or health content, private question text | Prohibited | No passive mining or outbound emails |

No single navigation action, palette choice or scroll can produce a personality result. All matching is a **provisional narrative suggestion** against 25 design reference vectors, not a calibrated psychometric likelihood. Avoid a fabricated “94% personality match” or statistical confidence interval.

## Technical paths and retention

- Source: web/src/lib/communications/passiveFirstRun.ts, a deterministic pure scoring engine with explicit allowlist, bounded counters and evidence sufficiency.
- Browser adapter: web/src/lib/communications/passiveFirstRunClient.ts, using sessionStorage. The observation window is six minutes; unaccepted summaries are removed after an additional short review grace period.
- Setup opt-in: web/src/components/setup/SetupFlow.tsx.
- User actions: SideBar navigation, actual dashboard widget changes, QBank practice launch, and a single coarse scroll milestone per eligible content section.
- Optional dashboard review: web/src/components/dashboard/AtlasFirstRunCard.tsx.
- Provisional account scope: the accepted choice is stored locally under its user's ID. **No cloud syncing is claimed; first-run guest setup and later account creation require a separate explicit handoff and owner-scoped server contract.**
- No SDK-based analytics export or network call is made by this feature. The broader AXOM application may have unrelated legitimate network activity.

The environment is local-first: a new user does not need to create an account to study. Account creation later must not silently attach an earlier device's behavioral aggregate to the new account. Cross-account and multi-device identity binding need separate authenticated acceptance before rollout.

## Optional assessment: when it adds value

An optional questionnaire can be offered behind the companion review / Settings for learners who want more control. Its original 30 questions and six reference dimensions should undergo independent construct, wording and accessibility review before being described as psychometrically meaningful. In particular, reverse-keying and arbitrary centroid distances do not prove reliability or predictive validity.

The optional questionnaire should be used to elicit **stated preferences**, not to assert deep identity traits. Its results can replace a suggestion only after the learner approves the change.

## Quality / privacy acceptance

- No collection or storage without explicit consent; false and skipped settings must leave no session record.
- No raw interaction event object, URL, scroll pixel, account email or journal content may enter the summary.
- Bound each event count to two and stop the observer at the six-minute limit; expire the session.
- Exclude programmatic navigation, tutorial auto-advances and saved/restored exam sessions from meaningful action counts.
- Cross-account isolation and deletion / disable controls must work across sign-in, sign-out, refresh and device changes.
- Test insufficient evidence, adversarial payloads, fairness across keyboard/touch/screen-reader interfaces, and empty new accounts.
- Full browser acceptance at 320/390/1440 widths, dark/light, plus keyboard and reduced-motion checks.
- Track suggestion adoption only with optional, aggregate and separately consented product metrics. Never instrument a covert personality classifier.
- Verify all updates on the literal PR head and then as part of AXOM FORGE's integrated release. No merge, deployment or production database change before independent review.

**Remaining:** user-editable Settings and cross-device durable preference persistence, integration with the existing canonical welcome email, optional assessment access from a real AXOM route, longitudinal quality testing, and independently reviewed browser acceptance.
