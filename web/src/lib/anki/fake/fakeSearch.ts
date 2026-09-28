// ===========================================================================
// Anki search syntax for the in-memory fake AnkiConnect (tests and e2e only;
// never imported by the app). Covers what AXOM sends plus the everyday terms a
// learner might paste: implicit AND, OR, -negation, parentheses, quotes and
// escapes, deck:/tag:/note:/field: with * and _ wildcards, is:, prop:,
// rated:, cid:, nid:, and bare text. Semantics follow Anki's rslib search:
// deck: includes subdecks (and a filtered card's home deck), tag: includes
// child tags, field searches match the whole field, all case-insensitive.
// ===========================================================================

export interface SearchCard {
  id: number;
  nid: number;
  did: number;
  odid: number;
  type: number;
  queue: number;
  due: number;
  ivl: number;
  factor: number;
  reps: number;
  lapses: number;
}

export interface SearchNote {
  id: number;
  modelName: string;
  fieldNames: string[];
  fields: string[];
  tags: string[];
}

export interface SearchContext {
  note(nid: number): SearchNote | undefined;
  deckName(did: number): string | undefined;
  /** Days since collection creation for "today". */
  today: number;
  nowMs: number;
  /** Start of today's Anki day, in ms. */
  dayStartMs: number;
  /** Card ids with a non-manual review at or after the given ms timestamp. */
  ratedSince(sinceMs: number): Set<number>;
}

export type SearchPredicate = (card: SearchCard, ctx: SearchContext) => boolean;

export class SearchError extends Error {}

type Token = { kind: "open" } | { kind: "close" } | { kind: "or" } | { kind: "and" } | { kind: "not" } | { kind: "term"; text: string };

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    const char = query[i];
    if (/\s/.test(char)) { i += 1; continue; }
    if (char === "(") { tokens.push({ kind: "open" }); i += 1; continue; }
    if (char === ")") { tokens.push({ kind: "close" }); i += 1; continue; }
    if (char === "-" && (i + 1 < query.length) && !/\s/.test(query[i + 1])) {
      tokens.push({ kind: "not" });
      i += 1;
      continue;
    }
    // A term: runs until whitespace or a parenthesis outside quotes. Quotes
    // may wrap the whole term ("deck:a b") or only its value (deck:"a b").
    let text = "";
    let inQuote = false;
    while (i < query.length) {
      const c = query[i];
      if (c === "\\" && i + 1 < query.length) {
        text += c + query[i + 1];
        i += 2;
        continue;
      }
      if (c === '"') { inQuote = !inQuote; i += 1; continue; }
      if (!inQuote && (/\s/.test(c) || c === "(" || c === ")")) break;
      text += c;
      i += 1;
    }
    if (inQuote) throw new SearchError(`Unterminated quote in search: ${query}`);
    const upper = text.toUpperCase();
    if (upper === "OR") tokens.push({ kind: "or" });
    else if (upper === "AND") tokens.push({ kind: "and" });
    else tokens.push({ kind: "term", text });
  }
  return tokens;
}

const VALID_ESCAPE = /\\[\\":()\-*_]/;

/** Parser-level unescape: \" \: \( \) \- become literal; glob escapes stay. */
function unescapeParser(text: string): string {
  const invalid = text.match(/(?:^|[^\\])(?:\\\\)*(\\(?:[^\\":*_()-]|$))/);
  if (invalid) throw new SearchError(`Unknown escape sequence ${invalid[1]} in search`);
  return text.replace(/\\[":()-]/g, (seq) => seq[1]);
}

function escapeRegex(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/** Anki glob → regex source: * and _ are wildcards unless escaped. */
function globSource(text: string, wildcard: string): string {
  let source = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "\\" && i + 1 < text.length && VALID_ESCAPE.test(`\\${text[i + 1]}`)) {
      source += escapeRegex(text[i + 1]);
      i += 1;
    } else if (char === "*") source += `${wildcard}*`;
    else if (char === "_") source += wildcard;
    else source += escapeRegex(char);
  }
  return source;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function deckMatcher(value: string): (deckName: string | undefined) => boolean {
  const source = globSource(value, ".");
  const pattern = new RegExp(`^${source}(?:$|::)`, "i");
  return (deckName) => Boolean(deckName) && pattern.test(deckName!);
}

function tagMatcher(value: string): (tags: string[]) => boolean {
  if (value === "none") return (tags) => tags.length === 0;
  if (value === "*") return () => true;
  const pattern = new RegExp(`^${globSource(value, "\\S")}(?:$|::)`, "i");
  return (tags) => tags.some((tag) => pattern.test(tag));
}

function compare(op: string, left: number, right: number): boolean {
  switch (op) {
    case "=": return left === right;
    case "!=": return left !== right;
    case ">": return left > right;
    case ">=": return left >= right;
    case "<": return left < right;
    case "<=": return left <= right;
    default: throw new SearchError(`Unknown comparison ${op}`);
  }
}

function learningDayOffset(card: SearchCard, ctx: SearchContext): number {
  return Math.floor((card.due * 1000 - ctx.dayStartMs) / 86_400_000);
}

function termPredicate(raw: string): SearchPredicate {
  // Split on the first unescaped colon before unescaping, so "\:" stays text.
  const colon = raw.search(/(?<!\\):/);
  if (colon <= 0) {
    // Bare text: substring match across the note's fields.
    const pattern = new RegExp(globSource(unescapeParser(raw), "."), "i");
    return (card, ctx) => {
      const note = ctx.note(card.nid);
      return Boolean(note?.fields.some((field) => pattern.test(stripHtml(field))));
    };
  }
  const key = unescapeParser(raw.slice(0, colon)).toLowerCase();
  const value = unescapeParser(raw.slice(colon + 1));
  switch (key) {
    case "deck": {
      const match = deckMatcher(value);
      return (card, ctx) => match(ctx.deckName(card.did)) || (card.odid !== 0 && match(ctx.deckName(card.odid)));
    }
    case "tag": {
      const match = tagMatcher(value);
      return (card, ctx) => match(ctx.note(card.nid)?.tags ?? []);
    }
    case "note": {
      const pattern = new RegExp(`^${globSource(value, ".")}$`, "i");
      return (card, ctx) => pattern.test(ctx.note(card.nid)?.modelName ?? "");
    }
    case "cid": {
      const ids = new Set(value.split(",").map((id) => Number(id.trim())));
      return (card) => ids.has(card.id);
    }
    case "nid": {
      const ids = new Set(value.split(",").map((id) => Number(id.trim())));
      return (card) => ids.has(card.nid);
    }
    case "is": {
      switch (value.toLowerCase()) {
        case "new": return (card) => card.type === 0;
        case "learn": return (card) => card.queue === 1 || card.queue === 3;
        case "review": return (card) => card.type === 2 || card.type === 3;
        case "suspended": return (card) => card.queue === -1;
        case "buried": return (card) => card.queue === -2 || card.queue === -3;
        case "due": return (card, ctx) =>
          ((card.queue === 2 || card.queue === 3) && card.due <= ctx.today) ||
          (card.queue === 1 && card.due * 1000 <= ctx.nowMs + 20 * 60_000);
        default: throw new SearchError(`Unsupported is:${value}`);
      }
    }
    case "prop": {
      const match = value.match(/^(ivl|due|lapses|reps|ease)(<=|>=|!=|=|<|>)(-?\d+(?:\.\d+)?)$/i);
      if (!match) throw new SearchError(`Unsupported prop:${value}`);
      const [, prop, op, rawNumber] = match;
      const number = Number(rawNumber);
      switch (prop.toLowerCase()) {
        case "ivl": return (card) => compare(op, card.ivl, number);
        case "lapses": return (card) => compare(op, card.lapses, number);
        case "reps": return (card) => compare(op, card.reps, number);
        case "ease": return (card) => compare(op, card.factor / 1000, number);
        default: return (card, ctx) => {
          if (card.queue === 2 || card.queue === 3) return compare(op, card.due - ctx.today, number);
          if (card.queue === 1) return compare(op, learningDayOffset(card, ctx), number);
          return false;
        };
      }
    }
    case "rated": {
      const days = Number(value.split(":")[0]);
      if (!Number.isFinite(days) || days < 1) throw new SearchError(`Unsupported rated:${value}`);
      return (card, ctx) => ctx.ratedSince(ctx.dayStartMs - (Math.min(days, 365) - 1) * 86_400_000).has(card.id);
    }
    default: {
      // A field search: the whole field must match (wildcards allowed).
      const fieldName = key;
      const pattern = new RegExp(`^${globSource(value, ".")}$`, "is");
      return (card, ctx) => {
        const note = ctx.note(card.nid);
        if (!note) return false;
        const index = note.fieldNames.findIndex((name) => name.toLowerCase() === fieldName);
        return index >= 0 && pattern.test(note.fields[index] ?? "");
      };
    }
  }
}

/** Compile an Anki search into a card predicate. An empty search matches everything. */
export function compileSearch(query: string): SearchPredicate {
  const tokens = tokenize(query);
  let position = 0;

  function parseOr(): SearchPredicate {
    const parts = [parseAnd()];
    while (tokens[position]?.kind === "or") {
      position += 1;
      parts.push(parseAnd());
    }
    return parts.length === 1 ? parts[0] : (card, ctx) => parts.some((part) => part(card, ctx));
  }

  function parseAnd(): SearchPredicate {
    const parts: SearchPredicate[] = [];
    while (position < tokens.length) {
      const token = tokens[position];
      if (token.kind === "close" || token.kind === "or") break;
      if (token.kind === "and") { position += 1; continue; }
      parts.push(parseUnary());
    }
    if (!parts.length) throw new SearchError("Empty group in search");
    return parts.length === 1 ? parts[0] : (card, ctx) => parts.every((part) => part(card, ctx));
  }

  function parseUnary(): SearchPredicate {
    const token = tokens[position];
    if (token?.kind === "not") {
      position += 1;
      const inner = parseUnary();
      return (card, ctx) => !inner(card, ctx);
    }
    if (token?.kind === "open") {
      position += 1;
      const inner = parseOr();
      if (tokens[position]?.kind !== "close") throw new SearchError("Unbalanced parentheses in search");
      position += 1;
      return inner;
    }
    if (token?.kind === "term") {
      position += 1;
      return termPredicate(token.text);
    }
    throw new SearchError("Unexpected token in search");
  }

  if (tokens.length === 0) return () => true;
  const predicate = parseOr();
  if (position !== tokens.length) throw new SearchError("Unbalanced parentheses in search");
  return predicate;
}
