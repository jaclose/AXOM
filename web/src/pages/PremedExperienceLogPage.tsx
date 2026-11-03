import { useMemo, useState } from "react";
import { Download, ShieldCheck, Stethoscope, Users, FlaskConical, Eye, Trophy } from "lucide-react";
import { useStore } from "../lib/store";
import { GlassCard, GButton, PanelHeader, Tag, EmptyState } from "../components/ui/primitives";
import { exportPremedExperienceWorkbook } from "../lib/premedExport";
import { premedEvidenceStrength } from "../lib/premedScoring";
import type { PremedExperienceEntry, PremedExperienceKind } from "../lib/types";
import { ICON_SIZE } from "../lib/iconSize";
import { externalLinkHref } from "../lib/resourceUtils";

const TABS: Array<"Overview" | PremedExperienceKind> = ["Overview", "Clinical", "Service", "Research", "Shadowing", "Leadership"];
const ICONS: Record<PremedExperienceKind, JSX.Element> = {
  Clinical: <Stethoscope size={ICON_SIZE.emphasis} />,
  Service: <Users size={ICON_SIZE.emphasis} />,
  Research: <FlaskConical size={ICON_SIZE.emphasis} />,
  Shadowing: <Eye size={ICON_SIZE.emphasis} />,
  Leadership: <Trophy size={ICON_SIZE.emphasis} />,
};

export function PremedExperienceLogPage() {
  const entries = useStore((s) => s.premedExperiences ?? []);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const shown = tab === "Overview" ? entries : entries.filter((entry) => entry.kind === tab);
  const summary = useMemo(() => summarize(entries), [entries]);
  const strength = useMemo(() => premedEvidenceStrength(entries), [entries]);

  return (
    <div className="stack gap16">
      <GlassCard pad>
        <PanelHeader title="Pre-Med Experience Log" sub="Clinical, service, research, shadowing, leadership, verification, reflections, and evidence"
          action={<GButton size="sm" variant="primary" onClick={() => exportPremedExperienceWorkbook(entries)} disabled={!entries.length}><Download size={ICON_SIZE.body} /> Export .xlsx</GButton>} />
        <div className="filter-bar" style={{ marginTop: 12 }}>
          {TABS.map((item) => (
            <button key={item} type="button" className={`filter-pill ${tab === item ? "on" : ""}`} onClick={() => setTab(item)}>{item}</button>
          ))}
        </div>
      </GlassCard>

      {tab === "Overview" && (
        <>
          <GlassCard pad className="premed-evidence-overview">
            <PanelHeader title="Application Evidence Strength"
              sub="Transparent local score from verification, evidence, reflection, competency breadth, sustainment, and progression"
              action={<Tag tone={strength.score >= 58 ? "green" : strength.score >= 30 ? "orange" : "neutral"}>{strength.rank}</Tag>} />
            <div className="premed-evidence-score">
              <b>{strength.score}</b>
              <span>/100</span>
              <div className="track"><i style={{ width: `${strength.score}%` }} /></div>
            </div>
            <div className="premed-evidence-grid">
              {strength.rationale.map((item) => <span key={item}>{item}</span>)}
            </div>
            {!!strength.nextActions.length && (
              <div className="premed-action-list">
                {strength.nextActions.map((action) => <span key={action}>{action}</span>)}
              </div>
            )}
          </GlassCard>
          <div className="grid grid-stats">
            {summary.map((item) => {
              const kindScore = strength.kindScores.find((score) => score.kind === item.kind);
              return (
                <GlassCard pad className="premed-log-stat" key={item.kind}>
                  <div className="stat-icon">{ICONS[item.kind]}</div>
                  <div className="stat-value">{item.hours.toFixed(item.hours % 1 ? 1 : 0)}h</div>
                  <div className="stat-label">{item.kind}</div>
                  <div className="stat-note">{item.verified.toFixed(item.verified % 1 ? 1 : 0)}h verified · {item.entries} entries</div>
                  {!!kindScore?.milestones.length && <div className="stat-note">Milestones: {kindScore.milestones.slice(0, 2).join(", ")}</div>}
                </GlassCard>
              );
            })}
          </div>
        </>
      )}

      <GlassCard pad>
        <PanelHeader title={tab === "Overview" ? "All entries" : `${tab} entries`}
          sub={tab === "Overview" ? "Newest first across every experience category" : "Newest first within this category"}
          action={<Tag tone={shown.length ? "cyan" : "neutral"}>{shown.length} record{shown.length === 1 ? "" : "s"}</Tag>} />
        {!shown.length ? (
          <EmptyState title="No experiences logged yet" hint="Use Pre-Med / MCAT / DAT to add experiences, then return here for the full ledger." />
        ) : (
          <div className="premed-log-table">
            <div className="premed-log-head">
              <span>Date</span><span>Category</span><span>Hours</span><span>Activity</span><span>Evidence</span>
            </div>
            {shown.slice().sort(compareEntries).map((entry) => <ExperienceRow key={entry.id} entry={entry} />)}
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function ExperienceRow({ entry }: { entry: PremedExperienceEntry }) {
  const evidenceHref = externalLinkHref(entry.evidenceLink);
  return (
    <div className="premed-log-row">
      <span className="mono">{entry.date}</span>
      <Tag tone={entry.verified ? "green" : "neutral"}>{entry.kind}</Tag>
      <span>{entry.hours}h</span>
      <span className="premed-log-main">
        <b>{entry.title}</b>
        <small>{entry.organization}{entry.contact ? ` · ${entry.contact}` : ""}</small>
        {entry.reflection && <em>{entry.reflection}</em>}
        {!!entry.competencyTags?.length && <small>{entry.competencyTags.map((tag) => `#${tag}`).join(" ")}</small>}
      </span>
      <span className="premed-log-evidence">
        {entry.verified && <Tag tone="green"><ShieldCheck size={ICON_SIZE.microInline} /> Verified</Tag>}
        {evidenceHref && <a className="gbtn tiny" href={evidenceHref} target="_blank" rel="noreferrer noopener">Evidence</a>}
        {entry.notes && <small>{entry.notes}</small>}
      </span>
    </div>
  );
}

function summarize(entries: PremedExperienceEntry[]) {
  return (TABS.filter((item): item is PremedExperienceKind => item !== "Overview")).map((kind) => {
    const subset = entries.filter((entry) => entry.kind === kind);
    return {
      kind,
      entries: subset.length,
      hours: subset.reduce((sum, entry) => sum + entry.hours, 0),
      verified: subset.filter((entry) => entry.verified).reduce((sum, entry) => sum + entry.hours, 0),
    };
  });
}

function compareEntries(a: PremedExperienceEntry, b: PremedExperienceEntry) {
  return b.date.localeCompare(a.date) || b.created.localeCompare(a.created);
}
