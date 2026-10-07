// ===========================================================================
// How a source asks its questions. A reusable signature of a set of questions
// (a school's quizzes, a week's practice set): what they ask for, how much
// they make you read, and how often the wording itself gives the answer away.
// Counts and shares only. It describes the questions in front of it and says
// nothing about a writer's intent.
// ===========================================================================
import type { ID } from "../types";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { median } from "./attempts";
import { ITEM_CUE_LABEL, QUESTION_TASK_LABEL, questionFeatures, type ItemCue, type QuestionTask } from "./questionFeatures";

/** Below this, shares swing too much between sets to read anything into. */
export const MIN_STYLE_SAMPLE = 20;

export interface Share {
  count: number;
  /** Whole percent of the sample. */
  percent: number;
}

export interface CueRate extends Share {
  cue: ItemCue;
  label: string;
  questionIds: ID[];
}

export interface StyleSignature {
  sampleSize: number;
  /** False while the sample is too small for the shares to be steady. */
  reliable: boolean;
  tasks: Array<Share & { task: QuestionTask; label: string }>;
  depth: Record<1 | 2 | 3, Share>;
  vignettes: Share;
  figures: Share;
  medianStemWords: number;
  /** The number of options most questions carry. */
  usualOptionCount: number;
  cues: CueRate[];
  /**
   * How often the longest option is the answer, against how often it would be
   * by chance. Only counted where a question has a trusted key.
   */
  longestOptionIsAnswer?: { percent: number; chancePercent: number; keyed: number };
}

const share = (count: number, total: number): Share => ({ count, percent: total ? Math.round((count / total) * 100) : 0 });

export function describeQuestionStyle(questions: readonly QuestionRecord[]): StyleSignature {
  const sample = questions.filter((question) => question.stem.trim().length > 0);
  const total = sample.length;
  const features = sample.map((question) => ({ question, features: questionFeatures(question) }));

  const taskCounts = new Map<QuestionTask, number>();
  const depthCounts: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  const optionCounts = new Map<number, number>();
  const cueQuestions = new Map<ItemCue, ID[]>();
  for (const entry of features) {
    taskCounts.set(entry.features.task, (taskCounts.get(entry.features.task) ?? 0) + 1);
    depthCounts[entry.features.reasoningDepth] += 1;
    if (entry.features.optionCount) optionCounts.set(entry.features.optionCount, (optionCounts.get(entry.features.optionCount) ?? 0) + 1);
    for (const cue of entry.features.cues) cueQuestions.set(cue, [...(cueQuestions.get(cue) ?? []), entry.question.id]);
  }

  // Longest option: every keyed question with three or more options counts,
  // so the rate can be set against chance.
  const keyed = sample.filter((question) => questionMappingStatus(question) === "ready" && question.options.length >= 3);
  let longestIsAnswer = 0;
  let chance = 0;
  for (const question of keyed) {
    const longest = [...question.options].sort((left, right) => right.text.length - left.text.length)[0];
    if (longest.key === question.correctKey) longestIsAnswer += 1;
    chance += 1 / question.options.length;
  }

  return {
    sampleSize: total,
    reliable: total >= MIN_STYLE_SAMPLE,
    tasks: [...taskCounts.entries()]
      .map(([task, count]) => ({ task, label: QUESTION_TASK_LABEL[task], ...share(count, total) }))
      .sort((left, right) => right.count - left.count),
    depth: { 1: share(depthCounts[1], total), 2: share(depthCounts[2], total), 3: share(depthCounts[3], total) },
    vignettes: share(features.filter((entry) => entry.features.vignette).length, total),
    figures: share(features.filter((entry) => entry.features.referencesFigure || entry.features.hasExhibit).length, total),
    medianStemWords: Math.round(median(features.map((entry) => entry.features.stemWords)) ?? 0),
    usualOptionCount: [...optionCounts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? 0,
    cues: [...cueQuestions.entries()]
      .map(([cue, ids]) => ({ cue, label: ITEM_CUE_LABEL[cue], questionIds: ids, ...share(ids.length, total) }))
      .sort((left, right) => right.count - left.count),
    longestOptionIsAnswer: keyed.length >= MIN_STYLE_SAMPLE
      ? { percent: Math.round((longestIsAnswer / keyed.length) * 100), chancePercent: Math.round((chance / keyed.length) * 100), keyed: keyed.length }
      : undefined,
  };
}

/**
 * The few things about a source worth saying out loud. Each line is a count a
 * learner can check, with what it means for how to study from that source.
 */
export function styleObservations(style: StyleSignature): string[] {
  if (!style.sampleSize) return [];
  const lines: string[] = [];
  const top = style.tasks.filter((entry) => entry.task !== "other")[0];
  if (top && top.percent >= 30) {
    lines.push(`${top.percent}% ask for ${top.label.toLowerCase()} (${top.count} of ${style.sampleSize}).`);
  }
  if (style.depth[3].percent >= 25) {
    lines.push(`${style.depth[3].percent}% describe a case and ask for something one step past the diagnosis.`);
  } else if (style.depth[1].percent >= 60) {
    lines.push(`${style.depth[1].percent}% can be answered directly, without working through a case.`);
  }
  if (style.figures.percent >= 20) {
    lines.push(`${style.figures.percent}% rest on an image, tracing or figure.`);
  }
  const negative = style.cues.find((entry) => entry.cue === "negative-stem");
  if (negative && negative.percent >= 10) {
    lines.push(`${negative.percent}% ask for the exception (EXCEPT, NOT, LEAST). Read the last line of the stem first.`);
  }
  const longest = style.longestOptionIsAnswer;
  if (longest && longest.percent >= longest.chancePercent + 15) {
    lines.push(`The longest option is the answer ${longest.percent}% of the time; chance would be ${longest.chancePercent}%. Scores from this source may flatter you, so check them against another one.`);
  }
  return lines;
}
