// ===========================================================================
// Labelled records: files where every field carries its own label, one
// record per question, the way an export or an AI clean-up writes them:
//
//   SOURCE: Block 2 quiz          QUESTION_NUMBER: 7        STEM: A 40-year-old ...
//   A. ...  B. ...                CORRECT_ANSWER: C         EXPLANATION: ...
//
// This pass rewrites that shape into the wording the main parser already
// reads ("Question 7", the bare stem, "Answer: C", "Explanation: ...", with
// "Source:" style lines after the choices). It only runs when the text holds
// an unmistakable record label; anything else passes through untouched.
// Nothing is invented and nothing is dropped except empty "CHOICES:" headers.
// ===========================================================================

type FieldKind = "number" | "stem" | "choices" | "answer" | "explanation" | "meta" | "reference" | "objective";

interface Field { kind: FieldKind; label: string; value: string; strong: boolean }

/** Record labels only a labelled file would use; these switch the pass on. */
const NUMBER_KEYS = new Set([
  "question number", "question no", "question num", "question id", "question index",
  "q number", "q no", "q num", "q id", "qid", "item number", "item no", "item id",
]);
const STEM_KEYS = new Set(["stem", "question stem", "question text", "question body", "vignette", "prompt"]);
const CHOICES_KEYS = new Set(["choices", "options", "answer choices", "answer options", "answers choices"]);
const ANSWER_KEYS = new Set([
  "answer", "correct answer", "right answer", "answer key", "correct", "correct option", "correct choice", "correct letter", "key", "ans",
]);
const EXPLANATION_KEYS = new Set([
  "explanation", "answer explanation", "rationale", "reasoning", "discussion", "teaching point", "key concept",
]);
const META_KEYS: Record<string, string> = {
  source: "Source", "source name": "Source", exam: "Source", quiz: "Source",
  topic: "Topic", subtopic: "Topic",
  system: "System", "organ system": "System",
  category: "Category", discipline: "Category",
  subject: "Subject", tags: "Tags", tag: "Tags",
};
const REFERENCE_KEYS = new Set(["reference", "references", "citation"]);
const OBJECTIVE_KEYS = new Set(["objective", "objectives", "learning objective", "learning objectives"]);

const LABEL_RE = /^\s*([A-Za-z][A-Za-z0-9]*(?:[ _-][A-Za-z0-9]+){0,2})\s*[:=]\s*(.*?)\s*$/;

function readField(line: string): Field | null {
  const match = line.match(LABEL_RE);
  if (!match) return null;
  const raw = match[1];
  const key = raw.toLowerCase().replace(/[\s_-]+/g, " ").trim();
  const value = match[2];
  // UPPER_SNAKE or snake_case spelling is itself a sign of a labelled record.
  const snake = raw.includes("_");
  if (NUMBER_KEYS.has(key)) return { kind: "number", label: key, value, strong: true };
  if (STEM_KEYS.has(key)) return { kind: "stem", label: key, value, strong: true };
  if (key === "question") {
    // "Question: 4" numbers a record; "Question: Which drug ..." is a stem.
    // Neither switches the pass on by itself ("Question 4" is ordinary text).
    return /^#?\s*\d{1,4}\s*$/.test(value)
      ? { kind: "number", label: key, value, strong: false }
      : { kind: "stem", label: key, value, strong: false };
  }
  if (CHOICES_KEYS.has(key)) return { kind: "choices", label: key, value, strong: false };
  if (ANSWER_KEYS.has(key)) return { kind: "answer", label: key, value, strong: snake };
  if (EXPLANATION_KEYS.has(key)) return { kind: "explanation", label: key, value, strong: snake };
  if (key in META_KEYS) return { kind: "meta", label: META_KEYS[key], value, strong: false };
  if (REFERENCE_KEYS.has(key)) return { kind: "reference", label: "Reference", value, strong: false };
  if (OBJECTIVE_KEYS.has(key)) return { kind: "objective", label: "Objective", value, strong: false };
  return null;
}

/** True when the text is written as labelled records. */
export function hasLabelledRecords(text: string): boolean {
  return text.split("\n").some((line) => readField(line)?.strong === true);
}

/**
 * Rewrite labelled records into the parser's own wording. Idempotent: its
 * output holds no record labels, so a second pass returns it unchanged.
 */
export function normalizeLabelledRecords(text: string): string {
  const lines = text.split("\n");
  const fields = lines.map(readField);
  if (!fields.some((field) => field?.strong)) return text;

  // Does this file put "SOURCE:" style lines before the question number
  // (they lead the record) or after it (they trail the record)?
  const firstField = fields.find(Boolean);
  const metaLeads = firstField?.kind === "meta";

  const out: string[] = [];
  /** Meta lines of the record being written; they go out after its body. */
  let recordMeta: string[] = [];
  /** Meta lines seen since the last body line: head of the next record, or tail of this one. */
  let looseMeta: string[] = [];
  let open = false;
  let stemSeen = false;
  let lastNumber = 0;

  const keepLooseMeta = () => { recordMeta.push(...looseMeta); looseMeta = []; };
  const closeRecord = () => {
    if (!metaLeads) keepLooseMeta();
    if (recordMeta.length) out.push(...recordMeta);
    recordMeta = [];
  };
  const openRecord = (number: number) => {
    closeRecord();
    if (out.length && out[out.length - 1].trim()) out.push("");
    out.push(`Question ${number}`);
    recordMeta = looseMeta;
    looseMeta = [];
    open = true;
    stemSeen = false;
    lastNumber = number;
  };

  lines.forEach((line, index) => {
    const field = fields[index];
    if (!field) {
      if (line.trim()) keepLooseMeta();
      out.push(line);
      return;
    }
    switch (field.kind) {
      case "number": {
        const digits = field.value.match(/\d{1,4}/);
        openRecord(digits ? Number(digits[0]) : lastNumber + 1);
        break;
      }
      case "stem":
        if (!open || stemSeen) openRecord(lastNumber + 1);
        else keepLooseMeta();
        stemSeen = true;
        if (field.value) out.push(field.value);
        break;
      case "choices":
        keepLooseMeta();
        if (field.value) out.push(field.value);
        break;
      case "answer":
        keepLooseMeta();
        out.push(`Answer: ${field.value}`);
        break;
      case "explanation":
        keepLooseMeta();
        out.push(`Explanation: ${field.value}`);
        break;
      case "meta":
        looseMeta.push(`${field.label}: ${field.value}`);
        break;
      default:
        keepLooseMeta();
        out.push(`${field.label}: ${field.value}`);
    }
  });
  keepLooseMeta();
  if (recordMeta.length) out.push(...recordMeta);
  return out.join("\n");
}
