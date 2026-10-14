// Compare two versions of one academic assessment without inventing answer
// evidence. Full *question-number + stem + choices* correspondence is needed;
// filename similarity and first-page similarity alone are insufficient.
import type { ParsedQuestionDraft } from "../questionParse";

export type PairConfidence = "exact" | "similar-needs-review" | "choice-drift" | "stem-drift" | "missing-match" | "ambiguous-number";
export interface PairQuestionCorrespondence {
  number?: number;
  sourcePage?: number;
  answeredPage?: number;
  kind: PairConfidence;
  stemSimilarity?: number;
  optionsEqual?: boolean;
  keyCandidate?: string;
}
export interface PairCorrespondence {
  originalQuestions: number;
  answeredQuestions: number;
  exact: number;
  similarNeedsReview: number;
  choiceDrift: number;
  stemDrift: number;
  missingMatch: number;
  ambiguousNumber: number;
  observedAnswerCandidates: number;
  readyToAssignAnswers: 0;
  entries: PairQuestionCorrespondence[];
}
const normalized = (value: string): string => value.normalize("NFC").toLowerCase()
  .replace(/[“”‘’]/g, "'").replace(/\s+/g, " ").replace(/[^\p{L}\p{N}]+/gu, "").trim();
const labels = (q: ParsedQuestionDraft) => q.options.map(option => option.key + ":" + normalized(option.text));

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  if (a.length < 3 || b.length < 3) return 0;
  const groups = (text: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < text.length - 2; i++) {
      const key = text.slice(i,i+3);
      counts.set(key,(counts.get(key)??0)+1);
    }
    return counts;
  };
  const left = groups(a), right = groups(b);
  let shared = 0, total = 0;
  for (const n of left.values()) total += n;
  for (const n of right.values()) total += n;
  for (const [key,n] of left) shared += Math.min(n,right.get(key)??0);
  return (2*shared)/total;
}

export function compareAssessmentVersions(original: readonly ParsedQuestionDraft[], answered: readonly ParsedQuestionDraft[]): PairCorrespondence {
  const indexed = new Map<number, ParsedQuestionDraft[]>();
  const counts = new Map<number, number>();
  for (const draft of answered) if (draft.questionNumber !== undefined)
    indexed.set(draft.questionNumber,[...(indexed.get(draft.questionNumber)??[]),draft]);
  for (const draft of original) if (draft.questionNumber !== undefined)
    counts.set(draft.questionNumber,(counts.get(draft.questionNumber)??0)+1);
  const seen = new Set<number>();
  const entries: PairQuestionCorrespondence[] = [];
  for (const question of original) {
    const number = question.questionNumber;
    const candidates = number === undefined ? [] : indexed.get(number)??[];
    let kind: PairConfidence;
    let score: number | undefined;
    let optionsEqual: boolean | undefined;
    if (number === undefined || candidates.length > 1 || (counts.get(number)??0) > 1) {
      kind = "ambiguous-number";
    } else if (!candidates.length) {
      kind = "missing-match";
    } else {
      seen.add(number);
      const other = candidates[0];
      score = similarity(normalized(question.stem),normalized(other.stem));
      optionsEqual = JSON.stringify(labels(question)) === JSON.stringify(labels(other));
      if (score === 1 && optionsEqual) kind="exact";
      else if (score >= .97 && optionsEqual) kind="similar-needs-review";
      else if (score >= .97) kind="choice-drift";
      else kind="stem-drift";
    }
    entries.push({
      number,
      sourcePage: question.sourcePage,
      answeredPage: candidates.length===1 ? candidates[0].sourcePage:undefined,
      kind,
      ...(score === undefined?{}:{stemSimilarity:Number(score.toFixed(5))}),
      ...(optionsEqual === undefined?{}:{optionsEqual}),
      ...(candidates.length===1 && candidates[0].correctKey?{keyCandidate:candidates[0].correctKey}:{}),
    });
  }
  for (const draft of answered) {
    if (draft.questionNumber === undefined || !seen.has(draft.questionNumber))
      entries.push({number:draft.questionNumber, answeredPage:draft.sourcePage,
        kind:(draft.questionNumber===undefined||(indexed.get(draft.questionNumber)?.length??0)>1)?"ambiguous-number":"missing-match"});
  }
  return {
    originalQuestions: original.length,
    answeredQuestions: answered.length,
    exact:entries.filter(e=>e.kind==="exact").length,
    similarNeedsReview:entries.filter(e=>e.kind==="similar-needs-review").length,
    choiceDrift:entries.filter(e=>e.kind==="choice-drift").length,
    stemDrift:entries.filter(e=>e.kind==="stem-drift").length,
    missingMatch:entries.filter(e=>e.kind==="missing-match").length,
    ambiguousNumber:entries.filter(e=>e.kind==="ambiguous-number").length,
    observedAnswerCandidates:entries.filter(e=>e.keyCandidate !== undefined).length,
    readyToAssignAnswers:0, // Never auto-adopt even exact matches without authoritative source-key verification.
    entries,
  };
}
