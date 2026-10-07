import { describe, expect, it } from "vitest";
import type { QuestionAttempt, QuestionRecord } from "../questions";
import {
  attemptEvents, buildPatternReport, buildReviewSet, calibrateDifficulty, describeQuestionStyle, empiricalDifficulty,
  questionFeatures, rankByReasons, reviewCandidates, reviewPriority, structuralDifficulty, styleObservations, tally,
  type ReviewSignals,
} from "./index";

let counter = 0;
function question(patch: Partial<QuestionRecord> = {}): QuestionRecord {
  counter += 1;
  return {
    id: `q-${counter}`,
    source: "imported",
    stem: "Which enzyme is deficient in classic galactosemia?",
    options: [
      { key: "A", text: "Aldolase B" },
      { key: "B", text: "Galactose-1-phosphate uridyltransferase" },
      { key: "C", text: "Galactokinase" },
      { key: "D", text: "Fructokinase" },
    ],
    correctKey: "B",
    status: "unseen",
    tags: [],
    attempts: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...patch,
  };
}

function attempt(day: number, status: QuestionAttempt["status"], patch: Partial<QuestionAttempt> = {}): QuestionAttempt {
  return {
    at: `2026-07-${String(day).padStart(2, "0")}T09:00:00.000Z`,
    status,
    answerKey: status === "correct" ? "B" : "A",
    ...patch,
  };
}

const VIGNETTE_TREATMENT = "A 58-year-old man presents with crushing chest pain and diaphoresis. His blood pressure is 92/60 mm Hg and an ECG shows ST elevation in leads II, III and aVF. Which of the following is the most appropriate next step in management?";

describe("attempts as events", () => {
  it("numbers each answer by how many times the question had been met", () => {
    const first = question({ attempts: [attempt(3, "incorrect"), attempt(1, "incorrect"), attempt(5, "correct")] });
    const events = attemptEvents([first]);
    // Ordered by time, whatever order they were stored in.
    expect(events.map((event) => [event.at.slice(8, 10), event.exposure, event.correct])).toEqual([
      ["01", 1, false], ["03", 2, false], ["05", 3, true],
    ]);
  });

  it("does not score an answer it cannot check, and does not count a bare flag as an exposure", () => {
    const unkeyed = question({ correctKey: undefined, attempts: [attempt(1, "needs-review", { answerKey: "C" })] });
    const flagged = question({ attempts: [{ at: "2026-07-01T09:00:00.000Z", status: "flagged" }, attempt(2, "correct")] });
    expect(attemptEvents([unkeyed])[0]).toMatchObject({ correct: undefined, correctKey: undefined });
    expect(attemptEvents([flagged])).toEqual([expect.objectContaining({ exposure: 1, correct: true })]);
    expect(tally(attemptEvents([unkeyed]))).toEqual({ attempts: 0, correct: 0, accuracy: null });
  });

  it("takes a learner's \"guessed\" as right and unsure, and never invents certainty", () => {
    const guessed = attemptEvents([question({ attempts: [attempt(1, "guessed", { answerKey: "B" })] })])[0];
    expect(guessed).toMatchObject({ correct: true, certainty: "guess" });
    expect(attemptEvents([question({ attempts: [attempt(1, "correct")] })])[0].certainty).toBeUndefined();
  });
});

describe("reading a question from its wording", () => {
  it("separates a direct recall question from a case with a hidden step", () => {
    const recall = questionFeatures(question());
    expect(recall).toMatchObject({ task: "recall", reasoningDepth: 1, vignette: false });

    const treatment = questionFeatures(question({ stem: VIGNETTE_TREATMENT }));
    // The diagnosis is never asked for, but has to be made first.
    expect(treatment).toMatchObject({ task: "treatment", reasoningDepth: 3, vignette: true, referencesFigure: true });
    expect(treatment.dataPoints).toBeGreaterThanOrEqual(2);
  });

  it("names the task from the sentence that asks, not from words earlier in the case", () => {
    const stem = "A 30-year-old woman is treated with a drug that inhibits dihydrofolate reductase. Three weeks later she presents with fatigue and pallor. Which of the following is the most likely diagnosis?";
    expect(questionFeatures(question({ stem })).task).toBe("diagnosis");
  });

  it("finds the cues that give an answer away or mislead", () => {
    const cued = questionFeatures(question({
      stem: "All of the following are true of glucokinase EXCEPT:",
      options: [
        { key: "A", text: "It is found in liver" },
        { key: "B", text: "It is always saturated at fasting glucose concentrations and never responds to insulin" },
        { key: "C", text: "It has a high Km" },
        { key: "D", text: "None of the above" },
      ],
      correctKey: "B",
    }));
    expect(cued.cues).toEqual(expect.arrayContaining(["negative-stem", "longest-option-is-answer", "all-or-none-option"]));
    expect(cued.negativeStem).toBe(true);
  });

  it("notices a stem that points to a figure nobody attached", () => {
    const stem = "The arrow in the photograph shown below indicates which structure?";
    expect(questionFeatures(question({ stem })).cues).toContain("figure-missing");
    const withImage = question({
      stem,
      attachments: [{ id: "a", fileName: "f.png", mimeType: "image/png", byteSize: 10, altText: "", createdAt: "", updatedAt: "", blobKey: "a", role: "exhibit" }],
    });
    expect(questionFeatures(withImage).cues).not.toContain("figure-missing");
  });

  it("does not report answer cues for a question whose key is not trusted", () => {
    const unreviewed = question({
      options: [{ key: "A", text: "Short" }, { key: "B", text: "A much, much longer option that qualifies itself at length" }, { key: "C", text: "Brief" }],
      correctKey: "B",
      extraction: { confidence: "medium", reviewed: false },
    });
    expect(questionFeatures(unreviewed).cues).not.toContain("longest-option-is-answer");
  });
});

describe("difficulty", () => {
  it("rates a hidden-step case above a direct question and says what drives it", () => {
    const direct = structuralDifficulty(question());
    const hidden = structuralDifficulty(question({ stem: VIGNETTE_TREATMENT }));
    expect(hidden.score).toBeGreaterThan(direct.score);
    expect(hidden.tier).toBeGreaterThan(direct.tier);
    expect(hidden.driver).toBe("reasoningSteps");
    expect(direct.tier).toBe(1);
  });

  it("raises the rating when the options are close to each other", () => {
    const alike = structuralDifficulty(question({
      options: [
        { key: "A", text: "Decreased renal sodium reabsorption in the proximal tubule" },
        { key: "B", text: "Decreased renal sodium reabsorption in the distal tubule" },
        { key: "C", text: "Increased renal sodium reabsorption in the proximal tubule" },
        { key: "D", text: "Increased renal sodium reabsorption in the distal tubule" },
      ],
    }));
    expect(alike.signature.distractorSimilarity).toBeGreaterThan(0.6);
    expect(alike.score).toBeGreaterThan(structuralDifficulty(question()).score);
  });

  it("will not state an empirical difficulty from fewer than three answers", () => {
    const one = attemptEvents([question({ attempts: [attempt(1, "incorrect")] })]);
    expect(empiricalDifficulty(one)).toEqual({ status: "insufficient", attempts: 1, needed: 2 });
    const three = attemptEvents([question({ attempts: [attempt(1, "incorrect"), attempt(2, "incorrect"), attempt(3, "correct")] })]);
    expect(empiricalDifficulty(three)).toEqual({ status: "estimated", attempts: 3, missRate: 0.67, firstTimeCorrect: false });
  });

  it("only says whether the rating tracks performance once two tiers have enough first-time answers", () => {
    const few = [question({ attempts: [attempt(1, "correct")] })];
    expect(calibrateDifficulty(few, attemptEvents(few)).tracks).toBeUndefined();

    const easy = Array.from({ length: 8 }, () => question({ attempts: [attempt(1, "correct")] }));
    const hard = Array.from({ length: 8 }, (_, index) => question({ stem: VIGNETTE_TREATMENT, attempts: [attempt(1, index < 2 ? "correct" : "incorrect")] }));
    const calibrated = calibrateDifficulty([...easy, ...hard], attemptEvents([...easy, ...hard]));
    expect(calibrated.tracks).toBe(true);
    expect(calibrated.tiers.filter((tier) => tier.sufficient).map((tier) => tier.firstTime.accuracy)).toEqual([100, 25]);
  });
});

describe("pattern findings", () => {
  it("says nothing, and waits for nothing, before any answer exists", () => {
    const report = buildPatternReport([question(), question()]);
    expect(report.findings).toEqual([]);
    expect(report.waitingFor).toEqual([]);
    expect(report.totals.all.accuracy).toBeNull();
  });

  it("puts answers the learner was sure of and got wrong first, grouped by what they share", () => {
    const report = buildPatternReport([
      question({ topic: "Carbohydrate metabolism", status: "incorrect", attempts: [attempt(1, "incorrect", { certainty: "sure" })] }),
      question({ topic: "Carbohydrate metabolism", status: "incorrect", attempts: [attempt(1, "incorrect", { certainty: "sure" })] }),
      question({ topic: "Lipids", status: "incorrect", attempts: [attempt(1, "incorrect", { certainty: "unsure" })] }),
    ]);
    expect(report.findings[0]).toMatchObject({
      kind: "sure-and-wrong", basis: "observed", sample: 2,
      title: "2 answers you were sure of were wrong",
    });
    expect(report.findings[0].detail).toContain("2 of them are Carbohydrate metabolism");
    expect(report.findings[0].questionIds).toHaveLength(2);
  });

  it("names the pair of answers the learner keeps swapping", () => {
    const report = buildPatternReport([
      question({ status: "incorrect", attempts: [attempt(1, "incorrect", { answerKey: "C" })] }),
      question({ status: "incorrect", attempts: [attempt(2, "incorrect", { answerKey: "C" })] }),
      question({ status: "incorrect", attempts: [attempt(3, "incorrect", { answerKey: "A" })] }),
    ]);
    expect(report.confusionPairs).toEqual([
      expect.objectContaining({ picked: "Galactokinase", correct: "Galactose-1-phosphate uridyltransferase", count: 2 }),
    ]);
    expect(report.findings.find((finding) => finding.kind === "confusion-pair")?.title)
      .toBe('You chose "Galactokinase" when the answer was "Galactose-1-phosphate uridyltransferase"');
  });

  it("compares new and repeated questions only when both have enough answers, and says what it is waiting for", () => {
    const thin = buildPatternReport([question({ attempts: [attempt(1, "incorrect"), attempt(2, "correct")] })]);
    expect(thin.findings.some((finding) => finding.kind === "first-vs-repeat")).toBe(false);
    expect(thin.waitingFor).toContain("New against repeated questions: needs 8 answers of each (1 new, 1 repeated so far).");

    const seen = Array.from({ length: 8 }, (_, index) => question({
      status: "correct",
      attempts: [attempt(1, index < 3 ? "correct" : "incorrect"), attempt(4, "correct")],
    }));
    const finding = buildPatternReport(seen).findings.find((item) => item.kind === "first-vs-repeat");
    expect(finding).toMatchObject({ basis: "computed", title: "38% on new questions, 100% on ones you have seen" });
  });

  it("contrasts question types on first-time answers and labels the reading as inferred", () => {
    const recall = Array.from({ length: 8 }, () => question({ status: "correct", attempts: [attempt(1, "correct")] }));
    const treatment = Array.from({ length: 8 }, (_, index) => question({
      stem: VIGNETTE_TREATMENT,
      status: index < 2 ? "correct" : "incorrect",
      attempts: [attempt(1, index < 2 ? "correct" : "incorrect")],
    }));
    const report = buildPatternReport([...recall, ...treatment]);
    const gap = report.findings.find((finding) => finding.kind === "task-gap");
    expect(gap).toMatchObject({ basis: "inferred", title: "Recall: 100%. Treatment: 25%" });
    // Missed questions lead the practice list.
    expect(report.findings.find((finding) => finding.kind === "depth-gap")?.questionIds[0]).toBe(treatment[2].id);
  });

  it("does not contrast types a repeat would flatter: only first-time answers count", () => {
    const recall = Array.from({ length: 8 }, () => question({ attempts: [attempt(1, "correct")] }));
    const treatment = Array.from({ length: 4 }, () => question({
      stem: VIGNETTE_TREATMENT, attempts: [attempt(1, "incorrect"), attempt(2, "incorrect"), attempt(3, "incorrect")],
    }));
    expect(buildPatternReport([...recall, ...treatment]).findings.some((finding) => finding.kind === "task-gap")).toBe(false);
  });

  it("reads quick misses as a computed pattern, with the two medians it rests on", () => {
    const right = Array.from({ length: 6 }, () => question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 80 })] }));
    const wrong = Array.from({ length: 6 }, () => question({ status: "incorrect", attempts: [attempt(1, "incorrect", { timeSpentSeconds: 25 })] }));
    const finding = buildPatternReport([...right, ...wrong]).findings.find((item) => item.kind === "fast-misses");
    expect(finding?.detail).toContain("25 seconds or less, against 80 for right ones");
  });

  it("reports questions that depend on an image that was never imported", () => {
    const report = buildPatternReport([question({ stem: "The radiograph shown below is most consistent with which condition?" })]);
    expect(report.findings).toEqual([expect.objectContaining({ kind: "figure-missing", basis: "inferred", sample: 1 })]);
  });

  it("asks for certainty marks before it says anything about calibration", () => {
    const report = buildPatternReport([question({ attempts: [attempt(1, "correct", { certainty: "sure" })] })]);
    expect(report.waitingFor).toContain('How sure you were: mark it on 9 more answers to see whether "sure" means right.');
  });
});

describe("how a source asks its questions", () => {
  it("holds back the answer-length comparison until the sample is large enough", () => {
    const small = describeQuestionStyle(Array.from({ length: 5 }, () => question()));
    expect(small).toMatchObject({ sampleSize: 5, reliable: false, longestOptionIsAnswer: undefined, usualOptionCount: 4 });
  });

  it("sets how often the longest option is the answer against chance", () => {
    // In the default question the longest option is the keyed one.
    const style = describeQuestionStyle(Array.from({ length: 20 }, () => question()));
    expect(style.longestOptionIsAnswer).toEqual({ percent: 100, chancePercent: 25, keyed: 20 });
    expect(styleObservations(style)).toContain(
      "The longest option is the answer 100% of the time; chance would be 25%. Scores from this source may flatter you, so check them against another one.",
    );
    expect(style.tasks[0]).toMatchObject({ task: "recall", percent: 100 });
  });

  it("describes a case-heavy source in counts a learner can check", () => {
    const cases = Array.from({ length: 12 }, () => question({ stem: VIGNETTE_TREATMENT }));
    const style = describeQuestionStyle([...cases, ...Array.from({ length: 8 }, () => question())]);
    expect(style.depth[3]).toEqual({ count: 12, percent: 60 });
    expect(styleObservations(style)).toEqual(expect.arrayContaining([
      "60% ask for treatment (12 of 20).",
      "60% describe a case and ask for something one step past the diagnosis.",
      "60% rest on an image, tracing or figure.",
    ]));
  });
});

describe("what to look at again after a block", () => {
  const history = [
    question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 40 })] }),
    question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 50 })] }),
    question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 60 })] }),
    question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 45 })] }),
    question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 55 })] }),
  ];

  it("gives each answered question its reasons, and leaves a clean right answer alone", () => {
    const block = [
      question({ attempts: [attempt(9, "incorrect", { certainty: "sure", quizSessionId: "run" })] }),
      question({ attempts: [attempt(2, "incorrect"), attempt(9, "incorrect", { quizSessionId: "run" })] }),
      question({ attempts: [attempt(9, "incorrect", { quizSessionId: "run" })] }),
      question({ attempts: [attempt(9, "correct", { certainty: "unsure", quizSessionId: "run" })] }),
      question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 200, quizSessionId: "run" })] }),
      question({ attempts: [attempt(9, "correct", { certainty: "sure", timeSpentSeconds: 50, quizSessionId: "run" })] }),
    ];
    const events = attemptEvents([...history, ...block]);
    const candidates = reviewCandidates(events.filter((event) => event.quizSessionId === "run"), events);
    const byQuestion = new Map(candidates.map((candidate) => [candidate.questionId, candidate]));

    expect(byQuestion.get(block[0].id)).toMatchObject({ reasons: ["sure-and-wrong"], retry: ["today", "in-a-week"] });
    expect(byQuestion.get(block[1].id)).toMatchObject({ reasons: ["repeat-miss"], retry: ["today", "this-week"] });
    expect(byQuestion.get(block[2].id)).toMatchObject({ reasons: ["wrong"], retry: ["tomorrow"] });
    expect(byQuestion.get(block[3].id)).toMatchObject({ reasons: ["unsure-right"], retry: ["this-week"] });
    expect(byQuestion.get(block[4].id)).toMatchObject({ reasons: ["slow-right"] });
    expect(byQuestion.has(block[5].id)).toBe(false);
  });

  it("orders candidates by priority, and a question with no reason has none", () => {
    expect(reviewPriority([])).toBe(0);
    const block = [
      question({ attempts: [attempt(9, "correct", { certainty: "unsure" })] }),
      question({ attempts: [attempt(9, "incorrect", { certainty: "sure" })] }),
    ];
    const candidates = reviewCandidates(attemptEvents(block));
    const priorities = candidates.map((candidate) => candidate.priority);
    expect(priorities).toEqual([...priorities].sort((a, b) => b - a));
  });

  it("hands a ranker the facts of each attempt, and lets the ranker be replaced", () => {
    const block = [
      question({ attempts: [attempt(2, "incorrect"), attempt(9, "incorrect", { certainty: "sure", errorType: "missed-clue", timeSpentSeconds: 70, quizSessionId: "run" })] }),
      question({ attempts: [attempt(9, "correct", { certainty: "unsure", timeSpentSeconds: 30, quizSessionId: "run" })] }),
    ];
    const events = attemptEvents([...history, ...block]);
    const seen: ReviewSignals[] = [];
    // A ranker of another kind: slowest first. It reads the signals and nothing else.
    const slowestFirst = (signals: ReviewSignals) => { seen.push(signals); return signals.seconds ?? 0; };
    const candidates = reviewCandidates(events.filter((event) => event.quizSessionId === "run"), events, slowestFirst);

    expect(candidates.map((candidate) => candidate.questionId)).toEqual([block[0].id, block[1].id]);
    expect(candidates.map((candidate) => candidate.priority)).toEqual([70, 30]);
    expect(seen.find((signals) => signals.questionId === block[0].id)).toMatchObject({
      reasons: ["sure-and-wrong", "repeat-miss"], correct: false, firstAttemptCorrect: false, exposure: 2, earlierMisses: 1,
      // The learner's usual time on a right answer: the middle of 30, 40, 45, 50, 55 and 60 seconds.
      certainty: "sure", errorType: "missed-clue", seconds: 70, usualSeconds: 47.5,
    });
    expect(seen.find((signals) => signals.questionId === block[1].id)).toMatchObject({ correct: true, firstAttemptCorrect: true, exposure: 1, earlierMisses: 0 });
    // The reasons stay with the candidate whatever ranked it, so a ranking can say why.
    expect(candidates[0].reasons).toEqual(["sure-and-wrong", "repeat-miss"]);
    // Without a ranker, the order is today's rule.
    const usual = reviewCandidates(events.filter((event) => event.quizSessionId === "run"), events);
    expect(usual.map((candidate) => candidate.priority)).toEqual(usual.map((candidate) => rankByReasons({ ...seen[0], reasons: candidate.reasons })));
  });

  it("builds a review set that points at the same questions and keeps its place in the course", () => {
    const block = [question({ attempts: [attempt(9, "incorrect")] }), question({ attempts: [attempt(9, "correct", { certainty: "guess" })] })];
    const candidates = reviewCandidates(attemptEvents(block));
    const set = buildReviewSet({
      id: "review-1",
      candidates,
      reasons: ["wrong", "sure-and-wrong", "repeat-miss"],
      parent: { id: "set-1", title: "Week 2 practice", scope: { module: "FTM 1", week: 2 } },
      now: "2026-07-09T10:00:00.000Z",
    });
    expect(set).toMatchObject({
      kind: "review", parentSetId: "set-1", scope: { module: "FTM 1", week: 2 }, questionIds: [block[0].id], tags: ["missed-review"],
    });
    expect(set.title.startsWith("Week 2 practice: review, ")).toBe(true);
  });
});
