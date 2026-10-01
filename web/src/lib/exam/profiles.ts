// ===========================================================================
// Exam profiles: how each exam behaves, as data. The engine (engine.ts) runs
// every block the same way; a profile holds what differs between exams that
// is not a matter of looks: what things are called, how a block ends, whether
// a second click clears an answer, what the navigator can filter, which keys
// move between questions. Looks live in the renderers.
// ===========================================================================
import type { ExamSkin } from "../examSim";
import type { NavigatorFilter } from "./engine";

/** A key combination. `mod` is Command on a Mac and Control elsewhere. */
export interface KeyChord {
  /** `KeyboardEvent.key`, compared without case. */
  key?: string;
  /** `KeyboardEvent.code`, for keys whose character changes with Alt or the layout. */
  code?: string;
  alt?: boolean;
  mod?: boolean;
}

export interface ExamProfile {
  id: ExamSkin;
  words: {
    /** "Item 3 of 20" or "Question 3". */
    item: string;
    /** The action that flags an item, and what a flagged item is called in counts. */
    flag: string;
    flagged: string;
    /** The action that ends the block, and the heading of its confirmation. */
    end: string;
    endTitle: string;
  };
  /** What ending the block does first: ask to confirm, or open the item review screen. */
  ending: "confirm" | "item-review";
  /** Choosing the chosen answer again clears it. */
  repickClears: boolean;
  /** The highlighter is always in hand, or a tool that is picked up first. */
  highlighter: "always" | "tool";
  /** Filters the navigator offers while testing. Review adds "correct" and "incorrect". */
  filters: readonly NavigatorFilter[];
  keys: {
    next: readonly KeyChord[];
    previous: readonly KeyChord[];
    flag: readonly KeyChord[];
  };
}

/** Keys every exam interface in AXOM answers to. */
const ARROWS = { next: [{ key: "ArrowRight" }], previous: [{ key: "ArrowLeft" }] } as const;

export const EXAM_PROFILES: Record<ExamSkin, ExamProfile> = {
  uworld: {
    id: "uworld",
    words: { item: "Item", flag: "Mark", flagged: "marked", end: "End Block", endTitle: "End block?" },
    ending: "confirm",
    repickClears: false,
    highlighter: "always",
    filters: ["all"],
    keys: {
      next: [...ARROWS.next, { code: "KeyN", alt: true }],
      previous: [...ARROWS.previous, { code: "KeyP", alt: true }],
      flag: [{ key: "m" }],
    },
  },
  nbme: {
    id: "nbme",
    words: { item: "Item", flag: "Mark", flagged: "marked", end: "End Block", endTitle: "End block?" },
    ending: "item-review",
    repickClears: false,
    highlighter: "always",
    filters: ["all", "unanswered", "flagged"],
    keys: {
      next: [...ARROWS.next, { code: "KeyN", alt: true }],
      previous: [...ARROWS.previous, { code: "KeyP", alt: true }],
      flag: [{ key: "m" }],
    },
  },
  examsoft: {
    id: "examsoft",
    words: { item: "Question", flag: "Flag question", flagged: "flagged", end: "Submit Exam", endTitle: "Submit exam?" },
    ending: "confirm",
    // In Examplify an answer is a toggle: selecting it again clears it.
    repickClears: true,
    highlighter: "tool",
    filters: ["all", "flagged", "unanswered", "answered"],
    keys: {
      // Examplify's own: Command / Control with the > and < keys. The arrows and Alt keys are AXOM's, kept in every interface.
      next: [{ code: "Period", mod: true }, ...ARROWS.next, { code: "KeyN", alt: true }],
      previous: [{ code: "Comma", mod: true }, ...ARROWS.previous, { code: "KeyP", alt: true }],
      flag: [{ key: "f" }, { key: "m" }],
    },
  },
};

interface KeyLike { key: string; code?: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean }

/** Does this key press match the chord exactly (no extra Alt, Command or Control)? */
export function matchesChord(event: KeyLike, chord: KeyChord): boolean {
  const mod = event.metaKey || event.ctrlKey;
  if (Boolean(chord.mod) !== mod || Boolean(chord.alt) !== event.altKey) return false;
  if (chord.code !== undefined) return event.code === chord.code;
  return chord.key !== undefined && event.key.toLowerCase() === chord.key.toLowerCase();
}

export const matchesAnyChord = (event: KeyLike, chords: readonly KeyChord[]) => chords.some((chord) => matchesChord(event, chord));
