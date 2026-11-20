import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
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
  const [filter, setFilter] = useState<BuildStatus | "all" | "next">("all");
  const [pointerOver, setPointerOver] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const overviewTabRef = useRef<HTMLButtonElement>(null);
  const systemsTabRef = useRef<HTMLButtonElement>(null);
  const counts = useMemo(() => Object.fromEntries(STATUS_ORDER.map((status) => [status, SYSTEM_PREVIEWS.filter((item) => item.status === status).length])) as Record<BuildStatus, number>, []);
  const visible = filter === "all" ? SYSTEM_PREVIEWS : SYSTEM_PREVIEWS.filter((item) =>
    filter === "next" ? item.status === "in-development" || item.status === "planned" : item.status === filter);
  const groups = useMemo(() => Object.entries(visible.reduce<Record<string, SystemPreview[]>>((all, item) => {
    (all[item.area] ??= []).push(item);
    return all;
  }, {})), [visible]);
  const activeId = focused ?? pointerOver;
  const hoveredItem = SYSTEM_PREVIEWS.find((item) => item.id === activeId);
  const related = new Set(hoveredItem ? [hoveredItem.name, ...hoveredItem.connectsTo] : []);

  function selectView(target: "overview" | "systems") {
    setPointerOver(null);
    setFocused(null);
    setView(target);
    (target === "overview" ? overviewTabRef : systemsTabRef).current?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: "overview" | "systems") {
    let target: "overview" | "systems";
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowRight":
        target = current === "overview" ? "systems" : "overview";
        break;
      case "Home":
        target = "overview";
        break;
      case "End":
        target = "systems";
        break;
      default:
        return;
    }
    event.preventDefault();
    selectView(target);
  }

  function selectFilter(target: BuildStatus | "all" | "next") {
    setPointerOver(null);
    setFocused(null);
    setFilter(target);
  }

  function openHorizon(horizon: (typeof HORIZONS)[number]) {
    selectFilter(horizon.id === "next" ? "next" : (horizon.statuses[0] ?? "all"));
    selectView("systems");
  }

  return (
    <main className="ecosystem-page building-page" aria-labelledby="building-title">
      <header className="ecosystem-hero">
        <Tag tone="cyan"><Blocks size={ICON_SIZE.body} /> Transparent roadmap</Tag>
        <h1 id="building-title">Building AXOM</h1>
        <p>A preview of how today’s working study tools could become a connected medical-learning system. These cards describe direction, not shipped capability.</p>
      </header>
      <div className="ecosystem-tabs" role="tablist" aria-label="Building views">
        <button
          ref={overviewTabRef}
          id="building-tab-overview"
          type="button"
          role="tab"
          aria-controls="building-active-panel"
          aria-selected={view === "overview"}
          tabIndex={view === "overview" ? 0 : -1}
          onClick={() => selectView("overview")}
          onKeyDown={(event) => handleTabKeyDown(event, "overview")}
        >Overview</button>
        <button
          ref={systemsTabRef}
          id="building-tab-systems"
          type="button"
          role="tab"
          aria-controls="building-active-panel"
          aria-selected={view === "systems"}
          tabIndex={view === "systems" ? 0 : -1}
          onClick={() => selectView("systems")}
          onKeyDown={(event) => handleTabKeyDown(event, "systems")}
        >Systems <span className="building-count" aria-hidden="true">{SYSTEM_PREVIEWS.length}</span></button>
      </div>

      <div
        className="building-panel"
        id="building-active-panel"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={view === "overview" ? "building-tab-overview" : "building-tab-systems"}
        key={view}
      >
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
              <button type="button" className={`filter-pill ${filter === "all" ? "on" : ""}`} aria-pressed={filter === "all"} onClick={() => selectFilter("all")}>All <small>{SYSTEM_PREVIEWS.length}</small></button>
              <button type="button" className={`filter-pill ${filter === "next" ? "on" : ""}`} aria-pressed={filter === "next"} onClick={() => selectFilter("next")}>Next <small>{counts["in-development"] + counts.planned}</small></button>
              {STATUS_ORDER.map((status) => (
                <button key={status} type="button" className={`filter-pill ${filter === status ? "on" : ""}`} aria-pressed={filter === status} onClick={() => selectFilter(status)}>
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
                        onMouseEnter={() => setPointerOver(item.id)}
                        onMouseLeave={() => setPointerOver(null)}
                        onFocus={() => setFocused(item.id)}
                        onBlur={() => setFocused(null)}
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
