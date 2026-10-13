import { daysUntilExam, EXAM_META, pickFocusExam } from "../examPlan";
import type { NoctyriumState } from "../types";
import type { Personalization } from "./model";
/** Both preview and delivery resolve the existing board-prep plan, never task-title guesses. */
export function examContext(state: NoctyriumState, day: string): Personalization["exam"] {
  const id = pickFocusExam(state.boardPrep, day); if (!id) return undefined;
  const date = state.boardPrep?.[id]?.examDate; const days = daysUntilExam(date, day);
  if (!date || days === null || days < 0) return undefined;
  return { name: EXAM_META[id].label, date, days, route: EXAM_META[id].route };
}
