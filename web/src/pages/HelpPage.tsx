import { useState } from "react";
import {
  PlayCircle, Sparkles, FileText, ExternalLink, Mail,
  Timer, LineChart, BadgeCheck, Brain, Database, Layers,
  Eye, AlertTriangle, ArrowRight, MessageCircle, Palette, Lock, Quote, Cloud, CalendarDays, Target, Trophy, FolderTree,
  Lightbulb, type LucideIcon,
} from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, PanelHeader } from "../components/ui/primitives";
import { Modal } from "../components/ui/Modal";
import { clearTourProgress } from "../lib/onboardingProgress";
import { DAILY_WORD_PUBLIC_METADATA } from "../data/dailyWordMetadata";
import { buildFeedbackMailto, type FeedbackKind } from "../lib/feedback";
import { SCHEMA_VERSION } from "../lib/seed";
import { ICON_SIZE } from "../lib/iconSize";
import { COACH_RESET_EVENT, readCoachLedger, resetPageHints, writeCoachLedger } from "../lib/coach";
import { pushToast } from "../lib/toast";

const FEEDBACK_EMAIL = "jafardabbagh@gmail.com";

const ANKI_STEPS = [
  { img: "open-anki.png", title: "Open Anki", body: "Start from your main Anki deck screen." },
  { img: "manage-note-types.png", title: "Manage note types", body: "Go to Tools → Manage Note Types." },
  { img: "add-note-types.png", title: "Add or clone the note type", body: "Use Basic for Q&A cards, Cloze for cloze cards, or clone an existing JD card type." },
  { img: "fields.png", title: "Check fields", body: "Make sure fields match the CSV export: Front, Back, Tags, Source, and any optional image fields." },
  { img: "card-editor.png", title: "Paste templates / style", body: "Open Cards to paste or edit the front, back, and styling templates." },
  { img: "jd-anki-builds.png", title: "Find JD Anki Builds", body: "Use the JD Anki Builds folder for the card-style system and reference files." },
  { img: "importing.png", title: "Import CSV", body: "Go to File → Import, select your AXOM CSV, then map fields carefully." },
  { img: null, title: "Review before studying", body: "Open the Browser and inspect a few cards before adding them to daily reviews." },
];

const ANKI_SETTINGS = [
  ["New cards/day", "9999"], ["Maximum reviews/day", "9999"], ["Learning steps", "1m 10m 2d"],
  ["Graduating interval", "2 days"], ["Easy interval", "4 days"], ["Lapses relearning step", "3m"],
  ["Minimum interval", "1 day"], ["Leech threshold", "4 lapses"], ["Leech action", "Tag Only"],
  ["Answer timer max", "30s (shown, stops on answer)"], ["FSRS", "Off"], ["Maximum interval", "36500"],
  ["Starting ease", "2.00"], ["Easy bonus", "1.30"], ["Interval modifier", "1.00"],
  ["Hard interval", "1.20"], ["New interval", "0.30"],
];

const ADDONS = [
  { name: "Advanced Browser", id: "874215009", note: "Extra columns + search power in the card browser." },
  { name: "Anki Leaderboard", id: "175794613", note: "Friendly review streak competition — username JD7." },
  { name: "Anki Remote – Customize", id: "693153301", note: "Map a remote/controller to review answers." },
  { name: "Ankimon", id: "1908235722", note: "Light gamified motivation layer for reviews." },
  { name: "Review Heatmap", id: "1771074083", note: "A calendar heatmap of your review history." },
  { name: "Anki Terminator V2 (AI sidebar)", id: "1468920185", note: "ChatGPT / DeepSeek sidebar inside Anki." },
];

type GuideStatus = "Ready to test" | "In progress" | "Planned" | "Requires setup" | "Hidden until enabled" | "Not working yet";
interface GuideEntry {
  icon: LucideIcon;
  name: string;
  status: GuideStatus;
  lives: string;
  start: string;
  prerequisite: string;
  route: string;
  preview: string;
}

const FEATURE_GUIDES: GuideEntry[] = [
  {
    icon: Palette,
    name: "Appearance & accent palettes",
    status: "Ready to test",
    lives: "Settings → Appearance (or the sun/moon button next to your name)",
    start: "Pick Light, Dark, or System, then an accent palette — Gold & graphite, Gold & white, Purple & black, Blue & silver, Navy & gold, Emerald, Rosé, Platinum — or any custom color.",
    prerequisite: "None. Appearance is saved per device, so your laptop and phone can differ.",
    route: "dashboard",
    preview: "Every palette has a tuned light and dark version and keeps text contrast readable. Reduce motion calms lusters and transitions even if your device allows motion.",
  },
  {
    icon: Lock,
    name: "“Are you locked in?” check-ins",
    status: "Ready to test",
    lives: "Settings → Personalization → Daily rhythm",
    start: "Turn on lock-in check-ins, choose an interval (10 min – 2 h), when to ask (during focus sprints or whenever AXOM is open), and a voice. Use “Preview a check-in” to see it.",
    prerequisite: "Optional and off by default. Background notifications need browser permission.",
    route: "productivity",
    preview: "A small pop-up asks if you’re locked in. Answer in one tap; AXOM replies with a nudge or what’s left (“Just 40 min to go on Study time”). Drifted? It offers to restart a focus sprint — no shame.",
  },
  {
    icon: Quote,
    name: "Quotes in the top bar",
    status: "Ready to test",
    lives: "Top bar, next to the clock, on every page",
    start: "Click the quote to see it in full, favorite it, hide it, or skip. The gear sets how often it changes: daily, every 6 h, 2 h, hourly, or every section you open.",
    prerequisite: "None. Guilt/shame quotes stay off unless you choose them.",
    route: "dashboard",
    preview: "180 quotes including 90 AXOM Originals. You can narrow the library to categories like AXOM Originals, Discipline, or Perspective.",
  },
  {
    icon: Cloud,
    name: "Accounts & protection",
    status: "Requires setup",
    lives: "Settings → Account (cloud button next to your name shows status)",
    start: "Sign in with email + password or a one-time email code, then choose “Protect this workspace”. Changes back up in the background on every page.",
    prerequisite: "The deployment must be configured with its account service. Without it AXOM stays fully local and says so.",
    route: "dashboard",
    preview: "Versioned cloud copies, restore any recent version (a safety snapshot is taken first), a conflict screen when two devices diverge, a device list, and one-click deletion of every cloud copy.",
  },
  {
    icon: FolderTree,
    name: "Course Tracker subsections",
    status: "Ready to test",
    lives: "Course Tracker → Items",
    start: "Use the breadcrumb and the Subsection dropdown to narrow a big scope (like Term 4) to one course, week, or module. Sections collapse; “Show only this” focuses one.",
    prerequisite: "Items are grouped by their path (Term/Course/Module).",
    route: "tracker",
    preview: "AXOM remembers where you were, so the tracker reopens on the same subsection next time.",
  },
  {
    icon: Target,
    name: "Habits count toward daily targets",
    status: "Ready to test",
    lives: "Habit Tracker (Labs) ↔ Productivity → Today’s targets",
    start: "New habits count toward Today’s targets by default; use the “In daily targets” chip on any habit to add or remove it.",
    prerequisite: "Enable the Habit Tracker in Settings → Personalization → Program & lanes → Early features.",
    route: "habits",
    preview: "Checking a habit fills its target automatically — the habit is the single source of truth, so the two never disagree.",
  },
  {
    icon: Trophy,
    name: "Leaderboards — race your past self",
    status: "Ready to test",
    lives: "Tools → Leaderboards",
    start: "Pick study days, cards, or study time. The race compares this week with your typical and best weeks at the same point.",
    prerequisite: "A few completed weeks of logged activity make the comparison meaningful.",
    route: "leaderboards",
    preview: "Tells you if you’re ahead, on pace, or behind, and exactly what per-day effort beats your best week. Private study groups are planned and will be opt-in.",
  },
  {
    icon: CalendarDays,
    name: "Calendar export",
    status: "Ready to test",
    lives: "Integrations → Calendar file (.ics)",
    start: "Choose tasks with due dates, exam days, and/or daily intentions, then download the .ics and import it into Google, Apple, or Outlook Calendar.",
    prerequisite: "None — no calendar account is connected.",
    route: "integrations",
    preview: "All-day events with stable IDs; journal text and notes are never included.",
  },
  {
    icon: Sparkles,
    name: "AXOM Daily Word",
    status: "Ready to test",
    lives: "Daily Games → Daily Word",
    start: "Open Daily Games in the sidebar and submit a five-letter word. Unrecognized words can be suggested for a later dictionary review.",
    prerequisite: "On for everyone. Hide it from the sidebar with Customize if you don't play.",
    route: "daily-word",
    preview: `Dictionary ${DAILY_WORD_PUBLIC_METADATA.version}: ${DAILY_WORD_PUBLIC_METADATA.allowedGuessCount.toLocaleString()} local allowed words from ${DAILY_WORD_PUBLIC_METADATA.sourceName} ${DAILY_WORD_PUBLIC_METADATA.sourceRelease}. Play uses no network dictionary call; offline reopening works after one successful online load.`,
  },
  {
    icon: AlertTriangle,
    name: "AnkiConnect sync",
    status: "Not working yet",
    lives: "Integrations → Anki",
    start: "Use the card as a diagnostic only until the local connection is user-confirmed.",
    prerequisite: "Desktop Anki open, AnkiConnect installed, and browser local-network access allowed.",
    route: "integrations",
    preview: "Local HTTP bridge to Anki. Hosted Vercel can still be blocked by browser local-network rules, so the supported path is local AXOM plus local Anki.",
  },
  {
    icon: Timer,
    name: "Pomodoro",
    status: "Ready to test",
    lives: "Productivity and Dashboard widget",
    start: "Select a target, set an intention, start a sprint, and let it log when complete or when reset after at least one minute.",
    prerequisite: "Auto-log must be on if you want minutes written to Productivity.",
    route: "productivity",
    preview: "A persisted focus timer with a progress ring, tracker/blueprint target, intention, partial logging on reset/skip, and refresh recovery.",
  },
  {
    icon: Brain,
    name: "Blueprint install",
    status: "In progress",
    lives: "USMLE / Shelf Prep and Pre-Med / MCAT / DAT",
    start: "Pick a lane, install a blueprint, then open the container from the Course Tracker mastery tree.",
    prerequisite: "Choose the correct pathway lane; source-audited does not mean user-verified.",
    route: "step",
    preview: "Blueprint containers use exam objects, source metadata, linked questions, Anki counts, error logs, assessment counts, notes, due dates, and mastery.",
  },
  {
    icon: BadgeCheck,
    name: "Course Tracker mastery tree",
    status: "Ready to test",
    lives: "Course Tracker",
    start: "Open Term Mastery for schoolwork or Blueprint Mastery for installed exam containers.",
    prerequisite: "Add course/tracker rows or install a blueprint first.",
    route: "tracker",
    preview: "Term items and blueprint objects are separated so lecture/DLA/PQ logic does not flatten boards or MCAT prep.",
  },
  {
    icon: LineChart,
    name: "Pre-Med experience log",
    status: "Ready to test",
    lives: "Pre-Med / MCAT / DAT and Experience Log",
    start: "Log an experience with category, hours, reflection, evidence, verifier, and competency tags.",
    prerequisite: "A useful score needs real entries over time; admissions probability is intentionally not shown.",
    route: "premed-log",
    preview: "Application Evidence Strength scores verification, reflection, competency breadth, sustainment, and progression milestones instead of worshipping raw hours.",
  },
  {
    icon: Database,
    name: "Local backup and exports",
    status: "Ready to test",
    lives: "Settings / Data and Backup plus log pages",
    start: "Use JSON backup for the whole app; use .xlsx exports for Pre-Med and Activity History.",
    prerequisite: "Exports stay local in the browser.",
    route: "activity",
    preview: "Local-first data survives refresh and can be exported without a backend. Account sync remains a future bridge, not a false cloud claim.",
  },
  {
    icon: Sparkles,
    name: "Optional widgets and hidden tools",
    status: "Hidden until enabled",
    lives: "Dashboard Customize and sidebar Customize",
    start: "Use Customize to subscribe only to the surfaces you actually use.",
    prerequisite: "Dashboard is locked; optional widgets/tools can be hidden.",
    route: "dashboard",
    preview: "The app should start quieter, then expand as the user subscribes to more workflows.",
  },
];

export function HelpPage() {
  const s = useStore();
  const [activeGuide, setActiveGuide] = useState<GuideEntry | null>(null);
  return (
    <>
      <GlassCard pad className="help-card">
        <PanelHeader title="Help" sub="A guided tour, a written field guide, the Anki import flow, and a direct line for feedback"
          action={<GButton size="sm" variant="primary" onClick={() => { clearTourProgress(); s.updateProfile({ tourDone: false }); location.hash = "dashboard"; }}>
            <PlayCircle size={ICON_SIZE.body} /> Replay guided tour
          </GButton>} />
        <div className="sub" style={{ marginTop: 2 }}>The optional eight-stop tour can be skipped at any time. Replaying it never changes your data.</div>
        <div className="help-hints-row">
          <span className="sub">Small first-visit hints point at one thing per page, once.</span>
          <GButton size="sm" onClick={showPageHintsAgain}>
            <Lightbulb size={ICON_SIZE.body} /> Show page hints again
          </GButton>
        </div>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="Feature guide" sub="Truthful status, where each tool lives, and how to start without hunting" />
        <div className="sub" style={{ marginBottom: 10 }}>
          Daily Word dictionary: <b>{DAILY_WORD_PUBLIC_METADATA.version}</b> · {DAILY_WORD_PUBLIC_METADATA.sourceName} {DAILY_WORD_PUBLIC_METADATA.sourceRelease} · {DAILY_WORD_PUBLIC_METADATA.allowedGuessCount.toLocaleString()} local allowed words. Uncommon legitimate words may fall outside the current policy; suggestions are reviewed rather than accepted automatically.
        </div>
        <div className="feature-guide-grid">
          {FEATURE_GUIDES.map((guide) => {
            const I = guide.icon;
            return (
              <div className="feature-guide-card" key={guide.name}>
                <div className="feature-guide-top">
                  <span className="guide-tile-icon"><I size={ICON_SIZE.emphasis} /></span>
                  <span className={`feature-status ${statusClass(guide.status)}`}>{guide.status}</span>
                </div>
                <b>{guide.name}</b>
                <span>{guide.preview}</span>
                <div className="feature-guide-meta">
                  <small>{guide.lives}</small>
                  <button type="button" onClick={() => setActiveGuide(guide)}><Eye size={ICON_SIZE.body} /> Preview</button>
                  <a href={`#${guide.route}`}>Open <ArrowRight size={ICON_SIZE.body} /></a>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>

      {activeGuide && (
        <Modal title={activeGuide.name} onClose={() => setActiveGuide(null)}
          footer={<a className="gbtn primary" href={`#${activeGuide.route}`} onClick={() => setActiveGuide(null)}>Open feature <ArrowRight size={ICON_SIZE.body} /></a>}>
          <div className="feature-preview-modal">
            <span className={`feature-status ${statusClass(activeGuide.status)}`}>{activeGuide.status}</span>
            <div><b>Where it lives</b><span>{activeGuide.lives}</span></div>
            <div><b>How to start</b><span>{activeGuide.start}</span></div>
            <div><b>Prerequisite</b><span>{activeGuide.prerequisite}</span></div>
            <div><b>Preview</b><span>{activeGuide.preview}</span></div>
          </div>
        </Modal>
      )}

      <GlassCard pad>
        <PanelHeader title="Community and Feedback" sub="Bug reports, feature requests, and beta discussion without a noisy floating widget"
          action={<a className="gbtn sm primary" href="https://discord.gg/sTNuHa6qR" target="_blank" rel="noreferrer noopener"><MessageCircle size={ICON_SIZE.body} /> AXOM Discord Channel</a>} />
        <div className="sub" style={{ marginTop: 6 }}>
          Use the Discord for quick community feedback. Use the form below for structured bug reports with app version and browser details.
        </div>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="Importing AXOM cards into Anki" sub="Eight steps, from your generated CSV to graded reviews"
          action={<a className="gbtn sm" href="https://drive.google.com/drive/folders/19_3nrTD66v_oCIKlruFVidirdCAIe8yp?usp=sharing" target="_blank" rel="noreferrer noopener"><Layers size={ICON_SIZE.body} /> JD Anki Builds</a>} />
        <details className="help-compact-details">
          <summary>Show Anki import screenshots</summary>
          <div className="anki-guide-steps compact">
            {ANKI_STEPS.map((step, i) => (
              <div className="anki-guide-step" key={step.title}>
                <div className="anki-step-head"><span className="anki-step-n">{i + 1}</span> <b>{step.title}</b></div>
                {step.img && <img className="anki-shot" src={`./anki-guide/${step.img}`} alt={step.title} loading="lazy" />}
                <div className="anki-step-body">{step.body}</div>
              </div>
            ))}
          </div>
        </details>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="Optimized Anki settings (no FSRS)" sub="Based on the included Anki settings PDF — tuned for high-volume med-school review"
          action={<a className="gbtn sm" href="./anki-guide/my-anki-settings.pdf" target="_blank" rel="noreferrer noopener"><FileText size={ICON_SIZE.body} /> Open settings PDF</a>} />
        <div className="settings-grid">
          {ANKI_SETTINGS.map(([k, v]) => (
            <div className="setting-row" key={k}><span>{k}</span><b>{v}</b></div>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 10 }}>These are starting points, not gospel — adjust once you know your own retention. FSRS is intentionally off for this setup.</div>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="Recommended Anki add-ons" sub="Useful, optional — install from Tools → Add-ons → Get Add-ons with the code" />
        <div className="addon-grid">
          {ADDONS.map((a) => (
            <a key={a.id} className="addon-tile" href={`https://ankiweb.net/shared/info/${a.id}`} target="_blank" rel="noreferrer noopener">
              <div className="grow"><b>{a.name}</b><span>{a.note}</span></div>
              <span className="addon-code mono">{a.id}</span>
              <ExternalLink size={ICON_SIZE.body} />
            </a>
          ))}
        </div>
      </GlassCard>

      <FeedbackForm />
    </>
  );
}

function statusClass(status: GuideStatus): string {
  if (status === "Ready to test") return "ready";
  if (status === "Not working yet") return "blocked";
  if (status === "Requires setup") return "setup";
  if (status === "Hidden until enabled") return "hidden";
  if (status === "Planned") return "planned";
  return "progress";
}

export function FeedbackForm() {
  const s = useStore();
  const [type, setType] = useState<FeedbackKind>("Bug");
  const [area, setArea] = useState("Dashboard");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const canDraft = Boolean(message.trim());
  const draftHref = buildFeedbackMailto({
    kind: type,
    message,
    area,
    contact,
    appVersion: s.profile.versionLabel,
    schemaVersion: SCHEMA_VERSION,
    route: typeof location === "undefined" ? "help" : location.hash,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
  });

  return (
    <GlassCard pad className="feedback-card">
      <PanelHeader title="Feedback"
        sub={`Open a local email draft to ${FEEDBACK_EMAIL}. AXOM adds coarse app and device labels, never workspace content.`} />
      <div className="row gap12 wrap">
        <label className="stack gap6">
          <span className="field-label">Type</span>
          <select className="field" aria-label="Feedback type" value={type} onChange={(event) => setType(event.target.value as FeedbackKind)}>
            {(["Suggestion", "Bug", "Urgent"] as const).map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="stack gap6">
          <span className="field-label">Page or feature</span>
          <select className="field" aria-label="Area" value={area} onChange={(event) => setArea(event.target.value)}>
            {["Dashboard", "Question Bank", "Productivity", "Reports", "Course Tracker", "Daily Word", "Tasks", "Journal", "Onboarding / Tour", "Other"].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="stack gap6 grow">
          <span className="field-label">Contact (optional)</span>
          <input className="field" placeholder="Only included if you type it" value={contact} onChange={(event) => setContact(event.target.value)} />
        </label>
      </div>
      <label className="stack gap6" style={{ marginTop: 12 }}>
        <span className="field-label">Message</span>
        <textarea className="field" rows={4} placeholder="What happened, what would help, or what should change?" value={message} onChange={(event) => setMessage(event.target.value)} />
      </label>
      <div className="row gap8 wrap" style={{ marginTop: 12 }}>
        <a
          className={`gbtn primary ${canDraft ? "" : "disabled"}`}
          href={canDraft ? draftHref : undefined}
          aria-disabled={!canDraft}
          onClick={(event) => { if (!canDraft) event.preventDefault(); }}
        ><Mail size={ICON_SIZE.body} /> Open email draft</a>
        <span className="sub">No journal, questions, answers, activity history, goals, workspace ID, or backup data is attached.</span>
      </div>
      <div className="feedback-fallback"><Sparkles size={ICON_SIZE.body} /> AXOM support is not an emergency service.</div>
    </GlassCard>
  );
}

function showPageHintsAgain() {
  writeCoachLedger(resetPageHints(readCoachLedger()));
  window.dispatchEvent(new CustomEvent(COACH_RESET_EVENT));
  pushToast({ title: "Page hints are back on", body: "Each page will point at one thing, once.", tone: "info", dedupe: "coach-hints-reset" });
}
