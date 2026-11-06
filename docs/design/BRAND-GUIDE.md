---
tags: [axom/design, axom/identity, axom/brand]
authority: proposed-until-merged
owner: AXOM product/design
updated: 2026-11-06
review_trigger: identity-master-or-design-token-change
---

# AXOM Brand Guide | Precision without spectacle

**Position:** a private academic operating system. AXOM makes difficult study work legible by keeping the learner's original source, uncertainty, progress and next move together. Brand behavior must demonstrate ownership, evidence, clarity and composure, not merely resemble premium software.

**Source hierarchy:** the owner's *AXOM Identity Atlas V3* is a 46-page working editorial reference, with explicit source-versus-proposal distinctions. The executable [AXOM design contract](DESIGN.md) and current assets/tokens govern product implementation; [UX governance](../governance/AX-0010-UX-STANDARDS.md) and [constitution](../governance/AX-0002-CONSTITUTION.md) govern requirements. The Atlas's unapproved design explorations are **not** automatically product defaults. This guide organizes those sources for implementation; it does not claim trademark clearance or product deployment.

## 1. The brand promise

**Keep the signal. Keep the person.**

| Principle | Behavioral promise | Observable test |
| --- | --- | --- |
| Ownership | This is the learner's workspace | Export/backup, deliberate sharing, portable identity, private defaults |
| Evidence | Make the basis visible | Every significant recommendation can reveal its source, revision and limit |
| Clarity | One useful next move | Primary action and hierarchy remain understandable on a narrow phone |
| Composure | Progress without pressure | No guilt-based streak traps, false urgency, manipulative nudge or fabricated certainty |

Product copy must be *specific, calm, inspectable*. “You answered 8 of 9 recent questions correctly” is better than “You have mastered this.” “Theme seen in available questions” is better than “AI predicts your next exam.” When an access or save state is unknown, say so. “Later” and “Not today” are legitimate choices.

## 2. Identity assets and usage

| Context | Correct source | Rule |
| --- | --- | --- |
| Product and email | `web/public/icons/axom-orb-512.png` | Use the actual raster, preserve its geometry, alt text and contrast |
| Flat editorial symbol | original source vector from the identity kit | Keep original paths and proportions, do not re-trace |
| Name-recognition lockup | supplied original lettered AXOM wordmark | It is vector artwork, **not** a substitute typed font |
| App/PWA/native installation | verified square icon and platform asset | Test at installed small sizes; preserve platform padding |
| Cinematic landing | approved film/asset from current landing contract | Respect evidence and performance budget; do not change product mark |

Protect proportions, negative space and visual contrast. Editorial starting clear space around a standalone symbol is 0.16 x its width, subject to actual asset review. Do not stretch, add heavy glow, recolor mark to match every user palette, separate its geometry or place it on a visually competing texture. Personal palettes affect UI accents, **not** the identity master.

**Asset ingestion contract:** source path/owner, copyright/rights, version, hash, safe crops, contrast on light/dark, small-size legibility, and intended surfaces. An AI regeneration is not an authorized replacement for the official brand master. Only adopt new source files after owner signoff and tests.

## 3. Color: source identity versus live app themes

**Identity Atlas source swatches** (editorial foundation, not instructions to overwrite app tokens):

| Name | Value | Job |
| --- | --- | --- |
| Ink | `#0D0D0E` | Primary dark foundation |
| Graphite | `#1C1C1E` | Layered depth |
| Bone | `#E6E2D6` | Reading and warm light |
| Gold | `#C8A96A` | Sparse, meaningful emphasis |

The Atlas shows high contrast for Bone/Ink and Gold/Ink, but **Bone/Gold is insufficient for ordinary body text**. Re-test actual opacity, palette, gradients, focus rings and background images in context rather than extrapolating from flat swatches.

**Current product system:** `web/src/styles/theme.css` and `web/src/lib/palette.ts` supply all theme tokens. AXOM Classic is the actual navy/gold default; AXOM Legacy is the original graphite/gold family. Other learner-selected palettes and System/Light/Dark remain supported. Do **not** globally replace the runtime theme with the four source swatches. Only permitted CSS variables and semantic components may carry color. Gold marks an action, decision or verified state, not every divider and heading. States use words/icons as well as color.

Contrast gate: target at least WCAG AA 4.5:1 for ordinary text, 3:1 for large text and actionable graphical controls where applicable, with additional focus visibility and reduced transparency where necessary. Measure rendered state for each supported palette; do not claim compliance from a hex palette alone.

## 4. Typography and editorial hierarchy

- **Application:** use `--font-display` (Poppins) for headings, `--font-ui` for body, `--font-mono` for versions, codes and evidence identifiers. Use `--fs-*`, `--fw-*` and existing line-height/spacing rules from the design contract.
- **Atlas editorial:** the V3 Baskerville display treatment is a *proposal*, not an accepted web app typeface. Do not introduce fonts or fictional wordmarks based only on a sample PDF.
- **Voice:** short active headings, one useful action first, supporting evidence second, technical metadata behind intentional disclosure. No em dash in product UI copy.
- **Density:** prioritize readable stems and mechanisms, moderate line lengths, strong baseline spacing, consistent card edges. Avoid artificial tracking, giant orphan words, low-contrast captions and generic “AI dashboard” decorations.

### Three information layers

**Layer 1 — Decide:** concise heading, question or next action, primary control.

**Layer 2 — Understand:** explanation/mechanism, confidence, source status, related work.

**Layer 3 — Inspect:** raw source references, IDs, revision, AI/provider metadata, detailed log behind `TechnicalDetails`.

A screen fails if the learner cannot find the next step without reading a diagnostic panel.

## 5. Layout and product components

Reuse the existing `GlassCard`, `PanelHeader`, `GButton`, `GhostButton`, `Tag`, `Modal`, `pushToast`, `CoachMark`, and shell primitives. [DESIGN.md](DESIGN.md) is the exact implementation contract for breakpoints, z-index, motion and token usage. Validate at 1440 x 900, 390 x 844 and constrained 320px layouts where relevant.

- One principal reading column for question attempts and study content; optional evidence rail must collapse gracefully on phones.
- Cards mean organization, not a reason to wrap every sentence in another bordered container. Use whitespace and type more than glow.
- A short, semantic status works better than multicolored badges. A pending save may not look like success. State labels must be truthful after reload.
- The learner chooses motion and audio. Reduced-motion disables nonessential loops; sound does not override accessible default/mute and prior consent. The cinematic introduction must not prevent ordinary login or navigation.
- Onboarding, dialog, pills, timers, navigation, keyboard tabs and charts need explicit focus/hover/disabled/empty/error states.

## 6. Visual language for medicine and learning

AXOM's in-house diagrams are an *evidence and comprehension tool*, not a background illustration style. Use the twelve structural primitives in the working Atlas only when applicable:

| Reasoning need | Suitable structures |
| --- | --- |
| Causal mechanism | causal chain, feedback loop, layered mechanism |
| Localization/identification | annotated structure, image reading |
| Decision | decision branch, distractor autopsy, contrast pair |
| Time | temporal sequence |
| Evidence and source | source trace, quantitative bridge |
| Compression | retrieval reduction |

Visual sequence: **reviewed question/key → source-linked claim → correct template → independently verified labels/mechanism → accessible, responsive output**. No diagram enters scored QBank review unless medical content, anatomic orientation, units, legend, rights, source revision, label legibility and answer-leakage boundary are reviewed.

For microscopy/histology/gross anatomy, preserve source-image provenance and teaching annotations separately; do not manufacture a photomicrograph with a generative model and call it a clinical specimen. Generated illustrations may be labeled explanatory art if independently checked. Favor accurate illustrations with independently typeset text and consistent labels rather than AI-generated typography.

## 7. Brand in communication, character and motion

**Email:** Orb plus clear subject and primary action; explain what is ready, what the learner controls and what is private. Do not put personal study/clinical content in a public or unintended recipient's template. Outbound provider activation is a separate ops gate.

**Character personalities and eventual companions:** character stories, custom correspondents and companion avatars may express guidance and identity; they are not evidence of a diagnosis, personality test, hidden surveillance, academic ranking or supernatural certainty. A matching system must use consented, purpose-limited profile fields, explain appropriate user control and prevent sensitive inference. Never allow the character layer to obscure errors, saved state or primary study content. Visuals remain future proposals until owner-reviewed and licensed.

**Sound and cinema:** atmosphere is subordinate to comprehension, playback controls and performance. Keep original assets/hashes, offer sound controls, verify loop transitions and reduced-motion behavior. No fabricated 8K/HDR label for source assets that do not actually carry that quality.

## 8. Quality gates for a brand change

1. Is the exact master asset approved and traceable?
2. Does it follow the existing design contract and learner palette?
3. Is source/uncertainty as visible as the accent color?
4. Does it work at 1440/390/320, light/dark, keyboard/screen reader and reduced motion?
5. Does it protect original user data, private content and rights?
6. Is the visual hierarchy more useful than before, tested on a real QBank/Tracker/Journal journey?
7. Have browser screenshots, checks, reviewer and rollback been recorded at the exact source revision?
8. Is the change labeled proposal, built, merged, deployed or accepted *accurately*?

**Owner approval required:** changing mark geometry, canonical lockup, global font family, major palette meaning, brand name or public claim of capabilities. Minor component refinements follow the named engineering and FORGE release gates.

## 9. Brand maintenance

Maintain one approved, source-linked asset inventory, a small example gallery of *actual* components, approved email/media exports and a versioned change ledger. Mark open creative ideas explicitly as proposals. Do not replace official assets simply because a new generated POC is visually attractive.

**Related documents:** [identity/design contract](DESIGN.md), [product guide](../product/PRODUCT-GUIDE.md), [engineering SOP](../operations/engineering-sop.md), [release nomenclature](../operations/release-nomenclature.md), [document control](../operations/document-control.md).
