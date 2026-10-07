# In flight

What each branch is doing right now. Update when a branch starts, changes scope, or merges.

| Branch | Worktree | Owner | Plan | State |
|---|---|---|---|---|
| `feat/course-engine-v1` | /Users/jd/Developer/AXOM-course-engine-v1 | Claude | [Course engine contract](../../features/course-engine.md) | local commits on base 42eeacb, not merged; origin has the first six (an editor Sync, 2026-10-07), the rest are local only: save path, course engine, learning intelligence, PDF figures, slide decks read slide by slide, mass import Accept / Edit / Skip, re-import adds nothing. Waiting on the integration line. `reviewPriority` is JD's to write |
| `fix/wave1.3.2-audit` | /Users/jd/Developer/AXOM-wave-1.3.1 (same worktree as 1.3.1) | Claude | Browser audit of what Wave 1.3 shipped: your sounds across a reload, Locked In chime and wording, the stage orb by eye; two small repairs | on local main (tag wave-1.3.2), not pushed |
| `fix/wave1.3.1-sync` | /Users/jd/Developer/AXOM-wave-1.3.1 | Claude | The production upload failure: server migration, bounded client, profile photo size, browser replay of the incident; Ideas 5 work order banked | on local main (tag wave-1.3.1), not pushed; production needs the migration and a deploy (JD) |
| `fix/wave1.3` | /Users/jd/Developer/AXOM-wave-1.3 | Claude | Ideas 5 fixes: question import layouts and images, Your sounds, exam time and marks, Locked In chime, stage orb | on main (ef3e6b5, tag wave-1.3), pushed by JD |
| `wave/1.2` | /Users/jd/Developer/AXOM-wave-1.2 | Claude | directions, opening films, timer cues, tracker order, account fix, post-Promise reveal, quiet first day, How you study | on main (2915b46, tag wave-1.2), pushed by JD |
| `feat/wave2-home` | /Users/jd/Developer/AXOM-wave2-home | Claude | ../../feature-development/2026-09-30/home/PLAN-v1.md on that branch | in progress: save-progress banner, sign-in restore, Daily Check-In rebuild done on the branch; Up Next, widget primitive, Wrapped open |
| `feat/wave2-journal-library` | /Users/jd/Developer/AXOM-wave2-journal | Claude | ../../feature-development/2026-09-30/journal-library/PLAN-v1.md on that branch | plan v1 |
| `feat/wave2-study-ai` | /Users/jd/Developer/AXOM-wave2-study | Claude | ../../feature-development/2026-09-30/study-ai/PLAN-v1.md on that branch (gains the cohort schedule, .ics export and skip tracker from Ideas 4) | plan v1 |
| `feat/ideas2-integration` | /Users/jd/Developer/AXOM-ideas2 | Codex | Codex's Ideas 2 lane | three commits since Wave 1.1 (1a2961b, and JD's "Wave 1.1" / "Wave1.1.1" commits of Codex's working tree); the last includes Codex's `.coordination/` recovery snapshots, which should not reach main |
| `feat/ideas3-staging` | /Users/jd/Developer/AXOM-ideas3 | Claude | Ideas 1 + 3 | on main since Wave 1.1; one later commit (933419f) is a leftover note superseded by Wave 1.2. Nothing to merge; safe to archive when JD says |
