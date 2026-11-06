import { useState } from "react";
import {
  ArrowRight, CalendarDays, CheckCircle2, Cloud, Download, FileJson, HardDrive, Layers, Link2, Lock, NotebookPen, Plug,
  Puzzle, Smartphone, Sparkles,
} from "lucide-react";
import { useStore } from "../lib/store";
import { GButton, GlassCard, Tag } from "../components/ui/primitives";
import { AnkiConnectPanel } from "../components/integrations/AnkiConnectPanel";
import { ICON_SIZE } from "../lib/iconSize";
import { buildIcs, calendarEvents, downloadIcs } from "../lib/calendarExport";
import { useUi } from "../lib/uiStore";
import { useAccount } from "../lib/account/accountStore";
import "../styles/wip-experience.css";

type Readiness = "ready" | "experimental" | "unavailable" | "planned";

interface IntegrationCard {
  id: string;
  name: string;
  icon: typeof Layers;
  readiness: Readiness;
  what: string;
  leaves: string;
  action?: { label: string; href?: string; onClick?: () => void };
}

const READINESS: Record<Readiness, { label: string; tone: "green" | "orange" | "neutral"; blurb: string }> = {
  ready: { label: "Works today", tone: "green", blurb: "No setup, no account. Files you download stay yours." },
  experimental: { label: "Experimental", tone: "orange", blurb: "Check each connection’s status before relying on it." },
  unavailable: { label: "Unavailable in this build", tone: "neutral", blurb: "These controls need an AXOM account service. Local tools above still work." },
  planned: { label: "Planned", tone: "neutral", blurb: "Designed, not built. Each will be opt-in with clear privacy rules." },
};

export function IntegrationsPage() {
  const accountPhase = useAccount((account) => account.phase);
  const accountsAvailable = accountPhase !== "unconfigured";
  const [calendarOpen, setCalendarOpen] = useState(false);

  const cards: IntegrationCard[] = [
    {
      id: "anki-export", name: "Anki card export", icon: Layers, readiness: "ready",
      what: "Draft cards from lecture text in Anki Lab (quick local drafts, or paste what your own AI chat returns), then export CSV or TSV files that Anki imports.",
      leaves: "Nothing. You download a file and import it into Anki yourself.",
      action: { label: "Open Anki Lab", href: "#anki" },
    },
    {
      id: "calendar", name: "Calendar file (.ics)", icon: CalendarDays, readiness: "ready",
      what: "Put task due dates, exam days, and daily intentions on Google, Apple, or Outlook Calendar.",
      leaves: "Nothing. AXOM builds a calendar file you import; no calendar account is connected.",
      action: { label: calendarOpen ? "Hide options" : "Create calendar file", onClick: () => setCalendarOpen((open) => !open) },
    },
    {
      id: "backup", name: "Portable backup (JSON)", icon: FileJson, readiness: "ready",
      what: "A complete copy of your workspace you can keep anywhere and restore or merge later.",
      leaves: "Nothing. It downloads to your computer.",
      action: { label: "Open backups", onClick: () => useUi.getState().requestSettings("backup") },
    },
    {
      id: "account", name: "AXOM account", icon: Cloud, readiness: accountsAvailable ? "experimental" : "unavailable",
      what: accountsAvailable
        ? "Optional sign-in can keep versioned cloud copies. Check Account settings for your actual protection status."
        : "Sign-in and cloud copies are switched off in this version. Your workspace still saves on this device.",
      leaves: accountsAvailable ? "Your workspace data, only after you choose to protect this workspace." : "Nothing. No account connection is configured.",
      action: accountsAvailable
        ? { label: "Check account status", onClick: () => useUi.getState().requestSettings("account") }
        : { label: "Open recovery options", onClick: () => useUi.getState().requestSettings("backup") },
    },
    {
      id: "ankiconnect", name: "Anki live stats (AnkiConnect)", icon: Plug, readiness: "experimental",
      what: "Reads today’s review count from the Anki app on this computer and logs it to Productivity.",
      leaves: "Nothing leaves this computer: AXOM talks to Anki on 127.0.0.1 only. Setup below.",
      action: { label: "Set up below", onClick: () => document.getElementById("ankiconnect-setup")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
    },
    { id: "gcal", name: "Google Calendar sync", icon: CalendarDays, readiness: "planned", what: "Read-only overlay of study blocks and class schedules; export first, write-back only with consent.", leaves: "Read-only calendar data you approve." },
    { id: "drive", name: "Google Drive folders", icon: HardDrive, readiness: "planned", what: "Link course folders and lecture files to Course Tracker items and resources.", leaves: "Links only. No drive scanning without opt-in." },
    { id: "noji", name: "Noji & other SRS apps", icon: Sparkles, readiness: "planned", what: "Export cards in formats Noji, RemNote, and Quizlet can import.", leaves: "Nothing. Export files only." },
    { id: "notion", name: "Notion", icon: NotebookPen, readiness: "planned", what: "Import reference pages and study dashboards as resources.", leaves: "Import-only by default." },
    { id: "health", name: "Apple Health / Health Connect", icon: Smartphone, readiness: "planned", what: "Optional sleep and movement signals for the readiness score (desktop/mobile app only).", leaves: "Stays on device; explicit opt-in." },
    { id: "extension", name: "Browser extension", icon: Puzzle, readiness: "planned", what: "Send highlighted text to Tasks, Anki Lab, or Resources in one click.", leaves: "Only what you capture." },
  ];

  return (
    <div className="integrations-page">
      <GlassCard pad className="integrations-hero">
        <div className="integrations-hero-head">
          <span className="integrations-hero-icon"><Link2 size={ICON_SIZE.control} aria-hidden="true" /></span>
          <div>
            <span className="integrations-kicker">How integrations work</span>
            <h2>AXOM brings things in. It never quietly sends your data out.</h2>
            <p>Your workspace lives on this device. Integrations are files you download and import yourself, bridges to apps on this computer{accountsAvailable ? ", or an optional account connection you control." : ", or future opt-in connections."}</p>
          </div>
        </div>
        <ol className="integrations-steps">
          <li><b>1 · Works today</b><span>Export files (Anki, calendar, backup). No setup.</span></li>
          <li><b>2 · On this computer</b><span>Optional local bridges like AnkiConnect.</span></li>
          <li><b>3 · Optional account</b><span>{accountsAvailable ? "Check its status before trusting a cloud copy." : "Unavailable here. Portable backups still work."}</span></li>
        </ol>
      </GlassCard>

      {(["ready", "experimental", "unavailable", "planned"] as Readiness[])
        .filter((readiness) => cards.some((card) => card.readiness === readiness))
        .map((readiness) => (
        <section key={readiness} className="integrations-section" aria-labelledby={`integrations-${readiness}`}>
          <div className="integrations-section-head">
            <h3 id={`integrations-${readiness}`}>{READINESS[readiness].label}</h3>
            <span>{READINESS[readiness].blurb}</span>
          </div>
          <div className="integrations-grid">
            {cards.filter((card) => card.readiness === readiness).map((card) => {
              const Icon = card.icon;
              return (
                <GlassCard pad key={card.id} className={`integration-card ${readiness}`}>
                  <div className="integration-card-head">
                    <span className="integration-card-icon"><Icon size={ICON_SIZE.emphasis} aria-hidden="true" /></span>
                    <b>{card.name}</b>
                    <Tag tone={READINESS[readiness].tone}>{readiness === "ready" ? <CheckCircle2 size={ICON_SIZE.microInline} /> : readiness === "planned" || readiness === "unavailable" ? <Lock size={ICON_SIZE.microInline} /> : null} {READINESS[readiness].label}</Tag>
                  </div>
                  <p>{card.what}</p>
                  <small><b>What leaves your device:</b> {card.leaves}</small>
                  {card.action && (
                    card.action.href
                      ? <a className="gbtn sm integration-action" href={card.action.href}>{card.action.label} <ArrowRight size={ICON_SIZE.body} /></a>
                      : <GButton size="sm" className="integration-action" onClick={card.action.onClick}>{card.action.label} <ArrowRight size={ICON_SIZE.body} /></GButton>
                  )}
                  {card.id === "calendar" && calendarOpen && <CalendarExportPanel />}
                </GlassCard>
              );
            })}
          </div>
        </section>
        ))}

      <div id="ankiconnect-setup" className="integrations-anki">
        <AnkiConnectPanel />
      </div>
    </div>
  );
}

function CalendarExportPanel() {
  // Subscribe where the live calendar state and error UI are actually rendered.
  // The outer integrations catalog need not own the workspace subscription.
  const state = useStore();
  const [tasks, setTasks] = useState(true);
  const [exams, setExams] = useState(true);
  const [dayPlans, setDayPlans] = useState(false);
  // An error applies to the exact source revision that produced it. Derive its
  // visibility from the canonical store on each render instead of relying on a
  // passive effect to clear it before paint (or before an immediate retry).
  const [exportError, setExportError] = useState<{
    message: string;
    sources: Pick<ReturnType<typeof useStore.getState>,
      "tasks" | "boardPrep" | "dayPlans" | "activeDayKey">;
  } | null>(null);
  const currentSources = useStore.getState();
  const errorMessage = exportError
    && exportError.sources.tasks === currentSources.tasks
    && exportError.sources.boardPrep === currentSources.boardPrep
    && exportError.sources.dayPlans === currentSources.dayPlans
    && exportError.sources.activeDayKey === currentSources.activeDayKey
    ? exportError.message : null;
  const reportError = (message: string) => {
    const { tasks, boardPrep, dayPlans, activeDayKey } = useStore.getState();
    setExportError({ message, sources: { tasks, boardPrep, dayPlans, activeDayKey } });
  };
  // The existing subscribed store snapshot drives source-validity rendering.
  // Avoid a competing error-specific effect that updates React state while
  // Zustand dispatches its own source notifications.
  const events = calendarEvents(state, { tasks, exams, dayPlans, fromDay: state.activeDayKey });
  const downloadSelected = () => {
    let content: string;
    try {
      // Use the current canonical workspace at click time. An edit to a task
      // outside this panel must not export the stale render-time snapshot.
      const latest = useStore.getState();
      const selected = calendarEvents(latest, { tasks, exams, dayPlans, fromDay: latest.activeDayKey });
      if (!selected.length) {
        reportError("The selected calendar items changed. Review the choices above and try again.");
        return;
      }
      content = buildIcs(selected);
    } catch {
      reportError("A calendar item has an invalid date or identifier. Correct it in AXOM and try again.");
      return;
    }
    try {
      downloadIcs(content);
      setExportError(null);
    } catch {
      reportError("The calendar file could not be downloaded. Check your browser settings and retry.");
    }
  };
  return (
    <div className="calendar-export">
      <label><input type="checkbox" checked={tasks} onChange={(event) => { setTasks(event.target.checked); setExportError(null); }} /> Open tasks with due dates</label>
      <label><input type="checkbox" checked={exams} onChange={(event) => { setExams(event.target.checked); setExportError(null); }} /> Exam dates (Boards)</label>
      <label><input type="checkbox" checked={dayPlans} onChange={(event) => { setDayPlans(event.target.checked); setExportError(null); }} /> Upcoming daily intentions</label>
      <div className="calendar-export-foot">
        <span>{events.length} event{events.length === 1 ? "" : "s"} from today onward · all-day · no notes or journal text</span>
        <GButton size="sm" variant="primary" disabled={!events.length} onClick={downloadSelected}>
          <Download size={ICON_SIZE.body} /> Download .ics
        </GButton>
      </div>
      {errorMessage && <p className="calendar-export-next" role="alert">{errorMessage}</p>}
      {!events.length && <p className="calendar-export-next">Nothing dated is ready to export. <a href="#productivity">Add a task with a due date</a> or choose another source above.</p>}
      <p>Import it in Google Calendar (Settings → Import), Apple Calendar (File → Import), or Outlook. This is a file export, not live sync. On re-import, your calendar app may skip, update, or duplicate events; check the target calendar first.</p>
    </div>
  );
}
