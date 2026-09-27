// ===========================================================================
// Daily Closeout (directive §3) — a 30–90 second end-of-day flow. Prefills as
// much as possible from today's data so the user mostly confirms, not writes.
// Saving updates tomorrow's Command Brief (first task + mode preference).
// ===========================================================================
import { useMemo, useState } from "react";
import { mergeCloseoutIntoJournal } from "../../lib/closeoutJournal";
import type { NotebookJournalEntry } from "../../lib/journalNotebook";
import { useStore } from "../../lib/store";
import { closeoutForDay, type EnergyVsMorning } from "../../lib/closeout";
import { MODE_LABEL, type BriefMode } from "../../lib/commandBrief";
import type { DailyCloseout } from "../../lib/closeout";
import { Modal, Field, TextAreaField } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import { selectDayAtAGlance } from "../../lib/dayAtAGlance";
import { entryDayKey } from "../../lib/journal";
import { gotoJournalDay } from "../../lib/uiStore";

const MODES: Array<"auto" | BriefMode> = ["auto", "maintain", "catch-up", "recovery", "sprint", "exam-week"];

export function CloseoutModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const existing = closeoutForDay(s.closeouts ?? [], s.activeDayKey);

  const today = s.activeDayKey;
  const doneToday = s.tasks.filter((t) => t.done && t.completedAt?.slice(0, 10) === today).map((t) => t.title);
  const sessionsToday = (s.sessions ?? []).filter((x) => x.dayKey === today && x.status === "completed");
  const openCount = s.tasks.filter((t) => !t.done && !t.archived).length;

  const [completed, setCompleted] = useState(
    existing?.completedSummary
      ?? [
        sessionsToday.length ? `${sessionsToday.length} session${sessionsToday.length === 1 ? "" : "s"} completed` : "",
        doneToday.length ? `Tasks: ${doneToday.slice(0, 3).join(", ")}${doneToday.length > 3 ? "…" : ""}` : "",
      ].filter(Boolean).join(" · "),
  );
  const [remaining, setRemaining] = useState(existing?.remainingSummary ?? (openCount ? `${openCount} open task${openCount === 1 ? "" : "s"}` : ""));
  const [blocker, setBlocker] = useState(existing?.blocker ?? "");
  const [oneWin, setOneWin] = useState(existing?.oneWin ?? "");
  const [energyNow, setEnergyNow] = useState(existing?.energyNow ? String(existing.energyNow) : "");
  const [firstTask, setFirstTask] = useState(existing?.tomorrowFirstTask ?? "");
  const [energy, setEnergy] = useState<EnergyVsMorning | undefined>(existing?.energyVsMorning);
  const [mode, setMode] = useState<"auto" | BriefMode>(existing?.tomorrowMode ?? "auto");
  const glance = useMemo(() => selectDayAtAGlance(s, today, today), [s, today]);
  const existingJournal = s.journal.find((entry) => entryDayKey(entry) === today) as NotebookJournalEntry | undefined;

  function save(openNotebook = false) {
    const record: Omit<DailyCloseout, "id" | "createdAt" | "updatedAt"> = {
      dayKey: s.activeDayKey,
      completedSummary: completed.trim() || "Nothing logged",
      remainingSummary: remaining.trim() || undefined,
      blocker: blocker.trim() || undefined,
      oneWin: oneWin.trim() || undefined,
      energyNow: energyNow ? Math.max(0, Math.min(100, Number(energyNow) || 0)) : undefined,
      tomorrowFirstTask: firstTask.trim() || undefined,
      energyVsMorning: energy,
      tomorrowMode: mode,
    };
    s.saveCloseout(record);
    // The closeout always lands in today's journal page, without replacing
    // anything already written there.
    const merged = mergeCloseoutIntoJournal(existingJournal, {
      completed, oneWin, blocker, remaining, tomorrow: firstTask, energyLabel: energyNow ? numericEnergyLabel(Number(energyNow)) : "",
    }, today);
    if (merged.create) s.addJournal(merged.create);
    else if (merged.patch && existingJournal) s.updateJournal(existingJournal.id, merged.patch);
    onClose();
    if (openNotebook) gotoJournalDay(today);
  }

  return (
    <Modal
      title="Daily closeout"
      onClose={onClose}
      footer={<>
        <GButton onClick={() => save(true)}>Expand into full notebook</GButton>
        <GButton variant="primary" onClick={() => save(false)}>Close the day</GButton>
      </>}
    >
      <div className="sub">A short, honest closeout is enough. AXOM assembled the context below from today’s local records.</div>
      <section className="closeout-glance" aria-label="Day at a glance">
        <b>Day at a Glance</b>
        <span>{glance.intention?.text ? `Intention: ${glance.intention.text}` : "No intention was set"}</span>
        <span>{glance.targetCompletion.eligibleCount ? `Targets: ${glance.targetCompletion.metCount}/${glance.targetCompletion.eligibleCount} met` : "No targets scheduled"}</span>
        <span>{glance.focusedMinutes.value} focused min · {glance.questions.trustedAttempts} questions · {glance.cards.reviewed} cards</span>
        <span>{glance.tasks.completed.length} tasks completed · {glance.unfinishedItems.length} open loops</span>
      </section>
      <TextAreaField label="What went well?" rows={2} value={completed} onChange={(e) => setCompleted(e.target.value)} />
      <Field label="One win" value={oneWin} onChange={(e) => setOneWin(e.target.value)} placeholder="the moment worth keeping" />
      <Field label="What got in the way?" value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="one sentence is enough" />
      <Field label="One unfinished loop" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="e.g. finish the final lecture" />
      <Field label="What matters tomorrow?" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder="the brief can put this on top" />
      <Field label="Energy now (0–100)" type="number" min="0" max="100" value={energyNow} onChange={(e) => setEnergyNow(e.target.value)} />

      <details className="closeout-advanced">
        <summary>Planning details</summary>
      <div className="stack gap6">
        <span className="field-label">Energy vs this morning</span>
        <div className="row">
          {(["lower", "same", "higher"] as const).map((v) => (
            <button key={v} className={`filter-pill ${energy === v ? "on" : ""}`} onClick={() => setEnergy(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="stack gap6">
        <span className="field-label">Tomorrow's mode</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m} className={`filter-pill ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
              {m === "auto" ? "Auto-decide" : MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      </details>

      <p className="sub closeout-journal-option">
        {existingJournal
          ? "Saved into today’s journal page too — your writing there stays as it is; this fills empty parts and adds your win."
          : "Saved as today’s journal page too, alongside the day’s recorded activity."}
      </p>
    </Modal>
  );
}

function numericEnergyLabel(value: number): "Low" | "Medium" | "High" | "" {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 40) return "Low";
  if (value < 70) return "Medium";
  return "High";
}
