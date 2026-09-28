// ===========================================================================
// Anki search-query builders. Every value AXOM puts into a search (deck names,
// tags, AxomId values) is quoted and escaped the way Anki's search parser
// expects, so a premade deck called "Step_1*" or a tag like "#B&B" matches
// itself literally instead of acting as a wildcard.
//
// Anki's valid escapes inside a search are \\ \" \: \( \) \- \* \_ ; any other
// backslash sequence is a parse error, so only the characters that need it are
// escaped here. `*` and `_` are wildcards in deck, tag and field searches.
// ===========================================================================

/** Escape a literal value for use inside a quoted Anki search term. */
export function escapeSearchValue(value: string): string {
  return value.replace(/[\\"*_]/g, (char) => `\\${char}`);
}

/** `deck:` matches the deck and all of its subdecks. */
export function deckQuery(deckName: string): string {
  return `"deck:${escapeSearchValue(deckName)}"`;
}

/** `tag:` matches the tag and its children (tag::child). */
export function tagQuery(tag: string): string {
  return `"tag:${escapeSearchValue(tag)}"`;
}

/** Exact, case-insensitive match on a note field. */
export function fieldQuery(field: string, value: string): string {
  return `"${escapeSearchValue(field)}:${escapeSearchValue(value)}"`;
}

export function noteTypeQuery(modelName: string): string {
  return `"note:${escapeSearchValue(modelName)}"`;
}

/** Terms joined with OR, parenthesized so they combine safely with others. */
export function anyOf(terms: readonly string[]): string {
  const clean = terms.filter(Boolean);
  if (clean.length === 0) return "";
  return clean.length === 1 ? clean[0] : `(${clean.join(" OR ")})`;
}

/** Terms joined with Anki's implicit AND. */
export function allOf(terms: readonly string[]): string {
  return terms.filter(Boolean).join(" ");
}

export function cardIdQuery(cardIds: readonly number[]): string {
  return cardIds.length ? `cid:${cardIds.join(",")}` : "";
}

export function noteIdQuery(noteIds: readonly number[]): string {
  return noteIds.length ? `nid:${noteIds.join(",")}` : "";
}

/** Any of several decks (each including its subdecks). */
export function decksQuery(deckNames: readonly string[]): string {
  return anyOf(deckNames.map(deckQuery));
}

/** A premade-deck mapping: the chosen decks restricted to any of the tags. */
export function mappedTagsQuery(deckNames: readonly string[], tags: readonly string[]): string {
  if (!deckNames.length || !tags.length) return "";
  return allOf([decksQuery(deckNames), anyOf(tags.map(tagQuery))]);
}
