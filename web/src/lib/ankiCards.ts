// ===========================================================================
// Anki Lab card vault (directive Phase 5). Typed, persisted cards with
// provenance, lightweight spaced scheduling for in-app review, Anki-compatible
// export shape, and a quality-review layer that flags weak cards BEFORE they
// enter the vault. AI generation goes through validateGeneratedCards + user
// review — never bulk-saved unreviewed. Pure + testable.
// ===========================================================================
import type { ID } from "./types";
import type { ValidationResult } from "./questions";

export type AnkiCardType =
  | "basic"
  | "basic-reversed"
  | "cloze"
  | "image-occlusion" // placeholder type — occlusion editor is future work
  | "multiple-choice"
  | "clinical-vignette"
  | "mechanism-chain"
  | "differential"
  | "why-not-others"
  | "error-repair"
  | "rapid-review";

export const CARD_TYPE_LABEL: Record<AnkiCardType, string> = {
  basic: "Basic",
  "basic-reversed": "Basic (reversed)",
  cloze: "Cloze",
  "image-occlusion": "Image occlusion (placeholder)",
  "multiple-choice": "Multiple-choice recall",
  "clinical-vignette": "Clinical vignette",
  "mechanism-chain": "Mechanism chain",
  differential: "Differential diagnosis",
  "why-not-others": "Why not the other options?",
  "error-repair": "Error repair",
  "rapid-review": "Rapid review",
};

export type ReviewRating = "again" | "hard" | "good" | "easy";

export type CardPriority = "normal" | "urgent" | "flagged";

export interface CardSchedule {
  dueAt: string; // ISO
  intervalDays: number;
  ease: number; // 1.3 .. 3.0
  reps: number;
  lapses: number;
  priority: CardPriority;
}

export interface AnkiCard {
  id: ID;
  type: AnkiCardType;
  front: string;
  back: string;
  extra?: string;
  source?: string;
  tags: string[];
  courseId?: ID;
  /** Module within the course (CourseModule.id); files the card into its Anki subdeck. */
  moduleId?: ID;
  /** Course Tracker item (lecture, DLA…) the card belongs to. */
  trackerItemId?: ID;
  lectureLabel?: string;
  questionId?: ID;
  confidence?: 1 | 2 | 3 | 4 | 5;
  difficulty?: "foundational" | "medium" | "hard";
  aiGenerated: boolean;
  generation?: { provider: string; model?: string; promptVersion?: string };
  suspended?: boolean;
  schedule: CardSchedule;
  createdAt: string;
  updatedAt: string;
}

export interface CardReviewLog {
  id: ID;
  cardId: ID;
  at: string;
  rating: ReviewRating;
  msToAnswer?: number;
}

export function newSchedule(now: Date = new Date()): CardSchedule {
  return { dueAt: now.toISOString(), intervalDays: 0, ease: 2.5, reps: 0, lapses: 0, priority: "normal" };
}

/**
 * SM-2-flavored next schedule. Deliberately simple — the goal is a working
 * in-app review loop, not an Anki replacement; export to real Anki remains
 * the power path.
 */
export function nextSchedule(s: CardSchedule, rating: ReviewRating, now: Date = new Date()): CardSchedule {
  const day = 24 * 60 * 60 * 1000;

  // Reset priority to normal upon successful review
  const priority = "normal";

  if (rating === "again") {
    return {
      dueAt: new Date(now.getTime() + 10 * 60 * 1000).toISOString(), // 10 minutes
      intervalDays: 0,
      ease: Math.max(1.3, s.ease - 0.2),
      reps: 0,
      lapses: s.lapses + 1,
      priority,
    };
  }
  const easeDelta = rating === "hard" ? -0.15 : rating === "easy" ? 0.15 : 0;
  const ease = Math.min(3.0, Math.max(1.3, s.ease + easeDelta));
  let intervalDays: number;
  if (s.reps === 0) intervalDays = rating === "easy" ? 4 : 1;
  else if (s.reps === 1) intervalDays = rating === "hard" ? 4 : rating === "easy" ? 10 : 6;
  else {
    const factor = rating === "hard" ? 1.2 : rating === "easy" ? ease * 1.3 : ease;
    intervalDays = Math.min(365, Math.max(s.intervalDays + 1, Math.round(s.intervalDays * factor)));
  }
  return {
    dueAt: new Date(now.getTime() + intervalDays * day).toISOString(),
    intervalDays,
    ease,
    reps: s.reps + 1,
    lapses: s.lapses,
    priority,
  };
}

export function dueCards(cards: AnkiCard[], now: Date = new Date()): AnkiCard[] {
  const iso = now.toISOString();
  return cards
    .filter((c) => !c.suspended && (c.schedule.dueAt <= iso || c.schedule.priority === "urgent"))
    .sort((a, b) => {
      const priorityMap = { urgent: 0, flagged: 1, normal: 2 };
      if (a.schedule.priority !== b.schedule.priority) {
        return priorityMap[a.schedule.priority] - priorityMap[b.schedule.priority];
      }
      return a.schedule.dueAt.localeCompare(b.schedule.dueAt);
    });
}

// --- validation -----------------------------------------------------------------

const CARD_TYPES = Object.keys(CARD_TYPE_LABEL) as AnkiCardType[];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateAnkiCard(input: unknown, now: Date = new Date()): ValidationResult<AnkiCard> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["Card must be an object."] };

  const type = CARD_TYPES.includes(input.type as AnkiCardType) ? input.type as AnkiCardType : "basic";
  const front = typeof input.front === "string" ? input.front.trim() : "";
  const back = typeof input.back === "string" ? input.back.trim() : "";
  if (!front) errors.push("Card front is required.");
  if (!back && type !== "cloze") errors.push("Card back is required for non-cloze cards.");
  if (type === "cloze" && !/\{\{c\d+::[^}]+\}\}/.test(front)) {
    errors.push("Cloze cards need at least one {{c1::…}} deletion in the front text.");
  }
  if (front.length > 2000) errors.push("Card front is too long (>2000 chars) — split it.");
  if (back.length > 4000) errors.push("Card back is too long (>4000 chars) — move detail to Extra.");

  if (errors.length) return { ok: false, errors };

  const iso = now.toISOString();
  const sched = isRecord(input.schedule) ? input.schedule : undefined;
  return {
    ok: true,
    errors: [],
    value: {
      id: typeof input.id === "string" && input.id ? input.id : crypto.randomUUID(),
      type,
      front,
      back,
      extra: typeof input.extra === "string" && input.extra.trim() ? input.extra.trim() : undefined,
      source: typeof input.source === "string" && input.source.trim() ? input.source.trim() : undefined,
      tags: Array.isArray(input.tags) ? input.tags.filter((t): t is string => typeof t === "string" && !!t.trim()).map((t) => t.trim()) : [],
      courseId: typeof input.courseId === "string" && input.courseId ? input.courseId : undefined,
      moduleId: typeof input.moduleId === "string" && input.moduleId ? input.moduleId : undefined,
      trackerItemId: typeof input.trackerItemId === "string" && input.trackerItemId ? input.trackerItemId : undefined,
      lectureLabel: typeof input.lectureLabel === "string" && input.lectureLabel.trim() ? input.lectureLabel.trim() : undefined,
      questionId: typeof input.questionId === "string" ? input.questionId : undefined,
      confidence: typeof input.confidence === "number" && [1, 2, 3, 4, 5].includes(input.confidence) ? input.confidence as 1 | 2 | 3 | 4 | 5 : undefined,
      difficulty: (["foundational", "medium", "hard"] as const).includes(input.difficulty as "medium") ? input.difficulty as AnkiCard["difficulty"] : undefined,
      aiGenerated: input.aiGenerated === true,
      generation: isRecord(input.generation) && typeof input.generation.provider === "string"
        ? {
            provider: input.generation.provider,
            model: typeof input.generation.model === "string" ? input.generation.model : undefined,
            promptVersion: typeof input.generation.promptVersion === "string" ? input.generation.promptVersion : undefined,
          }
        : undefined,
      suspended: input.suspended === true,
      schedule: sched && typeof sched.dueAt === "string"
        ? {
            dueAt: sched.dueAt,
            intervalDays: typeof sched.intervalDays === "number" ? sched.intervalDays : 0,
            ease: typeof sched.ease === "number" ? Math.min(3, Math.max(1.3, sched.ease)) : 2.5,
            reps: typeof sched.reps === "number" ? sched.reps : 0,
            lapses: typeof sched.lapses === "number" ? sched.lapses : 0, priority: sched.priority === "urgent" || sched.priority === "flagged" ? sched.priority : "normal",
          }
        : newSchedule(now),
      createdAt: typeof input.createdAt === "string" ? input.createdAt : iso,
      updatedAt: iso,
    },
  };
}

// --- quality review layer (directive §11) ------------------------------------------

export type CardQualityFlagKind =
  | "duplicate"
  | "too-long"
  | "ambiguous"
  | "multi-fact"
  | "absolute-claim"
  | "weak-cloze"
  | "missing-source";

export interface CardQualityFlag {
  kind: CardQualityFlagKind;
  message: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/\{\{c\d+::|\}\}/g, "").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

/**
 * Flag likely-weak cards before save. Heuristics, not verdicts — the user
 * decides. `existing` lets duplicate detection cover the whole vault.
 */
export function reviewCardQuality(card: Pick<AnkiCard, "type" | "front" | "back" | "source" | "aiGenerated">, existing: Array<Pick<AnkiCard, "front">> = []): CardQualityFlag[] {
  const flags: CardQualityFlag[] = [];
  const front = card.front.trim();
  const back = card.back.trim();
  const norm = normalize(front);

  if (existing.some((c) => normalize(c.front) === norm && norm.length > 0)) {
    flags.push({ kind: "duplicate", message: "A card with an identical front already exists." });
  }
  if (front.length > 400) {
    flags.push({ kind: "too-long", message: "Front is very long — recall works best on one tight question." });
  }
  if (back.split(/\s+/).length > 80) {
    flags.push({ kind: "too-long", message: "Back exceeds ~80 words — move detail to the Extra field." });
  }
  if (/^(it|this|that|these|they)\b/i.test(front)) {
    flags.push({ kind: "ambiguous", message: "Front starts with a dangling pronoun — the card won't stand alone." });
  }
  const factSeparators = (back.match(/;|\band\b|\balso\b/gi) ?? []).length;
  if (card.type !== "clinical-vignette" && card.type !== "why-not-others" && factSeparators >= 3) {
    flags.push({ kind: "multi-fact", message: "Back looks like several facts in one card — consider splitting." });
  }
  if (/\b(always|never|all patients|100%|guaranteed)\b/i.test(back)) {
    flags.push({ kind: "absolute-claim", message: "Contains an absolute claim — verify against the source before trusting it." });
  }
  if (card.type === "cloze") {
    const deletions = front.match(/\{\{c\d+::[^}]+\}\}/g) ?? [];
    const deletedChars = deletions.join("").length;
    if (deletions.length === 0) {
      flags.push({ kind: "weak-cloze", message: "Cloze card without any {{c1::…}} deletion." });
    } else if (deletedChars > front.length * 0.6) {
      flags.push({ kind: "weak-cloze", message: "Cloze deletions cover most of the text — the card gives away too little context." });
    }
  }
  if (card.aiGenerated && !card.source) {
    flags.push({ kind: "missing-source", message: "AI-generated card without a source reference — add where this came from." });
  }
  return flags;
}

// --- export ---------------------------------------------------------------------

/** TSV rows compatible with Anki's text import (front, back, tags). */
export function cardsToAnkiTsv(cards: AnkiCard[]): string {
  const clean = (s: string) => s.replace(/\t/g, "  ").replace(/\n/g, "<br>");
  return cards
    .map((c) => [clean(c.front), clean([c.back, c.extra].filter(Boolean).join("<br><br>")), c.tags.join(" ")].join("\t"))
    .join("\n");
}
