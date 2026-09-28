// ===========================================================================
// AXOM card → the Anki note AXOM wants to exist. Pure: the sync engine
// compares this desired note with what it last pushed (hashes) to decide what
// to add, update or move, and never needs Anki to tell it what changed.
//
// Card text is plain text in AXOM, HTML in Anki: text is escaped and line
// breaks become <br>. Cloze syntax passes through unchanged. Text is
// normalized to NFC because Anki stores fields that way, so a hash of what
// was pushed matches what Anki later reports.
// ===========================================================================
import type { AnkiCard } from "../ankiCards";
import { courseLabel, type CourseCatalog } from "./courseAdapter";
import { ankiDeckPathFor, lectureLabelFor, type CardPlacement, type DeckLayoutOptions } from "./deckLayout";
import { AXOM_ID_FIELD, AXOM_NOTE_TYPES, type AxomNoteKind } from "./noteTypes";

export const AXOM_TAG = "AXOM";
/** Tags with meaning in Anki itself; an AXOM tag never sets them. */
const RESERVED_TAGS = new Set(["leech", "marked"]);

export interface DesiredNote {
  kind: AxomNoteKind;
  modelName: string;
  deckName: string;
  /** Every field of the note type, AxomId included. */
  fields: Record<string, string>;
  /** Tags AXOM manages on this note (tags added in Anki are left alone). */
  tags: string[];
  suspended: boolean;
}

export function noteKindFor(card: Pick<AnkiCard, "type">): AxomNoteKind {
  return card.type === "cloze" ? "cloze" : "basic";
}

/** Plain text → Anki field HTML. */
export function textToAnkiHtml(text: string | undefined): string {
  if (!text) return "";
  return text
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** Anki field HTML → plain text (to bring an Anki-side edit back into AXOM). */
export function ankiHtmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    // Anki's editor wraps new lines in <div>: an opening block starts a line.
    .replace(/<(div|p|h[1-6]|tr)(\s[^>]*)?>/gi, "\n")
    .replace(/<\/(li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A lowercase, hyphenated tag component: "BPM 501" → "bpm-501". */
export function tagSlug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "untitled";
}

/** An Anki tag from free text: no spaces, quotes or control characters. */
export function sanitizeTag(tag: string): string {
  return String(tag ?? "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/^:+|:+$/g, "")
    .slice(0, 100);
}

function uniqueCaseInsensitive(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** AXOM plus a course/module(/lecture) tag, plus the card's own tags. */
export function axomTagsFor(card: CardPlacement & Pick<AnkiCard, "tags">, catalog: CourseCatalog): string[] {
  const tags = [AXOM_TAG];
  const course = catalog.course(card.courseId);
  if (course) {
    const parts = [tagSlug(courseLabel(course))];
    const module = catalog.module(card.moduleId);
    if (module && module.courseId === course.id) {
      parts.push(tagSlug(module.name));
      const lecture = lectureLabelFor(card, catalog);
      if (lecture) parts.push(tagSlug(lecture));
    }
    tags.push(`${AXOM_TAG}::${parts.join("::")}`);
  }
  for (const tag of card.tags ?? []) {
    const clean = sanitizeTag(tag);
    if (clean && !RESERVED_TAGS.has(clean.toLowerCase())) tags.push(clean);
  }
  return uniqueCaseInsensitive(tags);
}

export function buildDesiredNote(card: AnkiCard, catalog: CourseCatalog, layout: DeckLayoutOptions): DesiredNote {
  const kind = noteKindFor(card);
  const definition = AXOM_NOTE_TYPES[kind];
  const fields: Record<string, string> = kind === "cloze"
    ? {
        Text: textToAnkiHtml(card.front),
        "Back Extra": textToAnkiHtml(card.back),
        Extra: textToAnkiHtml(card.extra),
        Source: textToAnkiHtml(card.source),
        [AXOM_ID_FIELD]: card.id,
      }
    : {
        Front: textToAnkiHtml(card.front),
        Back: textToAnkiHtml(card.back),
        Extra: textToAnkiHtml(card.extra),
        Source: textToAnkiHtml(card.source),
        Reverse: card.type === "basic-reversed" ? "y" : "",
        [AXOM_ID_FIELD]: card.id,
      };
  return {
    kind,
    modelName: definition.name,
    deckName: ankiDeckPathFor(card, catalog, layout),
    fields,
    tags: axomTagsFor(card, catalog),
    suspended: card.suspended === true,
  };
}

/** Fields AXOM writes and watches for Anki-side edits (everything but AxomId). */
export function managedFieldNames(kind: AxomNoteKind): string[] {
  return AXOM_NOTE_TYPES[kind].fields.filter((field) => field !== AXOM_ID_FIELD);
}

/** cyrb53: a fast, well-distributed 53-bit string hash, base-36 encoded. */
export function hashText(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Hash of the managed fields, comparable between AXOM's desired note and Anki's copy. */
export function fieldsHash(fields: Record<string, string | undefined>, kind: AxomNoteKind): string {
  return hashText(managedFieldNames(kind).map((name) => `${name}\u0000${(fields[name] ?? "").normalize("NFC")}`).join("\u0001"));
}

/** Everything that decides whether a card needs another push. */
export function noteFingerprint(note: DesiredNote): string {
  return hashText(JSON.stringify([
    note.modelName,
    note.deckName.toLowerCase(),
    fieldsHash(note.fields, note.kind),
    note.tags.map((tag) => tag.toLowerCase()).sort(),
    note.suspended,
  ]));
}
