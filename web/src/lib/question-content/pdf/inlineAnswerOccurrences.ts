import { parseQuestionBlocks } from "../../questionParse";
import { fingerprintParsedQuestionDraft, type SourceQuestionOccurrence } from "./inlineAnswerProposals";

interface LocatedLine { page: number; line: number; text: string }

const normalized = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, "");
const position = (line: LocatedLine): string => `${line.page}:${line.line}`;
const answerLine = /^\s*(?:(?:\d{1,3}|q\s*\d{1,3})[.)]?\s+)?answer\s*[:-]\s*([A-J])\b/i;
const secondChoice = /^\s*(?:[,(/;&+]\s*)?(?:(?:and|or)\s+)?[A-J]\b/i;
const questionStart = /^\s*(?:(?:question|q)\s*)?(\d{1,4})[.)]?\s+(.+)/i;

/**
 * Match every parsed question to one PDF opening in source order. Ambiguous
 * alignments are discarded instead of assigning a marker to a repeated stem.
 */
export function locateInlineAnswerOccurrences(pageTexts: readonly string[]): SourceQuestionOccurrence[] {
  if (!pageTexts.length) return [];
  const drafts = parseQuestionBlocks(pageTexts.join("\n\n"));
  if (!drafts.length) return [];
  const lines: LocatedLine[] = pageTexts.flatMap((pageText, pageIndex) => pageText.split(/\r?\n/)
    .map((text, lineIndex) => ({ page: pageIndex + 1, line: lineIndex + 1, text })));
  const fingerprints = drafts.map(fingerprintParsedQuestionDraft);
  if (fingerprints.some(value => !value)) return [];
  const candidates = drafts.map(draft => {
    const opening = normalized(draft.stem).slice(0, 36);
    if (opening.length < 24) return [];
    return lines.flatMap((line, index) => {
      const match = line.text.match(questionStart);
      if (match && (draft.questionNumber === undefined || Number(match[1]) === draft.questionNumber)
        && normalized(match[2]).startsWith(opening)) return [index];
      return normalized(line.text).startsWith(opening) ? [index] : [];
    });
  });
  // Count complete monotonic alignments, capped at two. A row is located only
  // when every alignment through the reachable prefix uses the same opening.
  if (!candidates[0].length) return [];
  const forward: number[][] = candidates.map(group => group.map(() => 0));
  const backward: number[][] = candidates.map(group => group.map(() => 0));
  forward[0].fill(1);
  let lastReachable = 0;
  for (let row = 1; row < candidates.length; row += 1) {
    for (let at = 0; at < candidates[row].length; at += 1) {
      let count = 0;
      for (let prior = 0; prior < candidates[row - 1].length; prior += 1) {
        if (candidates[row - 1][prior] < candidates[row][at]) count = Math.min(2, count + forward[row - 1][prior]);
      }
      forward[row][at] = count;
    }
    if (forward[row].every(value => value === 0)) break;
    lastReachable = row;
  }
  backward[lastReachable].fill(1);
  for (let row = lastReachable - 1; row >= 0; row -= 1) {
    for (let at = 0; at < candidates[row].length; at += 1) {
      let count = 0;
      for (let next = 0; next < candidates[row + 1].length; next += 1) {
        if (candidates[row][at] < candidates[row + 1][next]) count = Math.min(2, count + backward[row + 1][next]);
      }
      backward[row][at] = count;
    }
  }
  const anchors = candidates.map((group, row) => {
    if (row > lastReachable) return undefined;
    const possible = group.filter((_, at) => forward[row][at] > 0 && backward[row][at] > 0);
    return possible.length === 1 ? possible[0] : undefined;
  });
  const firstUnknown = anchors.findIndex(anchor => anchor === undefined);
  if (firstUnknown >= 0) anchors.fill(undefined, firstUnknown);
  const located = anchors.filter((anchor): anchor is number => anchor !== undefined);
  if (new Set(located.map(index => position(lines[index]))).size !== located.length) return [];

  return anchors.map((start, index) => {
    const end = index + 1 === anchors.length ? lines.length : anchors[index + 1];
    if (start === undefined) return { page: 0, line: 0, fingerprint: fingerprints[index]!, answerMarkers: [] };
    const answerMarkers = end === undefined ? [] : lines.slice(start + 1, end).flatMap(line => {
      const match = line.text.match(answerLine);
      const tail = match ? line.text.slice(match[0].length).replace(/^\s*[.)]\s*/, "") : "";
      const label = match && !secondChoice.test(tail) ? match[1].toUpperCase() : undefined;
      return label ? [{ page: line.page, line: line.line, label }] : [];
    });
    return { page: lines[start].page, line: lines[start].line, fingerprint: fingerprints[index]!, answerMarkers };
  });
}
