import type { JournalEntry } from "./types";
import type { NotebookJournalEntry } from "./journalNotebook";

export interface CloseoutForJournal {
  completed: string;
  oneWin?: string;
  blocker?: string;
  remaining?: string;
  tomorrow?: string;
  energyLabel: JournalEntry["energy"];
}

const add = (list: string[] | undefined, value: string | undefined) => {
  const items = (list ?? []).map((item) => item.trim()).filter(Boolean);
  const next = value?.trim();
  return next && !items.includes(next) ? [...items, next] : items;
};

/**
 * Fold a daily closeout into the day's journal page. Existing writing always
 * wins: empty fields are filled, wins and open loops are appended once, and
 * nothing the learner wrote is replaced.
 */
export function mergeCloseoutIntoJournal(
  existing: NotebookJournalEntry | undefined,
  closeout: CloseoutForJournal,
  day: string,
): { create?: Omit<JournalEntry, "id"> & Partial<NotebookJournalEntry>; patch?: Partial<NotebookJournalEntry> } {
  if (!existing) {
    return {
      create: {
        date: `${day}T20:30:00`,
        today: closeout.completed.trim() || "Daily closeout",
        tomorrow: closeout.tomorrow?.trim() ?? "",
        blockers: closeout.blocker?.trim() ?? "",
        energy: closeout.energyLabel,
        rating: "Daily closeout",
        wins: add([], closeout.oneWin),
        losses: add([], closeout.remaining),
        notebookStatus: "draft",
        updatedAt: new Date().toISOString(),
      },
    };
  }
  return {
    patch: {
      today: existing.today?.trim() ? existing.today : closeout.completed.trim(),
      tomorrow: existing.tomorrow?.trim() ? existing.tomorrow : closeout.tomorrow?.trim() ?? "",
      blockers: existing.blockers?.trim() ? existing.blockers : closeout.blocker?.trim() ?? "",
      energy: existing.energy || closeout.energyLabel,
      wins: add(existing.wins, closeout.oneWin),
      losses: add(existing.losses, closeout.remaining),
      updatedAt: new Date().toISOString(),
    },
  };
}
