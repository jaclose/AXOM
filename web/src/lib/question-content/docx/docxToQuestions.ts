// ===========================================================================
// A .docx file in, package questions and their picture files out.
//
// A document written with the AXOM markers is read by its markers. Any other
// document is read by AXOM's own text parser, with its tables and pictures
// carried through as anchors, so both kinds end in the same package.
// ===========================================================================
import { parseQuestionBlocks } from "../../questionParse";
import { describeAssets, SHOWABLE_IMAGE_TYPES } from "../assets";
import { bodyToAnchoredText, draftsToQuestions, type UnplacedMedia } from "../fromDrafts";
import type { PackageIssue, PackageQuestion } from "../package";
import { readMarker } from "./markers";
import { parseMarkedBody } from "./parseMarkedBody";
import { readDocxBody } from "./readDocxBody";
import type { ZipOptions } from "./zip";

export interface DocxConversionDefaults {
  bankId: string;
  sourceFilename: string;
  createdAt?: string;
}

export interface ConvertedQuestions {
  questions: PackageQuestion[];
  /** Picture files by the name the questions' assets use. */
  files: Map<string, Uint8Array>;
  issues: PackageIssue[];
  /** Whether the questions were found by the template's markers or by AXOM's text parser. */
  readBy: "markers" | "text-parser" | "nothing";
  /** Tables and pictures that belong to no question, for placing by hand. */
  unplaced: UnplacedMedia[];
}

export async function docxToQuestions(input: ArrayBuffer | Uint8Array, defaults: DocxConversionDefaults, options: ZipOptions = {}): Promise<ConvertedQuestions> {
  const body = await readDocxBody(input, options);
  if (body.issues.some((issue) => issue.code === "invalid_document")) {
    return { questions: [], files: new Map(), issues: body.issues, readBy: "nothing", unplaced: [] };
  }
  const marked = body.elements.some((element) => element.kind === "paragraph" && readMarker(element.text) !== undefined);
  const issues: PackageIssue[] = [...body.issues];
  let questions: PackageQuestion[];
  let assetTargets: Map<string, string>;
  let unplaced: UnplacedMedia[] = [];
  if (marked) {
    const parsed = parseMarkedBody(body.elements, defaults);
    ({ questions, assetTargets } = parsed);
    issues.push(...parsed.issues);
  } else {
    const anchored = bodyToAnchoredText(body.elements);
    const converted = draftsToQuestions(parseQuestionBlocks(anchored.text), anchored, { ...defaults, method: "docx-import" });
    ({ questions, assetTargets, unplaced } = converted);
    issues.push(...converted.issues);
    if (anchored.flattened) {
      issues.push({ severity: "info", code: "unsupported_content", message: "Subscripts, superscripts and emphasis were read as plain text. Write the document with the AXOM template to keep them." });
    }
  }
  const files = await describeAssets(questions, (asset) => body.media.get(assetTargets.get(asset.id) ?? ""));
  for (const question of questions) {
    for (const asset of question.assets) {
      if (asset.checksum && !SHOWABLE_IMAGE_TYPES.has(asset.mimeType)) {
        issues.push({
          severity: asset.role === "stem" || asset.role === "choice" || asset.role === "question" ? "error" : "warning",
          code: "missing_required_media",
          message: `${asset.filename} is a ${asset.mimeType.replace("image/", "").toUpperCase()} picture, which AXOM cannot show. In Word, copy it, paste it back as a picture (PNG), and save.`,
          questionId: question.id,
          path: `assets[${asset.id}]`,
        });
      }
    }
  }
  return { questions, files, issues, readBy: questions.length ? (marked ? "markers" : "text-parser") : "nothing", unplaced };
}
