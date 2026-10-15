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
import {
  assertVaultWrite,
  assertVaultWritesSince,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
} from "../../lib/localVault";

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
  const [addToJournal, setAddToJournal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const glance = useMemo(() => selectDayAtAGlance(s, today, today), [s, today]);
  const existingJournal = s.journal.find((entry) => entryDayKey(entry) === today) as NotebookJournalEntry | undefined;

  async function save(openNotebook = false) {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    const record: Omit<DailyCloseout, "id" | "createdAt" | "updatedAt"> = {
      dayKey: today,
      completedSummary: completed.trim() || "Nothing logged",
      remainingSummary: remaining.trim() || undefined,
      blocker: blocker.trim() || undefined,
      oneWin: oneWin.trim() || undefined,
      energyNow: energyNow ? Math.max(0, Math.min(100, Number(energyNow) || 0)) : undefined,
      tomorrowFirstTask: firstTask.trim() || undefined,
      energyVsMorning: energy,
      tomorrowMode: mode,
    };
    const checkpoint = getVaultWriteCheckpoint();
    try {
      useStore.setState((state) => {
        const stamp = new Date().toISOString();
        const priorCloseout = closeoutForDay(state.closeouts ?? [], today);
        const nextCloseout: DailyCloseout = {
          ...record,
          id: priorCloseout?.id ?? crypto.randomUUID(),
          createdAt: priorCloseout?.createdAt ?? stamp,
          updatedAt: stamp,
        };
        let journal = state.journal;
        if (addToJournal) {
          const liveJournal = state.journal.find((entry) => entryDayKey(entry) === today) as NotebookJournalEntry | undefined;
          const merged = mergeCloseoutIntoJournal(liveJournal, {
            completed, oneWin, blocker, remaining, tomorrow: firstTask,
            energyLabel: energyNow ? numericEnergyLabel(Number(energyNow)) : "",
          }, today);
          if (merged.create) journal = [{ ...merged.create, id: crypto.randomUUID() }, ...state.journal];
          else if (merged.patch && liveJournal) {
            journal = state.journal.map((entry) => entry.id === liveJournal.id ? { ...entry, ...merged.patch } : entry);
          }
        }
        return {
          closeouts: [nextCloseout, ...(state.closeouts ?? []).filter((item) => item.dayKey !== today)],
          ...(journal === state.journal ? {} : { journal }),
        };
      });
      await flushLocalVaultWrites();
      assertVaultWrite(checkpoint + 1);
      assertVaultWritesSince(checkpoint);
      onClose();
      if (openNotebook) gotoJournalDay(today);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "The local vault write failed.";
      setSaveError(`Not saved on this device. This closeout is still open, and your entries remain here so you can retry. ${detail}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Daily closeout"
      onClose={() => { if (!saving) onClose(); }}
      footer={<>
        <GButton disabled={saving} onClick={() => void save(true)}>Expand into full notebook</GButton>
        <GButton disabled={saving} variant="primary" onClick={() => void save(false)}>{saving ? "Saving…" : "Close the day"}</GButton>
      </>}
    >
      <div className="sub">A short, honest closeout is enough. AXOM assembled the context below from today’s local records.</div>
      {saveError && <p role="alert">{saveError}</p>}
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
      <Field label="What matters tomorrow?" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder="Up next can put this on top" />
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

      <label className="sub closeout-journal-option row gap8">
        <input type="checkbox" checked={addToJournal} onChange={(event) => setAddToJournal(event.target.checked)} />
        <span>
          {existingJournal
            ? "Add this closeout to today’s journal. Your existing writing stays unchanged; AXOM only fills empty closeout fields and adds new wins or unfinished loops."
            : "Create today’s journal page from this closeout. Leave this unchecked to save the closeout without creating a journal entry."}
        </span>
      </label>
    </Modal>
  );
}

function numericEnergyLabel(value: number): "Low" | "Medium" | "High" | "" {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 40) return "Low";
  if (value < 70) return "Medium";
  return "High";
}
