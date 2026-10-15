import { sha256Hex } from "../checksum";
import { canonicalJson } from "../compressedText";
import type { QuestionSet } from "../library";
import { validateQuestionRecord, type QuestionRecord } from "../questions";
import { normalizeTagList } from "../questionTags";

export const SHARE_FORMAT_VERSION = 1;

const MAX_SHARE_BYTES = 5_000_000;
const MAX_TITLE_LENGTH = 200;
const MAX_QUESTION_COUNT = 1_000;
const MAX_QUESTION_ID_LENGTH = 200;
const MAX_OPTION_COUNT = 26;
const MAX_OPTION_KEY_LENGTH = 16;
const MAX_OPTION_TEXT_LENGTH = 4_000;
const MAX_TAG_COUNT = 100;
const MAX_TAG_LENGTH = 64;
const MAX_METADATA_LENGTH = 500;
const MAX_EXPLANATION_LENGTH = 30_000;
const MAX_RATIONALE_LENGTH = 10_000;
const MAX_CITATION_LENGTH = 2_000;

const SNAPSHOT_KEYS = new Set([
  "shareFormatVersion",
  "title",
  "tags",
  "orderedQuestionIds",
  "questions",
  "createdAt",
  "copyrightNotice",
]);
const QUESTION_KEYS = new Set([
  "id",
  "stem",
  "options",
  "correctKey",
  "correctAnswerText",
  "explanation",
  "choiceRationales",
  "system",
  "topic",
  "objective",
  "category",
  "subcategory",
  "tags",
  "citation",
]);
const OPTION_KEYS = new Set(["key", "text"]);

export interface SharedQuestion {
  id: string;
  stem: string;
  options: { key: string; text: string }[];
  correctKey?: string;
  correctAnswerText?: string;
  explanation?: string;
  choiceRationales?: Record<string, string>;
  system?: string;
  topic?: string;
  objective?: string;
  category?: string;
  subcategory?: string;
  tags: string[];
  citation?: string;
}

export interface SharedQuestionSetSnapshot {
  shareFormatVersion: 1;
  title: string;
  tags: string[];
  orderedQuestionIds: string[];
  questions: SharedQuestion[];
  createdAt: string;
  copyrightNotice: string;
}

export interface SharedQuestionImportIdentity {
  shareId: string;
  contentDigest: string;
}

export interface SharedQuestionImportProvenance extends SharedQuestionImportIdentity {
  version: 1;
}

export type ImportedSharedQuestionSet = QuestionSet & {
  importProvenance: SharedQuestionImportProvenance;
};

export interface SharedQuestionImportPlan {
  set: ImportedSharedQuestionSet;
  questions: QuestionRecord[];
  reused: number;
  alreadyImported: boolean;
}

export function createQuestionSetShare(
  set: QuestionSet,
  bank: readonly QuestionRecord[],
  now = new Date().toISOString(),
): SharedQuestionSetSnapshot {
  const byId = new Map(bank.map((question) => [question.id, question]));
  const questions = set.questionIds
    .map((id) => byId.get(id))
    .filter((question): question is QuestionRecord => Boolean(question))
    // Share-local membership IDs preserve order without exposing stable IDs
    // from the sender's workspace through a bearer link.
    .map((question, index) => toShared(question, `shared-question-${index + 1}`));
  if (questions.length !== set.questionIds.length) {
    throw new Error("Question Set contains missing questions and cannot be shared safely.");
  }
  const snapshot: SharedQuestionSetSnapshot = {
    shareFormatVersion: SHARE_FORMAT_VERSION,
    title: set.title,
    tags: [...set.tags],
    orderedQuestionIds: questions.map((question) => question.id),
    questions,
    createdAt: now,
    copyrightNotice: "Share only material you have permission to distribute.",
  };
  validateShare(snapshot);
  return snapshot;
}

export async function sharedQuestionSetDigest(snapshot: SharedQuestionSetSnapshot): Promise<string> {
  validateShare(snapshot);
  const digest = await sha256Hex(canonicalJson(snapshot));
  if (!digest) throw new Error("This browser cannot verify the shared set identity safely.");
  return digest;
}

export function importSharedQuestionSet(input: {
  snapshot: SharedQuestionSetSnapshot;
  identity: SharedQuestionImportIdentity;
  existingQuestions: readonly QuestionRecord[];
  existingSets?: readonly QuestionSet[];
  now?: string;
}): SharedQuestionImportPlan {
  const { snapshot, identity, existingQuestions, existingSets = [] } = input;
  validateShare(snapshot);
  validateImportIdentity(identity);

  const previous = existingSets.find((set) => readSharedQuestionImportProvenance(set)?.shareId === identity.shareId);
  if (previous) {
    const provenance = readSharedQuestionImportProvenance(previous)!;
    if (provenance.contentDigest !== identity.contentDigest.toLowerCase()) {
      throw new Error("This share ID was already imported from different content. The existing local set was preserved.");
    }
    return {
      set: previous as ImportedSharedQuestionSet,
      questions: [],
      reused: previous.questionIds.length,
      alreadyImported: true,
    };
  }

  const now = validTimestamp(input.now ?? new Date().toISOString(), "Import time");
  const availableByIdentity = new Map<string, QuestionRecord[]>();
  for (const existing of existingQuestions) {
    const shared = existingQuestionShareView(existing);
    if (!shared) continue;
    const key = questionIdentity(shared);
    const matches = availableByIdentity.get(key) ?? [];
    matches.push(existing);
    availableByIdentity.set(key, matches);
  }

  const added: QuestionRecord[] = [];
  const questionIds: string[] = [];
  let reused = 0;
  for (const shared of snapshot.questions) {
    const matches = availableByIdentity.get(questionIdentity(shared));
    const existing = matches?.shift();
    if (existing) {
      questionIds.push(existing.id);
      reused += 1;
      continue;
    }
    const question = importedQuestion(shared, now);
    added.push(question);
    questionIds.push(question.id);
  }

  const set: ImportedSharedQuestionSet = {
    id: crypto.randomUUID(),
    title: snapshot.title.trim(),
    sourceDocumentIds: [],
    createdAt: now,
    questionIds,
    tags: normalizeTagList(snapshot.tags),
    aiEnhanced: false,
    parserWarnings: ["Imported from an unlisted Question Set link."],
    ordering: "import",
    kind: "source",
    importProvenance: {
      version: 1,
      shareId: identity.shareId,
      contentDigest: identity.contentDigest.toLowerCase(),
    },
  };
  return { questions: added, reused, set, alreadyImported: false };
}

export function readSharedQuestionImportProvenance(set: QuestionSet): SharedQuestionImportProvenance | undefined {
  const value = (set as QuestionSet & { importProvenance?: unknown }).importProvenance;
  if (!isRecord(value) || value.version !== 1 || typeof value.shareId !== "string"
    || !validShareId(value.shareId) || typeof value.contentDigest !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.contentDigest)) return undefined;
  return { version: 1, shareId: value.shareId, contentDigest: value.contentDigest.toLowerCase() };
}

export function validateShare(value: unknown): asserts value is SharedQuestionSetSnapshot {
  if (!isRecord(value)) throw new Error("Shared set payload is invalid.");
  assertOnlyKeys(value, SNAPSHOT_KEYS, "Shared set");

  let encoded: string;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new Error("Shared set payload is not serializable.");
  }
  if (new TextEncoder().encode(encoded).byteLength > MAX_SHARE_BYTES) {
    throw new Error("Shared set payload exceeds the 5 MB safety limit.");
  }
  if (value.shareFormatVersion !== SHARE_FORMAT_VERSION) {
    throw new Error("Shared set format is unsupported or corrupt.");
  }
  requiredString(value.title, "Shared set title", MAX_TITLE_LENGTH);
  validateStringList(value.tags, "Shared set tags", MAX_TAG_COUNT, MAX_TAG_LENGTH);
  validTimestamp(value.createdAt, "Shared set creation time");
  requiredString(value.copyrightNotice, "Shared set copyright notice", 500);

  if (!Array.isArray(value.questions) || value.questions.length > MAX_QUESTION_COUNT) {
    throw new Error(`Shared set questions must be an array of at most ${MAX_QUESTION_COUNT} items.`);
  }
  if (!Array.isArray(value.orderedQuestionIds) || value.orderedQuestionIds.length !== value.questions.length) {
    throw new Error("Shared set membership is incomplete.");
  }

  const orderedIds = value.orderedQuestionIds.map((id, index) => validQuestionId(id, `Membership ID ${index + 1}`));
  if (new Set(orderedIds).size !== orderedIds.length) {
    throw new Error("Shared set membership IDs must be unique.");
  }

  const questionIds = value.questions.map((question, index) => validateSharedQuestion(question, index));
  if (new Set(questionIds).size !== questionIds.length) {
    throw new Error("Shared question IDs must be unique.");
  }
  for (let index = 0; index < orderedIds.length; index += 1) {
    if (orderedIds[index] !== questionIds[index]) {
      throw new Error("Shared set membership order does not match its questions.");
    }
  }
}

function validateSharedQuestion(value: unknown, index: number): string {
  const label = `Shared question ${index + 1}`;
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  assertOnlyKeys(value, QUESTION_KEYS, label);
  const id = validQuestionId(value.id, `${label} ID`);
  requiredString(value.stem, `${label} stem`, 8_000);
  validateStringList(value.tags, `${label} tags`, MAX_TAG_COUNT, MAX_TAG_LENGTH);

  if (!Array.isArray(value.options) || value.options.length > MAX_OPTION_COUNT || value.options.length === 1) {
    throw new Error(`${label} must contain either no choices or 2-${MAX_OPTION_COUNT} choices.`);
  }
  const optionKeys = value.options.map((option, optionIndex) => {
    if (!isRecord(option)) throw new Error(`${label} choice ${optionIndex + 1} must be an object.`);
    assertOnlyKeys(option, OPTION_KEYS, `${label} choice ${optionIndex + 1}`);
    const key = requiredString(option.key, `${label} choice ${optionIndex + 1} key`, MAX_OPTION_KEY_LENGTH).toUpperCase();
    requiredString(option.text, `${label} choice ${optionIndex + 1} text`, MAX_OPTION_TEXT_LENGTH);
    return key;
  });
  if (new Set(optionKeys).size !== optionKeys.length) {
    throw new Error(`${label} choice keys must be unique.`);
  }

  const correctKey = optionalString(value.correctKey, `${label} correct key`, MAX_OPTION_KEY_LENGTH)?.toUpperCase();
  const correctAnswerText = optionalString(value.correctAnswerText, `${label} correct answer text`, MAX_OPTION_TEXT_LENGTH);
  if (correctKey && !optionKeys.includes(correctKey)) {
    throw new Error(`${label} correct key does not match a choice.`);
  }
  if (correctAnswerText !== undefined) {
    if (!correctKey) throw new Error(`${label} correct answer text requires a correct key.`);
    const correctIndex = optionKeys.indexOf(correctKey);
    const choice = value.options[correctIndex] as Record<string, unknown>;
    if (correctAnswerText !== String(choice.text).trim()) {
      throw new Error(`${label} correct answer text does not match its keyed choice.`);
    }
  }

  optionalString(value.explanation, `${label} explanation`, MAX_EXPLANATION_LENGTH);
  optionalString(value.system, `${label} system`, MAX_METADATA_LENGTH);
  optionalString(value.topic, `${label} topic`, MAX_METADATA_LENGTH);
  optionalString(value.objective, `${label} objective`, MAX_METADATA_LENGTH);
  optionalString(value.category, `${label} category`, MAX_METADATA_LENGTH);
  optionalString(value.subcategory, `${label} subcategory`, MAX_METADATA_LENGTH);
  optionalString(value.citation, `${label} citation`, MAX_CITATION_LENGTH);

  if (value.choiceRationales !== undefined) {
    if (!isRecord(value.choiceRationales)) throw new Error(`${label} choice rationales must be an object.`);
    if (Object.keys(value.choiceRationales).length > optionKeys.length) {
      throw new Error(`${label} has more rationales than choices.`);
    }
    const seen = new Set<string>();
    for (const [rawKey, rationale] of Object.entries(value.choiceRationales)) {
      const key = requiredString(rawKey, `${label} rationale key`, MAX_OPTION_KEY_LENGTH).toUpperCase();
      if (!optionKeys.includes(key) || seen.has(key)) {
        throw new Error(`${label} rationale keys must each match one distinct choice.`);
      }
      seen.add(key);
      requiredString(rationale, `${label} rationale ${key}`, MAX_RATIONALE_LENGTH);
    }
  }
  return id;
}

function importedQuestion(shared: SharedQuestion, now: string): QuestionRecord {
  const correctKey = shared.correctKey?.trim().toUpperCase();
  const correctAnswerText = correctKey
    ? shared.options.find((option) => option.key.trim().toUpperCase() === correctKey)?.text.trim()
    : undefined;
  const projected = {
    id: crypto.randomUUID(),
    source: "imported" as const,
    stem: shared.stem.trim(),
    options: shared.options.map((option) => ({ key: option.key.trim().toUpperCase(), text: option.text.trim() })),
    correctKey,
    correctAnswerText,
    explanation: cleanOptional(shared.explanation),
    choiceRationales: shared.choiceRationales
      ? Object.fromEntries(Object.entries(shared.choiceRationales).map(([key, rationale]) => [key.trim().toUpperCase(), rationale.trim()]))
      : undefined,
    needsReview: correctKey ? undefined : true,
    status: "unseen" as const,
    system: cleanOptional(shared.system),
    topic: cleanOptional(shared.topic),
    objective: cleanOptional(shared.objective),
    category: cleanOptional(shared.category),
    subcategory: cleanOptional(shared.subcategory),
    tags: normalizeTagList(shared.tags),
    citation: cleanOptional(shared.citation),
    attempts: [],
    createdAt: now,
    updatedAt: now,
  };
  const result = validateQuestionRecord(projected, new Date(now));
  if (!result.ok || !result.value) {
    throw new Error(`A shared question could not be imported safely: ${result.errors.slice(0, 2).join(" ")}`);
  }
  return result.value;
}

function toShared(question: QuestionRecord, shareId = question.id): SharedQuestion {
  const correctKey = question.correctKey?.trim().toUpperCase();
  const correctAnswerText = correctKey
    ? question.options.find((option) => option.key.trim().toUpperCase() === correctKey)?.text.trim()
    : undefined;
  return {
    id: shareId,
    stem: question.stem,
    options: question.options.map((option) => ({ key: option.key, text: option.text })),
    correctKey,
    correctAnswerText,
    explanation: question.explanation,
    choiceRationales: question.choiceRationales ? { ...question.choiceRationales } : undefined,
    system: question.system,
    topic: question.topic,
    objective: question.objective,
    category: question.category,
    subcategory: question.subcategory,
    tags: [...question.tags],
    citation: question.citation,
  };
}

function existingQuestionShareView(question: QuestionRecord): SharedQuestion | undefined {
  const shared = toShared(question);
  try {
    validateSharedQuestion(shared, 0);
    return shared;
  } catch {
    return undefined;
  }
}

function questionIdentity(question: SharedQuestion): string {
  const rationales = question.choiceRationales
    ? Object.fromEntries(Object.entries(question.choiceRationales)
      .map(([key, value]) => [key.trim().toUpperCase(), value.trim()])
      .sort(([left], [right]) => left.localeCompare(right)))
    : undefined;
  return canonicalJson({
    stem: question.stem.trim(),
    options: question.options.map((option) => ({ key: option.key.trim().toUpperCase(), text: option.text.trim() })),
    correctKey: question.correctKey?.trim().toUpperCase(),
    correctAnswerText: question.correctAnswerText?.trim(),
    explanation: cleanOptional(question.explanation),
    choiceRationales: rationales,
    system: cleanOptional(question.system),
    topic: cleanOptional(question.topic),
    objective: cleanOptional(question.objective),
    category: cleanOptional(question.category),
    subcategory: cleanOptional(question.subcategory),
    tags: normalizeTagList(question.tags),
    citation: cleanOptional(question.citation),
  });
}

function validateImportIdentity(identity: SharedQuestionImportIdentity): void {
  if (!validShareId(identity.shareId)) throw new Error("Shared set identity is invalid.");
  if (!/^[a-f0-9]{64}$/i.test(identity.contentDigest)) throw new Error("Shared set content digest is invalid.");
}

function validShareId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validQuestionId(value: unknown, label: string): string {
  const id = requiredString(value, label, MAX_QUESTION_ID_LENGTH);
  if (id !== value) throw new Error(`${label} must not contain surrounding whitespace.`);
  return id;
}

function validateStringList(value: unknown, label: string, maxItems: number, maxLength: number): void {
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${label} must be an array of at most ${maxItems} strings.`);
  }
  value.forEach((item, index) => requiredString(item, `${label} item ${index + 1}`, maxLength));
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  const clean = value.trim();
  if ([...clean].length > maxLength) throw new Error(`${label} exceeds ${maxLength} characters.`);
  return clean;
}

function optionalString(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, label, maxLength);
}

function validTimestamp(value: unknown, label: string): string {
  const text = requiredString(value, label, 64);
  if (!Number.isFinite(Date.parse(text))) throw new Error(`${label} is invalid.`);
  return text;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string): void {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) throw new Error(`${label} contains unsupported field "${unsupported}".`);
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
