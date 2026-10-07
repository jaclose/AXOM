// ===========================================================================
// Where does a file belong? Reads a path against the learner's vocabulary and
// proposes term, module, week and activity, each with the words it came from.
// It proposes; it never files anything on its own. Every candidate carries a
// confidence, and anything inferred indirectly or contradicted is left for the
// learner to confirm.
//
// Dependency-free on purpose: scripts/source-inventory.ts imports this.
// ===========================================================================
import type { CourseActivity } from "./activity.ts";
import { moduleKey, type SourceVocabulary } from "./vocabulary.ts";

export interface MappingCandidate<T> {
  value: T;
  /** 0..1. Explicit words in the name score high; anything derived scores lower. */
  confidence: number;
  /** The words this came from, in the learner's own file or folder name. */
  evidence: string;
}

export type MappingStatus = "mapped" | "needs-confirmation" | "unresolved";

export const MAPPING_STATUS_LABEL: Record<MappingStatus, string> = {
  mapped: "Mapped automatically",
  "needs-confirmation": "Needs confirmation",
  unresolved: "Unresolved",
};

export type AnswerVariant = "with-answers" | "questions-only";

export interface SourceMapping {
  term?: MappingCandidate<string>;
  module?: MappingCandidate<string>;
  /** The week as the name states it. */
  week?: MappingCandidate<number>;
  /** Last week of a range such as "Week 10_11". */
  weekEnd?: number;
  /**
   * A folder numbered after its module ("FTM1 2") is that module's second
   * part. It is often a week, but it counts from the module's start while
   * "Week 12" in a file name counts from the term's, so it is kept apart.
   */
  part?: MappingCandidate<number>;
  activity?: MappingCandidate<CourseActivity>;
  /** Quiz or IMCQ number. */
  number?: number;
  /** Lecture numbers the file says it covers. */
  lectureRefs: number[];
  topic?: string;
  variant?: AnswerVariant;
  /** The name carries a download or copy marker such as "(1)" or "copy". */
  duplicateMarker: boolean;
  /** The name points into a book or site, so it may list questions, not hold them. */
  referenceCandidate: boolean;
  /** Pieces of evidence that disagree with each other. */
  conflicts: string[];
  status: MappingStatus;
}

interface Segment {
  /** As written, for evidence. */
  raw: string;
  /** Separators as spaces, copy markers removed. */
  text: string;
  /** Copy markers and extension removed, separators kept: "Week 10_11" is a range. */
  loose: string;
  isFile: boolean;
}

// "Guide _2_.pdf" is a second download; "Quiz_2_1_.pdf" is quiz 2, so the
// underscore form only counts as a copy marker after a space.
const COPY_MARKERS = /\s*(?:\(\d+\)|\bcopy(?:\s*\d+)?\b|\s_\d+_)\s*/gi;
// An underscore is a word character, so "\b" misses "2026_Week 1".
const WEEK = /(?:^|[^a-z0-9])(?:weeks?|wks?)[\s_]*0*(\d{1,2})(?:\s*(?:and|to|[_&+-])\s*0*(\d{1,2}))?(?![0-9])/i;
const TERM = /\b(?:term\s*|t)([1-9])\b/i;

export function inferSourceMapping(relativePath: string, vocabulary: SourceVocabulary): SourceMapping {
  const parts = relativePath.split("/").map((part) => part.trim()).filter(Boolean);
  const segments: Segment[] = parts.map((raw, index) => {
    const isFile = index === parts.length - 1;
    const withoutExtension = isFile ? raw.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/\.(?:doc|pdf|pptx?)$/i, "") : raw;
    return {
      raw,
      isFile,
      text: readable(withoutExtension),
      loose: withoutExtension.replace(new RegExp(COPY_MARKERS.source, "gi"), " ").trim(),
    };
  });
  // The file name is the most specific evidence, then the nearest folder.
  const nearestFirst = [...segments].reverse();
  const conflicts: string[] = [];

  const explicitTerm = firstMatch(nearestFirst, (segment) => {
    const match = segment.text.match(TERM);
    return match ? { value: `T${match[1]}`, confidence: segment.isFile ? 0.85 : 0.9, evidence: describe(segment) } : undefined;
  });

  const module = inferModule(nearestFirst, vocabulary);
  const moduleTerm = module
    ? termKey(vocabulary.modules.find((entry) => moduleKey(entry.code) === moduleKey(module.value))?.term)
    : undefined;
  if (explicitTerm && moduleTerm && explicitTerm.value !== moduleTerm) {
    conflicts.push(`${describe(nearestFirst[0])} sits under ${explicitTerm.value}, but ${module!.value} belongs to ${moduleTerm}.`);
  }
  const term = explicitTerm ?? (moduleTerm
    ? { value: moduleTerm, confidence: 0.75, evidence: `${module!.value} belongs to ${moduleTerm}` }
    : undefined);

  const stated = firstMatch(nearestFirst, (segment) => {
    const match = segment.loose.match(WEEK);
    if (!match) return undefined;
    return {
      candidate: { value: Number(match[1]), confidence: segment.isFile ? 0.9 : 0.85, evidence: describe(segment) },
      end: match[2] ? Number(match[2]) : undefined,
    };
  });
  const part = module
    ? firstMatch(nearestFirst.filter((segment) => !segment.isFile), (segment) => {
        const entry = vocabulary.modules.find((candidate) => moduleKey(candidate.code) === moduleKey(module.value));
        for (const spelling of [module.value, ...(entry?.aliases ?? [])]) {
          const match = segment.text.match(new RegExp(`${modulePattern(spelling)}\\s+(\\d{1,2})(?:\\s*-\\s*\\d{1,2})?\\s*$`, codeFlags(spelling)));
          if (match) return { value: Number(match[1]), confidence: 0.6, evidence: describe(segment) };
        }
        return undefined;
      })
    : undefined;
  const week = stated;

  const fileSegment = segments[segments.length - 1];
  // Only the file's own name and the folder it sits in say what it is: a
  // collection folder three levels up ("PQ Qbank ...") describes the pile, not
  // the file. A module's name is taken out first, so "Pre-Midterm" is not read
  // as a midterm exam.
  const moduleSpellings = vocabulary.modules.flatMap((entry) => [entry.code, ...(entry.aliases ?? [])]);
  const activity = firstMatch(nearestFirst.slice(0, 2), (segment) => {
    let text = segment.text;
    for (const spelling of moduleSpellings) text = text.replace(new RegExp(modulePattern(spelling), `g${codeFlags(spelling)}`), " ");
    // "imcq5" names IMCQ 5.
    text = text.replace(/([a-z])(\d)/gi, "$1 $2");
    for (const entry of vocabulary.activities) {
      if (entry.patterns.some((pattern) => new RegExp(pattern, "i").test(text))) {
        return { value: entry.activity, confidence: segment.isFile ? 0.9 : 0.75, evidence: describe(segment) };
      }
    }
    return undefined;
  });

  const fileText = fileSegment?.text ?? "";
  const mapping: SourceMapping = {
    term,
    module,
    week: week?.candidate,
    weekEnd: week?.end,
    part,
    activity,
    number: quizNumber(fileText),
    lectureRefs: lectureRefs(fileText, module?.value),
    topic: topicOf(fileSegment?.raw ?? ""),
    variant: answerVariant(fileSegment?.loose.replace(/_/g, " ") ?? ""),
    duplicateMarker: parts.some((part) => new RegExp(COPY_MARKERS.source, "i").test(part)),
    referenceCandidate: vocabulary.referenceSources.some((source) => squash(fileSegment?.raw ?? "").includes(squash(source))),
    conflicts,
    status: "unresolved",
  };
  mapping.status = mappingStatus(mapping);
  return mapping;
}

/**
 * Filed without asking only when the module is named outright and something
 * says what the file is. Anything derived, contradicted, or pointing at a book
 * waits for a yes.
 */
export function mappingStatus(mapping: Omit<SourceMapping, "status">): MappingStatus {
  if (!mapping.module) return "unresolved";
  if (mapping.conflicts.length > 0 || mapping.referenceCandidate) return "needs-confirmation";
  if (mapping.module.confidence < 0.8) return "needs-confirmation";
  if (!mapping.activity && !mapping.week) return "needs-confirmation";
  return "mapped";
}

/** "Term 1", "term-1" and "T1" are one term. Mappings always carry the short form. */
export function termKey(value: string | undefined): string | undefined {
  const match = value?.match(/([1-9])/);
  return match ? `T${match[1]}` : undefined;
}

/** One line a learner can read to see why a file landed where it did. */
export function describeMapping(mapping: SourceMapping): string {
  const where = [
    mapping.term?.value,
    mapping.module?.value,
    mapping.week ? `Week ${mapping.week.value}${mapping.weekEnd ? `-${mapping.weekEnd}` : ""}` : undefined,
  ].filter(Boolean).join(" · ");
  return where || "No module found in the name";
}

function inferModule(nearestFirst: Segment[], vocabulary: SourceVocabulary): MappingCandidate<string> | undefined {
  let family: MappingCandidate<string> | undefined;
  for (const segment of nearestFirst) {
    // The full code ("FTM 1") beats a bare prefix ("FTM") that several modules share.
    for (const entry of vocabulary.modules) {
      const spellings = [entry.code, ...(entry.aliases ?? [])];
      if (spellings.some((spelling) => codeRegExp(spelling).test(segment.text))) {
        return { value: entry.code, confidence: segment.isFile ? 0.9 : 0.85, evidence: describe(segment) };
      }
    }
    // A long name off by one letter ("PreMidtern") is almost certainly a typo.
    // It is offered, not filed.
    const typo = family ? undefined : vocabulary.modules.find((entry) => (
      [entry.code, ...(entry.aliases ?? [])].some((spelling) => nearlyContains(segment.text, spelling))
    ));
    if (typo) {
      family = { value: typo.code, confidence: 0.6, evidence: `${describe(segment)} (close to "${typo.code}")` };
      continue;
    }
    if (family) continue;
    const prefixes = new Map<string, string[]>();
    for (const entry of vocabulary.modules) {
      const prefix = familyPrefix(entry.code);
      if (prefix.length < 2 || moduleKey(prefix) === moduleKey(entry.code)) continue;
      prefixes.set(prefix, [...(prefixes.get(prefix) ?? []), entry.code]);
    }
    for (const [prefix, codes] of prefixes) {
      if (!new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(prefix)}(?![A-Za-z])`, codeFlags(prefix)).test(segment.text)) continue;
      family = codes.length === 1
        ? { value: codes[0], confidence: 0.7, evidence: `${describe(segment)} (only ${codes[0]} starts with ${prefix})` }
        : { value: codes[0], confidence: 0.4, evidence: `${describe(segment)} (could be ${codes.join(" or ")})` };
      break;
    }
  }
  return family;
}

/** "FTM1" also matches "FTM 1" and "FTM-1". */
function modulePattern(code: string): string {
  return code.trim().split(/[\s-]+|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/i).filter(Boolean).map(escapeRegExp).join("[\\s-]*");
}

/** The letters a family of modules shares: "FTM" for FTM 1 and FTM 2. */
function familyPrefix(code: string): string {
  return code.trim().split(/[\s\d-]+/)[0] ?? "";
}

/**
 * Short all-capital codes ("ER", "DM") are matched as written. Ignoring case
 * would find them inside ordinary words and file a stranger's document.
 */
function codeFlags(code: string): string {
  return /^[A-Z]{1,3}(?:[\s-]*\d+)?$/.test(code.trim()) ? "" : "i";
}

function codeRegExp(spelling: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z0-9])${modulePattern(spelling)}(?![A-Za-z0-9])`, codeFlags(spelling));
}

function quizNumber(text: string): number | undefined {
  const match = text.match(/\b(?:imcq|quiz|e ?soft|exam ?soft)[\s-]*(?:quiz[\s-]*)?(?:key[\s-]*)?#?\s*0*(\d{1,2})(?!\d)/i);
  return match ? Number(match[1]) : undefined;
}

function lectureRefs(text: string, moduleCode?: string): number[] {
  const lists: string[] = [];
  const named = text.match(/\b(?:lectures?|lec|l)\s*((?:\d{1,2})(?:\s*(?:,|&|and|-)\s*\d{1,2})*)/i);
  if (named) lists.push(named[1]);
  if (moduleCode) {
    // "NCRS 13, 15 PQ": the numbers between a module and "PQ" are its lectures.
    const prefix = familyPrefix(moduleCode) || moduleCode;
    const afterModule = text.match(new RegExp(`\\b${escapeRegExp(prefix)}\\s+((?:\\d{1,2})(?:\\s*(?:,|&|and)\\s*\\d{1,2})*)\\s+pqs?\\b`, "i"));
    if (afterModule) lists.push(afterModule[1]);
  }
  const numbers = lists.flatMap((list) => list.split(/[^0-9]+/).filter(Boolean).map(Number));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function answerVariant(text: string): AnswerVariant | undefined {
  if (/\bwithout\s+answers?\b|\bquestions?\s+only\b|\bblank\b/i.test(text)) return "questions-only";
  if (/\bwith\s+answers?\b|\bw\s?answers\b|\banswers?\s+(?:and|&)\s+rationale\b|\banswer\s+key\b|\bkey\b|\brationale\b/i.test(text)) return "with-answers";
  return undefined;
}

function topicOf(rawFileName: string): string | undefined {
  const name = rawFileName.replace(/\.[a-z0-9]{2,5}$/i, "").replace(new RegExp(COPY_MARKERS.source, "gi"), " ");
  const afterDash = name.split(/\s+-\s+/).slice(1).join(" - ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return afterDash.length >= 3 ? afterDash : undefined;
}

function readable(value: string): string {
  return value
    .replace(new RegExp(COPY_MARKERS.source, "gi"), " ")
    .replace(/[_:]+/g, " ")
    // "ExamSoft" and "eSoft" read as two words to a pattern, "PQs" as one.
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function describe(segment: Segment): string {
  return `${segment.isFile ? "file" : "folder"} "${segment.raw}"`;
}

function firstMatch<T>(segments: Segment[], read: (segment: Segment) => T | undefined): T | undefined {
  for (const segment of segments) {
    const value = read(segment);
    if (value !== undefined) return value;
  }
  return undefined;
}

function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** True when some run of words in `text` is one edit away from a long spelling. */
function nearlyContains(text: string, spelling: string): boolean {
  const target = squash(spelling);
  if (target.length < 8) return false;
  const words = text.split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    let run = "";
    for (let end = start; end < words.length && run.length <= target.length + 1; end += 1) {
      run += squash(words[end]);
      if (Math.abs(run.length - target.length) <= 1 && run !== target && withinOneEdit(run, target)) return true;
    }
  }
  return false;
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue; }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (a.length < b.length) j += 1;
    else { i += 1; j += 1; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
