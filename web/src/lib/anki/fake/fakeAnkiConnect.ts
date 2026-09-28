// ===========================================================================
// In-memory fake AnkiConnect (tests and e2e only; never imported by the app).
// It models the parts of Anki + AnkiConnect v6 that AXOM relies on, with the
// real add-on's semantics where they matter:
//  - HTTP: CORS origin allow-list (127.0.0.1:* trusted when http://localhost
//    is listed), preflight answers, 403 for untrusted origins, and
//    requestPermission accepted from any origin (with a simulated Anki dialog).
//  - The optional apiKey, checked for every action except requestPermission,
//    including each sub-action of `multi`.
//  - Decks (case-insensitive, nested, created with parents), note types with
//    templates and CSS, notes/cards with numeric ids, card generation (cloze
//    numbers, conditional templates), first-field duplicate checks, tags with
//    hierarchy, suspension, deck moves, filtered-deck home decks.
//  - Scheduling state (type/queue/due/ivl/factor/reps/lapses), a review log,
//    and the search syntax in fakeSearch.ts.
//  - Quirks AXOM must survive: addNotes returning null per failure (older
//    add-on) or throwing after the batch (newer), cardReviews reading only the
//    exact deck (not subdecks) and creating a deck that does not exist.
// ===========================================================================
import { compileSearch, type SearchCard, type SearchContext, type SearchNote } from "./fakeSearch";

export interface FakeTemplate {
  Name: string;
  Front: string;
  Back: string;
}

export interface FakeModel {
  id: number;
  name: string;
  fields: string[];
  templates: FakeTemplate[];
  css: string;
  isCloze: boolean;
}

export interface FakeNote {
  id: number;
  modelId: number;
  fields: string[];
  tags: string[];
  mod: number;
}

export interface FakeCard extends SearchCard {
  ord: number;
  left: number;
  mod: number;
}

export interface FakeReview {
  id: number;
  cid: number;
  usn: number;
  ease: number;
  ivl: number;
  lastIvl: number;
  factor: number;
  time: number;
  type: number;
}

export interface FakeAnkiOptions {
  /** Epoch ms for "now". Defaults to 2026-09-20T12:00:00Z; advance with advanceDays(). */
  startMs?: number;
  apiKey?: string | null;
  webCorsOriginList?: string[];
  ignoreOriginList?: string[];
  /** Simulates Anki's "A website wants to access Anki" dialog. Default: Yes. */
  answerPermission?: (origin: string) => "yes" | "no" | "no-and-ignore";
  apiVersion?: number;
  /** "nulls": older add-on (null per failed note). "throw": newer (throws after trying all). */
  addNotesFailure?: "nulls" | "throw";
  unsupportedActions?: string[];
  /** Hour of the day (UTC) when a new Anki day starts. */
  rolloverHour?: number;
}

export interface FakeHttpRequest {
  method: string;
  origin?: string | null;
  body?: string;
  headers?: Record<string, string | undefined>;
}

export interface FakeHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface FakeNoteInput {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
  options?: {
    allowDuplicate?: boolean;
    duplicateScope?: string;
    duplicateScopeOptions?: { deckName?: string | null; checkChildren?: boolean; checkAllModels?: boolean };
  };
}

const DAY_MS = 86_400_000;
const DEFAULT_START_MS = Date.UTC(2026, 8, 20, 12, 0, 0);

type Params = Record<string, any>;
type Handler = (params: Params) => unknown;

class ActionError extends Error {}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function normalizeDeckName(name: string): string {
  return String(name).split("::").map((part) => part.trim() || "blank").join("::");
}

function renderCloze(text: string, ord: number, answer: boolean): string {
  return text.replace(/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g, (_match, number: string, body: string, hint?: string) => {
    if (Number(number) !== ord) return body;
    return answer ? `<span class="cloze">${body}</span>` : `<span class="cloze">[${hint ?? "..."}]</span>`;
  });
}

function renderTemplate(template: string, fields: Record<string, string>, options: { cloze?: number; answer?: boolean; frontSide?: string } = {}): string {
  const lookup = (name: string) => {
    const key = Object.keys(fields).find((field) => field.toLowerCase() === name.trim().toLowerCase());
    return key ? fields[key] : "";
  };
  let out = template.replace(/\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_match, kind: string, name: string, inner: string) => {
    const nonEmpty = stripHtml(lookup(name)).length > 0;
    return (kind === "#") === nonEmpty ? inner : "";
  });
  out = out.replace(/\{\{([^}]+)\}\}/g, (_match, raw: string) => {
    const name = raw.trim();
    if (name === "FrontSide") return options.frontSide ?? "";
    const split = name.lastIndexOf(":");
    const filter = split >= 0 ? name.slice(0, split).toLowerCase() : "";
    const field = split >= 0 ? name.slice(split + 1) : name;
    const value = lookup(field);
    if (filter === "cloze") return renderCloze(value, options.cloze ?? 1, options.answer ?? false);
    if (filter === "text") return value.replace(/<[^>]*>/g, "");
    return value;
  });
  return out;
}

function clozeNumbers(text: string): number[] {
  return [...new Set([...text.matchAll(/\{\{c(\d+)::/g)].map((match) => Number(match[1])))].filter((n) => n > 0).sort((a, b) => a - b);
}

export class FakeAnkiConnect {
  readonly decks = new Map<number, { id: number; name: string }>();
  readonly models = new Map<number, FakeModel>();
  readonly notes = new Map<number, FakeNote>();
  readonly cards = new Map<number, FakeCard>();
  readonly revlog: FakeReview[] = [];
  readonly tagRegistry = new Set<string>();
  /** Every action handled, in order (sub-actions of multi included). */
  readonly log: Array<{ action: string; params: Params }> = [];
  /** The last query the "Anki browser" was opened with (guiBrowse). */
  lastBrowserQuery: string | null = null;
  /** Origins that were shown Anki's permission dialog. */
  readonly permissionPrompts: string[] = [];
  /** Simulate Anki being closed: the fetch adapter and server refuse connections. */
  offline = false;
  apiKey: string | null;
  webCorsOriginList: string[];
  ignoreOriginList: string[];
  answerPermission: (origin: string) => "yes" | "no" | "no-and-ignore";
  apiVersion: number;
  addNotesFailure: "nulls" | "throw";
  unsupportedActions: Set<string>;

  private clockMs: number;
  private readonly crtMs: number;
  private readonly rolloverHour: number;
  private nextIdValue = 1_690_000_000_000;
  private readonly reviewIds = new Set<number>();
  private newPosition = 1;
  private readonly handlers: Record<string, Handler>;

  constructor(options: FakeAnkiOptions = {}) {
    this.clockMs = options.startMs ?? DEFAULT_START_MS;
    this.rolloverHour = options.rolloverHour ?? 4;
    // The collection is ~2 years old, so premade cards can carry long intervals.
    this.crtMs = this.dayStartMs() - 730 * DAY_MS;
    this.apiKey = options.apiKey ?? null;
    this.webCorsOriginList = [...(options.webCorsOriginList ?? ["http://localhost"])];
    this.ignoreOriginList = [...(options.ignoreOriginList ?? [])];
    this.answerPermission = options.answerPermission ?? (() => "yes");
    this.apiVersion = options.apiVersion ?? 6;
    this.addNotesFailure = options.addNotesFailure ?? "nulls";
    this.unsupportedActions = new Set(options.unsupportedActions ?? []);
    this.decks.set(1, { id: 1, name: "Default" });
    this.handlers = this.buildHandlers();
  }

  // --- clock ---------------------------------------------------------------------

  nowMs(): number {
    return this.clockMs;
  }

  /** Start of the current Anki day (the rollover hour, UTC). */
  dayStartMs(at = this.clockMs): number {
    const shifted = at - this.rolloverHour * 3_600_000;
    return Math.floor(shifted / DAY_MS) * DAY_MS + this.rolloverHour * 3_600_000;
  }

  /** Days elapsed since the collection was created. */
  today(): number {
    return Math.round((this.dayStartMs() - this.crtMs) / DAY_MS);
  }

  advanceDays(days: number): void {
    this.clockMs += days * DAY_MS;
  }

  advanceMs(ms: number): void {
    this.clockMs += ms;
  }

  private nextId(): number {
    this.nextIdValue += 1;
    return this.nextIdValue;
  }

  // --- HTTP ------------------------------------------------------------------------

  private allowOrigin(origin: string | null | undefined): { allowed: boolean; corsOrigin: string } {
    const list = this.webCorsOriginList;
    if (list.includes("*")) return { allowed: true, corsOrigin: "*" };
    if (!origin) return { allowed: true, corsOrigin: "http://localhost" };
    if (list.includes(origin)) return { allowed: true, corsOrigin: origin };
    if (list.includes("http://localhost") && (
      origin === "http://127.0.0.1" || origin === "https://127.0.0.1" || origin.startsWith("http://127.0.0.1:") ||
      origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://") || origin.startsWith("safari-web-extension://")
    )) return { allowed: true, corsOrigin: origin };
    return { allowed: false, corsOrigin: "http://localhost" };
  }

  /** One HTTP exchange, answered the way AnkiConnect's web server answers it. */
  handle(request: FakeHttpRequest): FakeHttpResponse {
    const { allowed, corsOrigin } = this.allowOrigin(request.origin);
    const baseHeaders = { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Headers": "*" };
    if (request.method.toUpperCase() === "OPTIONS") {
      const headers: Record<string, string> = { ...baseHeaders, "Content-Type": "application/json" };
      if (request.headers?.["access-control-request-private-network"] === "true") headers["Access-Control-Allow-Private-Network"] = "true";
      return { status: 200, headers, body: "" };
    }
    let payload: Params;
    try {
      const parsed = JSON.parse(request.body ?? "");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || typeof parsed.action !== "string" || !parsed.action) {
        throw new Error("'action' is a required property");
      }
      payload = parsed as Params;
    } catch (error) {
      if (allowed) {
        const body = request.body ? JSON.stringify({ result: null, error: (error as Error).message }) : `AnkiConnect v.${this.apiVersion}`;
        return { status: 200, headers: { ...baseHeaders, "Content-Type": "application/json" }, body };
      }
      payload = {};
    }
    if (allowed || payload.action === "requestPermission") {
      let responseOrigin = corsOrigin;
      if (payload.action === "requestPermission") {
        payload = { ...payload, params: { ...(payload.params ?? {}), allowed, origin: request.origin ?? "" } };
        if (!allowed) responseOrigin = request.origin ?? "";
      }
      const reply = this.dispatch(payload);
      return {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": responseOrigin, "Access-Control-Allow-Headers": "*" },
        body: JSON.stringify(reply),
      };
    }
    return { status: 403, headers: baseHeaders, body: "" };
  }

  /** AnkiConnect's request handler: key check, action lookup, reply format. */
  dispatch(request: Params): unknown {
    const action = String(request.action ?? "");
    const version = typeof request.version === "number" ? request.version : 4;
    const params = request.params && typeof request.params === "object" ? request.params as Params : {};
    let reply: unknown;
    try {
      if ((request.key ?? null) !== this.apiKey && action !== "requestPermission") throw new ActionError("valid api key must be provided");
      const handler = this.handlers[action];
      if (!handler || this.unsupportedActions.has(action)) throw new ActionError("unsupported action");
      this.log.push({ action, params });
      const result = handler(params);
      reply = version <= 4 ? result : { result: result ?? null, error: null };
    } catch (error) {
      reply = { result: null, error: error instanceof Error ? error.message : String(error) };
    }
    return reply;
  }

  /** Convenience for tests: call one action directly (no HTTP, no key). */
  call<T = unknown>(action: string, params: Params = {}): T {
    const reply = this.dispatch({ action, version: 6, params, key: this.apiKey }) as { result: T; error: string | null };
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }

  actionsCalled(action?: string): string[] {
    return this.log.map((entry) => entry.action).filter((name) => !action || name === action);
  }

  // --- collection helpers ------------------------------------------------------------

  deckByName(name: string): { id: number; name: string } | undefined {
    const wanted = normalizeDeckName(name).toLowerCase();
    return [...this.decks.values()].find((deck) => deck.name.toLowerCase() === wanted);
  }

  /** decks.id(name): the existing deck, or a new one (parents created too). */
  ensureDeck(name: string): number {
    const normalized = normalizeDeckName(name);
    const existing = this.deckByName(normalized);
    if (existing) return existing.id;
    const parts = normalized.split("::");
    let id = 0;
    for (let depth = 1; depth <= parts.length; depth += 1) {
      const path = parts.slice(0, depth).join("::");
      const found = this.deckByName(path);
      if (found) { id = found.id; continue; }
      id = this.nextId();
      this.decks.set(id, { id, name: path });
    }
    return id;
  }

  deckNameOf(did: number): string | undefined {
    return this.decks.get(did)?.name;
  }

  modelByName(name: string): FakeModel | undefined {
    return [...this.models.values()].find((model) => model.name === name);
  }

  private noteFieldMap(note: FakeNote): Record<string, string> {
    const model = this.models.get(note.modelId)!;
    return Object.fromEntries(model.fields.map((field, index) => [field, note.fields[index] ?? ""]));
  }

  private registerTags(tags: string[]): void {
    for (const tag of tags) {
      const parts = tag.split("::");
      for (let depth = 1; depth <= parts.length; depth += 1) this.tagRegistry.add(parts.slice(0, depth).join("::"));
    }
  }

  private cardOrdsFor(note: FakeNote): number[] {
    const model = this.models.get(note.modelId)!;
    const fields = this.noteFieldMap(note);
    if (model.isCloze) {
      const clozeFields = new Set<string>();
      for (const template of model.templates) {
        for (const match of template.Front.matchAll(/\{\{cloze:([^}]+)\}\}/g)) clozeFields.add(match[1].trim().toLowerCase());
      }
      const numbers = new Set<number>();
      for (const [name, value] of Object.entries(fields)) {
        if (clozeFields.has(name.toLowerCase())) clozeNumbers(value).forEach((n) => numbers.add(n));
      }
      return [...numbers].sort((a, b) => a - b).map((n) => n - 1);
    }
    return model.templates
      .map((template, ord) => ({ ord, front: stripHtml(renderTemplate(template.Front, fields)) }))
      .filter((entry) => entry.front.length > 0)
      .map((entry) => entry.ord);
  }

  /** Create any cards the note's fields now call for (Anki does this on add and update). */
  private generateCards(note: FakeNote, did: number): number {
    const existing = new Set([...this.cards.values()].filter((card) => card.nid === note.id).map((card) => card.ord));
    let created = 0;
    for (const ord of this.cardOrdsFor(note)) {
      if (existing.has(ord)) continue;
      const id = this.nextId();
      this.cards.set(id, {
        id, nid: note.id, did, odid: 0, ord, type: 0, queue: 0, due: this.newPosition++, ivl: 0, factor: 0, reps: 0, lapses: 0, left: 0, mod: Math.floor(this.clockMs / 1000),
      });
      created += 1;
    }
    return created;
  }

  private isDuplicate(model: FakeModel, first: string, input: FakeNoteInput, did: number): boolean {
    const key = stripHtml(first);
    const options = input.options ?? {};
    let scopeDecks: Set<number> | null = null;
    if (options.duplicateScope === "deck") {
      const scopeName = options.duplicateScopeOptions?.deckName;
      const scopeDeck = scopeName ? this.deckByName(scopeName) : this.decks.get(did);
      if (!scopeDeck) return false;
      scopeDecks = new Set([scopeDeck.id]);
      if (options.duplicateScopeOptions?.checkChildren) {
        for (const deck of this.decks.values()) if (deck.name.toLowerCase().startsWith(`${scopeDeck.name.toLowerCase()}::`)) scopeDecks.add(deck.id);
      }
    }
    const checkAllModels = options.duplicateScopeOptions?.checkAllModels === true;
    for (const note of this.notes.values()) {
      if (!checkAllModels && note.modelId !== model.id) continue;
      if (stripHtml(note.fields[0] ?? "") !== key) continue;
      if (!scopeDecks) return true;
      const inScope = [...this.cards.values()].some((card) => card.nid === note.id && scopeDecks!.has(card.did));
      if (inScope) return true;
    }
    return false;
  }

  /** AnkiConnect's createNote + addNote. */
  private addNoteInternal(input: FakeNoteInput): number {
    if (!input || typeof input !== "object") throw new ActionError("note must be an object");
    const model = this.modelByName(input.modelName);
    if (!model) throw new ActionError(`model was not found: ${input.modelName}`);
    const deck = this.deckByName(input.deckName ?? "");
    if (!deck) throw new ActionError(`deck was not found: ${input.deckName}`);
    const fields = model.fields.map(() => "");
    for (const [name, value] of Object.entries(input.fields ?? {})) {
      const index = model.fields.findIndex((field) => field.toLowerCase() === name.toLowerCase());
      if (index >= 0) fields[index] = String(value);
    }
    if (input.options?.allowDuplicate !== undefined && typeof input.options.allowDuplicate !== "boolean") {
      throw new ActionError('option parameter "allowDuplicate" must be boolean');
    }
    if (!stripHtml(fields[0] ?? "")) throw new ActionError("cannot create note because it is empty");
    if (this.isDuplicate(model, fields[0], input, deck.id) && input.options?.allowDuplicate !== true) {
      throw new ActionError("cannot create note because it is a duplicate");
    }
    const note: FakeNote = { id: this.nextId(), modelId: model.id, fields, tags: [...new Set(input.tags ?? [])], mod: Math.floor(this.clockMs / 1000) };
    if (this.cardOrdsFor(note).length === 0) {
      throw new ActionError("The field values you have provided would make an empty question on all cards.");
    }
    this.notes.set(note.id, note);
    this.registerTags(note.tags);
    this.generateCards(note, deck.id);
    return note.id;
  }

  private requireNote(id: unknown): FakeNote {
    const note = this.notes.get(Number(id));
    if (!note) throw new ActionError(`Note was not found: ${String(id)}`);
    return note;
  }

  private searchContext(): SearchContext {
    const dayStart = this.dayStartMs();
    const notes = new Map<number, SearchNote>();
    return {
      today: this.today(),
      nowMs: this.clockMs,
      dayStartMs: dayStart,
      deckName: (did) => this.deckNameOf(did),
      note: (nid) => {
        const cached = notes.get(nid);
        if (cached) return cached;
        const note = this.notes.get(nid);
        if (!note) return undefined;
        const model = this.models.get(note.modelId)!;
        const view: SearchNote = { id: nid, modelName: model.name, fieldNames: model.fields, fields: note.fields, tags: note.tags };
        notes.set(nid, view);
        return view;
      },
      ratedSince: (sinceMs) => new Set(this.revlog.filter((entry) => entry.id >= sinceMs && entry.ease > 0).map((entry) => entry.cid)),
    };
  }

  findCardIds(query: string): number[] {
    let predicate;
    try {
      predicate = compileSearch(query ?? "");
    } catch (error) {
      throw new ActionError(`Invalid search: ${(error as Error).message}`);
    }
    const ctx = this.searchContext();
    return [...this.cards.values()].filter((card) => predicate(card, ctx)).map((card) => card.id).sort((a, b) => a - b);
  }

  private dueToday(card: FakeCard): boolean {
    return ((card.queue === 2 || card.queue === 3) && card.due <= this.today()) || (card.queue === 1 && card.due * 1000 <= this.clockMs + 20 * 60_000);
  }

  // --- scheduling simulation ------------------------------------------------------------

  /** Answer a card like a learner in Anki (simplified SM-2 with a review-log entry). */
  answer(cardId: number, ease: 1 | 2 | 3 | 4, atMs = this.clockMs): void {
    const card = this.cards.get(cardId);
    if (!card) throw new Error(`No card ${cardId}`);
    const today = this.today();
    const lastIvl = card.type === 2 ? card.ivl : card.type === 1 || card.type === 0 ? -60 : -600;
    let reviewType = card.type === 2 ? 1 : card.type === 3 ? 2 : 0;
    if (card.queue === -1) throw new Error("Suspended cards cannot be answered");
    card.reps += 1;
    if (card.type === 0 || card.type === 1) {
      reviewType = 0;
      if (ease === 1) { card.type = 1; card.queue = 1; card.due = Math.floor(atMs / 1000) + 60; card.ivl = 0; }
      else if (ease === 4 || (ease === 3 && card.type === 1)) {
        card.type = 2; card.queue = 2; card.ivl = ease === 4 ? 4 : 1; card.due = today + card.ivl; card.factor = card.factor || 2500;
      } else { card.type = 1; card.queue = 1; card.due = Math.floor(atMs / 1000) + 600; }
    } else if (card.type === 3) {
      if (ease === 1) { card.due = Math.floor(atMs / 1000) + 600; }
      else { card.type = 2; card.queue = 2; card.due = today + Math.max(1, card.ivl); }
    } else {
      const factor = card.factor || 2500;
      if (ease === 1) {
        card.lapses += 1;
        card.factor = Math.max(1300, factor - 200);
        card.type = 3; card.queue = 1; card.ivl = 1; card.due = Math.floor(atMs / 1000) + 600;
        if (card.lapses >= 8) {
          const note = this.notes.get(card.nid)!;
          if (!note.tags.some((tag) => tag.toLowerCase() === "leech")) { note.tags.push("leech"); this.registerTags(["leech"]); }
        }
      } else {
        const next = ease === 2 ? card.ivl * 1.2 : ease === 3 ? card.ivl * factor / 1000 : card.ivl * factor / 1000 * 1.3;
        card.ivl = Math.max(card.ivl + 1, Math.round(next));
        card.factor = ease === 2 ? Math.max(1300, factor - 150) : ease === 4 ? factor + 150 : factor;
        card.due = today + card.ivl;
      }
    }
    card.mod = Math.floor(atMs / 1000);
    this.revlog.push({ id: this.uniqueReviewId(atMs), cid: card.id, usn: -1, ease, ivl: card.type === 2 ? card.ivl : -600, lastIvl, factor: card.factor, time: 6000, type: reviewType });
  }

  private uniqueReviewId(atMs: number): number {
    let id = Math.floor(atMs);
    while (this.reviewIds.has(id)) id += 1;
    this.reviewIds.add(id);
    return id;
  }

  /** Test setup: put a card straight into a scheduling state. */
  setCard(cardId: number, patch: Partial<Omit<FakeCard, "id" | "nid">>): void {
    const card = this.cards.get(cardId);
    if (!card) throw new Error(`No card ${cardId}`);
    Object.assign(card, patch);
  }

  /** Test setup: a mature review card due `dueInDays` from today. */
  makeReviewCard(cardId: number, ivl: number, dueInDays = 3, extra: Partial<FakeCard> = {}): void {
    this.setCard(cardId, { type: 2, queue: 2, ivl, due: this.today() + dueInDays, factor: 2500, reps: Math.max(1, Math.round(Math.log2(ivl + 1)) + 2), ...extra });
  }

  /** Test setup: a review-log row (reviewType 1 = review, 0 = learn, 2 = relearn). */
  addReview(entry: { cid: number; ease: number; atMs: number; lastIvl: number; ivl?: number; type?: number }): void {
    this.revlog.push({
      id: this.uniqueReviewId(entry.atMs), cid: entry.cid, usn: -1, ease: entry.ease, ivl: entry.ivl ?? entry.lastIvl, lastIvl: entry.lastIvl,
      factor: 2500, time: 5000, type: entry.type ?? 1,
    });
  }

  /** Test setup: a premade-style deck of cloze notes (AnKing-like tags). */
  seedPremadeDeck(deckName: string, notes: Array<{ text: string; tags: string[]; extra?: string }>, modelName = "AnKingOverhaul"): number[] {
    if (!this.modelByName(modelName)) {
      this.call("createModel", {
        modelName, inOrderFields: ["Text", "Extra", "Lecture Notes"], isCloze: true,
        css: ".card { font-family: arial; }",
        cardTemplates: [{ Name: "Cloze", Front: "{{cloze:Text}}", Back: "{{cloze:Text}}<br>{{Extra}}" }],
      });
    }
    this.ensureDeck(deckName);
    const cardIds: number[] = [];
    for (const note of notes) {
      const id = this.addNoteInternal({ deckName, modelName, fields: { Text: note.text, Extra: note.extra ?? "" }, tags: note.tags, options: { allowDuplicate: true } });
      cardIds.push(...[...this.cards.values()].filter((card) => card.nid === id).map((card) => card.id));
    }
    return cardIds;
  }

  // --- actions ----------------------------------------------------------------------------

  private buildHandlers(): Record<string, Handler> {
    const numbers = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number) : []);
    const deckTotals = (deckId: number) => {
      const name = this.deckNameOf(deckId)!.toLowerCase();
      const inTree = [...this.cards.values()].filter((card) => {
        const deck = this.deckNameOf(card.did)?.toLowerCase() ?? "";
        return deck === name || deck.startsWith(`${name}::`);
      });
      return {
        deck_id: deckId,
        name: this.deckNameOf(deckId)!.split("::").pop()!,
        new_count: inTree.filter((card) => card.queue === 0).length,
        learn_count: inTree.filter((card) => card.queue === 1 && this.dueToday(card)).length,
        review_count: inTree.filter((card) => (card.queue === 2 || card.queue === 3) && this.dueToday(card)).length,
        total_in_deck: inTree.length,
      };
    };

    return {
      version: () => this.apiVersion,
      requestPermission: (params) => {
        const origin = String(params.origin ?? "");
        const granted = { permission: "granted", requireApiKey: Boolean(this.apiKey), version: this.apiVersion };
        if (params.allowed) return granted;
        if (this.ignoreOriginList.includes(origin)) return { permission: "denied" };
        this.permissionPrompts.push(origin);
        const answer = this.answerPermission(origin);
        if (answer === "yes") {
          this.webCorsOriginList.push(origin);
          return granted;
        }
        if (answer === "no-and-ignore" && origin) this.ignoreOriginList.push(origin);
        return { permission: "denied" };
      },
      multi: (params) => (Array.isArray(params.actions) ? params.actions : []).map((action: Params) => this.dispatch(action)),
      getActiveProfile: () => "User 1",

      // decks
      deckNames: () => [...this.decks.values()].map((deck) => deck.name).sort(),
      deckNamesAndIds: () => Object.fromEntries([...this.decks.values()].map((deck) => [deck.name, deck.id])),
      createDeck: (params) => this.ensureDeck(String(params.deck ?? "")),
      changeDeck: (params) => {
        const did = this.ensureDeck(String(params.deck ?? ""));
        for (const id of numbers(params.cards)) {
          const card = this.cards.get(id);
          if (!card) continue;
          card.did = did;
          card.odid = 0; // moving a card takes it out of a filtered deck first
          card.mod = Math.floor(this.clockMs / 1000);
        }
        return null;
      },
      getDecks: (params) => {
        const out: Record<string, number[]> = {};
        for (const id of numbers(params.cards)) {
          const card = this.cards.get(id);
          if (!card) throw new ActionError(`Card was not found: ${id}`);
          const name = this.deckNameOf(card.did)!;
          (out[name] ??= []).push(id);
        }
        return out;
      },
      getDeckStats: (params) => {
        const out: Record<string, unknown> = {};
        for (const name of Array.isArray(params.decks) ? params.decks : []) {
          const deck = this.deckByName(String(name));
          if (deck) out[String(deck.id)] = deckTotals(deck.id);
        }
        return out;
      },

      // models
      modelNames: () => [...this.models.values()].map((model) => model.name).sort(),
      modelNamesAndIds: () => Object.fromEntries([...this.models.values()].map((model) => [model.name, model.id])),
      modelFieldNames: (params) => {
        const model = this.modelByName(String(params.modelName));
        if (!model) throw new ActionError(`model was not found: ${params.modelName}`);
        return [...model.fields];
      },
      modelTemplates: (params) => {
        const model = this.modelByName(String(params.modelName));
        if (!model) throw new ActionError(`model was not found: ${params.modelName}`);
        return Object.fromEntries(model.templates.map((template) => [template.Name, { Front: template.Front, Back: template.Back }]));
      },
      modelStyling: (params) => {
        const model = this.modelByName(String(params.modelName));
        if (!model) throw new ActionError(`model was not found: ${params.modelName}`);
        return { css: model.css };
      },
      createModel: (params) => {
        const name = String(params.modelName ?? "");
        const fields = Array.isArray(params.inOrderFields) ? params.inOrderFields.map(String) : [];
        const templates = Array.isArray(params.cardTemplates) ? params.cardTemplates as Params[] : [];
        if (!fields.length) throw new ActionError("Must provide at least one field for inOrderFields");
        if (!templates.length) throw new ActionError("Must provide at least one card for cardTemplates");
        if (this.modelByName(name)) throw new ActionError("Model name already exists");
        const model: FakeModel = {
          id: this.nextId(),
          name,
          fields,
          isCloze: params.isCloze === true,
          css: typeof params.css === "string" ? params.css : ".card { font-family: arial; }",
          templates: templates.map((template, index) => ({ Name: String(template.Name ?? `Card ${index + 1}`), Front: String(template.Front ?? ""), Back: String(template.Back ?? "") })),
        };
        this.models.set(model.id, model);
        return { id: model.id, name: model.name, css: model.css, flds: model.fields.map((field, ord) => ({ name: field, ord })), tmpls: model.templates.map((template, ord) => ({ name: template.Name, ord, qfmt: template.Front, afmt: template.Back })), type: model.isCloze ? 1 : 0 };
      },
      updateModelStyling: (params) => {
        const model = this.modelByName(String(params.model?.name));
        if (!model) throw new ActionError(`model was not found: ${params.model?.name}`);
        model.css = String(params.model.css ?? "");
        return null;
      },
      updateModelTemplates: (params) => {
        const model = this.modelByName(String(params.model?.name));
        if (!model) throw new ActionError(`model was not found: ${params.model?.name}`);
        const templates = (params.model.templates ?? {}) as Record<string, { Front?: string; Back?: string }>;
        for (const template of model.templates) {
          const update = templates[template.Name];
          if (update?.Front) template.Front = update.Front;
          if (update?.Back) template.Back = update.Back;
        }
        return null;
      },

      // notes
      addNote: (params) => this.addNoteInternal(params.note as FakeNoteInput),
      addNotes: (params) => {
        const results: Array<number | null> = [];
        const errors: string[] = [];
        for (const note of Array.isArray(params.notes) ? params.notes : []) {
          try {
            results.push(this.addNoteInternal(note as FakeNoteInput));
          } catch (error) {
            results.push(null);
            errors.push((error as Error).message);
          }
        }
        if (errors.length && this.addNotesFailure === "throw") throw new ActionError(JSON.stringify(errors));
        return results;
      },
      canAddNotes: (params) => (Array.isArray(params.notes) ? params.notes : []).map((note: FakeNoteInput) => this.canAdd(note).canAdd),
      canAddNotesWithErrorDetail: (params) => (Array.isArray(params.notes) ? params.notes : []).map((note: FakeNoteInput) => this.canAdd(note)),
      updateNoteFields: (params) => {
        const note = this.requireNote(params.note?.id);
        const model = this.models.get(note.modelId)!;
        for (const [name, value] of Object.entries((params.note?.fields ?? {}) as Record<string, string>)) {
          const index = model.fields.indexOf(name);
          if (index >= 0) note.fields[index] = String(value);
        }
        note.mod = Math.floor(this.clockMs / 1000);
        const firstCard = [...this.cards.values()].find((card) => card.nid === note.id);
        this.generateCards(note, firstCard?.did ?? 1);
        return null;
      },
      updateNoteTags: (params) => {
        const note = this.requireNote(params.note);
        const tags = typeof params.tags === "string" ? [params.tags] : params.tags;
        if (!Array.isArray(tags) || !tags.every((tag) => typeof tag === "string")) throw new ActionError("Must provide tags as a list of strings");
        note.tags = [...new Set(tags as string[])];
        this.registerTags(note.tags);
        return null;
      },
      updateNote: (params) => {
        const note = params.note ?? {};
        if (!("fields" in note) && !("tags" in note)) throw new ActionError('Must provide a "fields" or "tags" property.');
        if ("fields" in note) this.handlers.updateNoteFields({ note });
        if ("tags" in note) this.handlers.updateNoteTags({ note: note.id, tags: note.tags });
        return null;
      },
      addTags: (params) => {
        const tags = String(params.tags ?? "").split(/\s+/).filter(Boolean);
        for (const id of numbers(params.notes)) {
          const note = this.notes.get(id);
          if (!note) continue;
          for (const tag of tags) if (!note.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase())) note.tags.push(tag);
        }
        this.registerTags(tags);
        return null;
      },
      removeTags: (params) => {
        const tags = new Set(String(params.tags ?? "").split(/\s+/).filter(Boolean).map((tag) => tag.toLowerCase()));
        for (const id of numbers(params.notes)) {
          const note = this.notes.get(id);
          if (note) note.tags = note.tags.filter((tag) => !tags.has(tag.toLowerCase()));
        }
        return null;
      },
      getTags: () => [...this.tagRegistry].sort(),
      getNoteTags: (params) => [...this.requireNote(params.note).tags],
      findNotes: (params) => {
        const nids = new Set(this.findCardIds(String(params.query ?? "")).map((cid) => this.cards.get(cid)!.nid));
        return [...nids].sort((a, b) => a - b);
      },
      notesInfo: (params) => {
        const ids = Array.isArray(params.notes)
          ? numbers(params.notes)
          : typeof params.query === "string" ? (this.handlers.findNotes({ query: params.query }) as number[]) : [];
        return ids.map((id) => {
          const note = this.notes.get(id);
          if (!note) return {};
          const model = this.models.get(note.modelId)!;
          return {
            noteId: note.id,
            profile: "User 1",
            tags: [...note.tags],
            fields: Object.fromEntries(model.fields.map((field, order) => [field, { value: note.fields[order] ?? "", order }])),
            modelName: model.name,
            mod: note.mod,
            cards: [...this.cards.values()].filter((card) => card.nid === note.id).sort((a, b) => a.ord - b.ord).map((card) => card.id),
          };
        });
      },
      cardsToNotes: (params) => [...new Set(numbers(params.cards).map((id) => this.cards.get(id)?.nid).filter((nid): nid is number => nid !== undefined))],

      // cards
      findCards: (params) => this.findCardIds(String(params.query ?? "")),
      cardsInfo: (params) => numbers(params.cards).map((id) => {
        const card = this.cards.get(id);
        if (!card) return {};
        const note = this.notes.get(card.nid)!;
        const model = this.models.get(note.modelId)!;
        const fields = this.noteFieldMap(note);
        const template = model.isCloze ? model.templates[0] : model.templates[card.ord];
        const question = renderTemplate(template.Front, fields, { cloze: card.ord + 1 });
        const answer = renderTemplate(template.Back, fields, { cloze: card.ord + 1, answer: true, frontSide: question });
        return {
          cardId: card.id,
          fields: Object.fromEntries(model.fields.map((field, order) => [field, { value: note.fields[order] ?? "", order }])),
          fieldOrder: card.ord,
          question,
          answer,
          modelName: model.name,
          ord: card.ord,
          deckName: this.deckNameOf(card.did),
          css: model.css,
          factor: card.factor,
          interval: card.ivl,
          note: card.nid,
          type: card.type,
          queue: card.queue,
          due: card.due,
          reps: card.reps,
          lapses: card.lapses,
          left: card.left,
          mod: card.mod,
        };
      }),
      suspend: (params) => {
        const targets = numbers(params.cards).map((id) => this.cards.get(id)).filter((card): card is FakeCard => Boolean(card) && card!.queue !== -1);
        for (const card of targets) card.queue = -1;
        return targets.length > 0;
      },
      unsuspend: (params) => {
        const targets = numbers(params.cards).map((id) => this.cards.get(id)).filter((card): card is FakeCard => Boolean(card) && card!.queue === -1);
        for (const card of targets) card.queue = card.type === 3 ? 1 : card.type;
        return targets.length > 0;
      },
      suspended: (params) => {
        const card = this.cards.get(Number(params.card));
        if (!card) throw new ActionError(`Card was not found: ${params.card}`);
        return card.queue === -1;
      },
      areSuspended: (params) => numbers(params.cards).map((id) => {
        const card = this.cards.get(id);
        return card ? card.queue === -1 : null;
      }),
      getIntervals: (params) => numbers(params.cards).map((id) => this.cards.get(id)?.ivl ?? 0),
      getEaseFactors: (params) => numbers(params.cards).map((id) => this.cards.get(id)?.factor ?? 0),

      // statistics
      getNumCardsReviewedToday: () => this.revlog.filter((entry) => entry.id >= this.dayStartMs()).length,
      getNumCardsReviewedByDay: () => {
        const counts = new Map<string, number>();
        for (const entry of this.revlog) {
          const day = new Date(entry.id - this.rolloverHour * 3_600_000).toISOString().slice(0, 10);
          counts.set(day, (counts.get(day) ?? 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[0].localeCompare(a[0]));
      },
      cardReviews: (params) => {
        // Like AnkiConnect: the exact deck only (not subdecks), and decks.id()
        // creates the deck when it does not exist.
        const did = this.ensureDeck(String(params.deck ?? ""));
        const startId = Number(params.startID ?? 0);
        return this.revlog
          .filter((entry) => entry.id > startId && this.cards.get(entry.cid)?.did === did)
          .sort((a, b) => a.id - b.id)
          .map((entry) => [entry.id, entry.cid, entry.usn, entry.ease, entry.ivl, entry.lastIvl, entry.factor, entry.time, entry.type]);
      },
      getReviewsOfCards: (params) => Object.fromEntries(numbers(params.cards).map((id) => [
        String(id),
        this.revlog.filter((entry) => entry.cid === id).sort((a, b) => a.id - b.id)
          .map((entry) => ({ id: entry.id, usn: entry.usn, ease: entry.ease, ivl: entry.ivl, lastIvl: entry.lastIvl, factor: entry.factor, time: entry.time, type: entry.type })),
      ])),

      // GUI
      guiBrowse: (params) => {
        this.lastBrowserQuery = typeof params.query === "string" ? params.query : null;
        return this.lastBrowserQuery === null ? [] : this.findCardIds(this.lastBrowserQuery);
      },
      guiDeckOverview: (params) => Boolean(this.deckByName(String(params.name ?? ""))),
      sync: () => null,
    };
  }

  private canAdd(note: FakeNoteInput): { canAdd: true } | { canAdd: false; error: string } {
    try {
      const model = this.modelByName(note.modelName);
      if (!model) throw new ActionError(`model was not found: ${note.modelName}`);
      const deck = this.deckByName(note.deckName ?? "");
      if (!deck) throw new ActionError(`deck was not found: ${note.deckName}`);
      const fields = model.fields.map(() => "");
      for (const [name, value] of Object.entries(note.fields ?? {})) {
        const index = model.fields.findIndex((field) => field.toLowerCase() === name.toLowerCase());
        if (index >= 0) fields[index] = String(value);
      }
      if (!stripHtml(fields[0] ?? "")) throw new ActionError("cannot create note because it is empty");
      if (this.isDuplicate(model, fields[0], note, deck.id) && note.options?.allowDuplicate !== true) {
        throw new ActionError("cannot create note because it is a duplicate");
      }
      return { canAdd: true };
    } catch (error) {
      return { canAdd: false, error: (error as Error).message };
    }
  }
}

// --- a browser-like fetch over the fake --------------------------------------------------

const SAFE_HEADERS = new Set(["accept", "accept-language", "content-language"]);
const SAFE_CONTENT_TYPES = new Set(["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"]);

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries([...headers.entries()].map(([key, value]) => [key.toLowerCase(), value]));
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key.toLowerCase(), value]));
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
}

/** Would a browser send a CORS preflight for this request? */
export function needsPreflight(method: string, headers: Record<string, string>): boolean {
  if (!["GET", "HEAD", "POST"].includes(method.toUpperCase())) return true;
  return Object.entries(headers).some(([key, value]) => {
    if (SAFE_HEADERS.has(key)) return false;
    if (key === "content-type") return !SAFE_CONTENT_TYPES.has(value.split(";")[0].trim().toLowerCase());
    return true;
  });
}

function corsAllows(headers: Record<string, string>, origin: string): boolean {
  const allowed = headers["Access-Control-Allow-Origin"];
  return allowed === "*" || allowed === origin;
}

/**
 * A fetch implementation that behaves like a browser page at `origin`
 * talking to AnkiConnect: preflights non-simple requests, and rejects with a
 * TypeError when CORS would block the response (exactly what page code sees).
 * `origin: null` behaves like a non-browser client (no CORS enforcement).
 */
export function createFakeFetch(fake: FakeAnkiConnect, options: { origin?: string | null } = {}): typeof fetch {
  const origin = options.origin === undefined ? "http://127.0.0.1:5173" : options.origin;
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (fake.offline) throw new TypeError("Failed to fetch");
    const method = init?.method ?? "GET";
    const headers = headerRecord(init?.headers);
    if (origin && needsPreflight(method, headers)) {
      const preflight = fake.handle({ method: "OPTIONS", origin, headers: { "access-control-request-method": method } });
      if (!corsAllows(preflight.headers, origin)) throw new TypeError("Failed to fetch");
    }
    const reply = fake.handle({ method, origin, body: typeof init?.body === "string" ? init.body : "", headers });
    if (origin && !corsAllows(reply.headers, origin)) throw new TypeError("Failed to fetch");
    return new Response(reply.body, { status: reply.status, headers: reply.headers });
  }) as typeof fetch;
}
