// ===========================================================================
// What is shown as teaching for a question, and which questions teach the
// same thing. Both are read from the questions and their sources. Neither
// says anything about the learner: which of these the learner missed is
// learning intelligence's answer, joined by question id where it is needed.
// ===========================================================================
import type { SourceDocument } from "../library";
import { questionSignature } from "../questionDuplicates";
import { questionMappingStatus, type QuestionRecord } from "../questions";
import { analysisPages, currentTeaching, questionSourcePages, questionVisualIdentity } from "./analysis";
import type { QuestionAnalysis, SourceTrace } from "./types";

export interface TeachingOption {
  key: string;
  text: string;
  whyWrong?: string;
  wouldFitIf?: string;
}

export interface TeachingView {
  /** The reviewed analysis the view is built from, when there is one. */
  analysis?: QuestionAnalysis;
  /** Whose words these are: the source's teaching, a model's reviewed reading, or the question's own explanation. */
  origin: "source" | "ai" | "question";
  concept?: string;
  /** The answer, only when the question's answer mapping is confirmed. */
  answer?: { key: string; text: string };
  rule?: string;
  explanation?: string;
  decisiveClues: string[];
  mechanism: string[];
  /** Every option except the answer, each with what is known about why it is wrong. */
  others: TeachingOption[];
  lecture?: string;
  documentId?: string;
  /** Source pages to open, in order. */
  pages: number[];
  references: SourceTrace[];
  /** True when there is nothing to teach from beyond the answer itself. */
  bare: boolean;
}

/**
 * Everything a tutor view needs for one question. With a reviewed analysis
 * that still fits, it leads; anything it does not say falls back to what the
 * question itself carries (its explanation and per-option rationales).
 */
export function teachingView(question: QuestionRecord, document?: Pick<SourceDocument, "id" | "checksum" | "pageTexts">): TeachingView {
  const analysis = currentTeaching(question, document);
  const trusted = questionMappingStatus(question) === "ready" ? question.correctKey : undefined;
  const answerOption = trusted ? question.options.find((option) => option.key === trusted) : undefined;
  const notes = new Map((analysis?.distractors ?? []).map((note) => [note.key, note]));
  const others = question.options
    .filter((option) => option.key !== trusted)
    .map((option) => {
      const note = notes.get(option.key);
      const whyWrong = note?.whyWrong ?? question.choiceRationales?.[option.key];
      return { key: option.key, text: option.text, ...(whyWrong ? { whyWrong } : {}), ...(note?.wouldFitIf ? { wouldFitIf: note.wouldFitIf } : {}) };
    });
  const explanation = analysis?.explanation ?? question.explanation?.trim() ?? undefined;
  const cited = analysis ? analysisPages(analysis) : [];
  const pages = cited.length ? cited : questionSourcePages(question);
  return {
    ...(analysis ? { analysis } : {}),
    origin: analysis?.origin ?? "question",
    concept: analysis?.concept ?? question.topic,
    ...(answerOption ? { answer: { key: answerOption.key, text: answerOption.text } } : {}),
    rule: analysis?.rule,
    explanation: explanation || undefined,
    decisiveClues: analysis?.decisiveClues ?? [],
    mechanism: analysis?.mechanism ?? [],
    others,
    lecture: analysis?.lecture,
    documentId: question.sourceDocumentId ?? analysis?.references[0]?.documentId,
    pages,
    references: analysis?.references ?? [],
    bare: !analysis?.rule && !explanation && others.every((option) => !option.whyWrong),
  };
}

/** Questions with a confirmed answer and no reviewed teaching that still fits: where a source or a model could add some. */
export function questionsWithoutTeaching(
  questions: readonly QuestionRecord[],
  documentsById: ReadonlyMap<string, Pick<SourceDocument, "id" | "checksum" | "pageTexts">> = new Map(),
): QuestionRecord[] {
  return questions.filter((question) => (
    questionMappingStatus(question) === "ready"
    && !currentTeaching(question, question.sourceDocumentId ? documentsById.get(question.sourceDocumentId) : undefined)
  ));
}

export interface ConceptGroup {
  id: string;
  concept: string;
  rule: string;
  questionIds: string[];
  analysisIds: string[];
  /** Distinct source question wording plus canonical displayed-figure identity, not source-copy count. */
  uniqueQuestions: number;
  sources: Array<{ documentId: string; uniqueQuestions: number }>;
  /** How far the grouping can be leaned on. One question is an instance, not a pattern. */
  evidence: "single-question" | "single-source" | "several-sources";
}

const fold = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("en");

/**
 * Questions that teach the same rule about the same concept, by reviewed
 * analyses that still fit. Grouping is exact on wording (case and spacing
 * aside): two rules that only resemble each other are not merged, so a group
 * never claims a recurrence the sources do not show.
 */
export function conceptGroups(
  questions: readonly QuestionRecord[],
  documentsById: ReadonlyMap<string, Pick<SourceDocument, "id" | "checksum" | "pageTexts">> = new Map(),
): ConceptGroup[] {
  const groups = new Map<string, { concept: string; rule: string; members: Array<{ question: QuestionRecord; analysis: QuestionAnalysis }> }>();
  for (const question of questions) {
    // A retained reviewed analysis is not current evidence if its scoring
    // mapping or required source-figure binding has since become unresolved.
    // Preserve the stored analysis for repair, but do not count it as a recurrence.
    if (questionMappingStatus(question) !== "ready") continue;
    const analysis = currentTeaching(question, question.sourceDocumentId ? documentsById.get(question.sourceDocumentId) : undefined);
    if (!analysis?.rule) continue;
    const key = `${fold(analysis.concept)}\u001f${fold(analysis.rule)}`;
    const group = groups.get(key) ?? { concept: analysis.concept, rule: analysis.rule, members: [] };
    group.members.push({ question, analysis });
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, group]) => {
    // Unknown per-import figure keys cannot establish a new source example.
    // Conservatively assign an unverified image to an existing confirmed
    // identity for the same wording, if any. Genuine distinct SHA-256 figures
    // remain separate; unknown-only duplicates count as a single instance.
    // A legacy import can retain verified image checksums but lose which
    // source choice contained each image. Missing placement cannot justify
    // counting another independent question when a placed example with the
    // same wording/digest/crop exists. Do not collapse two *known* different
    // A/B placements, though. Choose a stable representative independent
    // of input order so imports cannot change the aggregate count.
    const imageEvidence = new Map<QuestionRecord, { wording: string; visual: string; base: string }>();
    const placedByBase = new Map<string, string>();
    for (const { question } of group.members) {
      const wording = questionSignature(question);
      const visual = questionVisualIdentity(question);
      const base = questionVisualIdentity(question, false);
      imageEvidence.set(question, { wording, visual, base });
      if (visual !== base && visual !== "unverified-figure") {
        const key = `${wording}\u001f${base}`;
        const previous = placedByBase.get(key);
        if (previous === undefined || visual < previous) placedByBase.set(key, visual);
      }
    }
    const normalizedVisual = (question: QuestionRecord) => {
      const { wording, visual, base } = imageEvidence.get(question)!;
      return visual === base ? placedByBase.get(`${wording}\u001f${base}`) ?? visual : visual;
    };
    // An unverified figure must not become a *second* distinct question in
    // its own document simply because another document's known figure was
    // visited last. Prefer established same-source, same-wording evidence.
    // When no such source-local identity exists, use a stable global fallback.
    // Never infer a new digest or placement from unverified metadata.
    const knownByWording = new Map<string, string>();
    const knownBySource = new Map<string, string>();
    const chooseKnown = (previous: string | undefined, candidate: string): string => {
      if (previous === undefined || previous === "text-only" && candidate !== "text-only") return candidate;
      if (candidate === "text-only") return previous;
      return candidate < previous ? candidate : previous;
    };
    const sourceWordKey = (wording: string, documentId: string) => JSON.stringify([wording, documentId]);
    for (const { question } of group.members) {
      const wording = questionSignature(question);
      const visual = normalizedVisual(question);
      if (visual === "unverified-figure") continue;
      knownByWording.set(wording, chooseKnown(knownByWording.get(wording), visual));
      if (question.sourceDocumentId) {
        const sourceKey = sourceWordKey(wording, question.sourceDocumentId);
        knownBySource.set(sourceKey, chooseKnown(knownBySource.get(sourceKey), visual));
      }
    }
    const evidenceIdentity = (question: QuestionRecord) => {
      const wording = questionSignature(question);
      const visual = normalizedVisual(question);
      const local = question.sourceDocumentId
        ? knownBySource.get(sourceWordKey(wording, question.sourceDocumentId))
        : undefined;
      return `${wording}\u001f${visual === "unverified-figure" ? local ?? knownByWording.get(wording) ?? visual : visual}`;
    };
    const wordings = new Set(group.members.map(({ question }) => evidenceIdentity(question)));
    const bySource = new Map<string, Set<string>>();
    for (const { question } of group.members) {
      if (!question.sourceDocumentId) continue;
      const seen = bySource.get(question.sourceDocumentId) ?? new Set<string>();
      seen.add(evidenceIdentity(question));
      bySource.set(question.sourceDocumentId, seen);
    }
    const evidence: ConceptGroup["evidence"] = wordings.size < 2 ? "single-question" : bySource.size > 1 ? "several-sources" : "single-source";
    return {
      id: `concept-${key.length}-${[...key].reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(36)}`,
      concept: group.concept,
      rule: group.rule,
      questionIds: group.members.map(({ question }) => question.id),
      analysisIds: group.members.map(({ analysis }) => analysis.id),
      uniqueQuestions: wordings.size,
      sources: [...bySource.entries()].map(([documentId, seen]) => ({ documentId, uniqueQuestions: seen.size })),
      evidence,
    };
  }).sort((a, b) => b.uniqueQuestions - a.uniqueQuestions || a.concept.localeCompare(b.concept));
}
