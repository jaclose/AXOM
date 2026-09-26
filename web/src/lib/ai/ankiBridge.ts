// ===========================================================================
// Anki-QBank Bridge (directive §14B)
// Connects Question Bank failures to Anki SRS priority.
// When a user misses a question, this utility flags related cards as "urgent",
// effectively implementing "Cognitive Load Balancing" by overriding the
// standard SRS schedule for high-yield failure points.
// ===========================================================================
import { useStore } from "../store";
import type { AnkiCard } from "../ankiCards";

/**
 * Flags all Anki cards related to a specific failed question as "urgent".
 * An "urgent" card bypasses the standard due date and moves to the top of the queue.
 */
export async function bridgeQuestionFailureToAnki(questionId: string, tags: string[]) {
  const s = useStore.getState();
  const cards = s.ankiCards ?? [];

  // Find cards that are either directly linked by ID or share a specific high-yield tag
  const targetCards = cards.filter((card: AnkiCard) =>
    card.questionId === questionId ||
    tags.some(tag => card.tags.includes(tag))
  );

  if (targetCards.length === 0) return { flagged: 0 };

  const updatedCards = cards.map((card: AnkiCard) => {
    if (card.id === targetCards.find((t: AnkiCard) => t.id === card.id)?.id) {
      return {
        ...card,
        schedule: { ...card.schedule, priority: "urgent" as const },
        updatedAt: new Date().toISOString()
      };
    }
    return card;
  });

  // Update the global store
  updatedCards.forEach(card => s.updateAnkiCard(card.id, card));

  return {
    flagged: targetCards.length,
    cardIds: targetCards.map((c: AnkiCard) => c.id)
  };
}

/**
 * Analyzes the current "Urgency" state of the vault.
 */
export function getUrgencyMetrics(cards: AnkiCard[]) {
  const urgentCount = cards.filter(c => c.schedule.priority === "urgent").length;
  const flaggedCount = cards.filter(c => c.schedule.priority === "flagged").length;

  return {
    urgentCount,
    flaggedCount,
    isHighPressure: urgentCount > 50,
  };
}
