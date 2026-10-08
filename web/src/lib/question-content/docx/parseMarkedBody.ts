// ===========================================================================
// Turns the ordered body of a marked DOCX into package questions.
//
// This is the half that needs no Word file: it reads the neutral stream from
// `markers.ts`. Whatever it cannot place, it reports. It checks structure
// only; `validatePackage` checks what the questions say.
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
import { CHOICE_LINE, QUESTION_HEADING, looksLikeMarker, readMarker, type DocxBodyElement, type MarkerLine } from "./markers";

export const DOCX_MARKER_PARSER = "axom-docx-markers@1";

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
}

type Section = "meta" | "stem" | "choices" | "answer" | "explanation" | "source" | "flags";

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
  choiceTable?: TableBlock;
  explanation: QuestionBlock[];
  answerLines: string[];
  sourceLines: string[];
  flagLines: string[];
  assets: QuestionAsset[];
  issues: DraftIssue[];
  /** False until a section marker is seen: a bare QUESTION heading is not a question. */
  started: boolean;
}

const newDraft = (headingNumber?: number): Draft => ({
  headingNumber, meta: {}, stem: [], choices: [], explanation: [], answerLines: [], sourceLines: [], flagLines: [], assets: [], issues: [], started: false,
});

const keyValue = (line: string): [string, string] | undefined => {
  const match = /^\s*([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*?)\s*$/.exec(line);
  return match ? [match[1].toLowerCase().replace(/[\s_-]+/g, " "), match[2]] : undefined;
};

const wholeNumber = (value: string | undefined): number | undefined => (value && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined);

const nextLabel = (count: number): string => String.fromCharCode(65 + count);

/** A table in [CHOICES] whose first column runs A, B, C ... is the choices themselves. */
function asChoiceTable(rows: string[][]): TableBlock | undefined {
  if (rows.length < 3) return undefined;
  const [header, ...body] = rows;
  if (!body.every((row, index) => row[0]?.trim() === nextLabel(index))) return undefined;
  return { type: "table", headers: header.slice(1), rowKeys: body.map((row) => row[0].trim()), rows: body.map((row) => row.slice(1)) };
}

export function parseMarkedBody(elements: readonly DocxBodyElement[], defaults: MarkedBodyDefaults): MarkedBodyResult {
  const questions: PackageQuestion[] = [];
  const issues: PackageIssue[] = [];
  let draft: Draft | undefined;
  let section: Section | undefined;
  /** Set by [TABLE] or [IMAGE]: the next thing in the body must be that. */
  let awaiting: { kind: "table" | "image"; argument?: string } | undefined;
  /** Set by a marker: the next paragraph starts a block of its own. */
  let startNewText = false;

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

  const addText = (blocks: QuestionBlock[], element: Extract<DocxBodyElement, { kind: "paragraph" }>): void => {
    const last = blocks[blocks.length - 1];
    if (element.html) blocks.push({ type: "rich_text", html: element.html });
    else if (last?.type === "text" && !startNewText) last.text += `\n${element.text}`;
    else blocks.push({ type: "text", text: element.text });
    startNewText = false;
  };

  const addTable = (blocks: QuestionBlock[], rows: string[][]): void => {
    const wanted = awaiting;
    awaiting = undefined;
    if (wanted?.kind === "image") report("error", "missing_required_media", "An [IMAGE] marker is followed by a table, not a picture.", section);
    const argument = wanted?.kind === "table" ? wanted.argument : undefined;
    // [TABLE: no header] keeps every row as data; [TABLE: row headers] marks the first column as names.
    const table: TableBlock = argument === "no header" || rows.length < 2 ? { type: "table", rows } : { type: "table", headers: rows[0], rows: rows.slice(1) };
    if (argument === "row headers") table.rowHeaders = true;
    blocks.push(table);
    startNewText = true;
  };

  const addImage = (blocks: QuestionBlock[] | undefined, element: Extract<DocxBodyElement, { kind: "image" }>, sectionRole: AssetRole): void => {
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
    };
    draft.assets.push(asset);
    // An answer-marked copy is kept for review. It is never placed in the question.
    if (asset.role === "answer_reveal") return;
    if (!blocks) {
      report("warning", "media_association_uncertain", `${filename} sits where AXOM cannot tell which part of the question it belongs to.`, section);
      return;
    }
    blocks.push({ type: "image", assetId: asset.id, ...(element.alt ? { alt: element.alt } : {}) });
    startNewText = true;
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
    if (!closedByMarker) done.issues.push({ severity: "warning", code: "invalid_question", message: "The question has no [END QUESTION] line. It was closed where the next question starts, or at the end of the document." });
    if (!done.stem.length) done.issues.push({ severity: "error", code: "invalid_question", message: "The question has no [STEM].", path: "stem" });

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
      else done.issues.push({ severity: "warning", code: "unknown_flag", message: `"${line.trim()}" is not a flag AXOM knows. Write a flag as "type: what is wrong".`, path: "flags" });
    }

    const answerLine = done.answerLines.find((line) => line.trim().length > 0);
    const answer = answerLine ? /^\s*(?:answers?\s*[:-]?\s*)?([A-Z](?:\s*(?:,|&|and)\s*[A-Z])*)\s*[.)]?\s*$/i.exec(answerLine) : undefined;
    if (answerLine && !answer) {
      done.issues.push({ severity: "warning", code: "missing_answer_key", message: "The [ANSWER] section could not be read as choice letters. It was left empty, not guessed.", path: "correctAnswer" });
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
      if (!element.text.trim()) continue;
      const heading = QUESTION_HEADING.exec(element.text);
      if (heading) {
        settleAwaiting();
        open(wholeNumber(heading[1]));
        section = undefined;
        continue;
      }
      if (!draft || !section) continue; // Words outside a question are the author's own notes.
      settleAwaiting(); // Words where a table or a picture was announced: the marker is unmet.
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
      else if (section === "choices") {
        const lettered = CHOICE_LINE.exec(element.text);
        // Only the next letter in order starts a choice, so "E. coli" inside choice B stays text.
        if (lettered && lettered[1] === nextLabel(draft.choices.length) && !draft.choiceTable) {
          // The letter is taken off the formatted form too, so a subscript in a choice is not lost.
          const rich = element.html ? CHOICE_LINE.exec(element.html) : undefined;
          const first: QuestionBlock | undefined = rich?.[1] === lettered[1] && rich[2].trim()
            ? { type: "rich_text", html: rich[2] }
            : lettered[2].trim() ? { type: "text", text: lettered[2] } : undefined;
          draft.choices.push({ id: "", label: lettered[1], blocks: first ? [first] : [] });
          startNewText = false;
        } else if (draft.choices.length && !draft.choiceTable) addText(draft.choices[draft.choices.length - 1].blocks, element);
        else report("warning", "invalid_question", `"${element.text.trim()}" in [CHOICES] does not belong to a lettered choice and was not placed.`, "choices");
      } else addText(blocksOf(section)!, element);
      continue;
    }

    if (!draft || !section) continue;
    if (element.kind === "table") {
      const shared = section === "choices" && !draft.choices.length ? asChoiceTable(element.rows) : undefined;
      const blocks = blocksOf(section);
      if (shared) {
        awaiting = undefined;
        draft.choiceTable = shared;
        draft.choices = shared.rowKeys!.map((label) => ({ id: "", label, blocks: [] }));
      } else if (blocks) addTable(blocks, element.rows);
      else {
        awaiting = undefined;
        report("warning", "table_parse_uncertain", `A table in [${section.toUpperCase()}] could not be placed and was left out.`, section);
      }
      continue;
    }
    addImage(blocksOf(section), element, IMAGE_ROLE_OF[section] ?? "question");
  }
  finish(false);
  return { questions, issues };
}
