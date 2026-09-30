// Which flashcard app (if any) a student uses, read from their study workflow.
// Course Tracker shows card rounds under that app's name, or not at all
// (JD, Wave 2: "if neither, do NOT show meaningless Anki passes"). Profiles
// that never answered setup keep the original Anki rounds.
import type { StudyWorkflowPreferences } from "./studyPreferences";

export interface CardSystem { id: "anki" | "noji" | "quizlet" | "remnote"; label: string }

const ORDER: CardSystem[] = [
  { id: "anki", label: "Anki" },
  { id: "noji", label: "Noji" },
  { id: "remnote", label: "RemNote" },
  { id: "quizlet", label: "Quizlet" },
];

export function cardSystemFor(workflow: StudyWorkflowPreferences | undefined): CardSystem | null {
  if (!workflow?.configured) return ORDER[0];
  const enabled = new Set((workflow.methods ?? []).filter((method) => method.enabled).map((method) => method.id));
  return ORDER.find((system) => enabled.has(system.id)) ?? null;
}
