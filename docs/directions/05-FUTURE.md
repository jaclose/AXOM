# Future additions

Parked ideas, items waiting on JD, and additions worth considering. Anything here can move back into a branch plan.

## Waiting on JD

| ID | What is needed |
|---|---|
| I4-22 | A licence (or the creator's permission) for the alpha-waves track before it ships to everyone. Today it works on JD's own device: Soundscapes > Your sounds > add the file, then choose what it "Plays for". At 288 MB it would also need re-encoding (Opus at about 64-96 kbps) and streaming rather than bundling. |
| I1-25b | Licence for any myWallpaper images shown on the journal iPad; until then, original or generated art. |
| I3-64 | Where JD's NCRS sheets and Q-bank drives may be hosted (the repository is public). |
| I3-17b | Codex's call on how new students get four starter tracker boxes (board request 2026-09-30). |
| I4-18 | Production email settings (sign-up without a code, welcome email template) are a production change: design lands in the repo, JD applies it. |
| I5-30 | Production: apply migration `20261001090000` and push `main`, then check Settings > Account on the affected device. Steps and what to expect: `docs/release/2026-10-01-ACCOUNT-SYNC-INCIDENT.md`. Until then large workspaces cannot be protected. |
| I5-10 | Examplify / ExamSoft "carbon copy": reference screenshots of the real exam screen (question view, navigation pane, flag and strike-out, calculator and notes, review, the 5-minute warning), and a yes to this boundary: layout, controls, behaviour, type and colour match; their logo, brand name and artwork are not shipped. AMBOSS: deferred or removed, JD's call. |

## Parked

| ID | Idea | Why parked |
|---|---|---|
| I3-11 | Progress reveal animation (orbs per 30 min, fluid fill, speech bubble) | after Codex's targets model settles |
| I3-06 | Day overview calendar with click-to-create study time | after Codex's event model |
| I3-02 | DJ-style mixer, per-ear frequencies, saved mixes | engine supports per-ear tones; UI after the soundscape page restructure |
| I3-66 | Token economy and cosmetic unlocks | needs the journal and library first |
| I3-51 | Friends leaderboard | needs a backend and a privacy model |
| I3-24b | Community submissions (templates, soundscapes, drives, question sets) to JD | needs a moderated backend |
| I1-33 | Simulations tab | after exam UIs |
| I1-02 | Daily medical fact | needs a reviewed, sourced fact set |
| I3-23b | Dedicated, Step 2, Step 3 structures | research the exams' structure first |
| I3-61, I3-62 | Study methods and habit visuals | after trackers settle |
| M-03 | Custom notification HUD in the packaged app | native work, with Codex |

## Worth considering (Claude)

- A shared form system built from the setup primitives (tiles, chips, segments, summaries), so Settings, schedule import and journal setup reach the setup standard without one-off styling.
- A small "directions check" script that validates the index (unique IDs, allowed statuses, commits that exist) so this bank cannot quietly drift.
- A native screen-edge glow for timer completion in the packaged app (a transparent always-on-top window), matching the in-app cue.

## After the upload incident (Wave 1.3.1)

- **Protection re-sends the whole workspace on every change.** It is now paced (about 5 MB a minute) and bounded, but the cost still grows with the workspace instead of with the change. The record-level journal in `docs/architecture/accounts-sync-v1.md` (V2) is the real fix.
- **Import provenance is heavy.** In a 9.6 MB workspace, 3.7 MB was `extraction` snippets that mostly repeat the stem and explanation. Keep one copy, or drop them once a question is accepted.
- **History under a byte budget is short for a large workspace** (about ten versions at 5 MB stored each). Thinning older versions (keep hourly, then daily) would make the same budget reach back weeks.
- **`create_question_set_share` still reports its storage limit as SQLSTATE 54000** (HTTP 500). A deliberate action, not a loop, but the wrong status; Codex wrote that function.
- **The snapshot is built and stringified on the main thread, twice** (once to hash, once by the SDK). A worker and one serialisation would remove a visible hitch on large workspaces.

## Known limits after Wave 1.3

- **Question images stay on the device that imported them.** Their bytes live in the device vault; a portable backup carries them, account sync does not yet. On another device the question says the image is not there. Worth closing before a second device is in daily use.
- **A full-file import of images from a PDF's pages** is not built; images are added as separate files and matched by name.
