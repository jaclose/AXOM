import {
  useCallback, useEffect, useMemo, useRef, useState,
  type ChangeEvent, type KeyboardEvent,
} from "react";
import { ICON_SIZE } from "../lib/iconSize";
import {
  ArrowLeft, ArrowRight, BookOpen, CalendarClock, Check, CheckCircle2, ChevronRight,
  Download, ImagePlus, ListChecks, Lock, Palette, Pencil, Plus, Save, Sparkles, Trash2,
  Trophy, X,
} from "lucide-react";
import { useStore } from "../lib/store";
import { useUi } from "../lib/uiStore";
import { GButton, GhostButton, PanelHeader, Tag } from "../components/ui/primitives";
import { Field, Modal, SelectField } from "../components/ui/Modal";
import { dayKey, prettyDate } from "../lib/scoring";
import { entryDayKey, missedStandupDays, planForDay, reflectionPrompts } from "../lib/journal";
import type { DayPlan, JournalEntry, Profile } from "../lib/types";
import { announceJournalEnergyOnce } from "../lib/journalAnnouncement";
import { selectDayAtAGlance } from "../lib/dayAtAGlance";
import { buildDayExtraSections } from "../lib/journalExtras";
import { readListeningLog } from "../lib/soundscapes/listeningLog";
import { readRestLog } from "../lib/rest";
import { focusCheckInLedger } from "../lib/focusCheckIn";
import { useReducedMotion } from "../lib/motion";
import {
  DEFAULT_JOURNAL_NOTEBOOK,
  buildJournalGlanceSections,
  buildJournalMarkdown,
  createJournalAttachmentExport,
  formatBytes,
  hasNotebookContent,
  nextJournalDay,
  normalizeJournalAttachments,
  normalizeJournalNotebookPreferences,
  previousJournalDay,
  readJournalImage,
  renderJournalGlanceText,
  withoutJournalAttachment,
  type JournalGlancePreferences,
  type JournalGlanceSectionKey,
  type JournalImageAttachment,
  type JournalNotebookEntryFields,
  type JournalNotebookPreferences,
  type NotebookJournalEntry,
} from "../lib/journalNotebook";

type JournalProfile = Profile & { journalNotebook?: JournalNotebookPreferences };
type TurnDirection = "previous" | "next" | null;

const outcomeTone = { won: "green", partial: "orange", missed: "red" } as const;

export function JournalPage() {
  const s = useStore();
  const journalDay = useUi((state) => state.journalDay);
  const clearJournalDay = useUi((state) => state.clearJournalDay);
  const reducedMotion = useReducedMotion();
  const [selectedDay, setSelectedDay] = useState(s.activeDayKey || dayKey());
  const [open, setOpen] = useState(false);
  const [remediationMode, setRemediationMode] = useState(false);
  const [turnDirection, setTurnDirection] = useState<TurnDirection>(null);
  const [customizing, setCustomizing] = useState(false);
  const today = s.activeDayKey || dayKey();
  const preferences = normalizeJournalNotebookPreferences((s.profile as JournalProfile).journalNotebook);
  const missed = missedStandupDays({ journal: s.journal, logs: s.logs, dayPlans: s.dayPlans });
  const entries = useMemo(
    () => [...s.journal].sort((a, b) => entryDayKey(b).localeCompare(entryDayKey(a))),
    [s.journal],
  );

  useEffect(() => { announceJournalEnergyOnce(); }, []);

  useEffect(() => {
    if (!journalDay) return;
    setSelectedDay(journalDay);
    setOpen(true);
    setRemediationMode(true);
    clearJournalDay();
  }, [journalDay, clearJournalDay]);

  function openDay(key: string, remediation = false) {
    setSelectedDay(key);
    setRemediationMode(remediation);
    setOpen(true);
  }

  function closeNotebook() {
    setOpen(false);
    setRemediationMode(false);
  }

  function navigate(direction: Exclude<TurnDirection, null>) {
    const next = direction === "previous" ? previousJournalDay(selectedDay) : nextJournalDay(selectedDay);
    if (next > today) return;
    setTurnDirection(direction);
    setSelectedDay(next);
    if (!reducedMotion) window.setTimeout(() => setTurnDirection(null), 440);
  }

  return (
    <div className={`journal-notebook-page${open ? " is-open" : ""}`}>
      <header className="journal-page-header">
        <div>
          <span className="journal-kicker">Journal</span>
          <h1>Make sense of the day.</h1>
          <p>Write freely, close open loops, and keep the record on this device.</p>
        </div>
        <div className="journal-header-actions">
          <GButton size="sm" onClick={() => setCustomizing(true)}><Palette size={ICON_SIZE.body} /> Customize</GButton>
          {open && <GButton size="sm" onClick={closeNotebook}><BookOpen size={ICON_SIZE.body} /> Library</GButton>}
        </div>
      </header>

      {!open ? (
        <NotebookLibrary
          preferences={preferences}
          entries={entries}
          missed={missed}
          today={today}
          onOpenDay={openDay}
        />
      ) : (
        <JournalWritingPage
          key={selectedDay}
          day={selectedDay}
          today={today}
          preferences={preferences}
          direction={turnDirection}
          remediationMode={remediationMode}
          onNavigate={navigate}
          onClose={closeNotebook}
        />
      )}

      {customizing && (
        <NotebookCustomization
          initial={preferences}
          onClose={() => setCustomizing(false)}
          onSave={(journalNotebook) => {
            const patch = { journalNotebook } as Partial<Profile> & { journalNotebook: JournalNotebookPreferences };
            useStore.getState().updateProfile(patch);
            setCustomizing(false);
          }}
        />
      )}
    </div>
  );
}

function NotebookLibrary({
  preferences, entries, missed, today, onOpenDay,
}: {
  preferences: JournalNotebookPreferences;
  entries: JournalEntry[];
  missed: string[];
  today: string;
  onOpenDay: (key: string, remediation?: boolean) => void;
}) {
  const s = useStore();
  return (
    <div className="journal-library-grid">
      <section className="journal-library-hero" aria-labelledby="journal-library-title">
        <button
          type="button"
          className={`journal-hardback cover-${preferences.coverTone}`}
          onClick={() => onOpenDay(today)}
          aria-label={`Open ${preferences.title} to today’s page`}
        >
          <span className="journal-cover-spine" aria-hidden="true" />
          <span className="journal-cover-mark" aria-hidden="true">A</span>
          <span className="journal-cover-copy">
            <strong id="journal-library-title">{preferences.title}</strong>
            <span>{preferences.subtitle}</span>
          </span>
          <span className="journal-cover-edge" aria-hidden="true" />
        </button>
        <div className="journal-library-primary">
          <GButton variant="primary" onClick={() => onOpenDay(today)}>
            <BookOpen size={ICON_SIZE.emphasis} /> Open today’s page
          </GButton>
          <span>{entries.length ? `${entries.length} local page${entries.length === 1 ? "" : "s"}` : "Your first page is ready"}</span>
        </div>
      </section>

      <aside className="journal-library-shelf" aria-label="Journal pages">
        <PanelHeader title="Recent pages" sub="Stored locally in your AXOM workspace" />
        {entries.length === 0 ? (
          <div className="journal-calm-empty">
            <BookOpen size={ICON_SIZE.display} />
            <b>No pages yet</b>
            <span>Open today’s page. AXOM saves as you write.</span>
          </div>
        ) : (
          <div className="journal-page-list">
            {entries.slice(0, 8).map((rawEntry) => {
              const entry = rawEntry as NotebookJournalEntry;
              const key = entryDayKey(entry);
              const preview = entry.freeWriting?.trim() || entry.today.trim() || entry.tomorrow.trim() || "Image and day notes";
              return (
                <div className="journal-page-list-row" key={entry.id}>
                  <button type="button" onClick={() => onOpenDay(key)}>
                    <span><b>{key === today ? "Today" : prettyDate(`${key}T12:00:00`)}</b><small>{preview}</small></span>
                    <ChevronRight size={ICON_SIZE.emphasis} aria-hidden="true" />
                  </button>
                  <GhostButton
                    className="danger"
                    aria-label={`Delete journal page for ${key}`}
                    onClick={() => {
                      if (window.confirm("Delete this journal page? This cannot be undone.")) s.removeJournal(entry.id);
                    }}
                  ><Trash2 size={ICON_SIZE.body} /></GhostButton>
                </div>
              );
            })}
          </div>
        )}
        {missed.length > 0 && (
          <details className="journal-catchup-disclosure">
            <summary><CalendarClock size={ICON_SIZE.body} /> {missed.length} optional catch-up page{missed.length === 1 ? "" : "s"}</summary>
            <p>These days had local activity but no journal page. Catch-up is optional.</p>
            <div className="journal-catchup-days">
              {missed.map((key) => (
                <button key={key} type="button" onClick={() => onOpenDay(key, true)}>
                  {prettyDate(`${key}T12:00:00`)} <Plus size={ICON_SIZE.body} />
                </button>
              ))}
            </div>
          </details>
        )}
      </aside>
    </div>
  );
}

interface JournalDraft {
  today: string;
  tomorrow: string;
  blockers: string;
  energy: JournalEntry["energy"];
  rating: string;
  freeWriting: string;
  wins: string[];
  losses: string[];
  attachments: JournalImageAttachment[];
  dayAtAGlance: JournalGlancePreferences;
  notebookStatus: "draft" | "complete";
}

function JournalWritingPage({
  day, today, preferences, direction, remediationMode, onNavigate, onClose,
}: {
  day: string;
  today: string;
  preferences: JournalNotebookPreferences;
  direction: TurnDirection;
  remediationMode: boolean;
  onNavigate: (direction: Exclude<TurnDirection, null>) => void;
  onClose: () => void;
}) {
  const s = useStore();
  const entry = s.journal.find((item) => entryDayKey(item) === day) as NotebookJournalEntry | undefined;
  const plan = planForDay(s.dayPlans, day);
  const prompts = useMemo(() => reflectionPrompts(plan), [plan]);
  const reducedMotion = useReducedMotion();
  const [draft, setDraftState] = useState<JournalDraft>(() => draftFromEntry(entry, plan));
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(entry ? "saved" : "idle");
  const [attachmentError, setAttachmentError] = useState("");
  const [addingImage, setAddingImage] = useState(false);
  const [editingGlance, setEditingGlance] = useState<JournalGlanceSectionKey | null>(null);
  const entryIdRef = useRef(entry?.id ?? "");
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const glance = selectDayAtAGlance({
    profile: s.profile,
    activeDayKey: s.activeDayKey,
    dayPlans: s.dayPlans,
    logs: s.logs,
    productivityTrackers: s.productivityTrackers,
    sessions: s.sessions,
    questions: s.questions,
    habits: s.habits,
    habitEntries: s.habitEntries,
    tasks: s.tasks,
    energyFactors: s.energyFactors,
    journal: s.journal,
    closeouts: s.closeouts,
  }, day, today);
  const glanceSections = useMemo(() => [
    ...buildJournalGlanceSections(glance),
    ...buildDayExtraSections({
      day,
      sessions: s.sessions ?? [],
      attempts: (s.questions ?? []).flatMap((question) => question.attempts ?? []),
      listening: readListeningLog(),
      rests: readRestLog(),
      checkIns: focusCheckInLedger.read(day),
    }),
  ], [glance, day, s.sessions, s.questions]);
  // The day's record is always part of the page; hide or correct any line.
  const liveGlanceText = renderJournalGlanceText(glanceSections, draft.dayAtAGlance);
  const liveGlanceRef = useRef(liveGlanceText);
  liveGlanceRef.current = liveGlanceText;

  const persist = useCallback((status?: "draft" | "complete") => {
    const current = draftRef.current;
    if (!hasNotebookContent(current) && !entryIdRef.current) return;
    const timestamp = new Date().toISOString();
    // Stamp the entry's `date` with the local day key (noon), never a raw UTC
    // toISOString(): day-keyed lookups use `entry.date.slice(0,10)` against the
    // local day key, so a UTC prefix mismatches near midnight (entry appears on
    // the wrong day / not found). `updatedAt` keeps the precise instant.
    const payload: Omit<JournalEntry, "id"> & JournalNotebookEntryFields = {
      date: entry?.date ?? `${day}T12:00:00`,
      today: current.today.trim(),
      tomorrow: current.tomorrow,
      blockers: current.blockers,
      energy: current.energy,
      rating: current.rating,
      freeWriting: current.freeWriting,
      wins: current.wins.filter((value) => value.trim()),
      losses: current.losses.filter((value) => value.trim()),
      attachments: current.attachments,
      dayAtAGlance: { ...current.dayAtAGlance, includedText: liveGlanceRef.current, includedAt: timestamp },
      notebookStatus: status ?? current.notebookStatus,
      updatedAt: timestamp,
    };
    let id = entryIdRef.current;
    if (!id) {
      id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `journal-${Date.now()}`;
      entryIdRef.current = id;
    }
    const store = useStore.getState();
    if (store.journal.some((item) => item.id === id)) store.updateJournal(id, payload);
    else store.addJournal({ ...payload, id });
    dirtyRef.current = false;
    setSaveState("saved");
  }, [day, entry?.date]);

  function setDraft(update: (current: JournalDraft) => JournalDraft) {
    setDraftState((current) => {
      const next = update(current);
      draftRef.current = next;
      dirtyRef.current = true;
      setSaveState("saving");
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => persist(), 420);
      return next;
    });
  }

  useEffect(() => {
    pageHeadingRef.current?.focus({ preventScroll: true });
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
      if (dirtyRef.current) persist();
    };
  }, [persist]);

  function turnPage(nextDirection: Exclude<TurnDirection, null>) {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    persist();
    onNavigate(nextDirection);
  }

  function handleBookKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select, button, a, [contenteditable='true']")) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      turnPage("previous");
    }
    if (event.key === "ArrowRight" && day < today) {
      event.preventDefault();
      turnPage("next");
    }
  }

  async function addAttachment(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setAttachmentError("");
    setAddingImage(true);
    try {
      const attachment = await readJournalImage(file, draftRef.current.attachments);
      setDraft((current) => ({ ...current, attachments: [...current.attachments, attachment] }));
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : "AXOM could not add that image.");
    } finally {
      setAddingImage(false);
    }
  }

  function exportAttachment(attachment: JournalImageAttachment) {
    const result = createJournalAttachmentExport(attachment);
    downloadBlob(result.filename, result.blob);
  }

  function exportPage() {
    const raw: NotebookJournalEntry = {
      id: entryIdRef.current || `journal-export-${day}`,
      date: entry?.date ?? `${day}T12:00:00`,
      ...draftRef.current,
    };
    const body = buildJournalMarkdown(raw, prettyDate(`${day}T12:00:00`));
    downloadBlob(`axom-journal-${day}.md`, new Blob([body], { type: "text/markdown;charset=utf-8" }));
  }

  const hiddenGlance = new Set(draft.dayAtAGlance.hiddenSections ?? []);
  const dialogProps = remediationMode
    ? { role: "dialog" as const, "aria-modal": false, "aria-label": entry ? "Edit standup" : "New standup" }
    : {};

  return (
    <section
      className={`journal-book-stage paper-${preferences.paperTone}${direction ? ` turn-${direction}` : ""}`}
      aria-label="Journal notebook"
      data-motion={reducedMotion ? "reduced" : "full"}
      onKeyDown={handleBookKeyDown}
      {...dialogProps}
    >
      <div className="journal-book-toolbar">
        <GButton size="sm" onClick={() => turnPage("previous")} aria-label="Previous journal page">
          <ArrowLeft size={ICON_SIZE.body} /> Previous
        </GButton>
        <div className="journal-page-position" aria-live="polite">
          <b>{day === today ? "Today" : prettyDate(`${day}T12:00:00`)}</b>
          <span>{saveState === "saving" ? "Saving locally…" : saveState === "saved" ? "Saved locally" : "Ready to write"}</span>
        </div>
        <GButton size="sm" onClick={() => turnPage("next")} disabled={day >= today} aria-label="Next journal page">
          Next <ArrowRight size={ICON_SIZE.body} />
        </GButton>
      </div>

      <div className="journal-open-book">
        <article className="journal-paper journal-writing-paper">
          <div className="journal-paper-running-head">
            <span>{preferences.title}</span><time dateTime={day}>{prettyDate(`${day}T12:00:00`)}</time>
          </div>
          <h2 ref={pageHeadingRef} tabIndex={-1}>{day === today ? "Today’s page" : "Daily reflection"}</h2>
          <p className="journal-page-lede">A private record for what happened, what mattered, and what comes next.</p>

          {plan && <PreviousIntention plan={plan} />}

          <div className="journal-prompt-strip" aria-label="Reflection prompts">
            <Sparkles size={ICON_SIZE.body} aria-hidden="true" />
            <span>{prompts[0]}</span>
          </div>

          <label className="journal-writing-field">
            <span>Today — did you do what you set out to do?</span>
            <textarea value={draft.today} onChange={(event) => setDraft((current) => ({ ...current, today: event.target.value }))}
              placeholder="What went well?" />
          </label>
          <label className="journal-writing-field compact">
            <span>What got in the way?</span>
            <textarea value={draft.blockers} onChange={(event) => setDraft((current) => ({ ...current, blockers: event.target.value }))}
              placeholder="Name the friction without judging yourself." />
          </label>
          <label className="journal-writing-field compact">
            <span>What matters tomorrow?</span>
            <textarea value={draft.tomorrow} onChange={(event) => setDraft((current) => ({ ...current, tomorrow: event.target.value }))}
              placeholder="Protect one useful next step." />
          </label>

          <div className="journal-win-loss-grid">
            <label>
              <span><Trophy size={ICON_SIZE.body} /> One win</span>
              <input value={draft.wins[0] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, wins: [event.target.value] }))}
                placeholder="Something worth keeping" />
            </label>
            <label>
              <span><ListChecks size={ICON_SIZE.body} /> One unfinished loop</span>
              <input value={draft.losses[0] ?? ""} onChange={(event) => setDraft((current) => ({ ...current, losses: [event.target.value] }))}
                placeholder="Something to carry forward" />
            </label>
          </div>

          <label className="journal-writing-field journal-free-writing">
            <span>Free writing</span>
            <textarea value={draft.freeWriting} onChange={(event) => setDraft((current) => ({ ...current, freeWriting: event.target.value }))}
              placeholder="Write without a template. This stays on your device." />
          </label>

          {liveGlanceText && (
            <section className="journal-included-glance" aria-labelledby="included-glance-title">
              <div><Check size={ICON_SIZE.body} /><h3 id="included-glance-title">Your day, recorded</h3><span className="journal-auto-badge">Updates automatically</span></div>
              <pre>{liveGlanceText}</pre>
            </section>
          )}

          <section className="journal-attachments" aria-labelledby="journal-attachments-title">
            <div className="journal-section-head">
              <div><h3 id="journal-attachments-title">Images</h3><span>Optional · stored in this local workspace</span></div>
              <GButton size="sm" onClick={() => fileInputRef.current?.click()} disabled={addingImage}>
                <ImagePlus size={ICON_SIZE.body} /> {addingImage ? "Adding…" : "Add image"}
              </GButton>
              <input ref={fileInputRef} className="journal-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={addAttachment} aria-label="Choose a journal image" />
            </div>
            <p className="journal-local-note">Images are saved in IndexedDB with this workspace. Nothing is uploaded. Maximum 3 MB each and 12 MB per page.</p>
            {attachmentError && <div className="journal-attachment-error" role="alert">{attachmentError}</div>}
            {draft.attachments.length > 0 && (
              <div className="journal-attachment-grid">
                {draft.attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <img src={attachment.dataUrl} alt={attachment.altText || attachment.name} />
                    <figcaption>
                      <span><b>{attachment.name}</b><small>{formatBytes(attachment.size)}</small></span>
                      <span className="journal-attachment-actions">
                        <GhostButton aria-label={`Export ${attachment.name}`} onClick={() => exportAttachment(attachment)}><Download size={ICON_SIZE.body} /></GhostButton>
                        <GhostButton className="danger" aria-label={`Remove ${attachment.name}`} onClick={() => setDraft((current) => ({
                          ...current,
                          attachments: withoutJournalAttachment(current.attachments, attachment.id),
                        }))}><Trash2 size={ICON_SIZE.body} /></GhostButton>
                      </span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <div className="journal-page-footer-actions">
            <label className="journal-energy-field">
              <span>Energy</span>
              <select aria-label="Energy" value={draft.energy} onChange={(event) => setDraft((current) => ({
                ...current,
                energy: event.target.value as JournalEntry["energy"],
              }))}>
                <option value="">Not set</option><option>Low</option><option>Medium</option><option>High</option>
              </select>
            </label>
            <GButton size="sm" onClick={exportPage}><Download size={ICON_SIZE.body} /> Export page</GButton>
            {remediationMode && <GButton size="sm" onClick={onClose}><X size={ICON_SIZE.body} /> Cancel</GButton>}
            <GButton size="sm" onClick={() => persist()}><Save size={ICON_SIZE.body} /> Save</GButton>
            <GButton variant="primary" size="sm" onClick={() => {
              setDraft((current) => ({ ...current, notebookStatus: "complete" }));
              window.setTimeout(() => persist("complete"), 0);
            }}><CheckCircle2 size={ICON_SIZE.body} /> Done for today</GButton>
          </div>
        </article>

        <aside className="journal-paper journal-glance-paper" aria-labelledby="journal-glance-title">
          <div className="journal-paper-running-head"><span>Local summary</span><span>Optional</span></div>
          <h2 id="journal-glance-title">Day at a glance</h2>
          <p>AXOM assembled this from today’s local records. Edit or ignore anything.</p>
          <div className="journal-glance-list">
            {glanceSections.map((item) => {
              const hidden = hiddenGlance.has(item.key);
              const correction = draft.dayAtAGlance.corrections?.[item.key] ?? "";
              return (
                <section key={item.key} className={`journal-glance-row${hidden ? " is-hidden" : ""}`}>
                  <div className="journal-glance-row-head">
                    <span><i className={item.hasEvidence ? "has-evidence" : ""} aria-hidden="true" /><b>{item.label}</b></span>
                    <div>
                      <GhostButton aria-label={`Correct ${item.label}`} aria-expanded={editingGlance === item.key}
                        onClick={() => setEditingGlance((current) => current === item.key ? null : item.key)}><Pencil size={ICON_SIZE.body} /></GhostButton>
                      <GhostButton aria-label={`${hidden ? "Show" : "Hide"} ${item.label}`} onClick={() => setDraft((current) => {
                        const hiddenSections = new Set(current.dayAtAGlance.hiddenSections ?? []);
                        if (hidden) hiddenSections.delete(item.key); else hiddenSections.add(item.key);
                        return { ...current, dayAtAGlance: { ...current.dayAtAGlance, hiddenSections: [...hiddenSections] } };
                      })}>{hidden ? <Plus size={ICON_SIZE.body} /> : <X size={ICON_SIZE.body} />}</GhostButton>
                    </div>
                  </div>
                  <p>{correction.trim() || item.value}</p>
                  {editingGlance === item.key && (
                    <label><span className="sr-only">Correct {item.label}</span><input autoFocus value={correction}
                      placeholder="Use your own value, or leave blank"
                      onChange={(event) => setDraft((current) => ({
                        ...current,
                        dayAtAGlance: {
                          ...current.dayAtAGlance,
                          corrections: { ...current.dayAtAGlance.corrections, [item.key]: event.target.value },
                        },
                      }))} /></label>
                  )}
                </section>
              );
            })}
          </div>
          <span className="journal-glance-footnote">Every visible line is included in your page automatically and saved with it. Hide a line to leave it out; corrections change only this page, never your records.</span>
        </aside>
      </div>
    </section>
  );
}

function NotebookCustomization({
  initial, onClose, onSave,
}: {
  initial: JournalNotebookPreferences;
  onClose: () => void;
  onSave: (preferences: JournalNotebookPreferences) => void;
}) {
  const [draft, setDraft] = useState(initial);
  return (
    <Modal title="Customize notebook" onClose={onClose} footer={<>
      <GButton onClick={() => setDraft(DEFAULT_JOURNAL_NOTEBOOK)}>Reset</GButton>
      <GButton onClick={onClose}>Cancel</GButton>
      <GButton variant="primary" onClick={() => onSave(normalizeJournalNotebookPreferences(draft))}>Save notebook</GButton>
    </>}>
      <p className="sub">Change the cover and paper without changing any journal pages.</p>
      <Field label="Notebook title" value={draft.title} maxLength={80} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
      <Field label="Subtitle" value={draft.subtitle} maxLength={120} onChange={(event) => setDraft({ ...draft, subtitle: event.target.value })} />
      <div className="row gap12">
        <SelectField label="Cover" value={draft.coverTone} onChange={(event) => setDraft({
          ...draft,
          coverTone: event.target.value as JournalNotebookPreferences["coverTone"],
        })}>
          <option value="onyx">Onyx</option><option value="forest">Forest</option>
          <option value="oxblood">Oxblood</option><option value="navy">Midnight navy</option>
        </SelectField>
        <SelectField label="Paper" value={draft.paperTone} onChange={(event) => setDraft({
          ...draft,
          paperTone: event.target.value as JournalNotebookPreferences["paperTone"],
        })}>
          <option value="warm">Warm</option><option value="cream">Cream</option><option value="white">Bright</option>
        </SelectField>
      </div>
    </Modal>
  );
}

function PreviousIntention({ plan }: { plan: DayPlan }) {
  return (
    <div className="standup-prev-intention journal-intention-card">
      <div className="spi-head"><Lock size={ICON_SIZE.microInline} /> Intention set {prettyDate(`${plan.dayKey}T12:00:00`)} · source record unchanged</div>
      <p>“{plan.intention}”</p>
      {plan.wins.length > 0 && <div className="spi-wins">{plan.wins.map((win, index) => <span key={index}>{win}</span>)}</div>}
      {plan.outcome && <Tag tone={outcomeTone[plan.outcome]}><Trophy size={ICON_SIZE.microInline} /> Marked {plan.outcome}</Tag>}
    </div>
  );
}

function draftFromEntry(entry: NotebookJournalEntry | undefined, plan: DayPlan | undefined): JournalDraft {
  return {
    today: entry?.today ?? "",
    tomorrow: entry?.tomorrow ?? "",
    blockers: entry?.blockers ?? "",
    energy: entry?.energy ?? "",
    rating: entry?.rating ?? (plan?.outcome ? `Outcome: ${plan.outcome}` : "Daily review"),
    freeWriting: entry?.freeWriting ?? "",
    wins: entry?.wins?.length ? entry.wins : [""],
    losses: entry?.losses?.length ? entry.losses : [""],
    attachments: normalizeJournalAttachments(entry?.attachments),
    dayAtAGlance: entry?.dayAtAGlance ?? {},
    notebookStatus: entry?.notebookStatus ?? "draft",
  };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
