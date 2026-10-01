# Ideas 5 (verbatim)

Notes JD sent on 2026-09-30 (evening). Never edit the quoted text; index entries live in INDEX.md as `I5-nn`.

One redaction, marked in place: the worked example in JD's mapping note quoted a question, its choices and its explanation from a private course quiz. The repository is public, so that text is replaced with placeholders. The structure of the example is unchanged.

## "Ideas 5 so far"

````
Ideas 5:


elegant sound when the locked in thing pops up.

Are you lcoked in? I am locked out as an option with the tired face emojoi


mapping of paste for gpt:
For AXOM mapping, use this exact field logic so there’s no ambiguity:

| AXOM field | Map from my output | What it contains |
|---|---|---|
| **Question / Stem** | Everything after `Question X` and before `A.` | Full clinical vignette + question |
| **Choice A** | `A.` | First answer option |
| **Choice B** | `B.` | Second answer option |
| **Choice C** | `C.` | Third answer option |
| **Choice D** | `D.` | Fourth answer option |
| **Choice E** | `E.` | Fifth answer option |
| **Choice F/G/H** | `F.` / `G.` / `H.` when present | Extra answer options |
| **Correct Answer** | `Answer:` | **Letter only**: `A`, `B`, `C`, etc. |
| **Explanation** | `Explanation:` | AXOM answer explanation |
| **Review / Tags** | `Review:` | Topic labels / source metadata |
| **Image / Attachment** | `Attachment:` | Associated source image filename |
| **Question Number** | `Question X` | Original ExamSoft question number |
| **Source** | Set manually | `Examsoft Quiz 4`, `5`, `6`, or `7` |

### Most important mapping rule

For each item:

```text
Question 17
[STEM]

A. ...
B. ...
C. ...
D. ...
E. ...

Answer: D
Explanation: ...
Review: ...
Attachment: image.png
```

Map it as:

```text
Question Number → 17

Question / Stem →
[STEM ONLY]

Choices →
A → ...
B → ...
C → ...
D → ...
E → ...

Correct Answer →
D

Explanation →
[everything after "Explanation:"]

Review / Tags →
[everything after "Review:"]

Attachment →
image.png
```

### Source mapping

Also keep the provenance clear:

```text
Examsoft Quiz 4
Source: NCRS Examsoft Quiz 4
Questions: 1–25

Examsoft Quiz 5
Source: NCRS Examsoft Quiz 5
Questions: 1–35

Examsoft Quiz 6
Source: NCRS Examsoft Quiz 6
Questions: 1–20

Examsoft Quiz 7
Source: NCRS Examsoft Quiz 7
Questions: 1–35
```

And critically:

```text
WITHOUT ANSWERS PDF
→ Question stem
→ Answer choices
→ Original formatting/content

WITH ANSWERS PDF
→ Correct-answer mapping ONLY

My generated content
→ Explanation
→ Review / tags
```

So AXOM should **not interpret the ✓ symbol itself**. I already converted the checkmark into:

```text
Answer: C
```

That `C` is what should map to **Correct Answer**.

For the two questionable source items, preserve the warning rather than treating them like normal verified answers:

```text
Quiz 4 Q17
Correct Answer from source: D
Status: SOURCE-KEY FLAG
```

```text
Quiz 6 Q12
Correct Answer: UNRESOLVED
Source marks: A and D
Status: SOURCE-KEY CONFLICT
```

For Q12 specifically, **do not map either A or D as a normal single correct answer until you manually resolve it.**

A clean AXOM confirmation screen should therefore look roughly like:

```text
SOURCE
Examsoft Quiz 7

QUESTION NUMBER
29

QUESTION
[question stem omitted: private course material]

ANSWER CHOICES
A  [choice omitted]
B  [choice omitted]
C  [choice omitted]
D  [choice omitted]
E  [choice omitted]

CORRECT ANSWER
C

EXPLANATION
[explanation omitted: private course material]

TAGS / REVIEW
[three short topic tags, one per line, omitted]

ATTACHMENT
None
```

That is the mapping I intended for all **115 questions**.








Also mapping and import of questions
````

## Mid-turn notes (2026-09-30, verbatim)

```
assigning sounds to things doesnt work - renaming doesnt work either - make sure this works properly
```
(Screenshot: Soundscapes > Your sounds on axom.info. Six of JD's own tracks; the "Where it lives" menu open on one of them with Your sounds ticked and 40 Hz Gamma highlighted.)

```
Sphere and animated circle should adjust to the colors of the background and needs to be better centered and fit the vibe and sound activated and beautiful and elegant
```
(Two screenshots: the Soundscapes hero with a blue smoke ring over a dark scene, and the fullscreen view where a thin ring sits low and off centre over a blue and orange light-streak scene.)

```
Make sure to report to me of new branches created and how many chnages are made and whent o combine and publish branches
```

```
Use the new pipeline we developed then take a look at the subsequent codex workflow:
```
(Followed by Codex's status on soundscape and Spotify persistence in the Ideas 2 worktree, and JD's strategic-checkpoint prompt: research, reassess, choose, execute, verify, improve, ship.)

(Screenshot, no words: Question Bank > Import Center on axom.info. "Examsoft Quiz 4 (With Answers).pdf" parsed into one question marked Invalid. The stem begins with the labels SOURCE:, QUESTION_NUMBER: and STEM:; "5 choices, answer missing, explanation present".)

```
Need to work on the proper examsoft UI as well as the amboss - The uworld is pretty good - but I need carbon copy examplify and examsoft and (amboss can be deffered) or removed.
also if you get. a question wrong - have it mark and X instyead of the checkmark - and continue working on making the questions easy to navigate and use
```

```
work on image display to be integrated soon and a full working import system please
```

```
also time spent is not correct when answered
```
