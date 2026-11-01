import type { AnkiClient } from "../ankiConnect";
import type { CourseCatalog } from "./courseAdapter";
import { ankiDeckPathFor, DEFAULT_DECK_LAYOUT, joinDeckPath } from "./deckLayout";
import { axomScopeTagsFor } from "./noteBuilder";
import { mappedTagsQuery } from "./query";

export type AnkiCourseScope =
  | { kind: "term"; termId: string }
  | { kind: "module"; termId: string; courseId: string; moduleId: string }
  | { kind: "week"; termId: string; courseId: string; moduleId: string; week: number };

export interface PremadeScopeLink {
  scope: AnkiCourseScope;
  deckName: string;
  tag: string;
}

export interface UnsuspendPreview {
  link: PremadeScopeLink;
  axomTag: string;
  profile: string;
  query: string;
  cardIds: number[];
  previewedAtUtc: string;
}

export interface UnsuspendReceipt {
  profile: string;
  link: PremadeScopeLink;
  axomTag: string;
  requestedCardIds: number[];
  unsuspendedCardIds: number[];
  stillSuspendedCardIds: number[];
  completedAtUtc: string;
  complete: boolean;
  error?: string;
}

export interface TermDeckReceipt {
  profile: string;
  termId: string;
  paths: string[];
  created: string[];
  verifiedAtUtc: string;
}

function sameIds(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function sortedCardIds(raw: unknown): number[] {
  if (!Array.isArray(raw) || raw.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("Anki returned invalid card IDs. No cards were changed.");
  }
  return [...new Set(raw as number[])].sort((a, b) => a - b);
}

export function availableModuleWeeks(catalog: CourseCatalog, moduleId: string): number[] {
  const weeks = new Set<number>();
  for (const item of catalog.lectures(moduleId)) {
    const match = item.path.match(/(?:^|\/)Week\s+([1-9]\d*)(?=\/|$)/i);
    if (match) weeks.add(Number(match[1]));
  }
  return [...weeks].sort((a, b) => a - b);
}

export function validateAnkiScope(catalog: CourseCatalog, scope: AnkiCourseScope): void {
  const inTerm = catalog.courses.filter((course) => course.termId === scope.termId);
  if (!inTerm.length) throw new Error("Choose a term with courses in AXOM.");
  if (scope.kind === "term") return;
  const course = inTerm.find((entry) => entry.id === scope.courseId);
  if (!course || !course.modules.some((module) => module.id === scope.moduleId)) {
    throw new Error("The selected module no longer belongs to this AXOM term.");
  }
  if (scope.kind === "week" && !availableModuleWeeks(catalog, scope.moduleId).includes(scope.week)) {
    throw new Error("The selected week is not in this module's course tracker.");
  }
}

export function axomTagForScope(catalog: CourseCatalog, scope: AnkiCourseScope): string {
  validateAnkiScope(catalog, scope);
  const tags = axomScopeTagsFor(scope, catalog);
  const tag = tags.at(-1);
  if (!tag) throw new Error("This AXOM scope has no named term tag.");
  return tag;
}

export function termDeckPaths(catalog: CourseCatalog, termId: string): string[] {
  const courses = catalog.courses.filter((course) => course.termId === termId);
  const termName = courses[0]?.termName;
  if (!termName || !courses.length) return [];
  const paths = new Set<string>([`AXOM::${joinDeckPath([termName])}`]);
  const layout = { ...DEFAULT_DECK_LAYOUT, includeTerm: true };
  for (const course of courses) {
    paths.add(ankiDeckPathFor({ courseId: course.id }, catalog, layout));
    const modules = course.modules.length ? course.modules : [undefined];
    for (const module of modules) {
      paths.add(ankiDeckPathFor({ courseId: course.id, moduleId: module?.id }, catalog, layout));
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function createTermDecks(client: AnkiClient, catalog: CourseCatalog, termId: string, expectedProfile?: string): Promise<TermDeckReceipt> {
  const paths = termDeckPaths(catalog, termId);
  if (!paths.length) throw new Error("This term has no AXOM courses to create.");
  const profile = await client.call<string>("getActiveProfile");
  if (expectedProfile && profile !== expectedProfile) throw new Error("Anki changed profiles. Connect and preview again.");
  const before = await client.call<string[]>("deckNames");
  const known = new Set(before.map((name) => name.toLowerCase()));
  const created: string[] = [];
  for (const path of paths) {
    if (known.has(path.toLowerCase())) continue;
    await client.call<number>("createDeck", { deck: path });
    created.push(path);
    known.add(path.toLowerCase());
  }
  const after = new Set((await client.call<string[]>("deckNames")).map((name) => name.toLowerCase()));
  if (paths.some((path) => !after.has(path.toLowerCase()))) throw new Error("Anki did not retain every term deck. Refresh before trying again.");
  if (await client.call<string>("getActiveProfile") !== profile) throw new Error("Anki changed profiles while creating decks. Check both profiles before retrying.");
  return { profile, termId, paths, created, verifiedAtUtc: new Date().toISOString() };
}

function validateLink(catalog: CourseCatalog, link: PremadeScopeLink): PremadeScopeLink {
  validateAnkiScope(catalog, link.scope);
  const deckName = link.deckName.trim();
  const tag = link.tag.trim();
  if (!deckName || !tag || /\s/.test(tag) || /[\r\n]/.test(deckName)) {
    throw new Error("Choose an AnKing deck and enter one exact Anki tag without spaces.");
  }
  return { scope: link.scope, deckName, tag };
}

export async function previewPremadeUnsuspend(client: AnkiClient, catalog: CourseCatalog, input: PremadeScopeLink): Promise<UnsuspendPreview> {
  const link = validateLink(catalog, input);
  const profile = await client.call<string>("getActiveProfile");
  const decks = await client.call<string[]>("deckNames");
  if (!decks.some((name) => name.toLowerCase() === link.deckName.toLowerCase())) {
    throw new Error("That deck is not in the current Anki profile. Choose a deck from the list.");
  }
  const query = `${mappedTagsQuery([link.deckName], [link.tag])} is:suspended`;
  const cardIds = sortedCardIds(await client.call<unknown>("findCards", { query }));
  return { link, axomTag: axomTagForScope(catalog, link.scope), profile, query, cardIds, previewedAtUtc: new Date().toISOString() };
}

/** Recheck the exact collection and suspended set before touching any premade card. */
export async function unsuspendPreviewedCards(client: AnkiClient, catalog: CourseCatalog, preview: UnsuspendPreview): Promise<UnsuspendReceipt> {
  const link = validateLink(catalog, preview.link);
  if (preview.axomTag !== axomTagForScope(catalog, link.scope)) throw new Error("The AXOM scope tag changed. Preview again.");
  if (preview.query !== `${mappedTagsQuery([link.deckName], [link.tag])} is:suspended`) {
    throw new Error("The Anki search no longer matches this link. Preview again.");
  }
  if (!preview.cardIds.length) throw new Error("The preview contains no suspended cards.");
  const profile = await client.call<string>("getActiveProfile");
  if (profile !== preview.profile) throw new Error("Anki changed profiles. Preview again before unsuspending.");
  const current = sortedCardIds(await client.call<unknown>("findCards", { query: preview.query }));
  if (!sameIds(current, preview.cardIds)) throw new Error("The matching suspended cards changed. Preview again before unsuspending.");
  const before = await client.call<unknown>("areSuspended", { cards: current });
  if (!Array.isArray(before) || before.length !== current.length || before.some((value) => value !== true)) {
    throw new Error("Anki no longer confirms every selected card is suspended. Preview again.");
  }

  let error: string | undefined;
  for (let offset = 0; offset < current.length; offset += 500) {
    try {
      await client.call<boolean>("unsuspend", { cards: current.slice(offset, offset + 500) });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Anki could not finish unsuspending.";
      break;
    }
  }
  const after = await client.call<unknown>("areSuspended", { cards: current });
  if (!Array.isArray(after) || after.length !== current.length || after.some((value) => typeof value !== "boolean")) {
    throw new Error("Anki could not verify the selected cards after the change. Refresh the preview before trying again.");
  }
  const unsuspendedCardIds = current.filter((_, index) => after[index] === false);
  const stillSuspendedCardIds = current.filter((_, index) => after[index] === true);
  return {
    profile, link: preview.link, axomTag: preview.axomTag, requestedCardIds: current, unsuspendedCardIds, stillSuspendedCardIds,
    completedAtUtc: new Date().toISOString(), complete: !error && stillSuspendedCardIds.length === 0, ...(error ? { error } : {}),
  };
}
