import { useEffect, useState } from "react";
import {
  Brain, CheckCircle2, ExternalLink, LineChart, Loader, ShieldCheck, Sparkles, CircleDashed,
} from "lucide-react";
import { GlassCard, PanelHeader, Tag } from "../components/ui/primitives";
import { AxomMark, AxomWordmark } from "../components/ui/BrandMark";
import { ICON_SIZE } from "../lib/iconSize";
import { InstallAxomCard } from "../components/shell/InstallAxomCard";

const WEBSITE_URL = "https://www.jafardabbagh.com/";

type FeatureStatus = "ready" | "progress" | "planned";

interface Feature { name: string; detail: string }

const READY: Feature[] = [
  { name: "Appearance studio", detail: "Light, dark, or system, plus eight accent palettes (gold & graphite, gold & white, purple & black, blue & silver, navy & gold, emerald, rosé, platinum) or any custom color with automatic contrast tuning, and an AXOM-level reduce-motion switch." },
  { name: "Lock-in check-ins", detail: "Optional “Are you locked in?” pop-ups at your chosen interval, with replies that know how much is left in your sprint and your daily targets." },
  { name: "Top-bar quotes", detail: "180 quotes (90 AXOM Originals) next to the clock on every page, rotating daily, every few hours, or per section — with favorites, hiding, and category filters." },
  { name: "Question Bank", detail: "Review-first PDF, text, Markdown, CSV, and JSON import with unresolved-answer safety, source provenance, practice blocks, and results." },
  { name: "Dashboard", detail: "A focused daily surface with a one-line Up next suggestion, customizable widgets with their own icons, and a subtle pointer luster." },
  { name: "Productivity & Reports", detail: "Fast activity logging, optional targets (habits can count too), focus timer, and weekly/monthly trends that follow real calendar days — with plain-language explanations on demand." },
  { name: "Course Tracker", detail: "Course/module structure with a breadcrumb and subsection picker, collapsible sections, imports, pass and yield tracking, and next-move suggestions." },
  { name: "Leaderboards", detail: "Race your past self: this week vs your typical and best weeks, with what it takes to set a new record. No invented competitors." },
  { name: "Journal", detail: "Daily standups, missed-standup detection + remediation, and locked previous-intention reflection." },
  { name: "Local data & recovery", detail: "Device-local workspace, exact last-saved time, automatic snapshots, portable backups, and a restore history of every restore, merge, and reset." },
  { name: "Integrations that work today", detail: "Anki card export, calendar (.ics) export of tasks/exams/intentions, and portable JSON backups — no accounts required." },
  { name: "AXOM Daily Word", detail: "Optional local-first five-letter puzzle with a versioned SCOWL-derived dictionary, persisted history, private result sharing, and offline reopening after one successful online load." },
];

const IN_PROGRESS: Feature[] = [
  { name: "Accounts & cloud protection", detail: "Sign-in (password or one-time email code), background protection on every page, versioned restore, conflict resolution, device list, and cloud deletion are built. Activation needs the deployment’s account service configured and a live two-account security test." },
  { name: "Application Checker", detail: "292 US medical schools with sourced, dated requirement captures you can review and save. Residency programs and undergraduate/pre-med datasets are not gathered yet." },
  { name: "USMLE / MCAT / Pre-Med blueprints", detail: "Being deepened: macro vs. detailed depth, better-anchored content categories, and a dedicated tracker container per exam lane." },
  { name: "Anki integration", detail: "AnkiConnect bridge with card-count sync. Works on the local build; a hosted HTTPS page can't reach local Anki — that's a browser limit, not a bug." },
  { name: "Anki Lab", detail: "Turning lectures, DLAs, and slides into Anki cards. Functional; output quality and note-type templates are being improved." },
  { name: "Habit Tracker", detail: "Recovery-friendly habits (Labs) now linked to daily targets." },
];

const PLANNED: Feature[] = [
  { name: "Study groups with friends", detail: "Private, opt-in groups comparing weekly pace — requires accounts, invites, consent per measure, and the ability to leave and delete shared numbers." },
  { name: "Residency program research", detail: "A separate, sourced residency dataset for the Application Checker once reliable program data is collected." },
  { name: "Casper & DAT lanes", detail: "Separate pre-health lanes alongside MCAT and Pre-Med, each with their own outline." },
  { name: "Connected calendars & drives", detail: "Read-only Google Calendar overlays and Drive folder links, opt-in and revocable." },
  { name: "Attachment sync", detail: "Question images are device-only today; syncing them needs its own storage and quota design." },
  { name: "Performance intelligence", detail: "Sharper, day-aware recommendations as enough real days accumulate." },
];

const STATUS_META: Record<FeatureStatus, { label: string; sub: string; icon: typeof CheckCircle2; tone: "green" | "cyan" | "neutral" }> = {
  ready: { label: "Ready to use", sub: "Works as intended today", icon: CheckCircle2, tone: "green" },
  progress: { label: "Being worked on", sub: "Usable, actively improving", icon: Loader, tone: "cyan" },
  planned: { label: "Planned", sub: "Designed, not built yet", icon: CircleDashed, tone: "neutral" },
};

export function AboutPage() {
  return (
    <>
      <GlassCard pad className="about-hero-card">
        <div className="about-hero">
          <div>
            <Tag tone="cyan"><Sparkles size={ICON_SIZE.microInline} /> Pre-Beta</Tag>
            <h2 className="row" style={{ gap: 12 }}><AxomMark size={26} /> <AxomWordmark /></h2>
            <p>
              A local-first academic workspace for question practice, course tracking, study logs, planning,
              reflection, and review. Your workspace stays on this device, with recovery saves and a portable
              backup file you can export when you choose.
            </p>
            <p className="sub">
              Pre-beta honesty: account protection is built but stays off until this deployment configures and verifies its account service. Supported PDFs use local text
              extraction; image-only OCR is not promised. Optional provider tools require explicit setup, and
              local AnkiConnect access still depends on your browser and desktop Anki configuration.
            </p>
          </div>
          <div className="about-principles">
            <span><ShieldCheck size={ICON_SIZE.body} /> Local-first</span>
            <span><Brain size={ICON_SIZE.body} /> Blueprint-driven</span>
            <span><LineChart size={ICON_SIZE.body} /> Evidence-based</span>
          </div>
        </div>
      </GlassCard>

      <GlassCard pad>
        <PanelHeader title="Where each feature stands"
          sub="Honest status — features move from Planned → Being worked on → Ready as they earn real data and polish." />
        <div className="about-status-board">
          <StatusColumn status="ready" features={READY} />
          <StatusColumn status="progress" features={IN_PROGRESS} />
          <StatusColumn status="planned" features={PLANNED} />
        </div>
      </GlassCard>

      <InstallAxomCard />

      <LiveSiteDisclosure />
    </>
  );
}

function StatusColumn({ status, features }: { status: FeatureStatus; features: Feature[] }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <section className={`about-status-col status-${status}`}>
      <div className="about-status-head">
        <span className="about-status-mark"><Icon size={ICON_SIZE.emphasis} /></span>
        <div>
          <b>{meta.label}</b>
          <small>{meta.sub}</small>
        </div>
        <Tag tone={meta.tone}>{features.length}</Tag>
      </div>
      <div className="about-status-items">
        {features.map((feature) => (
          <div className="about-feature" key={feature.name}>
            <span className="about-feature-dot" />
            <div>
              <b>{feature.name}</b>
              <span>{feature.detail}</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LiveSiteDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <details className="website-preview-disclosure" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Developer website</summary>
      {open && <WebsitePreview />}
    </details>
  );
}

function WebsitePreview() {
  const [refreshKey, setRefreshKey] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshKey((key) => key + 1), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <GlassCard pad className="website-preview-card">
      <PanelHeader title="Live site" sub="Preview refreshes every 30 minutes"
        action={<a className="gbtn sm" href={WEBSITE_URL} target="_blank" rel="noreferrer noopener">
          Open site <ExternalLink size={ICON_SIZE.body} />
        </a>} />
      <div className="website-frame-shell">
        <iframe key={refreshKey} title="Live site preview" src={WEBSITE_URL} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
      </div>
      <div className="sub" style={{ marginTop: 8 }}>If the browser blocks embedding, use Open site; the refresh timer still keeps the iframe attempt current.</div>
    </GlassCard>
  );
}
