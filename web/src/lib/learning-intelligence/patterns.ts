// ===========================================================================
// The pattern engine. Turns recorded answers into a short list of findings a
// learner can act on. Deterministic, and honest about its footing: every
// finding says whether it was observed (it happened), computed (arithmetic on
// what happened) or inferred (a reading of the question's wording), and how
// many answers it rests on. A comparison is only made when both sides have
// enough answers; otherwise the report says what it is waiting for.
// ===========================================================================
import type { ID } from "../types";
import { ERROR_TYPE_LABEL, type QuestionErrorType, type QuestionRecord } from "../questions";
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
  // Attempt events retain their canonical question ID, not an origin-row
  // pointer. Aliases can disagree on both offered choices and their text.
  // Hold collided IDs from any inference that resolves option text or timing
  // via the last-write-wins byId index. Preserve raw attempt history/totals.
  const duplicateIds = new Set<ID>();
  const seenIds = new Set<ID>();
  for (const question of questions) {
    if (seenIds.has(question.id)) duplicateIds.add(question.id);
    else seenIds.add(question.id);
  }
  const features = new Map<ID, QuestionFeatures>();
  const featuresOf = (id: ID) => {
    let value = features.get(id);
    if (!value) { value = questionFeatures(byId.get(id)!); features.set(id, value); }
    return value;
  };
  const events = attemptEvents(questions);
  const scored = events.filter((event) => event.correct !== undefined);
  // Attempt events only store a question ID, not the specific imported row.
  // Never infer its topic, task, depth or figure cue through a collided ID:
  // byId could resolve to an unrelated, last-written alias. Raw historical
  // scores and direct attempt-based observations remain untouched.
  const metadataScored = scored.filter((event) => !duplicateIds.has(event.questionId));
  const first = scored.filter((event) => event.exposure === 1);
  const repeat = scored.filter((event) => event.exposure > 1);

  const byTask = group(metadataScored, (event) => {
    const task = featuresOf(event.questionId).task;
    return task === "other" ? undefined : { key: task, label: QUESTION_TASK_LABEL[task] };
  });
  const byDepth = group(metadataScored, (event) => {
    const depth = featuresOf(event.questionId).reasoningDepth;
    return { key: String(depth), label: depth === 1 ? "Answered directly" : depth === 2 ? "One step of reasoning" : "A hidden step in between" };
  });
  const byConcept = group(metadataScored, (event) => {
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
    if (duplicateIds.has(event.questionId) || event.correct !== false || !event.answerKey || !event.correctKey) continue;
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
  // An imported ID collision cannot establish that a *single source question*
  // was missed repeatedly: exposures were counted independently per record.
  // Keep historical miss events/totals, but never recommend an ambiguous retry.
  const repeatMisses = [...missCounts.entries()].filter(([id, count]) =>
    count >= 2 && !duplicateIds.has(id)
  ).sort((left, right) => right[1] - left[1]).map(([id]) => id);

  // Retain legacy status-only results in raw scored totals, but do not
  // infer an answer-speed diagnostic without an independently checkable saved
  // choice from the currently offered options. Historical key revisions are
  // not reconstructed here; this verifies consistency with the *current* key.
  // Malformed durations likewise cannot support medians or quick-miss retries.
  const timedScored = scored.filter((event) => {
    if (duplicateIds.has(event.questionId)) return false;
    if (typeof event.seconds !== "number" || !Number.isFinite(event.seconds) || event.seconds <= 0
      || typeof event.answerKey !== "string" || typeof event.correctKey !== "string") return false;
    const offered = byId.get(event.questionId)?.options.some((option) => option.key === event.answerKey);
    return offered === true && (event.answerKey === event.correctKey) === event.correct;
  });
  const correctTimes = timedScored.filter((event) => event.correct === true).map((event) => event.seconds!);
  const incorrectTimes = timedScored.filter((event) => event.correct === false).map((event) => event.seconds!);
  const timing = { correctMedian: median(correctTimes), incorrectMedian: median(incorrectTimes) };

  const findings: Finding[] = [];
  const waitingFor: string[] = [];

  if (sureAndWrong.length > 0) {
    const ids = [...new Set(sureAndWrong.map((event) => event.questionId))];
    const concepts = new Map<string, number>();
    for (const id of ids) {
      if (duplicateIds.has(id)) continue;
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
      // The first/repeat groups are not matched by question. An easier mix of
      // repeated items can create this gap with no improvement on any item.
      // Keep the observed percentages, never claim a causal memory benefit.
      const unseenIds = [...new Set(questions
        .filter((question) => question.attempts.length === 0 && !duplicateIds.has(question.id))
        .map((question) => question.id))];
      // Without unseen items, link to real first-time misses instead of
      // offering an "unseen questions" button with zero actionable targets.
      const firstMissIds = [...new Set(first
        .filter((event) => event.correct === false && !duplicateIds.has(event.questionId))
        .map((event) => event.questionId))];
      findings.push({
        id: "first-vs-repeat",
        kind: "first-vs-repeat",
        title: `${firstTally.accuracy}% on new questions, ${repeatTally.accuracy}% on ones you have seen`,
        detail: "The observed gap compares different groups of answers and does not prove that repetition improved recall. Repeated questions may be an easier mix. Prioritize genuinely unfamiliar questions when available, or review first-time misses.",
        basis: "computed",
        sample: firstTally.attempts + repeatTally.attempts,
        weight: 60,
        questionIds: unseenIds.length ? unseenIds : firstMissIds,
        actionLabel: unseenIds.length ? "Practise unseen questions" : "Review first-time misses",
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
      questionIds: [...new Set(timedScored.filter((event) => event.correct === false && event.seconds! <= timing.incorrectMedian!).map((event) => event.questionId))],
      actionLabel: "Retry the quick misses",
    });
  }

  // Raw error classifications are useful as history, but only a currently
  // scoreable miss can support a finding about the learner's current misses.
  // In particular, held keys and repaired answer mappings must not silently
  // restore unscored attempts to a current-performance recommendation.
  const classifiedMisses = scored.filter((event) => event.correct === false && event.errorType);
  const errorCounts = new Map<QuestionErrorType, number>();
  for (const event of classifiedMisses) {
    const errorType = event.errorType!;
    errorCounts.set(errorType, (errorCounts.get(errorType) ?? 0) + 1);
  }
  const classifiedTotal = classifiedMisses.length;
  const classified = [...errorCounts.entries()]
    .map(([errorType, count]) => ({ errorType, count, share: count / classifiedTotal }))
    .sort((left, right) => right.count - left.count);
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
      questionIds: [...new Set(classifiedMisses.filter((event) => event.errorType === top.errorType).map((event) => event.questionId))],
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

  const figureMissing = questions.filter((question) =>
    !duplicateIds.has(question.id) && featuresOf(question.id).cues.includes("figure-missing"));
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
