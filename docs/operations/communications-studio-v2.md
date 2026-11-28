# AXOM Communications Studio V2: complete catalog and evidence gates

Status: **draft proposal and synthetic POC**, not a production activation. This supplements the existing canonical Communications/Pulse contract and Resend operator runbook. The standalone November 7 studio contains 41 full HTML/text example messages, 40 Living Atlas welcome variants, a source/consent matrix and a four-period AXOM Pulse preview.

## Correct first welcome sequence

1. Account creation and any genuine identity verification remain in Supabase Auth, separate from the character email. Use email/password in the primary user interface; never silently bypass backend security.
2. **Welcome to AXOM.** Explain the private academic OS, Course Tracker, source-aware QBank and the difference between effort and confirmed learning.
3. **What is the Living Atlas?** Forty fictional academic companions organized into eight orders, each with an origin, distinct method, gift and limitation. Their stories are not psychological diagnoses.
4. **Your correspondent.** Introduce the learner-accepted character's order, lore and academic method, without announcing hidden matching coefficients or inferred traits.
5. **User control.** Explain that this is an optional preference match; the learner can select, switch, mute or decline. Raw journal entries and private study data are excluded from outgoing mail.
6. **One action.** Add a course, work one reviewed question, or bring in a trusted source.

The welcome is a one-time verified account communication, after a confirmed companion choice. If no character was accepted, deliver an ordinary AXOM welcome and introduce the Atlas in-app; never force the mascot. Avoid duplicate welcome plus first companion reveal.

Suggested headline: Welcome to AXOM, Alex.
Suggested character introduction: Juniper, the Gardener of Quiet Growth, was raised in the Courtyard of Small Beginnings. Its gifts are sustainable return, patience and the courage to practice without turning study hours into a moral score. Its blind spot is excessive reassurance when a difficult challenge needs to be confronted.
The full welcome begins with the product, not the character; includes a plain-text version and uses the original Orb asset.

## Four delivery lanes

| Lane | Content | Guard |
| --- | --- | --- |
| Supabase Auth + custom SMTP | Signup confirmation, recovery, invitations, change email, reauthentication and security events | Actual Auth event/token. Never Broadcast. |
| AXOM worker + Resend individual Emails API | Personal welcome, correspondent, learning report, Pulse and privacy notices | Verified owner, opt-in if optional, suppression, source snapshot, idempotency. |
| Resend Broadcasts | Approved essays, research, product updates and separately opted-in announcements | Category-specific consented Segment, reviewed Topic, one sender per campaign, explicit approval. |
| In-app / native | Full Pulse story, evidence rail, companion, notifications | Local-first privacy, quiet hours, dismiss/snooze and accessibility. |

A proposed sender such as AXOM · Juniper <juniper@axom.info> requires a verified sender domain and monitored Reply-To. Auth and security use a stable official From address. Broadcasts cannot change From identity for each recipient of one campaign.

## Draft message inventory (41)

**Account (10):** signup_confirmation (real signup), welcome (verified onboarding), correspondent_reveal (new companion accepted), onboarding_guide (early first-use gap), sign_in_link (actual existing link event, not a primary signup tab), reset_password (requested recovery), email_change (requested address change), invite_user (approved invitation), reauthentication (actual sensitive change), account_security (real security change).

**Learning (7):** daily_learning (one source-backed next move), daily_games (enabled games), exam_reminder (confirmed 14/7/3/1-day exam window), post_exam (actual debrief), inactivity (gentle return at most monthly after 14+ days idle), learning_insights (sufficient reviewed comparable attempts), energy_windows (separately opted-in aggregate-only patterns with uncertainty, never diagnosis).

**Reports (4):** weekly_report (previous seven completed dates), monthly_report (previous completed calendar month), term_pulse (verified completed term), annual_pulse (prior completed calendar year, no earlier than local January 1).

**Community (5):** course_ready (approved published course), qbank_shared (rights-cleared reviewed Question Set grant), reviewer_decision (actual reviewer receipt), study_group_invite (explicit invitation), community_digest (weekly opt-in with visibility recheck).

**Product (4):** companion_changed (user override), product_update (verified deployed improvement), release_notes (major coordinated release), marketing (separate opt-in and approved promotion).

**Editorial (2):** essay (published canonical article); research (original-source-linked curated method/research).

**Privacy (6):** export_requested, export_ready, deletion_requested, deletion_scheduled, deletion_cancelled, deletion_completed. Each is an actual state-dependent receipt, not a synthetic marketing event. No private export is attached to email.

**System (3):** sync_warning (verified persistent account-copy failure), incident_notice (real scoped outage), support_reply (real help thread).

The first 20 existing canonical AXOM types and six Auth/security template classes form the baseline. Sixteen additional messages in the V2 POC are proposed and not yet event-wired; never call all 41 production-ready.

## AXOM Pulse (Wrapped)

Annual label: PULSE // 2026. Descriptor: Your year in medicine, measured.

**Why:** Show a learner what changed and what still needs repair, not a competition for logged hours. The email is a concise teaser leading to a private, accessible in-app editorial retrospective.

**Period model:** Year, term, month, and trailing seven completed local days. Freeze period start/end, timezone, source-revision fingerprints, and eligibility. A full calendar year may only be sent on January 1 or later after the previous year closes. AXOM's existing annual scheduler uses local January 1; a December 31 6 p.m. summary would be incomplete.

**Sections:** opening year card → attempts and first-exposure questions → scored accuracy with reviewed-key denominator → actual focus minutes/active days, not mastery → meaningful changes in reasoning with matched population controls → discrimination pairs/error patterns → verified milestones and incomplete sources → one actionable source-backed next move → opt-in export/share card.

**Privacy:** no raw Journal prose, private source text, mood labels, protected Question Set stems or hidden contacts in an outgoing email. Optional locally derived aggregate projections require explicit separate consent; opt-out is reversible. Share cards are private by default and do not auto-post.

**Evidence:** report scored accuracy only for reviewed keys; show numerator/denominator and sample size. Distinguish total attempts from first exposures, prevent Anki card double-counting, and label missing data. A local-only record cannot be represented as fully synced cloud knowledge.

**Visual:** original Orb, restrained motion, text equivalents to all charts, reduced motion, mobile email client fallbacks. The email has one CTA: Open My Pulse.

## Delivery and scheduling

Event → authorized source → user/consent verification → frozen source snapshot → template/version render → idempotent recipient-period job → verified Resend sender → signed webhook → sent/delivered/bounced/suppressed receipt.

Optional ten categories default off and permit time/day/timezone choices. Weekly/monthly/annual periods must be complete before report generation. Security and privacy events bypass optional marketing quiet hours but never bypass address verification and suppression. Avoid duplicate sends when a Resend Broadcast and AXOM queue could both target the same publication.

Do not infer confidence or clinical readiness from hours and streaks, silently use Journal entries, make unsupported claims about personality, or claim releases are live based solely on code branches.

## Release gateway

Review 41 template copies and 40 welcome variants for client rendering; test opt-outs, missing sources, stable companion choice, UI changes, DST, period bounds, email security, original Orb presence and idempotency. Then confirm domain/SPF/DKIM/DMARC and Reply-To, Resend Topics/consented Segments, cron/worker, and signed webhooks. Send one allowlisted recipient test, inspect real inbox and message ID, then obtain independent review, staging acceptance and exact-head AXOM Quality before production activation.

No production configuration is changed by this document. The POC does not establish delivery.
