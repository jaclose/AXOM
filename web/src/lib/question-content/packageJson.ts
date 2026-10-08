// ===========================================================================
// Reading and writing the package's two JSON files.
//
// Reading reports whatever it cannot accept as an issue and never drops or
// repairs content quietly. Writing is canonical (fixed key order, absent
// fields left out), so export, re-import and export again give the same text.
// ===========================================================================
import { ASSET_ROLES, inspectRichText, type QuestionBlock, type TableBlock, type TableMerge } from "./blocks";
import {
  ANSWER_EVIDENCE,
  ASSET_DERIVATIONS,
  PACKAGE_SCHEMA_VERSION,
  PROVENANCE_METHODS,
  QUESTION_FLAG_TYPES,
  type AnswerKey,
  type ImportPackage,
  type IssueCode,
  type IssueSeverity,
  type PackageIssue,
  type PackageManifest,
  type PackageQuestion,
  type ProvenanceMetadata,
  type QuestionAsset,
  type QuestionChoice,
  type QuestionFlag,
  type SourceMetadata,
} from "./package";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
const filled = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);
const integer = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) ? value : undefined);
const finite = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const textList = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? (value as string[]) : undefined;
const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined;
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
const compact = (object: Json): Json => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

export const BANK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface ReadContext {
  issues: PackageIssue[];
  questionId?: string;
}

function note(ctx: ReadContext, severity: IssueSeverity, code: IssueCode, message: string, path?: string): void {
  ctx.issues.push({ severity, code, message, ...optional("questionId", ctx.questionId), ...optional("path", path) });
}

function warnUnknown(value: Json, known: readonly string[], path: string, ctx: ReadContext): void {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) note(ctx, "warning", "unknown_field", `"${key}" is not a field AXOM reads here. It was left out.`, path);
  }
}

// --- versions ----------------------------------------------------------------

/**
 * Each entry lifts a file from version N to N + 1. Empty while 1 is the only
 * version: the first change of shape adds `1: (raw) => ...` and bumps
 * PACKAGE_SCHEMA_VERSION, and older packages keep importing.
 */
const MIGRATIONS: Record<number, (raw: Json) => Json> = {};

function toCurrentVersion(raw: unknown, what: string, ctx: ReadContext): Json | undefined {
  if (!isRecord(raw)) {
    note(ctx, "error", "invalid_package", `${what} is not a JSON object.`);
    return undefined;
  }
  let version = integer(raw.schemaVersion);
  if (version === undefined || version < 1) {
    note(ctx, "error", "invalid_package", `${what} does not say which schemaVersion it is.`);
    return undefined;
  }
  if (version > PACKAGE_SCHEMA_VERSION) {
    note(ctx, "error", "unsupported_version", `${what} is version ${version}, made by a newer AXOM. This AXOM reads up to version ${PACKAGE_SCHEMA_VERSION}.`);
    return undefined;
  }
  let current = raw;
  while (version < PACKAGE_SCHEMA_VERSION) {
    const lift = MIGRATIONS[version];
    if (!lift) {
      note(ctx, "error", "unsupported_version", `${what} is version ${version} and AXOM has no way to bring it up to date.`);
      return undefined;
    }
    current = lift(current);
    version += 1;
  }
  return current;
}

// --- blocks ------------------------------------------------------------------

const BLOCK_KEYS: Record<QuestionBlock["type"], readonly string[]> = {
  text: ["type", "text"],
  rich_text: ["type", "html"],
  image: ["type", "assetId", "role", "alt", "caption"],
  table: ["type", "caption", "headers", "rowHeaders", "rowKeys", "rich", "merges", "rows", "sourceImageAssetId"],
  equation: ["type", "latex", "plainText"],
  divider: ["type"],
  callout: ["type", "tone", "text"],
};

function readMerges(value: unknown): TableMerge[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const merges: TableMerge[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const row = integer(entry.row);
    const column = integer(entry.column);
    const rowSpan = integer(entry.rowSpan);
    const columnSpan = integer(entry.columnSpan);
    if (row === undefined || column === undefined || rowSpan === undefined || columnSpan === undefined) return undefined;
    if (row < 0 || column < 0 || rowSpan < 1 || columnSpan < 1) return undefined;
    merges.push({ row, column, rowSpan, columnSpan });
  }
  return merges;
}

function readTable(value: Json, path: string, ctx: ReadContext): TableBlock | undefined {
  const reject = (message: string): undefined => {
    note(ctx, "error", "invalid_block", message, path);
    return undefined;
  };
  const rows = Array.isArray(value.rows) ? value.rows.map(textList) : undefined;
  if (!rows || rows.some((row) => row === undefined)) {
    return reject("A table needs rows of text cells. Write numbers as text so \"0.50\" keeps its zero.");
  }
  const headers = value.headers === undefined ? undefined : textList(value.headers);
  if (value.headers !== undefined && !headers) return reject("Table headers must be a list of text.");
  const rowKeys = value.rowKeys === undefined ? undefined : textList(value.rowKeys);
  if (value.rowKeys !== undefined && (!rowKeys || rowKeys.length !== rows.length)) {
    return reject("A shared answer table needs one row key for each row.");
  }
  const widths = new Set([...(headers ? [headers.length] : []), ...rows.map((row) => row!.length)]);
  if (widths.size > 1) {
    note(ctx, "warning", "table_parse_uncertain", "The rows of this table do not all have the same number of cells.", path);
  }
  const rich = value.rich === true;
  let escaped = false;
  const safe = (cell: string): string => {
    if (!rich) return cell;
    const inspected = inspectRichText(cell);
    escaped = escaped || inspected.escaped;
    return inspected.html;
  };
  const safeHeaders = headers?.map(safe);
  const safeRows = (rows as string[][]).map((row) => row.map(safe));
  if (escaped) note(ctx, "warning", "rich_text_escaped", "Markup AXOM does not run was kept as plain text.", path);
  const merges = value.merges === undefined ? undefined : readMerges(value.merges);
  if (value.merges !== undefined && !merges) return reject("Each merged cell needs a row, a column, a row span and a column span.");
  return {
    type: "table",
    ...optional("caption", text(value.caption)),
    ...optional("headers", safeHeaders),
    ...optional("rowHeaders", value.rowHeaders === true ? true : undefined),
    ...optional("rowKeys", rowKeys),
    ...optional("rich", rich ? true : undefined),
    ...optional("merges", merges?.length ? merges : undefined),
    rows: safeRows,
    ...optional("sourceImageAssetId", filled(value.sourceImageAssetId)),
  };
}

function readBlock(value: unknown, path: string, ctx: ReadContext): QuestionBlock | undefined {
  const reject = (message: string): undefined => {
    note(ctx, "error", "invalid_block", message, path);
    return undefined;
  };
  if (!isRecord(value)) return reject("A block must be an object with a type.");
  const known = BLOCK_KEYS[value.type as QuestionBlock["type"]];
  if (!known) return reject(`"${String(value.type)}" is not a kind of block AXOM knows.`);
  warnUnknown(value, known, path, ctx);
  switch (value.type as QuestionBlock["type"]) {
    case "text": {
      const body = text(value.text);
      return body === undefined ? reject("A text block needs its text.") : { type: "text", text: body };
    }
    case "rich_text": {
      const html = text(value.html);
      if (html === undefined) return reject("A rich text block needs its html.");
      const inspected = inspectRichText(html);
      if (inspected.escaped) note(ctx, "warning", "rich_text_escaped", "Markup AXOM does not run was kept as plain text.", path);
      return { type: "rich_text", html: inspected.html };
    }
    case "image": {
      const assetId = filled(value.assetId);
      if (!assetId) return reject("An image block needs the id of its asset.");
      const role = oneOf(ASSET_ROLES, value.role);
      if (value.role !== undefined && !role) return reject(`"${String(value.role)}" is not an asset role.`);
      return { type: "image", assetId, ...optional("role", role), ...optional("alt", text(value.alt)), ...optional("caption", text(value.caption)) };
    }
    case "table":
      return readTable(value, path, ctx);
    case "equation": {
      const latex = text(value.latex);
      const plainText = text(value.plainText);
      if (latex === undefined && plainText === undefined) return reject("An equation block needs latex or plain text.");
      return { type: "equation", ...optional("latex", latex), ...optional("plainText", plainText) };
    }
    case "divider":
      return { type: "divider" };
    case "callout": {
      const body = text(value.text);
      if (body === undefined) return reject("A callout block needs its text.");
      return { type: "callout", ...optional("tone", oneOf(["note", "warning"] as const, value.tone)), text: body };
    }
  }
}

export function readBlocks(value: unknown, path: string, ctx: ReadContext): QuestionBlock[] {
  if (!Array.isArray(value)) {
    note(ctx, "error", "invalid_block", "This must be a list of blocks.", path);
    return [];
  }
  return value.flatMap((entry, index) => {
    const block = readBlock(entry, `${path}[${index}]`, ctx);
    return block ? [block] : [];
  });
}

function writeBlock(block: QuestionBlock): Json {
  switch (block.type) {
    case "text": return { type: block.type, text: block.text };
    case "rich_text": return { type: block.type, html: block.html };
    case "image": return compact({ type: block.type, assetId: block.assetId, role: block.role, alt: block.alt, caption: block.caption });
    case "table": return compact({
      type: block.type, caption: block.caption, headers: block.headers, rowHeaders: block.rowHeaders,
      rowKeys: block.rowKeys, rich: block.rich,
      merges: block.merges?.map((merge) => ({ row: merge.row, column: merge.column, rowSpan: merge.rowSpan, columnSpan: merge.columnSpan })),
      rows: block.rows, sourceImageAssetId: block.sourceImageAssetId,
    });
    case "equation": return compact({ type: block.type, latex: block.latex, plainText: block.plainText });
    case "divider": return { type: block.type };
    case "callout": return compact({ type: block.type, tone: block.tone, text: block.text });
  }
}

// --- manifest ----------------------------------------------------------------

const MANIFEST_KEYS = ["schemaVersion", "course", "bank", "source", "questionsFile", "assetsDirectory"] as const;

export function readManifest(raw: unknown, issues: PackageIssue[]): PackageManifest | undefined {
  const ctx: ReadContext = { issues };
  const current = toCurrentVersion(raw, "The manifest", ctx);
  if (!current) return undefined;
  const reject = (message: string): undefined => {
    note(ctx, "error", "invalid_package", message, "manifest");
    return undefined;
  };
  const course = isRecord(current.course) ? current.course : {};
  const bank = isRecord(current.bank) ? current.bank : {};
  const source = isRecord(current.source) ? current.source : {};
  const name = filled(course.name);
  const term = integer(course.term);
  const week = integer(course.week);
  if (!name || term === undefined || week === undefined) return reject("The manifest needs a course with a name, a term and a week.");
  const id = filled(bank.id);
  const title = filled(bank.title);
  const discipline = filled(bank.discipline);
  if (!id || !BANK_ID_PATTERN.test(id)) return reject("The bank id must be lower-case letters and digits joined by hyphens.");
  if (!title || !discipline) return reject("The bank needs a title and a discipline.");
  const filename = filled(source.filename);
  if (!filename || typeof source.sourceWeekDeclared !== "boolean") {
    return reject("The source needs a file name, and must say whether the source itself declares the week.");
  }
  const questionsFile = filled(current.questionsFile);
  const assetsDirectory = filled(current.assetsDirectory);
  if (!questionsFile || !assetsDirectory) return reject("The manifest needs the questions file and the assets folder.");
  warnUnknown(current, MANIFEST_KEYS, "manifest", ctx);
  return {
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    course: { name, term, week },
    bank: { id, title, discipline, ...optional("topic", filled(bank.topic)) },
    source: {
      filename,
      ...optional("institution", filled(source.institution)),
      ...optional("declaredTitle", filled(source.declaredTitle)),
      ...optional("declaredTerm", filled(source.declaredTerm)),
      sourceWeekDeclared: source.sourceWeekDeclared,
      ...optional("axomAssignedWeek", integer(source.axomAssignedWeek)),
    },
    questionsFile,
    assetsDirectory,
  };
}

function writeManifest(manifest: PackageManifest): Json {
  return {
    schemaVersion: manifest.schemaVersion,
    course: { name: manifest.course.name, term: manifest.course.term, week: manifest.course.week },
    bank: compact({ id: manifest.bank.id, title: manifest.bank.title, discipline: manifest.bank.discipline, topic: manifest.bank.topic }),
    source: compact({
      filename: manifest.source.filename, institution: manifest.source.institution,
      declaredTitle: manifest.source.declaredTitle, declaredTerm: manifest.source.declaredTerm,
      sourceWeekDeclared: manifest.source.sourceWeekDeclared, axomAssignedWeek: manifest.source.axomAssignedWeek,
    }),
    questionsFile: manifest.questionsFile,
    assetsDirectory: manifest.assetsDirectory,
  };
}

// --- questions ---------------------------------------------------------------

const QUESTION_KEYS = [
  "id", "course", "term", "week", "bankId", "discipline", "topic", "subtopic", "source", "stem", "choices",
  "choiceTable", "correctAnswer", "explanation", "assets", "flags", "provenance",
] as const;
const ASSET_KEYS = [
  "id", "filename", "mimeType", "width", "height", "byteSize", "sourceFile", "sourcePage", "role", "questionId",
  "checksum", "derivation", "bounds", "revealOf", "crop",
] as const;

function readAsset(value: unknown, index: number, ctx: ReadContext): QuestionAsset | undefined {
  const id = isRecord(value) ? filled(value.id) : undefined;
  const path = `assets[${id ?? index}]`;
  const reject = (message: string): undefined => {
    note(ctx, "error", "invalid_question", message, path);
    return undefined;
  };
  if (!isRecord(value) || !id) return reject("An asset needs an id.");
  const filename = filled(value.filename);
  const mimeType = filled(value.mimeType);
  const role = oneOf(ASSET_ROLES, value.role);
  const questionId = filled(value.questionId);
  if (!filename || !mimeType) return reject("An asset needs a file name and a mime type.");
  if (!role) return reject(`An asset needs a role, one of: ${ASSET_ROLES.join(", ")}.`);
  if (!questionId) return reject("An asset needs the id of the question it belongs to.");
  warnUnknown(value, ASSET_KEYS, path, ctx);
  const crop = isRecord(value.crop) ? value.crop : undefined;
  const cropped = crop && [crop.left, crop.top, crop.right, crop.bottom].every((entry) => finite(entry) !== undefined && (entry as number) >= 0 && (entry as number) < 1)
    ? { left: crop.left as number, top: crop.top as number, right: crop.right as number, bottom: crop.bottom as number }
    : undefined;
  const bounds = isRecord(value.bounds) ? value.bounds : undefined;
  const region = bounds && [bounds.x, bounds.y, bounds.width, bounds.height].every((entry) => finite(entry) !== undefined)
    ? { x: bounds.x as number, y: bounds.y as number, width: bounds.width as number, height: bounds.height as number }
    : undefined;
  return {
    id, filename, mimeType,
    ...optional("width", integer(value.width)),
    ...optional("height", integer(value.height)),
    ...optional("byteSize", integer(value.byteSize)),
    ...optional("sourceFile", filled(value.sourceFile)),
    ...optional("sourcePage", integer(value.sourcePage)),
    role, questionId,
    ...optional("checksum", filled(value.checksum)),
    ...optional("derivation", oneOf(ASSET_DERIVATIONS, value.derivation)),
    ...optional("bounds", region),
    ...optional("revealOf", filled(value.revealOf)),
    ...optional("crop", cropped),
  };
}

function writeAsset(asset: QuestionAsset): Json {
  return compact({
    id: asset.id, filename: asset.filename, mimeType: asset.mimeType, width: asset.width, height: asset.height,
    byteSize: asset.byteSize, sourceFile: asset.sourceFile, sourcePage: asset.sourcePage, role: asset.role,
    questionId: asset.questionId, checksum: asset.checksum, derivation: asset.derivation,
    bounds: asset.bounds && { x: asset.bounds.x, y: asset.bounds.y, width: asset.bounds.width, height: asset.bounds.height },
    revealOf: asset.revealOf,
    crop: asset.crop && { left: asset.crop.left, top: asset.crop.top, right: asset.crop.right, bottom: asset.crop.bottom },
  });
}

function readChoice(value: unknown, index: number, ctx: ReadContext): QuestionChoice | undefined {
  const label = isRecord(value) ? filled(value.label) : undefined;
  const path = `choices[${label ?? index}]`;
  if (!isRecord(value) || !label || !filled(value.id)) {
    note(ctx, "error", "invalid_question", "A choice needs an id and a label.", path);
    return undefined;
  }
  warnUnknown(value, ["id", "label", "blocks"], path, ctx);
  return { id: value.id as string, label, blocks: readBlocks(value.blocks ?? [], `${path}.blocks`, ctx) };
}

function readAnswer(value: unknown, ctx: ReadContext): AnswerKey | undefined {
  const labels = isRecord(value) ? textList(value.labels) : undefined;
  if (!labels?.length) {
    note(ctx, "error", "invalid_question", "An answer key needs at least one choice label.", "correctAnswer");
    return undefined;
  }
  return { labels, ...optional("evidence", oneOf(ANSWER_EVIDENCE, (value as Json).evidence)) };
}

function readFlags(value: unknown, ctx: ReadContext): QuestionFlag[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const type = isRecord(entry) ? oneOf(QUESTION_FLAG_TYPES, entry.type) : undefined;
    const message = isRecord(entry) ? text(entry.message) : undefined;
    if (!type || message === undefined) {
      note(ctx, "warning", "unknown_flag", "A flag AXOM does not know was left out. Flags need a known type and a message.", `flags[${index}]`);
      return [];
    }
    return [{ type, message }];
  });
}

function readQuestion(value: unknown, index: number, issues: PackageIssue[]): PackageQuestion | undefined {
  const id = isRecord(value) ? filled(value.id) : undefined;
  if (!isRecord(value) || !id) {
    issues.push({ severity: "error", code: "invalid_question", message: `Question ${index + 1} in the file has no id and was not read.`, path: `questions[${index}]` });
    return undefined;
  }
  const ctx: ReadContext = { issues, questionId: id };
  const reject = (message: string, path: string): undefined => {
    note(ctx, "error", "invalid_question", message, path);
    return undefined;
  };
  warnUnknown(value, QUESTION_KEYS, "question", ctx);

  const sourceRaw = isRecord(value.source) ? value.source : {};
  const filename = filled(sourceRaw.filename);
  if (!filename) return reject("The question does not name its source file.", "source");
  const source: SourceMetadata = {
    filename,
    ...optional("page", integer(sourceRaw.page)),
    ...optional("pageEnd", integer(sourceRaw.pageEnd)),
    ...optional("questionNumber", integer(sourceRaw.questionNumber)),
    ...optional("set", integer(sourceRaw.set)),
  };

  const provenanceRaw = isRecord(value.provenance) ? value.provenance : {};
  const method = oneOf(PROVENANCE_METHODS, provenanceRaw.method);
  if (!method) return reject(`The question does not say how it was made. Provenance needs a method, one of: ${PROVENANCE_METHODS.join(", ")}.`, "provenance");
  const provenance: ProvenanceMetadata = {
    method,
    ...optional("tool", filled(provenanceRaw.tool)),
    ...optional("createdAt", filled(provenanceRaw.createdAt)),
    ...optional("sourceChecksum", filled(provenanceRaw.sourceChecksum)),
    ...optional("notes", filled(provenanceRaw.notes)),
  };

  const stem = readBlocks(value.stem, "stem", ctx);
  if (!stem.length) return reject("The question has no stem.", "stem");
  const choices = Array.isArray(value.choices)
    ? value.choices.flatMap((entry, at) => {
        const choice = readChoice(entry, at, ctx);
        return choice ? [choice] : [];
      })
    : [];
  let choiceTable: TableBlock | undefined;
  if (value.choiceTable !== undefined) {
    choiceTable = isRecord(value.choiceTable) ? readTable(value.choiceTable, "choiceTable", ctx) : undefined;
    if (choiceTable && !choiceTable.rowKeys) {
      note(ctx, "error", "invalid_block", "A shared answer table must say which choice each row is (rowKeys).", "choiceTable");
      choiceTable = undefined;
    }
  }
  const explanation = value.explanation === undefined ? undefined : readBlocks(value.explanation, "explanation", ctx);
  const assets = Array.isArray(value.assets)
    ? value.assets.flatMap((entry, at) => {
        const asset = readAsset(entry, at, ctx);
        return asset ? [asset] : [];
      })
    : [];
  const flags = readFlags(value.flags, ctx);

  return {
    id,
    ...optional("course", filled(value.course)),
    ...optional("term", integer(value.term)),
    ...optional("week", integer(value.week)),
    ...optional("bankId", filled(value.bankId)),
    ...optional("discipline", filled(value.discipline)),
    ...optional("topic", filled(value.topic)),
    ...optional("subtopic", filled(value.subtopic)),
    source,
    stem,
    choices,
    ...optional("choiceTable", choiceTable),
    ...optional("correctAnswer", value.correctAnswer === undefined ? undefined : readAnswer(value.correctAnswer, ctx)),
    ...optional("explanation", explanation?.length ? explanation : undefined),
    assets,
    ...optional("flags", flags.length ? flags : undefined),
    provenance,
  };
}

function writeQuestion(question: PackageQuestion): Json {
  return compact({
    id: question.id,
    course: question.course, term: question.term, week: question.week, bankId: question.bankId,
    discipline: question.discipline, topic: question.topic, subtopic: question.subtopic,
    source: compact({
      filename: question.source.filename, page: question.source.page, pageEnd: question.source.pageEnd,
      questionNumber: question.source.questionNumber,
      set: question.source.set,
    }),
    stem: question.stem.map(writeBlock),
    choices: question.choices.map((choice) => ({ id: choice.id, label: choice.label, blocks: choice.blocks.map(writeBlock) })),
    choiceTable: question.choiceTable && writeBlock(question.choiceTable),
    correctAnswer: question.correctAnswer && compact({ labels: question.correctAnswer.labels, evidence: question.correctAnswer.evidence }),
    explanation: question.explanation?.map(writeBlock),
    assets: question.assets.map(writeAsset),
    flags: question.flags?.map((flag) => ({ type: flag.type, message: flag.message })),
    provenance: compact({
      method: question.provenance.method, tool: question.provenance.tool, createdAt: question.provenance.createdAt,
      sourceChecksum: question.provenance.sourceChecksum, notes: question.provenance.notes,
    }),
  });
}

export function readQuestionsFile(raw: unknown, issues: PackageIssue[]): { bankId: string; questions: PackageQuestion[] } | undefined {
  const ctx: ReadContext = { issues };
  const current = toCurrentVersion(raw, "The questions file", ctx);
  if (!current) return undefined;
  const bankId = filled(current.bankId);
  if (!bankId || !Array.isArray(current.questions)) {
    note(ctx, "error", "invalid_package", "The questions file needs a bankId and a list of questions.");
    return undefined;
  }
  warnUnknown(current, ["schemaVersion", "bankId", "questions"], "questions file", ctx);
  const questions = current.questions.flatMap((entry, index) => {
    const question = readQuestion(entry, index, issues);
    return question ? [question] : [];
  });
  return { bankId, questions };
}

// --- whole package -----------------------------------------------------------

export interface ParsedPackage {
  /** Absent when either file could not be read at all. */
  package?: ImportPackage;
  issues: PackageIssue[];
}

function parseJson(source: string, what: string, issues: PackageIssue[]): unknown {
  try {
    return JSON.parse(source);
  } catch {
    issues.push({ severity: "error", code: "invalid_package", message: `${what} is not valid JSON.` });
    return undefined;
  }
}

export function parsePackage(manifestText: string, questionsText: string): ParsedPackage {
  const issues: PackageIssue[] = [];
  const manifestRaw = parseJson(manifestText, "The manifest", issues);
  const questionsRaw = parseJson(questionsText, "The questions file", issues);
  const manifest = manifestRaw === undefined ? undefined : readManifest(manifestRaw, issues);
  const file = questionsRaw === undefined ? undefined : readQuestionsFile(questionsRaw, issues);
  if (!manifest || !file) return { issues };
  if (file.bankId !== manifest.bank.id) {
    issues.push({
      severity: "error", code: "scope_mismatch",
      message: `The questions file is for the bank "${file.bankId}" but the manifest is for "${manifest.bank.id}".`,
    });
  }
  return { package: { manifest, questions: file.questions }, issues };
}

/** Lists of plain values stay on one line, so a table row reads as a row in a diff. */
function stringify(value: unknown, indent = ""): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every((entry) => entry === null || typeof entry !== "object")) {
      return `[${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    }
    return `[\n${value.map((entry) => inner + stringify(entry, inner)).join(",\n")}\n${indent}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    return `{\n${entries.map(([key, entry]) => `${inner}${JSON.stringify(key)}: ${stringify(entry, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

export function serializeManifest(manifest: PackageManifest): string {
  return `${stringify(writeManifest(manifest))}\n`;
}

export function serializeQuestionsFile(pkg: ImportPackage): string {
  return `${stringify({ schemaVersion: PACKAGE_SCHEMA_VERSION, bankId: pkg.manifest.bank.id, questions: pkg.questions.map(writeQuestion) })}\n`;
}
