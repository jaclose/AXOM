# AXOM Living Atlas: Forty Academic Companions

Status: **design prototype, not production onboarding, email automation or a shipped companion system**.

## Purpose and visual contract

The Living Atlas assigns a recognizable, optional fictional academic companion
to an individual learner. Its 40 curated identities belong to eight orders:
Architects (structure), Seekers (inquiry), Sentinels (discrimination), Keepers
(memory and reflection), Alchemists (creative synthesis), Wayfinders
(adaptation), Wardens (sustainable effort), and Luminaries (purpose and
leadership). Each order has five **unique** characters, not generic skins.

The proposed visual and storytelling reference is the 54-page *AXOM: The Forty - Companions
of the Living Atlas* character bible, which still awaits owner review and approval. Character
names, canonical IDs, silhouettes, pronunciation, taxonomy, myths, academic
strengths and limitations, strengths, rituals, movement, and image-generation
prompts should be imported from a **versioned, reviewed record** before
production. The current repository contains the short operational roster.
Avoid inventing medical facts in companion dialogue or citing lore as evidence.

AXOM Classic controls the framework: original Orb (do not redraw), Ink,
Graphite, Bone and restrained Gold; selected personal accents are not alternate
logo colors. Email and product interfaces use actual source assets and
accessible, independent typography.

## Selection model: eight orders and forty identities

Selection is a preference match for a *fictional guide*, never a measured
personality classification or prediction of clinical skill. The user can
choose an identity or decline the feature.

The V2 proof-of-concept deliberately scores only:
- explicitly selected academic order (strong evidence for a preference);
- directly declared study methods, e.g. visual, mechanism, planning, writing;
- self-chosen pace and preferred encouragement/challenge style;
- optional **abstract, reviewed journal themes** only when separately enabled.

A user's selected color is used for **visual presentation only**. It is never
used as evidence of personality, academic ability, emotional condition,
or psychiatric state. Journal text, grades and medical information are **not**
unilaterally mined for character classification.

Matching is deterministic for the same inputs. When preferences are absent,
a stable *starter* identity can be selected with a transparent technical
explanation in Settings. No character claims supernatural observation or
private insight into the user's mind. The welcome story can be atmospheric
without making factual claims about why the model assigned it.

**Critically, the chosen identity must be pinned after acceptance.** A live
account must not recalculate its correspondent on every email, palette change,
journal entry or device sync. User override beats any match. Consent and
preferences can be changed or withdrawn at any time.

Suggested versioned record:

~~~json
{
  "companion_id": "juniper",
  "catalog_version": 2,
  "selection": "user_chosen",
  "selected_at": "ISO-8601",
  "enabled": true,
  "theme_analysis_enabled": false,
  "persona_disclosure_seen": true
}
~~~

In production, validate the schema and owner ID on the server. Store no raw
journal text or private exam history in this record. Server-side RLS grants
self-access only; keep a non-destructive migration path and respect local-first
portability. A database migration is not authorized by this document alone.

## Public communication voice versus private rationale

**Welcome:** "Alex, the Living Atlas opens to Juniper. Juniper keeps the
steadiness of a growing forest. Patient, exacting, and protective of quiet
progress, this companion reminds you that a path is built one return at a
time." Add the fictional order, learning philosophy, and eventual visual
companion role. Phrase these as character features, not diagnoses or
assertions about what the learner secretly is.

**Do not send:** "AXOM analyzed your diary", "chosen because you are
introverted", "we know your personality", "your colors reveal", or
the matching coefficient. The detailed provenance can be inspected in a
separate learner-controlled Settings view if the learner wants it.

**Transport:** welcome belongs to AXOM's individual-email pipeline, not
a generic Resend Broadcast. Queue it after the relevant verified onboarding
event and user's companion acceptance. Preserve the existing consent,
suppression and idempotent delivery checks; maintain official branding and
sender verification. Authentication, recovery, privacy and security alerts
never impersonate a fictional correspondent.

If a user does not accept a companion, send an ordinary AXOM account welcome
without a character, or suppress the character introduction as appropriate.
Do not force a mascot on account creation.

## Companion engine: future state machine

The character is a **non-sentient product guide**. Its animation communicates
actual app state, not emotional surveillance.

| Mode | Verified event | Companion behavior |
| --- | --- | --- |
| Idle | User opens their workspace | Subtle breathing, stable posture |
| Attention | User focuses a task field | Orients its gaze without obscuring text |
| Inspect | User deliberately opens a source or rationale | Looks toward the source rail |
| Thinking | An explicit permitted computation is underway | One restrained looping gesture |
| Practice | User opens a question before answer commitment | Quiet presence, no answer hint |
| Reveal | Learner commits the question | Offers result-neutral transition |
| Progress | Durable save/checkpoint succeeds | Brief unobtrusive acknowledgment |
| Recovery | Data save or sync is genuinely impaired | Offers actual recovery action, no false success |
| Rest | Focus session ends or user opts to pause | Settles without guilt or streak pressure |
| Off | Companion disabled, reduced motion or OS setting | No animation or notification |

Rendering must respect reduced motion, mute/off, keyboard and screen-reader
access, low-power devices, and the visual priority of QBank and Course Tracker.
No behavior reveals protected answer content or pretends a timer equals mastery.
Nothing sends notifications, marks work complete or moves workspace state
without existing guarded product actions.

## Art and animation production contract

For each of 40 characters, create: canonical front/three-quarter/profile/back
turnaround, scale sheet, material palette and unique silhouette, expression
sheet, joint/wing/tail constraints, clean rig, idle and attention motions,
travel/reaction set, light/dark background proof and a reduced-motion static
poster. Preserve one identifiable species silhouette and avoid humanoid,
costume-like or repetitive generic designs. Every asset needs a license,
author, catalog ID, version, alt text, topology/rig specifications and a
verified responsive crop.

Do **not** auto-generate 40 public assets from a single generic mascot prompt
or silently ship placeholder images as approved art. New design work should
be generated from the corresponding individual character-bible brief and
visually reviewed before being linked to the app.

## Release gates

1. Review the full fictional roster and legal naming clearance.
2. Approve in-app companion first-use selection, disable and override states.
3. Persist owner-scoped identity without storing private journal content.
4. Integrate a narrative version of the welcome with the canonical email
renderer, verified sender, user preferences and idempotent queue.
5. Validate a single allowlisted Resend test to an approved inbox.
6. Verify 1440 and 390 desktop/mobile, both themes and reduced motion.
7. Verify mobile/desktop email clients, image-off presentation and plain text.
8. Pass exact-head tests, reviewer approval, staged backend acceptance and the
release gateway before any production deployment.

Related: `docs/operations/axom-correspondents.md` and draft PRs #154
(Living Atlas), #163 (password-first account) and #149 (Resend draft bridge).
