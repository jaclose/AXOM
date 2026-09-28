// ===========================================================================
// Where an AXOM card lives in Anki. The learner chooses the layout once in
// the Link Anki wizard; every card then gets a deterministic deck path:
//   AXOM::<course>::<module>[::<lecture>]      course + module assigned
//   AXOM::<course>                             course only
//   AXOM::Unsorted                             no course yet
// with an optional term level. Segment names are sanitized for Anki: `::` is
// the only separator, and quotes, asterisks (Anki search wildcards) and
// control characters are removed.
// ===========================================================================
import { courseLabel, type CourseCatalog, type CourseInfo } from "./courseAdapter";

export type CourseLabelStyle = "code" | "name" | "code-name";

export interface DeckLayoutOptions {
  root: string;
  courseLabel: CourseLabelStyle;
  includeTerm: boolean;
  lectureDecks: boolean;
}

export const DEFAULT_DECK_LAYOUT: DeckLayoutOptions = {
  root: "AXOM",
  courseLabel: "code",
  includeTerm: false,
  lectureDecks: false,
};

export const UNSORTED_DECK_SEGMENT = "Unsorted";
const MAX_SEGMENT_LENGTH = 80;

/** One deck-name component: no separators, quotes, wildcards or control chars. */
export function sanitizeDeckSegment(value: string, fallback = "Untitled"): string {
  const clean = String(value ?? "")
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/["*]/g, "")
    .replace(/^[\s:]+|[\s:]+$/g, "")
    .replace(/:{2,}/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SEGMENT_LENGTH)
    .trim();
  return /^[\s\-:]*$/.test(clean) ? fallback : clean;
}

/** A full deck path from components, each sanitized. */
export function joinDeckPath(segments: readonly string[]): string {
  return segments.map((segment) => sanitizeDeckSegment(segment)).join("::");
}

export function normalizeDeckLayout(raw: unknown): DeckLayoutOptions {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const style = record.courseLabel;
  return {
    root: sanitizeDeckRoot(typeof record.root === "string" ? record.root : DEFAULT_DECK_LAYOUT.root),
    courseLabel: style === "name" || style === "code-name" ? style : "code",
    includeTerm: record.includeTerm === true,
    lectureDecks: record.lectureDecks === true,
  };
}

/** The root may itself be nested ("Med::AXOM"); each part is sanitized. */
export function sanitizeDeckRoot(value: string): string {
  const parts = String(value ?? "").split("::").map((part) => sanitizeDeckSegment(part, "")).filter(Boolean);
  return parts.length ? parts.join("::") : DEFAULT_DECK_LAYOUT.root;
}

export function courseDeckLabel(course: Pick<CourseInfo, "code" | "name">, style: CourseLabelStyle): string {
  if (style === "name") return course.name || course.code || "Untitled course";
  if (style === "code-name" && course.code && course.name && course.name !== course.code) return `${course.code} - ${course.name}`;
  return courseLabel(course);
}

export interface CardPlacement {
  courseId?: string;
  moduleId?: string;
  trackerItemId?: string;
  lectureLabel?: string;
}

/** The lecture name a card is filed under, from its tracker item or free text. */
export function lectureLabelFor(card: CardPlacement, catalog: CourseCatalog): string | undefined {
  const lecture = catalog.lecture(card.trackerItemId);
  const label = lecture?.label || card.lectureLabel?.trim();
  return label || undefined;
}

/** The Anki deck for a card under the learner's layout. */
export function ankiDeckPathFor(card: CardPlacement, catalog: CourseCatalog, options: DeckLayoutOptions): string {
  const root = sanitizeDeckRoot(options.root);
  const course = catalog.course(card.courseId);
  if (!course) return `${root}::${UNSORTED_DECK_SEGMENT}`;
  const segments = [
    ...(options.includeTerm && course.termName ? [course.termName] : []),
    courseDeckLabel(course, options.courseLabel),
  ];
  const module = catalog.module(card.moduleId);
  if (module && module.courseId === course.id) {
    segments.push(module.name);
    const lecture = options.lectureDecks ? lectureLabelFor(card, catalog) : undefined;
    if (lecture) segments.push(lecture);
  }
  return `${root}::${joinDeckPath(segments)}`;
}

export interface DeckTreeNode {
  name: string;
  path: string;
  /** Cards filed directly in this deck. */
  count: number;
  /** Cards in this deck and its subdecks. */
  total: number;
  children: DeckTreeNode[];
}

/** Build a sorted tree from deck paths and their card counts. */
export function buildDeckTree(entries: ReadonlyArray<{ path: string; count: number }>): DeckTreeNode[] {
  const roots: DeckTreeNode[] = [];
  const byPath = new Map<string, DeckTreeNode>();
  for (const entry of entries) {
    const parts = entry.path.split("::");
    let siblings = roots;
    let path = "";
    for (const part of parts) {
      path = path ? `${path}::${part}` : part;
      let node = byPath.get(path.toLowerCase());
      if (!node) {
        node = { name: part, path, count: 0, total: 0, children: [] };
        byPath.set(path.toLowerCase(), node);
        siblings.push(node);
      }
      node.total += entry.count;
      siblings = node.children;
    }
    byPath.get(path.toLowerCase())!.count += entry.count;
  }
  const sort = (nodes: DeckTreeNode[]) => {
    nodes.sort((a, b) => {
      // Unsorted always sits last under the root.
      if (a.name === UNSORTED_DECK_SEGMENT) return 1;
      if (b.name === UNSORTED_DECK_SEGMENT) return -1;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    });
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

/**
 * The live preview in the wizard: the decks AXOM's cards will land in, plus
 * (optionally) every course and module as an empty deck-to-be.
 */
export function previewDeckTree(
  catalog: CourseCatalog,
  cards: readonly CardPlacement[],
  options: DeckLayoutOptions,
  preview: { includeEmptyModules?: boolean } = {},
): DeckTreeNode[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const path = ankiDeckPathFor(card, catalog, options);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  if (preview.includeEmptyModules) {
    for (const course of catalog.courses) {
      const modules = course.modules.length ? course.modules : [undefined];
      for (const module of modules) {
        const path = ankiDeckPathFor({ courseId: course.id, moduleId: module?.id }, catalog, options);
        if (!counts.has(path)) counts.set(path, 0);
      }
    }
  }
  if (!counts.size) counts.set(`${sanitizeDeckRoot(options.root)}::${UNSORTED_DECK_SEGMENT}`, 0);
  return buildDeckTree([...counts.entries()].map(([path, count]) => ({ path, count })));
}
