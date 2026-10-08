// ===========================================================================
// One bridge from AXOM's existing text parser to block questions.
//
// The parser reads plain text. A table or a picture cannot go through it, so
// each one is swapped for a short anchor on its own line before parsing and
// swapped back afterwards, wherever the parser put that line: in the stem,
// in a choice or in the explanation. That is how an unmarked Word file, or a
// PDF, keeps its tables and pictures in place without a second importer.
//
// An answer the parser is unsure of is never carried as the key.
// ===========================================================================
import { evaluateImportDraft, type DraftEvaluationCode } from "../questionImportTrust";
import type { ParsedQuestionDraft } from "../questionParse";
import type { EquationBlock, QuestionBlock, TableBlock } from "./blocks";
import type { DocxBodyElement } from "./docx/markers";
import type { IssueCode, IssueSeverity, PackageIssue, PackageQuestion, ProvenanceMethod, QuestionAsset, QuestionFlag } from "./package";

export const TEXT_PARSER_ADAPTER = "axom-text-parser-adapter@1";

type ImageElement = Extract<DocxBodyElement, { kind: "image" }>;

export type AnchoredMedia =
  | { kind: "table"; block: TableBlock }
  | { kind: "equation"; block: EquationBlock }
  | { kind: "image"; element: ImageElement; caption?: string };

export interface AnchoredText {
  text: string;
  /** Anchor n in the text stands for `media[n]`. */
  media: AnchoredMedia[];
  /** True when sub or superscripts were flattened to plain text on the way in. */
  flattened: boolean;
}

/** Letters and digits only, so no cleaning rule in the parser has a reason to touch it. */
export const anchorToken = (index: number): string => `AXOMANCHOR${String(index).padStart(4, "0")}X`;
const ANCHOR = /AXOMANCHOR(\d{4})X/g;

/** A document body as the text the parser reads, with an anchor line for each table, picture and set-off equation. */
export function bodyToAnchoredText(elements: readonly DocxBodyElement[]): AnchoredText {
  const lines: string[] = [];
  const media: AnchoredMedia[] = [];
  let flattened = false;
  const anchor = (entry: AnchoredMedia): void => {
    lines.push(anchorToken(media.length));
    media.push(entry);
  };
  for (const [index, element] of elements.entries()) {
    if (element.kind === "paragraph") {
      const before = elements[index - 1];
      const captioned = media[media.length - 1];
      // A caption belongs to the picture or table it follows, not to the running text.
      if (element.caption && captioned && (before?.kind === "image" || before?.kind === "table")) {
        if (captioned.kind === "image") captioned.caption = element.text;
        else if (captioned.kind === "table") captioned.block.caption = element.text;
        continue;
      }
      flattened = flattened || element.html !== undefined;
      lines.push(element.listLabel && element.listKind === "ordered" ? `${element.listLabel} ${element.text}` : element.text);
    } else if (element.kind === "table") {
      const headed = element.rows.length >= 2;
      anchor({
        kind: "table",
        block: {
          type: "table",
          ...(headed ? { headers: element.rows[0] } : {}),
          ...(element.rich ? { rich: true } : {}),
          ...(element.merges?.length ? { merges: element.merges } : {}),
          rows: headed ? element.rows.slice(1) : element.rows,
        },
      });
    } else if (element.kind === "equation") {
      anchor({ kind: "equation", block: { type: "equation", ...(element.latex ? { latex: element.latex } : {}), plainText: element.plainText } });
    } else anchor({ kind: "image", element });
  }
  // A blank line between paragraphs, as AXOM's existing Word import gives the parser.
  return { text: lines.join("\n\n"), media, flattened };
}

export interface DraftConversionDefaults {
  bankId: string;
  sourceFilename: string;
  method: ProvenanceMethod;
  createdAt?: string;
}

export interface UnplacedMedia {
  media: AnchoredMedia;
  /** Why it has no question, in plain words. */
  reason: string;
}

export interface DraftConversion {
  questions: PackageQuestion[];
  issues: PackageIssue[];
  /** For each image asset id, the picture's path in its source. */
  assetTargets: Map<string, string>;
  unplaced: UnplacedMedia[];
}

/** Reasons that mean the parser's answer cannot be trusted as the key. */
const ANSWER_DOUBT: ReadonlySet<DraftEvaluationCode> = new Set<DraftEvaluationCode>([
  "correct-answer-not-option",
  "conflicting-answer-keys",
  "unrecognized-answer-key",
  "answer-mapping-needs-review",
]);

const MIME_BY_EXTENSION: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };

export function draftsToQuestions(drafts: readonly ParsedQuestionDraft[], anchored: Pick<AnchoredText, "media">, defaults: DraftConversionDefaults): DraftConversion {
  const questions: PackageQuestion[] = [];
  const issues: PackageIssue[] = [];
  const assetTargets = new Map<string, string>();
  const used = new Set<number>();
  const takenIds = new Set<string>();

  drafts.forEach((draft, position) => {
    const number = draft.questionNumber ?? position + 1;
    let id = `${defaults.bankId}-q${String(number).padStart(2, "0")}`;
    for (let copy = 2; takenIds.has(id); copy += 1) id = `${defaults.bankId}-q${String(number).padStart(2, "0")}-${copy}`;
    takenIds.add(id);
    const note = (severity: IssueSeverity, code: IssueCode, message: string, path?: string): void => {
      issues.push({ severity, code, message, questionId: id, ...(path ? { path } : {}) });
    };
    const assets: QuestionAsset[] = [];
    const flags: QuestionFlag[] = [];

    /** Text with anchors in it, back into blocks in the order the parser kept. */
    const inflate = (text: string, role: QuestionAsset["role"], path: string): QuestionBlock[] => {
      const blocks: QuestionBlock[] = [];
      let from = 0;
      const addText = (part: string): void => {
        const trimmed = part.replace(/^\s+|\s+$/g, "");
        if (trimmed) blocks.push({ type: "text", text: trimmed });
      };
      for (const match of text.matchAll(ANCHOR)) {
        addText(text.slice(from, match.index));
        from = match.index + match[0].length;
        const index = Number(match[1]);
        const entry = anchored.media[index];
        if (!entry) continue;
        if (used.has(index)) {
          note("warning", "media_association_uncertain", "A table or picture appears in more than one part of the import. It was placed the first time only.", path);
          continue;
        }
        used.add(index);
        if (entry.kind !== "image") {
          blocks.push(entry.block);
          continue;
        }
        const filename = entry.element.target.split("/").pop() ?? entry.element.target;
        const asset: QuestionAsset = {
          id: `${id}-img-${assets.length + 1}`,
          filename,
          mimeType: MIME_BY_EXTENSION[filename.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream",
          role,
          questionId: id,
          derivation: "embedded",
          ...(entry.element.crop ? { crop: entry.element.crop } : {}),
        };
        assets.push(asset);
        assetTargets.set(asset.id, entry.element.target);
        blocks.push({ type: "image", assetId: asset.id, ...(entry.element.alt ? { alt: entry.element.alt } : {}), ...(entry.caption ? { caption: entry.caption } : {}) });
      }
      addText(text.slice(from));
      return blocks;
    };

    const evaluation = evaluateImportDraft(draft as ParsedQuestionDraft);
    const doubts = evaluation.reasons.filter((reason) => ANSWER_DOUBT.has(reason.code));
    const keep = draft.correctKey !== undefined && doubts.length === 0 && !draft.needsReview;
    if (draft.correctKey !== undefined && !keep) {
      const why = doubts.length ? doubts.map((reason) => reason.message).join(" ") : "The parser asked for this question to be reviewed.";
      flags.push({ type: "answer_needs_review", message: `${why} The parser's candidate was ${draft.correctKey}. It was not saved as the key.` });
    }
    for (const reason of evaluation.reasons) {
      if (ANSWER_DOUBT.has(reason.code) || reason.code === "missing-correct-answer") continue;
      note(reason.severity === "invalid" ? "error" : "warning", reason.severity === "invalid" ? "invalid_question" : "needs_review", reason.message);
    }

    const explanation = draft.explanation ? inflate(draft.explanation, "explanation", "explanation") : [];
    for (const [key, rationale] of Object.entries(draft.choiceRationales ?? {})) {
      explanation.push({ type: "text", text: `${key}. ${rationale}` });
    }
    const page = draft.questionSourcePage ?? draft.sourcePage;
    questions.push({
      id,
      ...(draft.topic ? { topic: draft.topic } : {}),
      source: {
        filename: defaults.sourceFilename,
        ...(page !== undefined ? { page } : {}),
        ...(draft.questionNumber !== undefined ? { questionNumber: draft.questionNumber } : {}),
      },
      stem: inflate(draft.stem, "stem", "stem"),
      choices: draft.options.map((option) => ({ id: `${id}-${option.key.toLowerCase()}`, label: option.key, blocks: inflate(option.text, "choice", `choices[${option.key}]`) })),
      ...(keep ? { correctAnswer: { labels: [draft.correctKey!], evidence: "printed-key" as const } } : {}),
      ...(explanation.length ? { explanation } : {}),
      assets,
      ...(flags.length ? { flags } : {}),
      provenance: { method: defaults.method, tool: TEXT_PARSER_ADAPTER, ...(defaults.createdAt ? { createdAt: defaults.createdAt } : {}) },
    });
  });

  const unplaced: UnplacedMedia[] = anchored.media.flatMap((media, index) =>
    used.has(index) ? [] : [{ media, reason: "It sits outside every question the parser found." }]);
  if (unplaced.length) {
    issues.push({
      severity: "warning",
      code: "media_association_uncertain",
      message: `${unplaced.length} ${unplaced.length === 1 ? "table or picture" : "tables or pictures"} in the file could not be tied to a question. Each one is listed so it can be placed by hand.`,
    });
  }
  return { questions, issues, assetTargets, unplaced };
}
