// ===========================================================================
// The academic bookshelf, as data. A book is a module of a course; a shelf is
// a term. Nothing here is stored: every book, and its thickness, is derived
// from the workspace's own records each time the shelf is drawn, so a book
// cannot disagree with what it holds.
// ===========================================================================

export type BookState =
  /** Has content to open. */
  | "available"
  /** A real module with nothing in it yet. */
  | "empty";

export interface ShelfBook {
  id: string;
  /** What the spine says: the module, as the course data names it. Never expanded or invented. */
  title: string;
  /** The course code, or another identifier the data holds. */
  identifier?: string;
  /** The shelf it stands on: the term. */
  shelf: string;
  /** How many units of content the book holds. The spine's thickness comes from this alone. */
  count: number;
  /** The count in words: "42 activities", "118 questions". */
  countLabel: string;
  state: BookState;
  /** One short line for an empty book, saying why it is empty. */
  stateNote?: string;
}

export interface BookShelf<T extends ShelfBook = ShelfBook> {
  id: string;
  label: string;
  books: T[];
}

export interface SpineScale {
  /** Thinnest spine, in pixels: still wide enough to read and to tap. */
  min: number;
  max: number;
  /** The count at which a spine reaches full thickness. */
  reference: number;
}

export const SPINE_SCALE: SpineScale = { min: 34, max: 96, reference: 400 };

/**
 * Thickness grows with the logarithm of the count: ten times the content is
 * visibly thicker, never ten times wider, so one very large bank cannot push
 * the others off the shelf. An empty book keeps the minimum.
 */
export function spineThickness(count: number, scale: SpineScale = SPINE_SCALE): number {
  if (!(count > 0)) return scale.min;
  const share = Math.min(1, Math.log1p(count) / Math.log1p(scale.reference));
  return Math.round(scale.min + (scale.max - scale.min) * share);
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
}

/** A book's height as a share of the shelf, steady for a given book: real shelves are not level. */
export function spineHeight(id: string): number {
  return 0.86 + (hash(id) % 13) / 100;
}

/** Which of the cover tones a book takes: one family per shelf, a small step per book. */
export function spineTone(shelfIndex: number, bookIndex: number): { family: number; step: number } {
  return { family: shelfIndex % 7, step: bookIndex % 4 };
}

/** Books onto shelves, keeping the order they arrive in. */
export function buildShelves<T extends ShelfBook>(books: readonly T[]): BookShelf<T>[] {
  const shelves = new Map<string, BookShelf<T>>();
  for (const book of books) {
    const shelf = shelves.get(book.shelf) ?? { id: book.shelf.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "shelf", label: book.shelf, books: [] };
    shelf.books.push(book);
    shelves.set(book.shelf, shelf);
  }
  return [...shelves.values()];
}

const one = (count: number, singular: string, plural = `${singular}s`): string => `${count} ${count === 1 ? singular : plural}`;

export const countWords = { one };
