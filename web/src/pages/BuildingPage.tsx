import { useMemo, useState, type CSSProperties } from "react";
import { ArrowRight, Blocks, FlaskConical, Network, Route } from "lucide-react";
import { GlassCard, Tag } from "../components/ui/primitives";
import { SYSTEM_PREVIEWS, type BuildStatus, type SystemPreview } from "../lib/buildingSystems";
import { ICON_SIZE } from "../lib/iconSize";
import "../styles/ecosystem.css";

const STATUS: Record<BuildStatus, string> = { foundation: "FOUNDATION", "in-development": "IN DEVELOPMENT", planned: "PLANNED", research: "RESEARCH" };
const STATUS_ORDER: BuildStatus[] = ["foundation", "in-development", "planned", "research"];

type Horizon = "now" | "next" | "later";
const HORIZONS: Array<{ id: Horizon; title: string; icon: typeof Route; statuses: BuildStatus[]; body: string }> = [
  { id: "now", title: "Now", icon: Route, statuses: ["foundation"], body: "Local-first tracking, Question Bank, Tutor tools, reports, routines, and recovery-oriented backups form the working foundation." },
  { id: "next", title: "Next", icon: Network, statuses: ["in-development", "planned"], body: "Accounts and sync, stable learner preferences, then transparent recommendations connect today’s tools without risking existing data." },
  { id: "later", title: "Later", icon: FlaskConical, statuses: ["research"], body: "Knowledge and simulation concepts stay in research until their evidence, safety, and provenance boundaries are credible." },
];

export function BuildingPage() {
  const [view, setView] = useState<"overview" | "systems">("overview");
  const [filter, setFilter] = useState<BuildStatus | "all">("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((status) => [status, SYSTEM_PREVIEWS.filter((item) => item.status === status).length])) as Record<BuildStatus, number>, []);
  const visible = filter === "all" ? SYSTEM_PREVIEWS : SYSTEM_PREVIEWS.filter((item) => item.status === filter);
  const groups = useMemo(() => Object.entries(visible.reduce<Record<string, SystemPreview[]>>((all, item) => {
    (all[item.area] ??= []).push(item);
    return all;
  }, {})), [visible]);
  const hoveredItem = SYSTEM_PREVIEWS.find((item) => item.id === hovered);
  const related = new Set(hoveredItem ? [hoveredItem.name, ...hoveredItem.connectsTo] : []);

  function openHorizon(horizon: (typeof HORIZONS)[number]) {
    setFilter(horizon.statuses.length === 1 ? horizon.statuses[0] : "all");
    setView("systems");
  }

  return (
    <main className="ecosystem-page building-page" aria-labelledby="building-title">
      <header className="ecosystem-hero">
        <Tag tone="cyan"><Blocks size={ICON_SIZE.body} /> Transparent roadmap</Tag>
        <h1 id="building-title">Building AXOM</h1>
        <p>A preview of how today’s working study tools could become a connected medical-learning system. These cards describe direction, not shipped capability.</p>
      </header>
      <div className="ecosystem-tabs" role="tablist" aria-label="Building views">
        <button role="tab" aria-selected={view === "overview"} onClick={() => setView("overview")}>Overview</button>
        <button role="tab" aria-selected={view === "systems"} onClick={() => setView("systems")}>Systems <span className="building-count" aria-hidden="true">{SYSTEM_PREVIEWS.length}</span></button>
      </div>

      <div className="building-panel" key={view}>
        {view === "overview" ? (
          <section className="building-overview">
            {HORIZONS.map((horizon, index) => {
              const Icon = horizon.icon;
              const items = SYSTEM_PREVIEWS.filter((item) => horizon.statuses.includes(item.status));
              return (
                <GlassCard pad key={horizon.id} className={`building-horizon horizon-${horizon.id}`} style={{ "--stagger": index } as CSSProperties}>
                  <Icon size={ICON_SIZE.display} aria-hidden="true" />
                  <h2>{horizon.title}</h2>
                  <p>{horizon.body}</p>
                  <ul className="building-horizon-list">
                    {items.map((item) => <li key={item.id}>{item.name}</li>)}
                  </ul>
                  <button type="button" className="building-horizon-link" onClick={() => openHorizon(horizon)}>
                    See {items.length} system{items.length === 1 ? "" : "s"} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
                  </button>
                </GlassCard>
              );
            })}
          </section>
        ) : (
          <section className="system-groups">
            <div className="building-filters" role="group" aria-label="Filter systems by status">
              <button type="button" className={`filter-pill ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All <small>{SYSTEM_PREVIEWS.length}</small></button>
              {STATUS_ORDER.map((status) => (
                <button key={status} type="button" className={`filter-pill ${filter === status ? "on" : ""}`} aria-pressed={filter === status} onClick={() => setFilter(status)}>
                  {STATUS[status].toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} <small>{counts[status]}</small>
                </button>
              ))}
            </div>
            <p className="building-hint">Hover or focus a system to light up what it connects to.</p>
            {groups.map(([area, items], groupIndex) => (
              <div key={area} className="system-area">
                <h2>{area}</h2>
                <div className="system-grid">
                  {items.map((item, index) => {
                    const state = !hoveredItem ? "" : item.id === hoveredItem.id ? "is-focus" : related.has(item.name) || item.connectsTo.includes(hoveredItem.name) ? "is-related" : "is-dim";
                    return (
                      <GlassCard
                        pad
                        key={item.id}
                        className={`system-card ${state}`}
                        style={{ "--stagger": groupIndex * 2 + index } as CSSProperties}
                        tabIndex={0}
                        onMouseEnter={() => setHovered(item.id)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(item.id)}
                        onBlur={() => setHovered(null)}
                      >
                        <div className={`build-status build-status--${item.status}`}>{STATUS[item.status]}</div>
                        <h3>{item.name}</h3>
                        <p>{item.promise}</p>
                        <div className="connection-list" aria-label={`${item.name} connections`}>
                          {item.connectsTo.map((connection) => <span key={connection} className={related.has(connection) && hoveredItem?.id === item.id ? "on" : ""}>{connection}</span>)}
                        </div>
                      </GlassCard>
                    );
                  })}
                </div>
              </div>
            ))}
          </section>
        )}
      </div>
      <p className="ecosystem-note">Preview rule: no planned card stores data, runs analysis, or implies a feature is available.</p>
    </main>
  );
}
