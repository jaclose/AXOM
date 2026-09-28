// ===========================================================================
// AXOM's own Anki note types. Dedicated note types (rather than Anki's
// built-in "Basic"/"Cloze", whose names and fields vary by language) keep the
// sync language-independent and idempotent: every AXOM note carries an
// AxomId field, so AXOM can find its notes with `AxomId:<id>` even after the
// device-local mapping is lost (new device, cleared storage).
//
//   AXOM Basic: Front, Back, Extra, Source, Reverse, AxomId
//               Card 1 asks Front; "Reverse" (non-empty only for
//               basic-reversed cards) adds a second card asking Back.
//   AXOM Cloze: Text, Back Extra, Extra, Source, AxomId
//
// Creating a note type needs no AnkiWeb full sync; AXOM never adds, renames
// or removes fields on an existing note type (that would force one). Styling
// and templates carry a version marker and are refreshed in place.
// ===========================================================================
import type { AnkiClient } from "../ankiConnect";

export const AXOM_NOTE_TYPE_VERSION = 1;
export const AXOM_ID_FIELD = "AxomId";
export const AXOM_BASIC_MODEL = "AXOM Basic";
export const AXOM_CLOZE_MODEL = "AXOM Cloze";
const VERSION_MARKER = `axom-note-type v${AXOM_NOTE_TYPE_VERSION}`;

export type AxomNoteKind = "basic" | "cloze";

export interface NoteTypeTemplate {
  Name: string;
  Front: string;
  Back: string;
}

export interface NoteTypeDefinition {
  kind: AxomNoteKind;
  name: string;
  fields: readonly string[];
  /** Fields AXOM writes from the card's text (everything except AxomId and flags). */
  contentFields: readonly string[];
  isCloze: boolean;
  templates: readonly NoteTypeTemplate[];
  css: string;
}

/** Card styling: AXOM's paper-and-gold look, with a dark variant for Anki's night mode. */
export const AXOM_NOTE_CSS = `/* ${VERSION_MARKER}: managed by AXOM. Edits here are replaced when AXOM updates its note types. */
.card {
  --axom-ink: #211d18;
  --axom-muted: #6f675b;
  --axom-accent: #8a6429;
  --axom-wash: rgba(138, 100, 41, 0.1);
  --axom-line: rgba(33, 29, 24, 0.14);
  --axom-paper: #faf8f3;
  font-family: "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  line-height: 1.55;
  text-align: left;
  color: var(--axom-ink);
  background-color: var(--axom-paper);
}
.card.nightMode, .card.night_mode, .nightMode .card, .night_mode .card {
  --axom-ink: #f3f0e8;
  --axom-muted: #a8a193;
  --axom-accent: #c8a96a;
  --axom-wash: rgba(200, 169, 106, 0.13);
  --axom-line: rgba(243, 240, 232, 0.16);
  --axom-paper: #17181c;
}
.axom-card { max-width: 40em; margin: 0 auto; padding: 1.1em 1.25em 1.4em; }
.axom-q { font-weight: 600; }
.axom-a { margin-top: 0.15em; }
.axom-extra { margin-top: 1.1em; padding: 0.7em 0.95em; border-left: 3px solid var(--axom-accent); border-radius: 0 10px 10px 0; background: var(--axom-wash); font-size: 0.86em; }
.axom-source { margin-top: 0.9em; font-size: 0.72em; letter-spacing: 0.02em; color: var(--axom-muted); }
.axom-source::before { content: "Source \\00B7  "; font-weight: 600; }
.axom-card hr#answer { border: none; border-top: 1px solid var(--axom-line); margin: 0.9em 0; }
.cloze { font-weight: 700; color: var(--axom-accent); }
.nightMode .cloze, .night_mode .cloze { color: var(--axom-accent); }
`;

const extras = `{{#Extra}}<div class="axom-extra">{{Extra}}</div>{{/Extra}}
{{#Source}}<div class="axom-source">{{Source}}</div>{{/Source}}`;

export const AXOM_NOTE_TYPES: Record<AxomNoteKind, NoteTypeDefinition> = {
  basic: {
    kind: "basic",
    name: AXOM_BASIC_MODEL,
    fields: ["Front", "Back", "Extra", "Source", "Reverse", AXOM_ID_FIELD],
    contentFields: ["Front", "Back", "Extra", "Source"],
    isCloze: false,
    css: AXOM_NOTE_CSS,
    templates: [
      {
        Name: "Card 1",
        Front: `<div class="axom-card"><div class="axom-q">{{Front}}</div></div>`,
        Back: `<div class="axom-card">
<div class="axom-q">{{Front}}</div>
<hr id="answer">
<div class="axom-a">{{Back}}</div>
${extras}
</div>`,
      },
      {
        Name: "Reverse",
        Front: `{{#Reverse}}<div class="axom-card"><div class="axom-q">{{Back}}</div></div>{{/Reverse}}`,
        Back: `{{#Reverse}}<div class="axom-card">
<div class="axom-q">{{Back}}</div>
<hr id="answer">
<div class="axom-a">{{Front}}</div>
${extras}
</div>{{/Reverse}}`,
      },
    ],
  },
  cloze: {
    kind: "cloze",
    name: AXOM_CLOZE_MODEL,
    fields: ["Text", "Back Extra", "Extra", "Source", AXOM_ID_FIELD],
    contentFields: ["Text", "Back Extra", "Extra", "Source"],
    isCloze: true,
    css: AXOM_NOTE_CSS,
    templates: [
      {
        Name: "Cloze",
        Front: `<div class="axom-card"><div class="axom-q">{{cloze:Text}}</div></div>`,
        Back: `<div class="axom-card">
<div class="axom-q">{{cloze:Text}}</div>
{{#Back Extra}}<hr id="answer"><div class="axom-a">{{Back Extra}}</div>{{/Back Extra}}
${extras}
</div>`,
      },
    ],
  },
};

export function noteTypeFor(modelName: string): NoteTypeDefinition | undefined {
  return Object.values(AXOM_NOTE_TYPES).find((definition) => definition.name === modelName);
}

export type NoteTypeState = "missing" | "ready" | "outdated" | "incompatible";

export interface NoteTypeStatus {
  kind: AxomNoteKind;
  name: string;
  state: NoteTypeState;
  missingFields: string[];
}

/** Read-only check of both AXOM note types in the collection. */
export async function inspectNoteTypes(client: AnkiClient): Promise<NoteTypeStatus[]> {
  const names = await client.call<string[]>("modelNames");
  const present = Object.values(AXOM_NOTE_TYPES).filter((definition) => names.includes(definition.name));
  const details = present.length
    ? await client.multi(present.flatMap((definition) => [
      { action: "modelFieldNames", params: { modelName: definition.name } },
      { action: "modelStyling", params: { modelName: definition.name } },
    ]))
    : [];
  return Object.values(AXOM_NOTE_TYPES).map((definition): NoteTypeStatus => {
    const index = present.indexOf(definition);
    if (index < 0) return { kind: definition.kind, name: definition.name, state: "missing", missingFields: [] };
    const fieldsReply = details[index * 2];
    const stylingReply = details[index * 2 + 1];
    const fields = fieldsReply?.ok && Array.isArray(fieldsReply.result) ? fieldsReply.result as string[] : [];
    const missingFields = definition.fields.filter((field) => !fields.includes(field));
    if (missingFields.length) return { kind: definition.kind, name: definition.name, state: "incompatible", missingFields };
    const css = stylingReply?.ok && stylingReply.result && typeof (stylingReply.result as { css?: unknown }).css === "string"
      ? (stylingReply.result as { css: string }).css
      : "";
    return { kind: definition.kind, name: definition.name, state: css.includes(VERSION_MARKER) ? "ready" : "outdated", missingFields: [] };
  });
}

export class NoteTypeConflictError extends Error {
  constructor(readonly statuses: NoteTypeStatus[]) {
    const bad = statuses.filter((status) => status.state === "incompatible");
    super(bad.map((status) => `Anki already has a note type named "${status.name}" without the field${status.missingFields.length === 1 ? "" : "s"} ${status.missingFields.join(", ")}. Rename that note type in Anki (Tools → Manage Note Types), then link again; AXOM will create its own.`).join(" "));
    this.name = "NoteTypeConflictError";
  }
}

export interface EnsureNoteTypesResult {
  created: string[];
  updated: string[];
  statuses: NoteTypeStatus[];
}

/**
 * Create missing AXOM note types and refresh outdated styling/templates.
 * Throws NoteTypeConflictError when a same-named note type lacks AXOM's fields.
 */
export async function ensureNoteTypes(client: AnkiClient): Promise<EnsureNoteTypesResult> {
  const statuses = await inspectNoteTypes(client);
  if (statuses.some((status) => status.state === "incompatible")) throw new NoteTypeConflictError(statuses);
  const created: string[] = [];
  const updated: string[] = [];
  for (const status of statuses) {
    const definition = AXOM_NOTE_TYPES[status.kind];
    if (status.state === "missing") {
      await client.call("createModel", {
        modelName: definition.name,
        inOrderFields: [...definition.fields],
        css: definition.css,
        isCloze: definition.isCloze,
        cardTemplates: definition.templates.map((template) => ({ ...template })),
      });
      created.push(definition.name);
    } else if (status.state === "outdated") {
      await client.multi([
        { action: "updateModelStyling", params: { model: { name: definition.name, css: definition.css } } },
        {
          action: "updateModelTemplates",
          params: { model: { name: definition.name, templates: Object.fromEntries(definition.templates.map((template) => [template.Name, { Front: template.Front, Back: template.Back }])) } },
        },
      ]);
      updated.push(definition.name);
    }
  }
  return {
    created,
    updated,
    statuses: statuses.map((status) => (status.state === "incompatible" ? status : { ...status, state: "ready" })),
  };
}
