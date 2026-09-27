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

type Readiness = "ready" | "experimental" | "planned";

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
  experimental: { label: "Experimental", tone: "orange", blurb: "Talks to an app on this computer. Confirm it works for you before relying on it." },
  planned: { label: "Planned", tone: "neutral", blurb: "Designed, not built. Each will be opt-in with clear privacy rules." },
};

export function IntegrationsPage() {
  const state = useStore();
  const [calendarOpen, setCalendarOpen] = useState(false);

  const cards: IntegrationCard[] = [
    {
      id: "anki-export", name: "Anki — card export", icon: Layers, readiness: "ready",
      what: "Turn lecture text into cards in Anki Lab, then export CSV/TSV that Anki imports directly.",
      leaves: "Nothing — you download a file and import it into Anki yourself.",
      action: { label: "Open Anki Lab", href: "#anki" },
    },
    {
      id: "calendar", name: "Calendar file (.ics)", icon: CalendarDays, readiness: "ready",
      what: "Put task due dates, exam days, and daily intentions on Google, Apple, or Outlook Calendar.",
      leaves: "Nothing — AXOM builds a calendar file you import. No calendar account is connected.",
      action: { label: calendarOpen ? "Hide options" : "Create calendar file", onClick: () => setCalendarOpen((open) => !open) },
    },
    {
      id: "backup", name: "Portable backup (JSON)", icon: FileJson, readiness: "ready",
      what: "A complete copy of your workspace you can keep anywhere and restore or merge later.",
      leaves: "Nothing — it downloads to your computer.",
      action: { label: "Open backups", onClick: () => useUi.getState().requestSettings("backup") },
    },
    {
      id: "account", name: "AXOM account", icon: Cloud, readiness: "experimental",
      what: "Optional sign-in that keeps versioned cloud copies and moves your workspace between devices.",
      leaves: "Your workspace data, only after you choose “Protect this workspace”.",
      action: { label: "Account settings", onClick: () => useUi.getState().requestSettings("account") },
    },
    {
      id: "ankiconnect", name: "Anki — live stats (AnkiConnect)", icon: Plug, readiness: "experimental",
      what: "Reads today’s review count from the Anki app on this computer and logs it to Productivity.",
      leaves: "Nothing — AXOM talks to Anki on 127.0.0.1 only. Setup below.",
      action: { label: "Set up below", onClick: () => document.getElementById("ankiconnect-setup")?.scrollIntoView({ behavior: "smooth", block: "start" }) },
    },
    { id: "gcal", name: "Google Calendar sync", icon: CalendarDays, readiness: "planned", what: "Read-only overlay of study blocks and class schedules; export first, write-back only with consent.", leaves: "Read-only calendar data you approve." },
    { id: "drive", name: "Google Drive folders", icon: HardDrive, readiness: "planned", what: "Link course folders and lecture files to Course Tracker items and resources.", leaves: "Links only — no drive scanning without opt-in." },
    { id: "noji", name: "Noji & other SRS apps", icon: Sparkles, readiness: "planned", what: "Export cards in formats Noji, RemNote, and Quizlet can import.", leaves: "Nothing — export files only." },
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
            <h2>AXOM brings things in — it never quietly sends your data out</h2>
            <p>Your workspace lives on this device. Integrations are either files you download and import yourself, a bridge to an app on this computer, or (later) an opt-in connection you can revoke.</p>
          </div>
        </div>
        <ol className="integrations-steps">
          <li><b>1 · Works today</b><span>Export files (Anki, calendar, backup). No setup.</span></li>
          <li><b>2 · On this computer</b><span>Optional local bridges like AnkiConnect.</span></li>
          <li><b>3 · Coming later</b><span>Account-based connections with explicit consent.</span></li>
        </ol>
      </GlassCard>

      {(["ready", "experimental", "planned"] as Readiness[]).map((readiness) => (
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
                    <Tag tone={READINESS[readiness].tone}>{readiness === "ready" ? <CheckCircle2 size={ICON_SIZE.microInline} /> : readiness === "planned" ? <Lock size={ICON_SIZE.microInline} /> : null} {READINESS[readiness].label}</Tag>
                  </div>
                  <p>{card.what}</p>
                  <small><b>What leaves your device:</b> {card.leaves}</small>
                  {card.action && (
                    card.action.href
                      ? <a className="gbtn sm integration-action" href={card.action.href}>{card.action.label} <ArrowRight size={ICON_SIZE.body} /></a>
                      : <GButton size="sm" className="integration-action" onClick={card.action.onClick}>{card.action.label} <ArrowRight size={ICON_SIZE.body} /></GButton>
                  )}
                  {card.id === "calendar" && calendarOpen && <CalendarExportPanel state={state} />}
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

function CalendarExportPanel({ state }: { state: ReturnType<typeof useStore.getState> }) {
  const [tasks, setTasks] = useState(true);
  const [exams, setExams] = useState(true);
  const [dayPlans, setDayPlans] = useState(false);
  const events = calendarEvents(state, { tasks, exams, dayPlans, fromDay: state.activeDayKey });
  return (
    <div className="calendar-export">
      <label><input type="checkbox" checked={tasks} onChange={(event) => setTasks(event.target.checked)} /> Open tasks with due dates</label>
      <label><input type="checkbox" checked={exams} onChange={(event) => setExams(event.target.checked)} /> Exam dates (Boards)</label>
      <label><input type="checkbox" checked={dayPlans} onChange={(event) => setDayPlans(event.target.checked)} /> Upcoming daily intentions</label>
      <div className="calendar-export-foot">
        <span>{events.length} event{events.length === 1 ? "" : "s"} from today onward · all-day · no notes or journal text</span>
        <GButton size="sm" variant="primary" disabled={!events.length} onClick={() => downloadIcs(buildIcs(events))}>
          <Download size={ICON_SIZE.body} /> Download .ics
        </GButton>
      </div>
      <p>Import it in Google Calendar (Settings → Import), Apple Calendar (File → Import), or Outlook. Re-export any time; events keep stable IDs so re-importing updates instead of duplicating in most apps.</p>
    </div>
  );
}
