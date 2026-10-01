// ===========================================================================
// Labelled records: files where every field carries its own label, one
// record per question, the way an export or an AI clean-up writes them:
//
//   SOURCE: Block 2 quiz          QUESTION_NUMBER: 7        STEM: A 40-year-old ...
//   A. ...  B. ...                CORRECT_ANSWER: C         EXPLANATION: ...
//
// or with each label on a line of its own and the value underneath:
//
//   QUESTION NUMBER               ANSWER CHOICES            CORRECT ANSWER
//   29                            A  First choice           C
//
// This pass rewrites both shapes into the wording the main parser already
// reads ("Question 7", the bare stem, "A. ...", "Answer: C", "Explanation:
// ...", with "Source:" style lines after the choices). It only runs when the
// text holds an unmistakable record label; anything else passes through
// untouched. Nothing is invented and nothing is dropped except empty
// "CHOICES:" headers.
// ===========================================================================

type FieldKind = "number" | "stem" | "choices" | "answer" | "explanation" | "meta" | "reference" | "objective" | "keep";

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
  review: "Review", "tags / review": "Review", "review / tags": "Review",
};
/** Fields the main parser reads under their own name; only the spelling is tidied. */
const KEEP_KEYS: Record<string, string> = {
  attachment: "Attachment", attachments: "Attachment", "image / attachment": "Attachment",
  status: "Status", "source marks": "Source marks",
};
const REFERENCE_KEYS = new Set(["reference", "references", "citation"]);
const OBJECTIVE_KEYS = new Set(["objective", "objectives", "learning objective", "learning objectives"]);

const LABEL_RE = /^\s*([A-Za-z][A-Za-z0-9]*(?:(?:\s*\/\s*|[ _-])[A-Za-z0-9]+){0,2})\s*[:=]\s*(.*?)\s*$/;

const labelKey = (raw: string) => raw.toLowerCase().replace(/\s*\/\s*/g, " / ").replace(/[\s_-]+/g, " ").trim();

function readField(line: string): Field | null {
  const match = line.match(LABEL_RE);
  if (!match) return null;
  const raw = match[1];
  const key = labelKey(raw);
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
  if (key in KEEP_KEYS) return { kind: "keep", label: KEEP_KEYS[key], value, strong: false };
  if (REFERENCE_KEYS.has(key)) return { kind: "reference", label: "Reference", value, strong: false };
  if (OBJECTIVE_KEYS.has(key)) return { kind: "objective", label: "Objective", value, strong: false };
  return null;
}

// --- Labels on their own line, value underneath ------------------------------

type BlockKind = "single" | "stem" | "choices" | "explanation" | "list";
/** `label` is the inline spelling the block is rewritten to. */
const BLOCK_LABELS: Record<string, { label: string; kind: BlockKind; strong?: boolean }> = {
  source: { label: "SOURCE", kind: "single" },
  "question number": { label: "QUESTION_NUMBER", kind: "single", strong: true },
  "question no": { label: "QUESTION_NUMBER", kind: "single", strong: true },
  "question #": { label: "QUESTION_NUMBER", kind: "single", strong: true },
  question: { label: "STEM", kind: "stem" },
  stem: { label: "STEM", kind: "stem" },
  "question stem": { label: "STEM", kind: "stem" },
  vignette: { label: "STEM", kind: "stem" },
  "answer choices": { label: "CHOICES", kind: "choices", strong: true },
  "answer options": { label: "CHOICES", kind: "choices", strong: true },
  choices: { label: "CHOICES", kind: "choices" },
  options: { label: "CHOICES", kind: "choices" },
  "correct answer": { label: "CORRECT_ANSWER", kind: "single", strong: true },
  "answer key": { label: "CORRECT_ANSWER", kind: "single" },
  answer: { label: "CORRECT_ANSWER", kind: "single" },
  explanation: { label: "EXPLANATION", kind: "explanation" },
  rationale: { label: "EXPLANATION", kind: "explanation" },
  "tags / review": { label: "Review", kind: "list" },
  "review / tags": { label: "Review", kind: "list" },
  tags: { label: "Tags", kind: "list" },
  review: { label: "Review", kind: "list" },
  attachment: { label: "Attachment", kind: "list" },
  attachments: { label: "Attachment", kind: "list" },
  "image / attachment": { label: "Attachment", kind: "list" },
  status: { label: "Status", kind: "single" },
  topic: { label: "Topic", kind: "single" },
  system: { label: "System", kind: "single" },
};

function readBlockLabel(line: string) {
  const text = line.trim().replace(/\s*:\s*$/, "");
  if (!text || text.length > 24 || !/^[A-Za-z][A-Za-z #/_-]*$/.test(text)) return undefined;
  return BLOCK_LABELS[labelKey(text).replace(/ #$/, " #")];
}

/**
 * "CORRECT ANSWER" on one line and "C" on the next becomes "CORRECT_ANSWER: C",
 * so the record pass below reads both layouts the same way. Only runs when the
 * text holds a label nothing but this layout would put on a line by itself.
 */
function inlineBlockLabels(text: string): string {
  const lines = text.split("\n");
  const labels = lines.map(readBlockLabel);
  if (!labels.some((label) => label?.strong)) return text;
  const out: string[] = [];
  for (let index = 0; index < lines.length;) {
    const block = labels[index];
    if (!block) { out.push(lines[index]); index += 1; continue; }
    let end = index + 1;
    while (end < lines.length && !labels[end]) end += 1;
    const body = lines.slice(index + 1, end);
    const filled = body.map((line) => line.trim()).filter(Boolean);
    if (block.kind === "single") {
      out.push(`${block.label}: ${filled[0] ?? ""}`, ...filled.slice(1));
    } else if (block.kind === "list") {
      out.push(`${block.label}: ${filled.join("; ")}`);
    } else if (block.kind === "choices") {
      // "A  First choice" (letter, gap, text) is how this layout writes a
      // choice. Only the next expected letter counts, so a wrapped line that
      // happens to begin with a capital is left alone.
      let expected = 65;
      for (const line of body) {
        const bare = line.match(/^\s*([A-H])\s+(\S.*)$/);
        if (bare && bare[1].charCodeAt(0) === expected && !/^[).:\-–]/.test(bare[2])) {
          out.push(`${bare[1]}. ${bare[2]}`);
          expected += 1;
        } else {
          if (/^\s*\(?[A-Ha-h][).:]\s/.test(line)) expected += 1;
          out.push(line);
        }
      }
    } else {
      out.push(`${block.label}: ${filled[0] ?? ""}`, ...body.slice(body.findIndex((line) => line.trim()) + 1));
    }
    out.push("");
    index = end;
  }
  return out.join("\n");
}

/** True when the text is written as labelled records. */
export function hasLabelledRecords(text: string): boolean {
  const lines = text.split("\n");
  return lines.some((line) => readField(line)?.strong === true) || lines.some((line) => readBlockLabel(line)?.strong === true);
}

/**
 * Rewrite labelled records into the parser's own wording. Idempotent: its
 * output holds no record labels, so a second pass returns it unchanged.
 */
export function normalizeLabelledRecords(source: string): string {
  const text = inlineBlockLabels(source);
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
