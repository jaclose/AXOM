// ===========================================================================
// The pattern engine. Turns recorded answers into a short list of findings a
// learner can act on. Deterministic, and honest about its footing: every
// finding says whether it was observed (it happened), computed (arithmetic on
// what happened) or inferred (a reading of the question's wording), and how
// many answers it rests on. A comparison is only made when both sides have
// enough answers; otherwise the report says what it is waiting for.
// ===========================================================================
import type { ID } from "../types";
import { ERROR_TYPE_LABEL, errorPatterns, type QuestionRecord } from "../questions";
import { attemptEvents, median, tally, type AttemptEvent, type Tally } from "./attempts";
import { QUESTION_TASK_LABEL, questionFeatures, type QuestionFeatures } from "./questionFeatures";

export type EvidenceBasis = "observed" | "computed" | "inferred";

export const EVIDENCE_BASIS_LABEL: Record<EvidenceBasis, string> = {
  observed: "Observed",
  computed: "Computed",
  inferred: "Inferred from wording",
};

/** First-time answers a group needs before it is compared with another. */
export const MIN_GROUP_ANSWERS = 8;
/** Percentage points two groups must differ by to be worth saying. */
export const MIN_GAP_POINTS = 20;

export type FindingKind =
  | "sure-and-wrong" | "confusion-pair" | "repeat-miss" | "first-vs-repeat" | "task-gap"
  | "depth-gap" | "fast-misses" | "error-pattern" | "weak-concept" | "figure-missing";

export interface Finding {
  id: string;
  kind: FindingKind;
  title: string;
  detail: string;
  basis: EvidenceBasis;
  /** Answers (or questions, for wording findings) this rests on. */
  sample: number;
  /** Higher is shown first. */
  weight: number;
  /** What to practise, most relevant first. */
  questionIds: ID[];
  actionLabel: string;
}

export interface GroupStat {
  key: string;
  label: string;
  /** First time each question was seen: the cleanest measure of what is known. */
  first: Tally;
  all: Tally;
  questionIds: ID[];
}

export interface ConfusionPair {
  picked: string;
  correct: string;
  count: number;
  questionIds: ID[];
}

export interface PatternReport {
  totals: { questions: number; all: Tally; first: Tally; repeat: Tally };
  byTask: GroupStat[];
  byDepth: GroupStat[];
  byConcept: GroupStat[];
  byCertainty: GroupStat[];
  timing: { correctMedian?: number; incorrectMedian?: number };
  sureAndWrong: AttemptEvent[];
  confusionPairs: ConfusionPair[];
  repeatMisses: ID[];
  findings: Finding[];
  /** What cannot be said yet, and what it needs. */
  waitingFor: string[];
}

function conceptOf(question: QuestionRecord): string | undefined {
  return question.topic ?? question.taxonomy?.topic ?? question.category ?? question.system;
}

function group(
  events: readonly AttemptEvent[],
  keyOf: (event: AttemptEvent) => { key: string; label: string } | undefined,
): GroupStat[] {
  const buckets = new Map<string, { label: string; events: AttemptEvent[] }>();
  for (const event of events) {
    const id = keyOf(event);
    if (!id) continue;
    const bucket = buckets.get(id.key) ?? { label: id.label, events: [] };
    bucket.events.push(event);
    buckets.set(id.key, bucket);
  }
  return [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    first: tally(bucket.events.filter((event) => event.exposure === 1)),
    all: tally(bucket.events),
    questionIds: [...new Set(bucket.events.map((event) => event.questionId))],
  })).sort((left, right) => right.all.attempts - left.all.attempts);
}

/** Missed questions first, so "practise these" starts where it hurts. */
function missedFirst(ids: readonly ID[], byId: ReadonlyMap<ID, QuestionRecord>): ID[] {
  return [...ids].sort((left, right) => (
    Number(byId.get(right)?.status === "incorrect") - Number(byId.get(left)?.status === "incorrect")
  ));
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function buildPatternReport(questions: readonly QuestionRecord[]): PatternReport {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const features = new Map<ID, QuestionFeatures>();
  const featuresOf = (id: ID) => {
    let value = features.get(id);
    if (!value) { value = questionFeatures(byId.get(id)!); features.set(id, value); }
    return value;
  };
  const events = attemptEvents(questions);
  const scored = events.filter((event) => event.correct !== undefined);
  const first = scored.filter((event) => event.exposure === 1);
  const repeat = scored.filter((event) => event.exposure > 1);

  const byTask = group(scored, (event) => {
    const task = featuresOf(event.questionId).task;
    return task === "other" ? undefined : { key: task, label: QUESTION_TASK_LABEL[task] };
  });
  const byDepth = group(scored, (event) => {
    const depth = featuresOf(event.questionId).reasoningDepth;
    return { key: String(depth), label: depth === 1 ? "Answered directly" : depth === 2 ? "One step of reasoning" : "A hidden step in between" };
  });
  const byConcept = group(scored, (event) => {
    const concept = conceptOf(byId.get(event.questionId)!);
    return concept ? { key: concept.toLowerCase(), label: concept } : undefined;
  });
  const byCertainty = group(scored, (event) => (
    event.certainty ? { key: event.certainty, label: event.certainty === "sure" ? "Sure" : event.certainty === "unsure" ? "Not sure" : "Guessing" } : undefined
  ));

  // --- observed -------------------------------------------------------------
  const sureAndWrong = scored.filter((event) => event.certainty === "sure" && event.correct === false);

  const pairs = new Map<string, ConfusionPair>();
  for (const event of scored) {
    if (event.correct !== false || !event.answerKey || !event.correctKey) continue;
    const question = byId.get(event.questionId)!;
    const picked = question.options.find((option) => option.key === event.answerKey)?.text.trim();
    const correct = question.options.find((option) => option.key === event.correctKey)?.text.trim();
    if (!picked || !correct) continue;
    const key = `${picked.toLowerCase()}\u001f${correct.toLowerCase()}`;
    const pair = pairs.get(key) ?? { picked, correct, count: 0, questionIds: [] };
    pair.count += 1;
    if (!pair.questionIds.includes(event.questionId)) pair.questionIds.push(event.questionId);
    pairs.set(key, pair);
  }
  const confusionPairs = [...pairs.values()].filter((pair) => pair.count >= 2).sort((left, right) => right.count - left.count);

  const missCounts = new Map<ID, number>();
  for (const event of scored) if (event.correct === false) missCounts.set(event.questionId, (missCounts.get(event.questionId) ?? 0) + 1);
  const repeatMisses = [...missCounts.entries()].filter(([, count]) => count >= 2).sort((left, right) => right[1] - left[1]).map(([id]) => id);

  const correctTimes = scored.filter((event) => event.correct && event.seconds).map((event) => event.seconds!);
  const incorrectTimes = scored.filter((event) => event.correct === false && event.seconds).map((event) => event.seconds!);
  const timing = { correctMedian: median(correctTimes), incorrectMedian: median(incorrectTimes) };

  const findings: Finding[] = [];
  const waitingFor: string[] = [];

  if (sureAndWrong.length > 0) {
    const ids = [...new Set(sureAndWrong.map((event) => event.questionId))];
    const concepts = new Map<string, number>();
    for (const id of ids) {
      const concept = conceptOf(byId.get(id)!);
      if (concept) concepts.set(concept, (concepts.get(concept) ?? 0) + 1);
    }
    const [topConcept, topCount] = [...concepts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];
    findings.push({
      id: "sure-and-wrong",
      kind: "sure-and-wrong",
      title: `${plural(sureAndWrong.length, "answer")} you were sure of ${sureAndWrong.length === 1 ? "was" : "were"} wrong`,
      detail: topConcept && topCount! >= 2
        ? `${topCount} of them are ${topConcept}. Being sure and wrong usually means a belief to correct, not a gap to fill. Check each against the explanation, then meet it again in about a week: corrected errors of this kind tend to come back.`
        : "Being sure and wrong usually means a belief to correct, not a gap to fill. Check each against the explanation, then meet it again in about a week: corrected errors of this kind tend to come back.",
      basis: "observed",
      sample: sureAndWrong.length,
      weight: 100 + sureAndWrong.length * 5,
      questionIds: ids,
      actionLabel: `Review ${plural(ids.length, "question")}`,
    });
  }

  for (const pair of confusionPairs.slice(0, 3)) {
    findings.push({
      id: `confusion-${pair.picked.toLowerCase()}-${pair.correct.toLowerCase()}`,
      kind: "confusion-pair",
      title: `You chose "${pair.picked}" when the answer was "${pair.correct}"`,
      detail: `This happened ${pair.count} times${pair.questionIds.length > 1 ? ` across ${pair.questionIds.length} questions` : ""}. Work out the one feature that separates the two before the next block.`,
      basis: "observed",
      sample: pair.count,
      // Capped so that being sure and wrong, when it happens, always leads.
      weight: 80 + Math.min(pair.count, 3) * 5,
      questionIds: pair.questionIds,
      actionLabel: `Retry ${plural(pair.questionIds.length, "question")}`,
    });
  }

  if (repeatMisses.length > 0) {
    findings.push({
      id: "repeat-miss",
      kind: "repeat-miss",
      title: `${plural(repeatMisses.length, "question")} missed more than once`,
      detail: "Seeing the explanation has not been enough for these. Write the rule each one turns on in your own words before retrying.",
      basis: "observed",
      sample: repeatMisses.reduce((total, id) => total + (missCounts.get(id) ?? 0), 0),
      weight: 70 + repeatMisses.length,
      questionIds: repeatMisses,
      actionLabel: `Retry ${plural(repeatMisses.length, "question")}`,
    });
  }

  // --- computed -------------------------------------------------------------
  const firstTally = tally(first);
  const repeatTally = tally(repeat);
  if (firstTally.attempts >= MIN_GROUP_ANSWERS && repeatTally.attempts >= MIN_GROUP_ANSWERS) {
    if (repeatTally.accuracy! - firstTally.accuracy! >= 15) {
      findings.push({
        id: "first-vs-repeat",
        kind: "first-vs-repeat",
        title: `${firstTally.accuracy}% on new questions, ${repeatTally.accuracy}% on ones you have seen`,
        detail: "The gap is what remembering the question adds. Your score on questions you have not seen is the one an exam will measure, so weight new questions over repeats.",
        basis: "computed",
        sample: firstTally.attempts + repeatTally.attempts,
        weight: 60,
        questionIds: questions.filter((question) => question.attempts.length === 0).map((question) => question.id),
        actionLabel: "Practise unseen questions",
      });
    }
  } else if (scored.length > 0) {
    waitingFor.push(`New against repeated questions: needs ${MIN_GROUP_ANSWERS} answers of each (${firstTally.attempts} new, ${repeatTally.attempts} repeated so far).`);
  }

  if (timing.correctMedian && timing.incorrectMedian && correctTimes.length >= 6 && incorrectTimes.length >= 6
    && timing.incorrectMedian <= timing.correctMedian * 0.6) {
    findings.push({
      id: "fast-misses",
      kind: "fast-misses",
      title: "Your misses are quick",
      detail: `Half your wrong answers took ${Math.round(timing.incorrectMedian)} seconds or less, against ${Math.round(timing.correctMedian)} for right ones. That pattern fits settling on an answer before finishing the stem.`,
      basis: "computed",
      sample: correctTimes.length + incorrectTimes.length,
      weight: 45,
      questionIds: [...new Set(scored.filter((event) => event.correct === false && event.seconds && event.seconds <= timing.incorrectMedian!).map((event) => event.questionId))],
      actionLabel: "Retry the quick misses",
    });
  }

  const classified = errorPatterns(questions as QuestionRecord[]);
  const classifiedTotal = classified.reduce((total, pattern) => total + pattern.count, 0);
  if (classified[0] && classifiedTotal >= 5 && classified[0].share >= 0.4) {
    const top = classified[0];
    findings.push({
      id: `error-${top.errorType}`,
      kind: "error-pattern",
      title: `${Math.round(top.share * 100)}% of the misses you explained: ${ERROR_TYPE_LABEL[top.errorType].toLowerCase()}`,
      detail: `${top.count} of ${classifiedTotal}. This is your own reading of why, and it points at a habit more than a topic.`,
      basis: "observed",
      sample: classifiedTotal,
      weight: 40,
      questionIds: questions.filter((question) => question.attempts.some((attempt) => attempt.errorType === top.errorType)).map((question) => question.id),
      actionLabel: "Retry these",
    });
  }

  const weak = byConcept
    .filter((stat) => stat.first.attempts >= 6 && stat.first.accuracy! <= 50)
    .sort((left, right) => left.first.accuracy! - right.first.accuracy!)[0];
  if (weak) {
    findings.push({
      id: `weak-${weak.key}`,
      kind: "weak-concept",
      title: `${weak.label}: ${weak.first.accuracy}% the first time`,
      detail: `${weak.first.correct} of ${weak.first.attempts} first-time answers were right. This is the topic to study before more questions on it.`,
      basis: "computed",
      sample: weak.first.attempts,
      weight: 35,
      questionIds: missedFirst(weak.questionIds, byId),
      actionLabel: `Practise ${weak.label}`,
    });
  }

  // --- inferred from wording ---------------------------------------------------
  const comparable = (stats: GroupStat[]) => stats.filter((stat) => stat.first.attempts >= MIN_GROUP_ANSWERS);
  const tasks = comparable(byTask).sort((left, right) => right.first.accuracy! - left.first.accuracy!);
  if (tasks.length >= 2) {
    const best = tasks[0];
    const worst = tasks[tasks.length - 1];
    if (best.first.accuracy! - worst.first.accuracy! >= MIN_GAP_POINTS) {
      findings.push({
        id: `task-${worst.key}`,
        kind: "task-gap",
        title: `${best.label}: ${best.first.accuracy}%. ${worst.label}: ${worst.first.accuracy}%`,
        detail: `First-time answers, ${best.first.attempts} and ${worst.first.attempts}. You know the material that ${best.label.toLowerCase()} questions ask for, and lose marks when the question asks for ${worst.label.toLowerCase()}. AXOM reads the question type from its wording.`,
        basis: "inferred",
        sample: best.first.attempts + worst.first.attempts,
        weight: 55,
        questionIds: missedFirst(worst.questionIds, byId),
        actionLabel: `Practise ${worst.label.toLowerCase()} questions`,
      });
    }
  } else if (scored.length > 0) {
    waitingFor.push(`Question types: needs ${MIN_GROUP_ANSWERS} first-time answers in at least two types.`);
  }

  const direct = byDepth.find((stat) => stat.key === "1");
  const hidden = byDepth.find((stat) => stat.key === "3");
  if (direct && hidden && direct.first.attempts >= MIN_GROUP_ANSWERS && hidden.first.attempts >= MIN_GROUP_ANSWERS
    && direct.first.accuracy! - hidden.first.accuracy! >= MIN_GAP_POINTS) {
    findings.push({
      id: "depth-gap",
      kind: "depth-gap",
      title: `${direct.first.accuracy}% when asked directly, ${hidden.first.accuracy}% when a step is left unstated`,
      detail: "These are cases that describe a patient and ask for the drug, mechanism or change, so the diagnosis has to be made on the way. Say that middle step out loud before reading the options.",
      basis: "inferred",
      sample: direct.first.attempts + hidden.first.attempts,
      weight: 50,
      questionIds: missedFirst(hidden.questionIds, byId),
      actionLabel: "Practise multi-step questions",
    });
  }

  const figureMissing = questions.filter((question) => featuresOf(question.id).cues.includes("figure-missing"));
  if (figureMissing.length > 0) {
    findings.push({
      id: "figure-missing",
      kind: "figure-missing",
      title: `${plural(figureMissing.length, "question")} point${figureMissing.length === 1 ? "s" : ""} to a figure that is not attached`,
      detail: "The stem mentions an image, tracing or figure, but none came in with the question. Answers to these say little until the image is added from the source.",
      basis: "inferred",
      sample: figureMissing.length,
      weight: 30,
      questionIds: figureMissing.map((question) => question.id),
      actionLabel: "See these questions",
    });
  }

  const marked = byCertainty.reduce((total, stat) => total + stat.all.attempts, 0);
  if (scored.length > 0 && marked < 10) {
    waitingFor.push(`How sure you were: mark it on ${10 - marked} more answer${10 - marked === 1 ? "" : "s"} to see whether "sure" means right.`);
  }

  return {
    totals: {
      questions: new Set(scored.map((event) => event.questionId)).size,
      all: tally(scored),
      first: firstTally,
      repeat: repeatTally,
    },
    byTask,
    byDepth,
    byConcept,
    byCertainty,
    timing,
    sureAndWrong,
    confusionPairs,
    repeatMisses,
    findings: findings.sort((left, right) => right.weight - left.weight),
    waitingFor,
  };
}
