import { describe, expect, it } from "vitest";
import type { QuestionAttempt, QuestionRecord } from "../questions";
import {
  attemptEvents, buildPatternReport, buildReviewSet, calibrateDifficulty, describeQuestionStyle, empiricalDifficulty,
  questionFeatures, rankByReasons, reviewCandidates, reviewCandidatesForSession, reviewPriority, structuralDifficulty, styleObservations, tally,
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

describe("answer-readiness and historical analytics integrity", () => {
  it("preserves recorded incorrect attempts without counting withdrawn mappings as current scores", () => {
    const held = question({
      needsReview: true,
      attempts: [attempt(1, "incorrect", { certainty: "sure", errorType: "missed-clue" })],
    });
    const before = JSON.stringify(held.attempts);
    const [event] = attemptEvents([held]);
    expect(event).toMatchObject({ questionId: held.id, answerKey: "A", correctKey: undefined, correct: undefined });
    expect(buildPatternReport([held]).totals.all).toEqual({ attempts: 0, correct: 0, accuracy: null });
    expect(JSON.stringify(held.attempts)).toBe(before);
  });

  it("holds unreviewed extraction and missing or changed answer keys out of scored accuracy", () => {
    const unreviewed = question({
      extraction: { confidence: "medium", reviewed: false },
      attempts: [attempt(1, "correct")],
    });
    const missingKey = question({
      correctKey: undefined,
      attempts: [attempt(1, "incorrect")],
    });
    const invalidKey = question({
      correctKey: "Z",
      attempts: [attempt(1, "correct")],
    });
    const records = [unreviewed, missingKey, invalidKey];
    const before = JSON.stringify(records.map((record) => record.attempts));
    expect(attemptEvents(records).map((event) => [event.correct, event.correctKey])).toEqual([
      [undefined, undefined], [undefined, undefined], [undefined, undefined],
    ]);
    expect(buildPatternReport(records).totals.all).toEqual({ attempts: 0, correct: 0, accuracy: null });
    expect(JSON.stringify(records.map((record) => record.attempts))).toBe(before);
  });

  it("does not create a weak-concept recommendation from six currently unverified keys", () => {
    const held = Array.from({ length: 6 }, () => question({
      topic: "Source held pending review",
      needsReview: true,
      attempts: [attempt(1, "incorrect")],
    }));
    const before = JSON.stringify(held);
    const report = buildPatternReport(held);
    expect(report.totals.all.attempts).toBe(0);
    expect(report.byConcept).toEqual([]);
    expect(report.findings.some((finding) => finding.kind === "weak-concept")).toBe(false);
    expect(JSON.stringify(held)).toBe(before);
  });

  it("keeps historically recorded scores in ready mappings and existing attempt history unchanged", () => {
    const ready = question({ attempts: [attempt(1, "incorrect"), attempt(2, "correct")] });
    const before = JSON.stringify(ready);
    expect(attemptEvents([ready]).map((event) => event.correct)).toEqual([false, true]);
    expect(buildPatternReport([ready]).totals.all).toEqual({ attempts: 2, correct: 1, accuracy: 50 });
    expect(JSON.stringify(ready)).toBe(before);
  });
});


describe("current scoring after answer-key repair", () => {
  it("holds a formerly correct or guessed answer whose saved choice contradicts the now-ready key", () => {
    const repaired = question({
      correctKey: "B",
      attempts: [
        attempt(1, "correct", { answerKey: "A", certainty: "sure" }),
        attempt(2, "guessed", { answerKey: "A", certainty: "guess" }),
      ],
    });
    const original = JSON.stringify(repaired);
    const events = attemptEvents([repaired]);
    expect(events.map((event) => [event.exposure, event.answerKey, event.correctKey, event.correct])).toEqual([
      [1, "A", "B", undefined],
      [2, "A", "B", undefined],
    ]);
    expect(buildPatternReport([repaired]).totals.all).toEqual({ attempts: 0, correct: 0, accuracy: null });
    expect(JSON.stringify(repaired)).toBe(original);
  });

  it("holds an old incorrect flag when its saved choice is the current trusted answer", () => {
    const repaired = question({
      correctKey: "B",
      attempts: [attempt(1, "incorrect", { answerKey: "B", certainty: "sure" })],
    });
    const original = JSON.stringify(repaired);
    expect(attemptEvents([repaired])[0].correct).toBeUndefined();
    const report = buildPatternReport([repaired]);
    expect(report.sureAndWrong).toEqual([]);
    expect(report.confusionPairs).toEqual([]);
    expect(report.totals.all).toEqual({ attempts: 0, correct: 0, accuracy: null });
    expect(JSON.stringify(repaired)).toBe(original);
  });

  it("retains coherent saved outcomes, exposure order and legacy status-only attempts", () => {
    const coherent = question({
      correctKey: "B",
      attempts: [
        attempt(3, "guessed", { answerKey: "B" }),
        attempt(1, "incorrect", { answerKey: "A" }),
        attempt(2, "correct", { answerKey: "B" }),
        attempt(4, "correct", { answerKey: undefined }),
      ],
    });
    expect(attemptEvents([coherent]).map((event) => [event.exposure, event.correct])).toEqual([
      [1, false], [2, true], [3, true], [4, true],
    ]);
    expect(buildPatternReport([coherent]).totals.all).toEqual({ attempts: 4, correct: 3, accuracy: 75 });
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

describe("verified current misses versus historical error classifications", () => {
  it("does not call five review-held, self-classified attempts currently scored misses", () => {
    const held = Array.from({ length: 5 }, () => question({
      needsReview: true,
      attempts: [attempt(1, "incorrect", { errorType: "missed-clue" })],
    }));
    const original = JSON.stringify(held);
    const report = buildPatternReport(held);
    expect(report.totals.all).toEqual({ attempts: 0, correct: 0, accuracy: null });
    expect(report.findings.filter((finding) => finding.kind === "error-pattern")).toEqual([]);
    expect(JSON.stringify(held)).toBe(original);
  });

  it("excludes five saved incorrect flags contradicted by the now-reviewed answer key", () => {
    const repaired = Array.from({ length: 5 }, () => question({
      attempts: [attempt(1, "incorrect", { answerKey: "B", errorType: "missed-clue" })],
    }));
    const original = JSON.stringify(repaired);
    expect(attemptEvents(repaired).every((event) => event.correct === undefined)).toBe(true);
    const report = buildPatternReport(repaired);
    expect(report.totals.all.attempts).toBe(0);
    expect(report.findings.some((finding) => finding.kind === "error-pattern")).toBe(false);
    expect(JSON.stringify(repaired)).toBe(original);
  });

  it("counts only verified incorrect error marks, not held or correct history", () => {
    const currentMisses = Array.from({ length: 5 }, () => question({
      attempts: [attempt(1, "incorrect", { errorType: "missed-clue" })],
    }));
    const held = Array.from({ length: 5 }, () => question({
      needsReview: true,
      attempts: [attempt(1, "incorrect", { errorType: "missed-clue" })],
    }));
    const correct = Array.from({ length: 3 }, () => question({
      attempts: [attempt(1, "correct", { errorType: "missed-clue" })],
    }));
    const records = [...held, ...correct, ...currentMisses];
    const original = JSON.stringify(records);
    const report = buildPatternReport(records);
    expect(report.totals.all).toEqual({ attempts: 8, correct: 3, accuracy: 38 });
    expect(report.findings.find((finding) => finding.kind === "error-pattern")).toMatchObject({
      title: "100% of the misses you explained: missed a clue",
      basis: "observed",
      sample: 5,
      questionIds: currentMisses.map((item) => item.id),
    });
    expect(JSON.stringify(records)).toBe(original);
  });
});

describe("computed pattern timing evidence must be valid", () => {
  const right = (seconds: number[]) => seconds.map((timeSpentSeconds) => question({
    attempts: [attempt(1, "correct", { timeSpentSeconds })],
  }));
  const wrong = (seconds: number[]) => seconds.map((timeSpentSeconds) => question({
    status: "incorrect",
    attempts: [attempt(1, "incorrect", { timeSpentSeconds })],
  }));
  const invalidDurations = [
    Number.POSITIVE_INFINITY, Number.NaN, -5, 0, "25" as unknown as number,
  ];

  it("never counts invalid correct durations as a sixth valid fast-miss comparison sample", () => {
    for (const invalid of invalidDurations) {
      const records = [...right([80, 80, 80, 80, 80, invalid]), ...wrong([25, 25, 25, 25, 25, 25])];
      const original = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.totals.all).toEqual({ attempts: 12, correct: 6, accuracy: 50 });
      expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
      expect(report.findings.some((finding) => finding.kind === "fast-misses")).toBe(false);
      expect(JSON.stringify(records)).toBe(original);
    }
  });

  it("never counts invalid incorrect durations as a sixth valid fast-miss comparison sample", () => {
    for (const invalid of invalidDurations) {
      const records = [...right([80, 80, 80, 80, 80, 80]), ...wrong([25, 25, 25, 25, 25, invalid])];
      const original = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.totals.all).toEqual({ attempts: 12, correct: 6, accuracy: 50 });
      expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
      expect(report.findings.some((finding) => finding.kind === "fast-misses")).toBe(false);
      expect(JSON.stringify(records)).toBe(original);
    }
  });

  it("preserves six genuinely timed correct and incorrect samples and their action IDs", () => {
    const correct = right([80, 80, 80, 80, 80, 80]);
    const incorrect = wrong([25, 25, 25, 25, 25, 25]);
    const report = buildPatternReport([...correct, ...incorrect]);
    expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
    expect(report.findings.find((finding) => finding.kind === "fast-misses")).toMatchObject({
      basis: "computed", sample: 12, questionIds: incorrect.map((q) => q.id),
    });
  });
});

describe("fast-miss timing requires a verifiable saved answer choice", () => {
  const right = (count: number, patch: Partial<QuestionAttempt> = {}) => Array.from({ length: count }, () => question({
    attempts: [attempt(1, "correct", { timeSpentSeconds: 80, ...patch })],
  }));
  const wrong = (count: number, patch: Partial<QuestionAttempt> = {}) => Array.from({ length: count }, () => question({
    status: "incorrect",
    attempts: [attempt(1, "incorrect", { timeSpentSeconds: 25, ...patch })],
  }));
  const fastMisses = (records: QuestionRecord[]) =>
    buildPatternReport(records).findings.find((finding) => finding.kind === "fast-misses");

  it("does not infer a current fast-miss pattern from twelve status-only legacy outcomes", () => {
    const records = [...right(6, { answerKey: undefined }), ...wrong(6, { answerKey: undefined })];
    const original = JSON.stringify(records);
    const report = buildPatternReport(records);
    // Preserve historical recorded scores while withholding unsupported timing conclusions.
    expect(report.totals.all).toEqual({ attempts: 12, correct: 6, accuracy: 50 });
    expect(report.timing).toEqual({ correctMedian: undefined, incorrectMedian: undefined });
    expect(fastMisses(records)).toBeUndefined();
    expect(JSON.stringify(records)).toBe(original);
  });

  it("does not allow one legacy status-only right answer to become the sixth comparison sample", () => {
    const records = [...right(5), ...right(1, { answerKey: undefined }), ...wrong(6)];
    const report = buildPatternReport(records);
    expect(report.totals.all.attempts).toBe(12);
    expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
    expect(fastMisses(records)).toBeUndefined();
  });

  it("does not allow one legacy status-only wrong answer to become the sixth comparison sample", () => {
    const records = [...right(6), ...wrong(5), ...wrong(1, { answerKey: undefined })];
    const report = buildPatternReport(records);
    expect(report.totals.all.attempts).toBe(12);
    expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
    expect(fastMisses(records)).toBeUndefined();
  });

  it("rejects an imported incorrect choice absent from the question's offered options", () => {
    const records = [...right(6), ...wrong(5), ...wrong(1, { answerKey: "Z" })];
    const original = JSON.stringify(records);
    expect(buildPatternReport(records).totals.all.attempts).toBe(12);
    expect(fastMisses(records)).toBeUndefined();
    expect(JSON.stringify(records)).toBe(original);
  });

  it("keeps held mappings and contradictory saved statuses out of fast-miss samples", () => {
    const held = question({ needsReview: true, attempts: [attempt(1, "incorrect", { timeSpentSeconds: 25 })] });
    const contradictory = question({ attempts: [attempt(1, "incorrect", { answerKey: "B", timeSpentSeconds: 25 })] });
    const records = [...right(6), ...wrong(4), held, contradictory];
    expect(attemptEvents([held, contradictory]).every((event) => event.correct === undefined)).toBe(true);
    expect(fastMisses(records)).toBeUndefined();
  });

  it("still recommends verified quick misses with exact retry IDs and no source mutation", () => {
    const correct = right(6);
    const incorrect = wrong(6);
    const records = [...correct, ...incorrect];
    const original = JSON.stringify(records);
    expect(fastMisses(records)).toMatchObject({
      basis: "computed", sample: 12, questionIds: incorrect.map((record) => record.id),
    });
    expect(JSON.stringify(records)).toBe(original);
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

  it("does not learn a fast correct-answer pace from six legacy status-only records", () => {
    const legacy = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: undefined, timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const later = question({ attempts: [attempt(9, "correct", {
      answerKey: "B", timeSpentSeconds: 100, quizSessionId: "later",
    })] });
    const all = [...legacy, later];
    const original = JSON.stringify(all);
    // Preserve the legacy analytics contract and its raw histories; only the
    // evidence standard for a diagnostic timing recommendation becomes stricter.
    expect(attemptEvents(legacy).every((event) => event.correct === true && event.answerKey === undefined)).toBe(true);
    expect(tally(attemptEvents(legacy))).toEqual({ attempts: 6, correct: 6, accuracy: 100 });
    expect(reviewCandidatesForSession("later", all)).toEqual([]);
    expect(JSON.stringify(all)).toBe(original);
  });

  it("does not satisfy six verified pace samples by adding one legacy status-only flag", () => {
    const matched = Array.from({ length: 5 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: "B", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const unverified = question({ attempts: [attempt(1, "correct", {
      answerKey: undefined, timeSpentSeconds: 10, quizSessionId: "earlier",
    })] });
    const later = question({ attempts: [attempt(9, "correct", {
      answerKey: "B", timeSpentSeconds: 100, quizSessionId: "later",
    })] });
    const all = [...matched, unverified, later];
    const original = JSON.stringify(all);
    expect(reviewCandidatesForSession("later", all)).toEqual([]);
    expect(JSON.stringify(all)).toBe(original);
  });

  it("does not label a legacy status-only target slow even with six valid pace samples", () => {
    const matched = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: "B", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const later = question({ attempts: [attempt(9, "correct", {
      answerKey: undefined, timeSpentSeconds: 100, quizSessionId: "later",
    })] });
    const all = [...matched, later];
    const original = JSON.stringify(all);
    expect(reviewCandidatesForSession("later", all)).toEqual([]);
    expect(JSON.stringify(all)).toBe(original);
  });

  it("does not establish a paced-correct baseline from six historically correct flags on withdrawn keys", () => {
    const held = Array.from({ length: 6 }, () => question({
      needsReview: true,
      attempts: [attempt(1, "correct", { timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const later = question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 100, quizSessionId: "later" })] });
    const originals = JSON.stringify([...held, later]);
    const historic = attemptEvents(held);
    expect(historic.filter((event) => event.correct === true)).toHaveLength(0);
    expect(reviewCandidatesForSession("later", [...held, later])).toEqual([]);
    expect(JSON.stringify([...held, later])).toBe(originals);
  });

  it("does not establish paced-correct baseline from six saved correct flags contradicting a reviewed key", () => {
    const contradicted = Array.from({ length: 6 }, () => question({
      correctKey: "B",
      attempts: [attempt(1, "correct", { answerKey: "A", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const later = question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 100, quizSessionId: "later" })] });
    const originals = JSON.stringify([...contradicted, later]);
    expect(attemptEvents(contradicted).filter((event) => event.correct === true)).toHaveLength(0);
    expect(reviewCandidatesForSession("later", [...contradicted, later])).toEqual([]);
    expect(JSON.stringify([...contradicted, later])).toBe(originals);
  });

  it.each([
    ["nonfinite Infinity", Number.POSITIVE_INFINITY],
    ["nonfinite NaN", Number.NaN],
    ["numeric string", "100"],
    ["zero", 0],
    ["negative", -30],
  ])("does not recommend slow-right from %s as a recorded target duration", (_description, seconds) => {
    const trusted = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: "B", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    // Simulate malformed imported legacy data at the runtime boundary. Do not
    // normalize an invalid duration into trusted evidence or mutate attempts.
    const target = question({ attempts: [attempt(9, "correct", {
      answerKey: "B", timeSpentSeconds: seconds as number, quizSessionId: "later",
    })] });
    const source = [...trusted, target];
    const originalAttempts = source.map((record) => [...record.attempts]);
    const current = attemptEvents(source);
    expect(current.filter((event) => event.correct === true)).toHaveLength(7);
    expect(reviewCandidatesForSession("later", source)).toEqual([]);
    expect(source.map((record) => record.attempts)).toEqual(originalAttempts);
  });

  it("keeps slow-right advice for valid finite slow timings, but not normal pace", () => {
    const trusted = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: "B", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const slow = question({ attempts: [attempt(9, "correct", {
      answerKey: "B", timeSpentSeconds: 100, quizSessionId: "slow",
    })] });
    const normal = question({ attempts: [attempt(9, "correct", {
      answerKey: "B", timeSpentSeconds: 12, quizSessionId: "normal",
    })] });
    expect(reviewCandidatesForSession("slow", [...trusted, slow])).toEqual([
      expect.objectContaining({ questionId: slow.id, reasons: ["slow-right"] }),
    ]);
    expect(reviewCandidatesForSession("normal", [...trusted, normal])).toEqual([]);
  });

  it("keeps six actually reviewed, matching correct timings sufficient for a slow-right observation", () => {
    const trusted = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { answerKey: "B", timeSpentSeconds: 10, quizSessionId: "earlier" })],
    }));
    const later = question({ attempts: [attempt(9, "correct", { answerKey: "B", timeSpentSeconds: 100, quizSessionId: "later" })] });
    expect(reviewCandidatesForSession("later", [...trusted, later])).toEqual([
      expect.objectContaining({ questionId: later.id, reasons: ["slow-right"], retry: ["this-week"] }),
    ]);
  });

  it("does not infer slow-right from five unscored timed attempts and one trusted correct pace", () => {
    const baseline = question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 10 })] });
    const held = Array.from({ length: 5 }, () => question({
      attempts: [attempt(2, "needs-review", { answerKey: "A", timeSpentSeconds: 7 })],
    }));
    const slow = question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 100 })] });
    const source = [...held, baseline, slow];
    const original = JSON.stringify(source);
    const block = attemptEvents([slow]);
    const history = attemptEvents([...held, baseline]);
    expect(history.filter((event) => event.correct === true)).toHaveLength(1);
    expect(history.filter((event) => event.seconds)).toHaveLength(6);
    expect(reviewCandidates(block, history)).toEqual([]);
    expect(JSON.stringify(source)).toBe(original);
  });

  it("does not use timed incorrect attempts to satisfy the correct-pace minimum", () => {
    const baseline = question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 10 })] });
    const misses = Array.from({ length: 5 }, () => question({
      attempts: [attempt(2, "incorrect", { timeSpentSeconds: 7 })],
    }));
    const slow = question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 100 })] });
    expect(reviewCandidates(attemptEvents([slow]), attemptEvents([baseline, ...misses]))).toEqual([]);
  });

  it("still identifies slow-right when six scored correct timed baselines support the median", () => {
    const baseline = Array.from({ length: 6 }, () => question({
      attempts: [attempt(1, "correct", { timeSpentSeconds: 10 })],
    }));
    const slow = question({ attempts: [attempt(9, "correct", { timeSpentSeconds: 100 })] });
    expect(reviewCandidates(attemptEvents([slow]), attemptEvents(baseline))).toEqual([
      expect.objectContaining({ questionId: slow.id, reasons: ["slow-right"], retry: ["this-week"] }),
    ]);
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

  it("keeps an older block's miss reason and retry stable after a later block", () => {
    const recorded = question({ attempts: [
      attempt(16, "incorrect", { quizSessionId: "older" }),
      attempt(18, "incorrect", { quizSessionId: "later" }),
    ] });
    expect(reviewCandidatesForSession("older", [recorded])).toEqual([
      expect.objectContaining({ questionId: recorded.id, reasons: ["wrong"], retry: ["tomorrow"] }),
    ]);
    expect(reviewCandidatesForSession("later", [recorded])).toEqual([
      expect.objectContaining({ questionId: recorded.id, reasons: ["repeat-miss"], retry: ["today", "this-week"] }),
    ]);
  });

  it("never turns an older right answer into slow-right using future timed answers", () => {
    const older = question({ attempts: [attempt(16, "correct", { quizSessionId: "older", timeSpentSeconds: 60 })] });
    const later = Array.from({ length: 6 }, () => question({
      attempts: [attempt(18, "correct", { quizSessionId: "later", timeSpentSeconds: 10 })],
    }));
    expect(reviewCandidatesForSession("older", [older])).toEqual([]);
    expect(reviewCandidatesForSession("older", [older, ...later])).toEqual([]);
  });

  it("ignores another session's equal timestamp rather than counting it as earlier pace", () => {
    const at = "2026-07-16T09:00:00.000Z";
    const older = question({ attempts: [attempt(16, "correct", { quizSessionId: "older", timeSpentSeconds: 60 })] });
    const sameTime = Array.from({ length: 6 }, () => question({
      attempts: [attempt(16, "correct", { at, quizSessionId: "simultaneous", timeSpentSeconds: 10 })],
    }));
    expect(reviewCandidatesForSession("older", [older, ...sameTime])).toEqual([]);
  });

  it("fails closed on invalid session times instead of trusting incomparable history", () => {
    const recorded = question({ attempts: [
      attempt(10, "incorrect", { quizSessionId: "prior" }),
      attempt(16, "incorrect", { at: "not-a-timestamp", quizSessionId: "invalid" }),
    ] });
    expect(reviewCandidatesForSession("invalid", [recorded])).toEqual([
      expect.objectContaining({ questionId: recorded.id, reasons: ["wrong"], retry: ["tomorrow"] }),
    ]);
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


describe("session review cannot assign retry identity to duplicated canonical question IDs", () => {
  const first = () => question({
    id: "ambiguous-session-id",
    status: "incorrect",
    attempts: [attempt(1, "incorrect", { quizSessionId: "earlier" })],
  });
  const second = () => question({
    id: "ambiguous-session-id",
    status: "incorrect",
    attempts: [attempt(3, "incorrect", { quizSessionId: "later" })],
  });

  it("does not call two source rows with separate first misses a repeat miss, in either order", () => {
    for (const records of [[first(), second()], [second(), first()]]) {
      const original = JSON.stringify(records);
      expect(tally(attemptEvents(records))).toEqual({ attempts: 2, correct: 0, accuracy: 0 });
      expect(reviewCandidatesForSession("earlier", records)).toEqual([]);
      expect(reviewCandidatesForSession("later", records)).toEqual([]);
      expect(JSON.stringify(records)).toBe(original);
    }
  });

  it("quarantines an answered row when another source row uses its ID, even if the alias is held", () => {
    const scored = question({
      id: "held-session-alias",
      status: "incorrect",
      attempts: [attempt(3, "incorrect", { quizSessionId: "later", certainty: "sure" })],
    });
    const alias = question({ id: scored.id, needsReview: true, attempts: [] });
    for (const records of [[scored, alias], [alias, scored]]) {
      expect(tally(attemptEvents(records))).toEqual({ attempts: 1, correct: 0, accuracy: 0 });
      expect(reviewCandidatesForSession("later", records)).toEqual([]);
    }
  });

  it("never offers a retry for copied identical imported attempts under the same ID", () => {
    const source = first();
    const copied = question({ ...source, attempts: source.attempts.map((saved) => ({ ...saved })) });
    const records = [source, copied];
    const original = JSON.stringify(records);
    expect(tally(attemptEvents(records)).attempts).toBe(2);
    expect(reviewCandidatesForSession("earlier", records)).toEqual([]);
    expect(JSON.stringify(records)).toBe(original);
  });

  it("retains real repeat-miss and ordinary wrong recommendations for unique source IDs", () => {
    const unique = question({
      id: "unique-session-miss",
      status: "incorrect",
      attempts: [
        attempt(1, "incorrect", { quizSessionId: "earlier" }),
        attempt(3, "incorrect", { quizSessionId: "later" }),
      ],
    });
    const once = question({
      id: "unique-session-once",
      status: "incorrect",
      attempts: [attempt(3, "incorrect", { quizSessionId: "later" })],
    });
    const records = [first(), second(), unique, once];
    const before = JSON.stringify(records);
    expect(reviewCandidatesForSession("later", records)).toEqual([
      expect.objectContaining({ questionId: unique.id, reasons: ["repeat-miss"], retry: ["today", "this-week"] }),
      expect.objectContaining({ questionId: once.id, reasons: ["wrong"], retry: ["tomorrow"] }),
    ]);
    expect(reviewCandidatesForSession("earlier", records)).toEqual([
      expect.objectContaining({ questionId: unique.id, reasons: ["wrong"], retry: ["tomorrow"] }),
    ]);
    expect(tally(attemptEvents(records)).attempts).toBe(5);
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe("review-set membership is unique while historical attempts remain intact", () => {
  it("includes a question only once when repeated attempts create multiple review candidates", () => {
    const candidates: Parameters<typeof buildReviewSet>[0]["candidates"] = [
      { questionId: "q-repeat", reasons: ["repeat-miss"], priority: 5, retry: ["today"] },
      { questionId: "q-repeat", reasons: ["wrong"], priority: 2, retry: ["tomorrow"] },
      { questionId: "q-other", reasons: ["wrong"], priority: 1, retry: ["tomorrow"] },
    ];
    const original = JSON.stringify(candidates);
    const result = buildReviewSet({
      id: "review-unique", candidates, reasons: ["repeat-miss", "wrong"],
      now: "2026-07-20T11:00:00.000Z",
    });
    expect(result.questionIds).toEqual(["q-repeat", "q-other"]);
    expect(JSON.stringify(candidates)).toBe(original);
  });

  it("deduplicates after reason filtering so an unselected first occurrence cannot hide a selected retry", () => {
    const result = buildReviewSet({
      id: "review-filtered",
      candidates: [
        { questionId: "q-repeat", reasons: ["slow-right"], priority: 4, retry: ["this-week"] },
        { questionId: "q-other", reasons: ["wrong"], priority: 3, retry: ["tomorrow"] },
        { questionId: "q-repeat", reasons: ["wrong"], priority: 2, retry: ["tomorrow"] },
      ],
      reasons: ["wrong"], now: "2026-07-20T11:00:00.000Z",
    });
    expect(result.questionIds).toEqual(["q-other", "q-repeat"]);
  });

  it("does not change unique-member ordering or inherited course scope", () => {
    const result = buildReviewSet({
      id: "review-scoped",
      candidates: [
        { questionId: "q-a", reasons: ["wrong"], priority: 5, retry: ["tomorrow"] },
        { questionId: "q-b", reasons: ["unsure-right"], priority: 4, retry: ["this-week"] },
        { questionId: "q-c", reasons: ["wrong"], priority: 3, retry: ["tomorrow"] },
      ],
      reasons: ["wrong", "unsure-right"],
      parent: { id: "original-set", title: "Module 3 Week 4", scope: { module: "DERS", week: 4 } },
      now: "2026-07-20T11:00:00.000Z",
    });
    expect(result).toMatchObject({
      questionIds: ["q-a", "q-b", "q-c"], parentSetId: "original-set",
      scope: { module: "DERS", week: 4 }, kind: "review",
    });
  });
});

describe("confusion-pair text requires an unambiguous question identity", () => {
  const sourceOptions = [
    { key: "A", text: "Gastrin" },
    { key: "B", text: "Secretin" },
    { key: "C", text: "Somatostatin" },
  ];
  const aliasOptions = [
    { key: "A", text: "Pepsin" },
    { key: "B", text: "Trypsin" },
    { key: "C", text: "Chymotrypsin" },
  ];
  const origin = () => question({
    id: "source-confusion-duplicate",
    options: sourceOptions,
    correctKey: "B",
    status: "incorrect",
    attempts: [
      attempt(1, "incorrect", { answerKey: "A" }),
      attempt(2, "incorrect", { answerKey: "A" }),
    ],
  });

  it("holds ambiguous duplicate-ID option text in both input orders, without rewriting scored history", () => {
    const original = origin();
    const alias = question({ id: original.id, options: aliasOptions, correctKey: "B", attempts: [] });
    for (const records of [[original, alias], [alias, original]]) {
      const before = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.totals.all).toEqual({ attempts: 2, correct: 0, accuracy: 0 });
      expect(report.confusionPairs).toEqual([]);
      expect(report.findings.filter((item) => item.kind === "confusion-pair")).toEqual([]);
      expect(JSON.stringify(records)).toBe(before);
    }
  });

  it("does not let a duplicate alias with unchanged offered text restore ambiguous confidence", () => {
    const original = origin();
    const alias = question({ id: original.id, options: sourceOptions, correctKey: "B", attempts: [] });
    expect(buildPatternReport([original, alias]).confusionPairs).toEqual([]);
  });

  it("retains precisely attributed text and retry IDs for a unique verified question", () => {
    const original = origin();
    const before = JSON.stringify(original);
    const report = buildPatternReport([original]);
    expect(report.confusionPairs).toEqual([
      { picked: "Gastrin", correct: "Secretin", count: 2, questionIds: [original.id] },
    ]);
    expect(report.findings.find((item) => item.kind === "confusion-pair")).toMatchObject({
      title: 'You chose "Gastrin" when the answer was "Secretin"',
      sample: 2,
      questionIds: [original.id],
    });
    expect(JSON.stringify(original)).toBe(before);
  });

  it("does not infer a confusion pair from withdrawn or unreviewed answer mappings", () => {
    const record = question({
      ...origin(),
      needsReview: true,
    });
    expect(buildPatternReport([record]).confusionPairs).toEqual([]);
  });
});

describe("fast-miss evidence rejects duplicate canonical question IDs", () => {
  const right = (count: number) => Array.from({ length: count }, () => question({
    attempts: [attempt(1, "correct", { timeSpentSeconds: 80 })],
  }));
  const wrong = (count: number, answerKey = "A") => Array.from({ length: count }, () => question({
    status: "incorrect",
    attempts: [attempt(1, "incorrect", { answerKey, timeSpentSeconds: 25 })],
  }));
  const alias = (record: QuestionRecord, options = record.options) => question({
    id: record.id,
    options,
    attempts: [],
  });
  const fast = (records: QuestionRecord[]) => buildPatternReport(records).findings.find((finding) => finding.kind === "fast-misses");

  it("cannot validate unoffered imported choices using later aliases sharing their IDs, in either order", () => {
    const correct = right(6);
    const invalid = wrong(6, "Z");
    const aliases = invalid.map((record) => alias(record, [...record.options, { key: "Z", text: "Not in source" }]));
    for (const records of [[...correct, ...invalid, ...aliases], [...correct, ...aliases, ...invalid]]) {
      const before = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.totals.all).toEqual({ attempts: 12, correct: 6, accuracy: 50 });
      expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: undefined });
      expect(fast(records)).toBeUndefined();
      expect(JSON.stringify(records)).toBe(before);
    }
  });

  it("does not treat an otherwise valid, duplicated wrong question ID as a sixth independent timing sample", () => {
    const correct = right(6);
    const incorrect = wrong(6);
    const duplicate = alias(incorrect[0]);
    for (const records of [[...correct, ...incorrect, duplicate], [...correct, duplicate, ...incorrect]]) {
      const report = buildPatternReport(records);
      expect(report.totals.all.attempts).toBe(12);
      expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
      expect(fast(records)).toBeUndefined();
    }
  });

  it("does not count duplicate correctly answered records toward the six-correct threshold", () => {
    const correct = right(5);
    const repeatedId = question({ attempts: [attempt(1, "correct", { timeSpentSeconds: 80 })] });
    const duplicate = question({ id: repeatedId.id, attempts: [attempt(1, "correct", { timeSpentSeconds: 80 })] });
    const incorrect = wrong(6);
    const records = [...correct, repeatedId, ...incorrect, duplicate];
    const before = JSON.stringify(records);
    const report = buildPatternReport(records);
    expect(report.totals.all).toEqual({ attempts: 13, correct: 7, accuracy: 54 });
    expect(report.timing).toEqual({ correctMedian: 80, incorrectMedian: 25 });
    expect(fast(records)).toBeUndefined();
    expect(JSON.stringify(records)).toBe(before);
  });

  it("retains the fast-miss finding and exact retry IDs for six unique, verifiable records per group", () => {
    const correct = right(6);
    const incorrect = wrong(6);
    const records = [...correct, ...incorrect];
    const before = JSON.stringify(records);
    const report = buildPatternReport(records);
    expect(report.findings.find((finding) => finding.kind === "fast-misses")).toMatchObject({
      sample: 12,
      basis: "computed",
      questionIds: incorrect.map((record) => record.id),
    });
    expect(JSON.stringify(records)).toBe(before);
  });
});


describe("duplicate-ID metadata evidence must not borrow another source row", () => {
  const wrong = (topic: string) => question({
    topic,
    stem: VIGNETTE_TREATMENT,
    status: "incorrect",
    attempts: [attempt(1, "incorrect")],
  });
  const alias = (record: QuestionRecord) => question({
    id: record.id,
    topic: "Cardiac",
    stem: "Which enzyme is deficient in classic galactosemia?",
    needsReview: true,
    attempts: [],
  });

  it("does not invent a weak Cardiac concept from six wrong Renal source rows when aliases reorder", () => {
    const renal = Array.from({ length: 6 }, () => wrong("Renal"));
    const cardiacAliases = renal.map(alias);
    for (const records of [[...renal, ...cardiacAliases], [...cardiacAliases, ...renal]]) {
      const before = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.totals.all).toEqual({ attempts: 6, correct: 0, accuracy: 0 });
      expect(report.byConcept).toEqual([]);
      expect(report.findings.filter((finding) => finding.kind === "weak-concept")).toEqual([]);
      expect(JSON.stringify(records)).toBe(before);
    }
  });

  it("does not attribute collided attempts to another record's inferred task or reasoning depth", () => {
    const source = Array.from({ length: 8 }, () => wrong("Renal"));
    const aliases = source.map(alias);
    for (const records of [[...source, ...aliases], [...aliases, ...source]]) {
      const report = buildPatternReport(records);
      expect(report.totals.all.attempts).toBe(8);
      expect(report.byTask).toEqual([]);
      expect(report.byDepth).toEqual([]);
      expect(report.findings.some((finding) => ["task-gap", "depth-gap"].includes(finding.kind))).toBe(false);
    }
  });

  it("retains observed certainty and raw scores without alias-derived topic naming", () => {
    const source = Array.from({ length: 2 }, () => question({
      topic: "Renal",
      attempts: [attempt(1, "incorrect", { certainty: "sure" })],
    }));
    const aliases = source.map(alias);
    for (const records of [[...source, ...aliases], [...aliases, ...source]]) {
      const report = buildPatternReport(records);
      const finding = report.findings.find((item) => item.kind === "sure-and-wrong");
      expect(report.sureAndWrong).toHaveLength(2);
      expect(report.totals.all.attempts).toBe(2);
      expect(finding).toMatchObject({ sample: 2, questionIds: source.map((record) => record.id) });
      expect(finding?.detail).not.toContain("Cardiac");
      expect(finding?.detail).not.toContain("Renal");
    }
  });

  it("does not infer missing figure evidence or retry IDs from collided question sources", () => {
    const source = question({ stem: "The arrow in the photograph shown below indicates which structure?" });
    const duplicate = alias(source);
    for (const records of [[source, duplicate], [duplicate, source]]) {
      const report = buildPatternReport(records);
      expect(report.findings.find((finding) => finding.kind === "figure-missing")).toBeUndefined();
    }
    expect(buildPatternReport([source]).findings.find((finding) => finding.kind === "figure-missing")).toMatchObject({
      sample: 1, questionIds: [source.id],
    });
  });

  it("preserves correctly attributed metadata and weak-concept actions for six unique ready questions", () => {
    const source = Array.from({ length: 6 }, () => wrong("Renal"));
    const before = JSON.stringify(source);
    const report = buildPatternReport(source);
    expect(report.byConcept).toEqual([expect.objectContaining({
      key: "renal", first: { attempts: 6, correct: 0, accuracy: 0 },
      questionIds: source.map((record) => record.id),
    })]);
    expect(report.findings.find((finding) => finding.kind === "weak-concept")).toMatchObject({
      title: "Renal: 0% the first time",
      sample: 6,
      questionIds: source.map((record) => record.id),
    });
    expect(report.byTask).not.toEqual([]);
    expect(report.byDepth).not.toEqual([]);
    expect(JSON.stringify(source)).toBe(before);
  });
});

describe("repeat-miss actions require an unambiguous question identity", () => {
  const missed = (id: string, day: number) => question({
    id, status: "incorrect", attempts: [attempt(day, "incorrect")],
  });
  const repeatFinding = (records: QuestionRecord[]) =>
    buildPatternReport(records).findings.find((finding) => finding.kind === "repeat-miss");

  it("does not turn two distinct single misses sharing an ID into a repeat-miss action", () => {
    const records = [missed("collision-two-rows", 1), missed("collision-two-rows", 2)];
    const before = JSON.stringify(records);
    const report = buildPatternReport(records);
    expect(report.totals.all).toEqual({ attempts: 2, correct: 0, accuracy: 0 });
    expect(report.totals.first).toEqual({ attempts: 2, correct: 0, accuracy: 0 });
    expect(report.repeatMisses).toEqual([]);
    expect(repeatFinding(records)).toBeUndefined();
    expect(JSON.stringify(records)).toBe(before);
  });

  it("never claims a repeated miss from two copies of the identical imported attempt", () => {
    const first = missed("collision-copy", 3);
    const records = [first, question({ ...first, attempts: first.attempts.map((saved) => ({ ...saved })) })];
    const report = buildPatternReport(records);
    expect(report.totals.all.attempts).toBe(2);
    expect(report.repeatMisses).toEqual([]);
    expect(repeatFinding(records)).toBeUndefined();
  });

  it("is order-independent when colliding rows have different provenance or answer readiness", () => {
    const source = missed("collision-order", 1);
    const alias = missed("collision-order", 2);
    alias.topic = "Unrelated concept";
    const held = question({ id: "collision-held", needsReview: true, attempts: [] });
    const answered = question({
      id: held.id, status: "incorrect",
      attempts: [attempt(1, "incorrect"), attempt(2, "incorrect")],
    });
    for (const records of [[source, alias], [alias, source], [answered, held], [held, answered]]) {
      const before = JSON.stringify(records);
      const report = buildPatternReport(records);
      expect(report.repeatMisses).toEqual([]);
      expect(report.findings.some((finding) => finding.kind === "repeat-miss")).toBe(false);
      expect(JSON.stringify(records)).toBe(before);
    }
  });

  it("keeps true repeated misses and retry IDs for a unique, verifiable source row", () => {
    const original = question({
      id: "unique-repeated-miss", status: "incorrect",
      attempts: [attempt(1, "incorrect"), attempt(2, "incorrect")],
    });
    const report = buildPatternReport([original]);
    expect(report.repeatMisses).toEqual([original.id]);
    expect(report.findings.find((finding) => finding.kind === "repeat-miss")).toMatchObject({
      title: "1 question missed more than once",
      sample: 2, questionIds: [original.id],
      actionLabel: "Retry 1 question",
    });
  });

  it("preserves a unique repeat-miss recommendation alongside ambiguous collided histories", () => {
    const distinct = question({
      id: "unique-repeat-alongside-collision", status: "incorrect",
      attempts: [attempt(1, "incorrect"), attempt(2, "incorrect")],
    });
    const collided = [missed("collision-mixed", 1), missed("collision-mixed", 2)];
    const records = [...collided, distinct];
    const report = buildPatternReport(records);
    expect(report.totals.all).toEqual({ attempts: 4, correct: 0, accuracy: 0 });
    expect(report.repeatMisses).toEqual([distinct.id]);
    expect(report.findings.find((finding) => finding.kind === "repeat-miss")).toMatchObject({
      sample: 2, questionIds: [distinct.id],
    });
  });
});
