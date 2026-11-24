// ===========================================================================
// Daily Closeout (directive §3) — a 30–90 second end-of-day flow. Prefills as
// much as possible from today's data so the user mostly confirms, not writes.
// Saving updates tomorrow's Command Brief (first task + mode preference).
// ===========================================================================
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { mergeCloseoutIntoJournal } from "../../lib/closeoutJournal";
import type { NotebookJournalEntry } from "../../lib/journalNotebook";
import { useStore, type Store } from "../../lib/store";
import { getQuestionAttachmentScope, isQuestionAttachmentScopeCurrent, subscribeQuestionAttachmentScope } from "../../lib/questionAttachmentScope";
import { read as readSyncMetadata } from "../../lib/sync/syncMetadata";
import { closeoutForDay, type EnergyVsMorning } from "../../lib/closeout";
import { MODE_LABEL, type BriefMode } from "../../lib/commandBrief";
import type { DailyCloseout } from "../../lib/closeout";
import { Modal, Field, TextAreaField } from "../ui/Modal";
import { GButton } from "../ui/primitives";
import { selectDayAtAGlance } from "../../lib/dayAtAGlance";
import { entryDayKey } from "../../lib/journal";
import { gotoJournalDay } from "../../lib/uiStore";
import { assertVaultWritesSince, commitLocalVaultItem, flushLocalVaultWrites, getVaultWriteCheckpoint, isVaultConflictError } from "../../lib/localVault";
import { isPackedFallbackError } from "../../lib/packedVaultFallback";

const MODES: Array<"auto" | BriefMode> = ["auto", "maintain", "catch-up", "recovery", "sprint", "exam-week"];

export function CloseoutModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  // Re-render when the attachment identity changes, even without a store update.
  const activeScope = useSyncExternalStore(subscribeQuestionAttachmentScope, getQuestionAttachmentScope);
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
  const submitting = useRef(false);
  const reconciliationRequired = useRef(false);
  const [reviewRequired, setReviewRequired] = useState(false);
  const requireReconciliation = (message: string) => {
    reconciliationRequired.current = true;
    setReviewRequired(true);
    setSaveError(message);
  };
  const [origin] = useState(() => ({
    scope: getQuestionAttachmentScope(),
    linkedAccountId: readSyncMetadata().accountUserId,
    profileUserId: s.profile.userId,
    day: today,
  }));
  const isCurrent = () => {
    const live = useStore.getState();
    return isQuestionAttachmentScopeCurrent(origin.scope)
      && readSyncMetadata().accountUserId === origin.linkedAccountId
      && live.profile.userId === origin.profileUserId
      && live.activeDayKey === origin.day;
  };
  const showRecoveryDraft = reviewRequired && activeScope === origin.scope && isCurrent();
  const recoveryDraft = showRecoveryDraft ? [
    "Unconfirmed closeout draft (not an AXOM backup or import file)",
    `Day: ${origin.day}`,
    `What went well: ${completed}`,
    `One win: ${oneWin}`,
    `Blocker: ${blocker}`,
    `Unfinished loop: ${remaining}`,
    `Tomorrow first task: ${firstTask}`,
    `Energy now: ${energyNow}`,
    `Energy vs morning: ${energy ?? "Not selected"}`,
    `Tomorrow mode: ${mode}`,
    `Add to Journal: ${addToJournal ? "Yes" : "No"}`,
  ].join("\n") : "";
  const glance = useMemo(() => selectDayAtAGlance(s, today, today), [s, today]);
  const existingJournal = s.journal.find((entry) => entryDayKey(entry) === today) as NotebookJournalEntry | undefined;

  async function save(openNotebook = false) {
    if (submitting.current || reconciliationRequired.current) return;
    if (!isCurrent()) {
      setSaveError("This closeout belongs to a previous workspace or day. Copy your draft before closing and open a new closeout for the current workspace.");
      return;
    }
    submitting.current = true;
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
    let acknowledged = false;
    try {
      // Drain previously requested work before preparing the isolated draft.
      await flushLocalVaultWrites();
      const options = useStore.persist.getOptions();
      if (!options.name || !options.partialize) throw new Error("The workspace persistence configuration is unavailable.");
      const { name, partialize, version } = options;
      const checkpoint = getVaultWriteCheckpoint();
      const published = await commitLocalVaultItem(name, () => {
        if (!isCurrent()) throw new Error("The workspace or day changed before this save started.");
        const base = useStore.getState();
        const stamp = new Date().toISOString();
        const priorCloseout = closeoutForDay(base.closeouts ?? [], today);
        const nextCloseout: DailyCloseout = {
          ...record,
          id: priorCloseout?.id ?? crypto.randomUUID(),
          createdAt: priorCloseout?.createdAt ?? stamp,
          updatedAt: stamp,
        };
        const priorJournal = base.journal.find((entry) => entryDayKey(entry) === today) as NotebookJournalEntry | undefined;
        let nextJournal: NotebookJournalEntry | undefined;
        if (addToJournal) {
          const merged = mergeCloseoutIntoJournal(priorJournal, {
            completed, oneWin, blocker, remaining, tomorrow: firstTask,
            energyLabel: energyNow ? numericEnergyLabel(Number(energyNow)) : "",
          }, today);
          if (merged.create) nextJournal = { ...merged.create, id: crypto.randomUUID() } as NotebookJournalEntry;
          else if (merged.patch && priorJournal) nextJournal = { ...priorJournal, ...merged.patch };
        }
        const apply = (live: Store) => ({
          closeouts: [nextCloseout, ...(live.closeouts ?? []).filter((item) => item.dayKey !== today)],
          ...(nextJournal ? {
            journal: priorJournal
              ? live.journal.map((entry) => entry.id === priorJournal.id ? nextJournal! : entry)
              : [nextJournal, ...live.journal],
          } : {}),
        });
        const candidate = { ...base, ...apply(base) };
        return {
          value: JSON.stringify({ state: partialize(candidate), version }),
          publish: () => {
            if (!isCurrent()) return false;
            const live = useStore.getState();
            // An unrelated task or another day's Journal edit may have been
            // queued while the candidate was writing. Preserve that edit.
            // A newer same-day edit owns its own fields; do not overwrite it.
            if (closeoutForDay(live.closeouts ?? [], today) !== priorCloseout
              || (addToJournal && live.journal.find((entry) => entryDayKey(entry) === today) !== priorJournal)) return false;
            // Zustand queues a fresh snapshot with the accepted delta and
            // any independent edits. This replaces a stale queued ordinary
            // snapshot before the single writer resumes draining.
            void useStore.setState(apply(live));
            return true;
          },
        };
      });
      acknowledged = true;
      // Draining is not a receipt: a newer coalesced snapshot may fail after
      // the staged candidate was acknowledged. Never navigate on that result.
      await flushLocalVaultWrites();
      assertVaultWritesSince(checkpoint);
      if (!published || !isCurrent()) {
        requireReconciliation("The closeout reached storage, but could not be confirmed here. Another edit or workspace change may have superseded it. Copy your draft and review your current workspace before retrying.");
        return;
      }
      onClose();
      if (openNotebook) gotoJournalDay(today);
    } catch (cause) {
      if (acknowledged) {
        requireReconciliation("The closeout reached storage, but newer changes could not be confirmed. Keep this workspace open, copy or export unsaved work, and review saved work before trying again.");
      } else if (isVaultConflictError(cause) || isPackedFallbackError(cause)) {
        // A conflict can occur AFTER the primary transaction commits. A
        // rejected receipt is not proof that the candidate is absent.
        requireReconciliation("AXOM could not confirm which changes were saved. Keep both copies, copy your draft, and review saved work before trying again.");
      } else {
        const detail = cause instanceof Error ? cause.message : "The local vault write failed.";
        setSaveError(`Not saved on this device. This closeout is still open, and your entries remain here so you can retry. ${detail}`);
      }
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Daily closeout"
      onClose={() => {
        if (submitting.current) return;
        // Do not accidentally discard the only editable copy of a disputed draft.
        if (reconciliationRequired.current && isCurrent()) return;
        onClose();
      }}
      footer={<>
        <GButton disabled={saving || reviewRequired} onClick={() => void save(true)}>Expand into full notebook</GButton>
        <GButton disabled={saving || reviewRequired} variant="primary" onClick={() => void save(false)}>{saving ? "Saving…" : "Close the day"}</GButton>
      </>}
    >
      <div className="sub">A short, honest closeout is enough. AXOM assembled the context below from today’s local records.</div>
      {saveError && <p role="alert">{saveError}</p>}
      {showRecoveryDraft && (
        <section className="stack gap6" aria-label="Unconfirmed closeout draft recovery">
          <p className="sub">A workspace backup may exclude this draft and competing stored versions. Select and copy this text somewhere private before leaving. This is not a restore file and does not resolve the storage conflict.</p>
          <TextAreaField label="Closeout draft copy (not a backup)" readOnly rows={6} value={recoveryDraft} />
          <GButton disabled={saving} onClick={() => { if (!submitting.current) onClose(); }}>Close without resolving</GButton>
          <p className="sub">Closing or reloading can discard this editable draft. Neither stored version is changed by closing.</p>
        </section>
      )}
      <section className="closeout-glance" aria-label="Day at a glance">
        <b>Day at a Glance</b>
        <span>{glance.intention?.text ? `Intention: ${glance.intention.text}` : "No intention was set"}</span>
        <span>{glance.targetCompletion.eligibleCount ? `Targets: ${glance.targetCompletion.metCount}/${glance.targetCompletion.eligibleCount} met` : "No targets scheduled"}</span>
        <span>{glance.focusedMinutes.value} focused min · {glance.questions.trustedAttempts} questions · {glance.cards.reviewed} cards</span>
        <span>{glance.tasks.completed.length} tasks completed · {glance.unfinishedItems.length} open loops</span>
      </section>
      <TextAreaField disabled={saving} label="What went well?" rows={2} value={completed} onChange={(e) => setCompleted(e.target.value)} />
      <Field disabled={saving} label="One win" value={oneWin} onChange={(e) => setOneWin(e.target.value)} placeholder="the moment worth keeping" />
      <Field disabled={saving} label="What got in the way?" value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="one sentence is enough" />
      <Field disabled={saving} label="One unfinished loop" value={remaining} onChange={(e) => setRemaining(e.target.value)} placeholder="e.g. finish the final lecture" />
      <Field disabled={saving} label="What matters tomorrow?" value={firstTask} onChange={(e) => setFirstTask(e.target.value)} placeholder="Up next can put this on top" />
      <Field disabled={saving} label="Energy now (0–100)" type="number" min="0" max="100" value={energyNow} onChange={(e) => setEnergyNow(e.target.value)} />

      <details className="closeout-advanced">
        <summary>Planning details</summary>
      <div className="stack gap6">
        <span className="field-label">Energy vs this morning</span>
        <div className="row">
          {(["lower", "same", "higher"] as const).map((v) => (
            <button key={v} disabled={saving} className={`filter-pill ${energy === v ? "on" : ""}`} onClick={() => setEnergy(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="stack gap6">
        <span className="field-label">Tomorrow's mode</span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {MODES.map((m) => (
            <button key={m} disabled={saving} className={`filter-pill ${mode === m ? "on" : ""}`} onClick={() => setMode(m)}>
              {m === "auto" ? "Auto-decide" : MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      </details>

      <label className="sub closeout-journal-option row gap8">
        <input type="checkbox" disabled={saving} checked={addToJournal} onChange={(event) => setAddToJournal(event.target.checked)} />
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
