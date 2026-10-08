// ===========================================================================
// Turns the ordered body of a marked DOCX into package questions.
//
// It reads the neutral stream from `markers.ts`, so it needs no Word file.
// Whatever it cannot place, it reports. It checks structure only;
// `validatePackage` checks what the questions say.
//
// Formatting that covers a whole answer choice is never imported and never
// used as the key: in a faculty file a bold or highlighted choice is usually
// the answer, and carrying it over would give the answer away.
// ===========================================================================
import { ASSET_ROLES, type AssetRole, type QuestionBlock, type TableBlock } from "../blocks";
import {
  QUESTION_FLAG_TYPES,
  type IssueCode,
  type IssueSeverity,
  type PackageIssue,
  type PackageQuestion,
  type QuestionAsset,
  type QuestionChoice,
  type QuestionFlag,
  type QuestionFlagType,
  type SourceMetadata,
} from "../package";
import { BANK_ID_PATTERN } from "../packageJson";
import {
  CHOICE_LINE,
  QUESTION_HEADING,
  looksLikeMarker,
  readMarker,
  type DocxBodyElement,
  type MarkerLine,
  type ParagraphEmphasis,
} from "./markers";

export const DOCX_MARKER_PARSER = "axom-docx-markers@2";

export interface MarkedBodyDefaults {
  /** The bank the questions belong to; also the stem of generated question ids. */
  bankId: string;
  /** Used when a question names no source of its own. The DOCX's own name is a fair default. */
  sourceFilename: string;
  createdAt?: string;
}

export interface MarkedBodyResult {
  questions: PackageQuestion[];
  issues: PackageIssue[];
  /** For each asset id, the picture's path inside the document. */
  assetTargets: Map<string, string>;
}

type Section = "meta" | "stem" | "choices" | "answer" | "explanation" | "source" | "flags";
type Paragraph = Extract<DocxBodyElement, { kind: "paragraph" }>;
type TableElement = Extract<DocxBodyElement, { kind: "table" }>;
type ImageElement = Extract<DocxBodyElement, { kind: "image" }>;

const SECTION_OF: Partial<Record<MarkerLine["marker"], Section>> = {
  "AXOM META": "meta",
  STEM: "stem",
  "STEM CONTINUED": "stem",
  CHOICES: "choices",
  ANSWER: "answer",
  EXPLANATION: "explanation",
  SOURCE: "source",
  FLAGS: "flags",
};

const IMAGE_ROLE_OF: Partial<Record<Section, AssetRole>> = { stem: "stem", choices: "choice", explanation: "explanation" };

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
};

/** A tick set beside a choice says which one is right. It is not part of the choice. */
const TICK = /^\s*[✓✔☑✅]\s*|\s*[✓✔☑✅]\s*$/gu;

const EMPHASIS_WORDS: Record<keyof ParagraphEmphasis, string> = {
  bold: "bold", italic: "italic", underline: "underlined", highlight: "highlighted", colour: "in colour", strike: "struck through",
};

/**
 * Whether formatting on one whole choice, and not on the others, should be
 * reported as a possible answer marking. The formatting is never imported
 * either way; this only decides whether the import preview says so.
 */
export function isPossibleAnswerMark(emphasis: ParagraphEmphasis): boolean {
  // TODO(human): decide which kinds of formatting count. Until then every
  // kind is reported, which is safe and sometimes noisy (an organism's name
  // set in italics as a whole choice is reported too).
  return Object.values(emphasis).some(Boolean);
}

interface DraftIssue {
  severity: IssueSeverity;
  code: IssueCode;
  message: string;
  path?: string;
}

interface Draft {
  headingNumber?: number;
  meta: Record<string, string>;
  stem: QuestionBlock[];
  choices: QuestionChoice[];
  /** The formatting of each choice's own line, in step with `choices`. */
  choiceEmphasis: (ParagraphEmphasis | undefined)[];
  choiceTable?: TableBlock;
  relettered: boolean;
  explanation: QuestionBlock[];
  answerLines: string[];
  sourceLines: string[];
  flagLines: string[];
  assets: QuestionAsset[];
  targets: Map<string, string>;
  issues: DraftIssue[];
  /** False until a section marker is seen: a bare QUESTION heading is not a question. */
  started: boolean;
}

const newDraft = (headingNumber?: number): Draft => ({
  headingNumber, meta: {}, stem: [], choices: [], choiceEmphasis: [], relettered: false, explanation: [],
  answerLines: [], sourceLines: [], flagLines: [], assets: [], targets: new Map(), issues: [], started: false,
});

const keyValue = (line: string): [string, string] | undefined => {
  const match = /^\s*([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*?)\s*$/.exec(line);
  return match ? [match[1].toLowerCase().replace(/[\s_-]+/g, " "), match[2]] : undefined;
};

const wholeNumber = (value: string | undefined): number | undefined => (value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined);

const nextLabel = (count: number): string => String.fromCharCode(65 + count);

const escapeHtml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const cellText = (cell: string, rich: boolean | undefined): string => (rich ? cell.replace(/<[^>]+>/g, "") : cell).trim();

function toTable(element: TableElement, argument: string | undefined): TableBlock {
  const headed = argument !== "no header" && element.rows.length >= 2;
  return {
    type: "table",
    ...(headed ? { headers: element.rows[0] } : {}),
    ...(argument === "row headers" ? { rowHeaders: true } : {}),
    ...(element.rich ? { rich: true } : {}),
    ...(element.merges?.length ? { merges: element.merges } : {}),
    rows: headed ? element.rows.slice(1) : element.rows,
  };
}

/** A table in [CHOICES] whose first column runs A, B, C ... is the choices themselves. */
function asChoiceTable(element: TableElement): TableBlock | undefined {
  if (element.rows.length < 3) return undefined;
  const [header, ...body] = element.rows;
  if (!body.every((row, index) => cellText(row[0] ?? "", element.rich).toUpperCase() === nextLabel(index))) return undefined;
  const merges = (element.merges ?? []).filter((merge) => merge.column > 0).map((merge) => ({ ...merge, column: merge.column - 1 }));
  return {
    type: "table",
    headers: header.slice(1),
    rowKeys: body.map((_, index) => nextLabel(index)),
    ...(element.rich ? { rich: true } : {}),
    ...(merges.length ? { merges } : {}),
    rows: body.map((row) => row.slice(1)),
  };
}

export function parseMarkedBody(elements: readonly DocxBodyElement[], defaults: MarkedBodyDefaults): MarkedBodyResult {
  const questions: PackageQuestion[] = [];
  const issues: PackageIssue[] = [];
  const assetTargets = new Map<string, string>();
  let draft: Draft | undefined;
  let section: Section | undefined;
  /** Set by [TABLE] or [IMAGE]: the next thing in the body must be that. */
  let awaiting: { kind: "table" | "image"; argument?: string } | undefined;
  /** Set by a marker: the next paragraph starts a block of its own. */
  let startNewText = false;
  /** True straight after an answer-marked picture, whose caption is held back with it. */
  let afterHeldImage = false;

  const report = (severity: IssueSeverity, code: IssueCode, message: string, path?: string): void => {
    if (draft) draft.issues.push({ severity, code, message, ...(path ? { path } : {}) });
    else issues.push({ severity, code, message, ...(path ? { path } : {}) });
  };

  const settleAwaiting = (): void => {
    if (!awaiting) return;
    if (awaiting.kind === "table") report("warning", "table_parse_uncertain", "A [TABLE] marker is not followed by a Word table.", section);
    else report("error", "missing_required_media", "An [IMAGE] marker is not followed by a picture.", section);
    awaiting = undefined;
  };

  const blocksOf = (target: Section): QuestionBlock[] | undefined => {
    if (!draft) return undefined;
    if (target === "stem") return draft.stem;
    if (target === "explanation") return draft.explanation;
    if (target === "choices") return draft.choices[draft.choices.length - 1]?.blocks;
    return undefined;
  };

  const addText = (blocks: QuestionBlock[], text: string, html: string | undefined): void => {
    const last = blocks[blocks.length - 1];
    if (html) blocks.push({ type: "rich_text", html });
    else if (last?.type === "text" && !startNewText) last.text += `\n${text}`;
    else blocks.push({ type: "text", text });
    startNewText = false;
  };

  /** A paragraph outside the choices, with the number or bullet Word draws before it. */
  const addParagraph = (blocks: QuestionBlock[], element: Paragraph): void => {
    const last = blocks[blocks.length - 1];
    if (element.caption) {
      if (afterHeldImage) return;
      if ((last?.type === "image" || last?.type === "table") && last.caption === undefined) {
        last.caption = element.text;
        return;
      }
    }
    const label = element.listLabel ? `${element.listLabel} ` : "";
    addText(blocks, `${label}${element.text}`, element.html ? `${escapeHtml(label)}${element.html}` : undefined);
  };

  const addTable = (blocks: QuestionBlock[], element: TableElement): void => {
    const wanted = awaiting;
    awaiting = undefined;
    if (wanted?.kind === "image") report("error", "missing_required_media", "An [IMAGE] marker is followed by a table, not a picture.", section);
    // [TABLE: no header] keeps every row as data; [TABLE: row headers] marks the first column as names.
    blocks.push(toTable(element, wanted?.kind === "table" ? wanted.argument : undefined));
    startNewText = true;
  };

  const addImage = (blocks: QuestionBlock[] | undefined, element: ImageElement, sectionRole: AssetRole): void => {
    if (!draft) return;
    const wanted = awaiting;
    awaiting = undefined;
    if (wanted?.kind === "table") report("warning", "table_parse_uncertain", "A [TABLE] marker is followed by a picture, not a Word table.", section);
    const named = wanted?.kind === "image" && wanted.argument ? wanted.argument.replace(/[\s-]+/g, "_") : undefined;
    const role = named ? ASSET_ROLES.find((entry) => entry === named) : sectionRole;
    if (!role) report("warning", "media_association_uncertain", `"${wanted?.argument}" is not an image role. The picture was kept with the role of its section.`, section);
    const filename = element.target.split("/").pop() ?? element.target;
    const extension = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!MIME_BY_EXTENSION[extension]) {
      report("warning", "media_association_uncertain", `${filename} is not a kind of picture AXOM can show (PNG, JPEG, GIF or WebP).`, section);
    }
    const previous = draft.assets[draft.assets.length - 1];
    const asset: QuestionAsset = {
      id: `img-${draft.assets.length + 1}`,
      filename,
      mimeType: MIME_BY_EXTENSION[extension] ?? "application/octet-stream",
      ...(element.width !== undefined ? { width: element.width } : {}),
      ...(element.height !== undefined ? { height: element.height } : {}),
      role: role ?? sectionRole,
      questionId: "",
      derivation: "embedded",
      ...(role === "answer_reveal" && previous && previous.role !== "answer_reveal" ? { revealOf: previous.id } : {}),
      ...(element.crop ? { crop: element.crop } : {}),
    };
    draft.assets.push(asset);
    draft.targets.set(asset.id, element.target);
    // An answer-marked copy is kept for review. It is never placed in the question.
    afterHeldImage = asset.role === "answer_reveal";
    if (afterHeldImage) return;
    if (!blocks) {
      report("warning", "media_association_uncertain", `${filename} sits where AXOM cannot tell which part of the question it belongs to.`, section);
      return;
    }
    blocks.push({ type: "image", assetId: asset.id, ...(element.alt ? { alt: element.alt } : {}) });
    startNewText = true;
  };

  /** A line of [CHOICES]: the start of the next choice, or more of the current one. */
  const addChoiceLine = (element: Paragraph): void => {
    if (!draft) return;
    if (draft.choiceTable) {
      report("warning", "invalid_question", `"${element.text.trim()}" in [CHOICES] comes after the answer table and was not placed.`, "choices");
      return;
    }
    const expected = nextLabel(draft.choices.length);
    const typed = CHOICE_LINE.exec(element.text);
    // Only the next letter in order starts a choice, so "E. coli" inside choice B stays text.
    const typedHere = typed !== null && typed[1].toUpperCase() === expected;
    const listed = !typedHere && element.listLabel !== undefined;
    if (!typedHere && !listed) {
      const current = draft.choices[draft.choices.length - 1];
      if (current) addText(current.blocks, element.text, element.html);
      else report("warning", "invalid_question", `"${element.text.trim()}" in [CHOICES] does not belong to a lettered choice and was not placed.`, "choices");
      return;
    }
    // Word numbers or bullets these choices itself. Anything but the expected letter is re-lettered in order, and said.
    if (listed && CHOICE_LINE.exec(`${element.listLabel} `)?.[1].toUpperCase() !== expected) draft.relettered = true;
    let text = typedHere ? typed[2] : element.text;
    const richTyped = typedHere && element.html ? CHOICE_LINE.exec(element.html) : undefined;
    let html = typedHere ? (richTyped?.[1].toUpperCase() === expected ? richTyped[2] : undefined) : element.html;
    const unticked = text.replace(TICK, "");
    if (unticked !== text) {
      report("warning", "possible_answer_marking", `Choice ${expected} carries a tick. It was taken out of the choice so the answer is not given away, and was not used as the key.`, `choices[${expected}]`);
      text = unticked;
      html = html?.replace(TICK, "");
    }
    draft.choices.push({ id: "", label: expected, blocks: html?.trim() ? [{ type: "rich_text", html }] : text.trim() ? [{ type: "text", text }] : [] });
    draft.choiceEmphasis.push(element.emphasis);
    startNewText = false;
  };

  const finish = (closedByMarker: boolean): void => {
    if (!draft) return;
    settleAwaiting();
    const done = draft;
    draft = undefined;
    section = undefined;
    startNewText = false;
    if (!done.started) return;
    const stated = wholeNumber(done.meta.number) ?? done.headingNumber;
    const number = stated ?? questions.length + 1;
    const id = done.meta.id || `${defaults.bankId}-q${String(number).padStart(2, "0")}`;
    const add = (severity: IssueSeverity, code: IssueCode, message: string, path?: string): void => {
      done.issues.push({ severity, code, message, ...(path ? { path } : {}) });
    };
    if (!closedByMarker) add("warning", "invalid_question", "The question has no [END QUESTION] line. It was closed where the next question starts, or at the end of the document.");
    if (!done.stem.length) add("error", "invalid_question", "The question has no [STEM].", "stem");
    if (done.relettered) add("info", "needs_review", "The choices are numbered or bulleted in the document, not lettered. AXOM lettered them A, B, C in the order they appear.", "choices");

    const marked = done.choices.flatMap((choice, index) => {
      const emphasis = done.choiceEmphasis[index];
      return emphasis && isPossibleAnswerMark(emphasis) ? [{ label: choice.label, emphasis }] : [];
    });
    // Formatting every choice shares is a style. Formatting on some of them may be the answer.
    if (marked.length > 0 && marked.length < done.choices.length) {
      const kinds = [...new Set(marked.flatMap((entry) => (Object.keys(entry.emphasis) as (keyof ParagraphEmphasis)[]).filter((key) => entry.emphasis[key]).map((key) => EMPHASIS_WORDS[key])))];
      add(
        "warning", "possible_answer_marking",
        `Choice ${marked.map((entry) => entry.label).join(", ")} ${marked.length === 1 ? "is" : "are"} formatted differently from the other choices (${kinds.join(", ")}). That may mark the answer. The formatting was not imported and was not used as the key.`,
        "choices",
      );
    }

    const renamed = new Map(done.assets.map((asset) => [asset.id, `${id}-${asset.id}`]));
    const rename = (blocks: QuestionBlock[]): QuestionBlock[] =>
      blocks.map((block) => (block.type === "image" ? { ...block, assetId: renamed.get(block.assetId) ?? block.assetId } : block));

    const source: SourceMetadata = { filename: done.meta.source || defaults.sourceFilename };
    for (const line of done.sourceLines) {
      const pair = keyValue(line);
      if (!pair) source.filename = line.trim();
      else if (pair[0] === "file") source.filename = pair[1];
      else if (pair[0] === "page" || pair[0] === "pages") {
        const [first, last] = pair[1].split(/\s*[-–]\s*/).map(wholeNumber);
        if (first !== undefined) source.page = first;
        if (last !== undefined) source.pageEnd = last;
      }
    }
    if (stated !== undefined) source.questionNumber = stated;

    const flags: QuestionFlag[] = [];
    for (const line of done.flagLines) {
      const pair = keyValue(line);
      const type = pair && QUESTION_FLAG_TYPES.find((entry) => entry === (pair[0].replace(/ /g, "_") as QuestionFlagType));
      if (pair && type) flags.push({ type, message: pair[1] });
      else add("warning", "unknown_flag", `"${line.trim()}" is not a flag AXOM knows. Write a flag as "type: what is wrong".`, "flags");
    }

    const answerLine = done.answerLines.find((line) => line.trim().length > 0);
    const answer = answerLine ? /^\s*(?:answers?\s*[:-]?\s*)?([A-Z](?:\s*(?:,|&|and)\s*[A-Z])*)\s*[.)]?\s*$/i.exec(answerLine) : undefined;
    if (answerLine && !answer) {
      add("warning", "missing_answer_key", "The [ANSWER] section could not be read as choice letters. It was left empty, not guessed.", "correctAnswer");
    }

    const term = wholeNumber(done.meta.term);
    const week = wholeNumber(done.meta.week);
    questions.push({
      id,
      ...(done.meta.course ? { course: done.meta.course } : {}),
      ...(term !== undefined ? { term } : {}),
      ...(week !== undefined ? { week } : {}),
      ...(done.meta.bank && BANK_ID_PATTERN.test(done.meta.bank) ? { bankId: done.meta.bank } : {}),
      ...(done.meta.discipline ? { discipline: done.meta.discipline } : {}),
      ...(done.meta.topic ? { topic: done.meta.topic } : {}),
      ...(done.meta.subtopic ? { subtopic: done.meta.subtopic } : {}),
      source,
      stem: rename(done.stem),
      choices: done.choices.map((choice) => ({ id: `${id}-${choice.label.toLowerCase()}`, label: choice.label, blocks: rename(choice.blocks) })),
      ...(done.choiceTable ? { choiceTable: done.choiceTable } : {}),
      ...(answer ? { correctAnswer: { labels: answer[1].toUpperCase().split(/\s*(?:,|&|AND)\s*/), evidence: "printed-key" as const } } : {}),
      ...(done.explanation.length ? { explanation: rename(done.explanation) } : {}),
      assets: done.assets.map((asset) => ({
        ...asset, id: renamed.get(asset.id)!, questionId: id,
        ...(asset.revealOf ? { revealOf: renamed.get(asset.revealOf)! } : {}),
      })),
      ...(flags.length ? { flags } : {}),
      provenance: { method: "docx-template", tool: DOCX_MARKER_PARSER, ...(defaults.createdAt ? { createdAt: defaults.createdAt } : {}) },
    });
    for (const [local, target] of done.targets) assetTargets.set(renamed.get(local)!, target);
    for (const issue of done.issues) issues.push({ ...issue, questionId: id });
  };

  const open = (headingNumber?: number): void => {
    if (draft) finish(false);
    draft = newDraft(headingNumber);
  };

  for (const element of elements) {
    if (element.kind === "paragraph") {
      const marker = readMarker(element.text);
      if (marker) {
        if (marker.marker === "END QUESTION") {
          if (draft) finish(true);
          continue;
        }
        if (marker.marker === "TABLE" || marker.marker === "IMAGE") {
          settleAwaiting();
          awaiting = { kind: marker.marker === "TABLE" ? "table" : "image", ...(marker.argument ? { argument: marker.argument } : {}) };
          startNewText = true;
          continue;
        }
        settleAwaiting();
        // [AXOM META] opens a question unless a QUESTION heading just did.
        if (!draft || (marker.marker === "AXOM META" && section !== undefined)) open();
        section = SECTION_OF[marker.marker];
        draft!.started = true;
        startNewText = true;
        continue;
      }
      if (!element.text.trim() && !element.listLabel) continue;
      const heading = QUESTION_HEADING.exec(element.text);
      if (heading && !element.listLabel) {
        settleAwaiting();
        open(wholeNumber(heading[1]));
        section = undefined;
        continue;
      }
      if (!draft || !section) continue; // Words outside a question are the author's own notes.
      settleAwaiting(); // Words where a table or a picture was announced: the marker is unmet.
      if (!element.caption) afterHeldImage = false;
      if (looksLikeMarker(element.text)) {
        report("warning", "invalid_question", `"${element.text.trim()}" looks like a marker but is not one AXOM knows. It was read as text.`, section);
      }
      if (section === "meta") {
        const pair = keyValue(element.text);
        if (pair) draft.meta[pair[0]] = pair[1];
        else report("warning", "invalid_question", `"${element.text.trim()}" in [AXOM META] is not written as "Name: value".`, "meta");
      } else if (section === "answer") draft.answerLines.push(element.text);
      else if (section === "source") draft.sourceLines.push(element.text);
      else if (section === "flags") draft.flagLines.push(element.text);
      else if (section === "choices") addChoiceLine(element);
      else addParagraph(blocksOf(section)!, element);
      continue;
    }

    if (!draft || !section) continue;
    if (element.kind === "equation") {
      settleAwaiting();
      const blocks = blocksOf(section);
      if (blocks) {
        blocks.push({ type: "equation", ...(element.latex ? { latex: element.latex } : {}), plainText: element.plainText });
        startNewText = true;
      } else if (section === "answer") draft.answerLines.push(element.plainText);
      else report("warning", "invalid_question", `An equation in [${section.toUpperCase()}] could not be placed and was left out.`, section);
      continue;
    }
    if (element.kind === "table") {
      const shared = section === "choices" && !draft.choices.length ? asChoiceTable(element) : undefined;
      const blocks = blocksOf(section);
      if (shared) {
        awaiting = undefined;
        draft.choiceTable = shared;
        draft.choices = shared.rowKeys!.map((label) => ({ id: "", label, blocks: [] }));
        draft.choiceEmphasis = draft.choices.map(() => undefined);
      } else if (blocks) addTable(blocks, element);
      else {
        awaiting = undefined;
        report("warning", "table_parse_uncertain", `A table in [${section.toUpperCase()}] could not be placed and was left out.`, section);
      }
      continue;
    }
    addImage(blocksOf(section), element, IMAGE_ROLE_OF[section] ?? "question");
  }
  finish(false);
  return { questions, issues, assetTargets };
}
