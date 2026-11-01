// Blueprint Workbench — the installable operating-system UI for a pathway mode.
// Mode (USMLE vs Pre-Health) is fixed by the page; the lane bar only shows that
// mode's lanes. Installing a blueprint creates a rich container of mastery
// objects (not lecture passes), with duplicate prevention, macro/detailed views,
// node detail panels, search/filter, and source governance.
import { useEffect, useMemo, useState } from "react";
import {
  Brain, Plus, ChevronDown, ChevronRight, Search, Layers, ListChecks, ClipboardCheck,
  FlaskConical, Trophy, ShieldCheck, ExternalLink, Trash2, Copy, ArrowRight, Target, Gauge,
} from "lucide-react";
import { useStore } from "../../lib/store";
import { GlassCard, GButton, GhostButton, PanelHeader, Tag } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import {
  BLUEPRINTS, blueprintsForLane, lanesForMode, blueprintById,
} from "../../lib/blueprintCatalog";
import { routeForBlueprintLane } from "../../lib/blueprintRoutes";
import type { BlueprintLaneId, BlueprintMode, BlueprintNodeStatus, BlueprintNodeType, BlueprintSource, InstalledBlueprint, InstalledBlueprintNode, SourceType } from "../../lib/types";
import { ICON_SIZE } from "../../lib/iconSize";
import "../../styles/exam-prep.css";

const DEPTH_KEY = "noctyrium-blueprint-depth";
const laneKey = (mode: BlueprintMode) => `noctyrium-blueprint-lane-${mode}`;

const TYPE_META: Record<BlueprintNodeType, { label: string; tone: "cyan" | "purple" | "orange" | "green" | "neutral" }> = {
  content: { label: "Content", tone: "cyan" },
  task: { label: "Task", tone: "purple" },
  tracker: { label: "Tracker", tone: "green" },
  queue: { label: "Queue", tone: "orange" },
  assessment: { label: "Assessment", tone: "orange" },
  evidence: { label: "Evidence", tone: "green" },
  metric: { label: "Metric", tone: "cyan" },
  planner: { label: "Planner", tone: "purple" },
};
const STATUS_ORDER: BlueprintNodeStatus[] = ["not-started", "in-progress", "blocked", "mastered", "done"];
const STATUS_LABEL: Record<BlueprintNodeStatus, string> = {
  "not-started": "Not started", "in-progress": "In progress", blocked: "Blocked", mastered: "Mastered", done: "Done",
};
const SOURCE_TONE: Record<SourceType, "green" | "cyan" | "neutral"> = { official: "green", tool: "cyan", internal: "neutral" };

function readDepth(): "macro" | "detailed" {
  try { return localStorage.getItem(DEPTH_KEY) === "detailed" ? "detailed" : "macro"; } catch { return "macro"; }
}

export function BlueprintWorkbench({ mode, initialLane }: { mode: BlueprintMode; initialLane?: BlueprintLaneId }) {
  const lanes = useMemo(() => lanesForMode(mode), [mode]);
  const installs = useStore((s) => s.blueprintInstalls);
  const installBlueprint = useStore((s) => s.installBlueprint);

  const [activeLane, setActiveLane] = useState<BlueprintLaneId>(() => {
    if (initialLane && lanes.some((l) => l.id === initialLane)) return initialLane;
    try { const saved = localStorage.getItem(laneKey(mode)) as BlueprintLaneId | null; if (saved && lanes.some((l) => l.id === saved)) return saved; } catch { /* ignore */ }
    return lanes[0]?.id;
  });
  const [openInstallId, setOpenInstallId] = useState<string | null>(null);
  const [dupFor, setDupFor] = useState<string | null>(null);

  useEffect(() => {
    if (initialLane && lanes.some((l) => l.id === initialLane)) {
      setActiveLane(initialLane);
      setOpenInstallId(null);
      try { localStorage.setItem(laneKey(mode), initialLane); } catch { /* ignore */ }
    }
  }, [initialLane, lanes, mode]);

  function selectLane(id: BlueprintLaneId, updateRoute = true) {
    setActiveLane(id);
    setOpenInstallId(null);
    try { localStorage.setItem(laneKey(mode), id); } catch { /* ignore */ }
    if (updateRoute && typeof window !== "undefined") {
      const route = routeForBlueprintLane(id);
      if (window.location.hash.replace("#", "") !== route) window.location.hash = route;
    }
  }

  const laneCatalog = blueprintsForLane(activeLane);
  const laneInstalls = installs.filter((i) => i.laneId === activeLane);
  const openInstall = installs.find((i) => i.id === openInstallId) ?? null;
  const activeLaneInfo = lanes.find((lane) => lane.id === activeLane);
  const primaryBlueprint = activeLaneInfo ? blueprintById(activeLaneInfo.blueprintId) : undefined;
  const heroSummary = primaryBlueprint?.summary.replace(/\s+—\s+/g, ", ");
  const primaryInstall = primaryBlueprint ? laneInstalls.find((install) => install.blueprintId === primaryBlueprint.id) : undefined;
  const progress = primaryInstall ? installStats(primaryInstall) : null;
  const objectiveCount = primaryBlueprint?.categories.reduce((sum, category) => sum + category.nodes.length, 0) ?? 0;

  function handleInstall(blueprintId: string) {
    const existing = installs.find((i) => i.blueprintId === blueprintId);
    if (existing) { setDupFor(blueprintId); return; }
    const id = installBlueprint(blueprintId);
    if (id) setOpenInstallId(id);
  }

  return (
    <>
      <section className="prep-desk" aria-labelledby="prep-desk-title" data-tour="step">
        <div className="prep-desk-main">
          <div className="prep-desk-topline">
            <span>AXOM / {mode === "usmle" ? "BOARD PREP" : "PRE-HEALTH"}</span>
            <span className="prep-desk-wip" aria-label="Work in progress">WIP</span>
          </div>
          <div className="prep-desk-copy" key={activeLane}>
            <span className="prep-desk-overline">{activeLaneInfo?.sub ?? "Your exam pathway"}</span>
            <h1 id="prep-desk-title">{activeLaneInfo?.label ?? "Exam prep"}<br /><span>with a plan.</span></h1>
            <p>{heroSummary ?? "Choose a pathway to see its source-backed blueprint."}</p>
          </div>
          <div className="prep-desk-progress">
            <span className="prep-desk-ring" style={{ background: `conic-gradient(var(--gold) ${progress?.pct ?? 0}%, var(--hairline) 0)` }} aria-hidden="true">
              <span>{progress?.pct ?? 0}<small>%</small></span>
            </span>
            <div>
              <span className="prep-desk-progress-label">{progress ? "AVERAGE MASTERY" : "READY TO BEGIN"}</span>
              <strong>{progress ? `${progress.mastered} of ${progress.total} objectives complete` : `${objectiveCount} objectives mapped`}</strong>
              <small>{progress ? "Progress stays with this blueprint on your device." : "Install a blueprint to track your own work."}</small>
            </div>
          </div>
          <div className="prep-desk-actions">
            <button type="button" className="prep-desk-primary-action" disabled={!primaryBlueprint}
              onClick={() => primaryInstall ? setOpenInstallId(primaryInstall.id) : primaryBlueprint && handleInstall(primaryBlueprint.id)}>
              {primaryInstall ? `Continue ${activeLaneInfo?.label ?? "blueprint"}` : `Start ${activeLaneInfo?.label ?? "blueprint"}`} <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
            </button>
            {primaryBlueprint && <SourceBadge source={primaryBlueprint.source} />}
          </div>
        </div>
        <nav className="prep-desk-routes" aria-label={mode === "usmle" ? "USMLE prep routes" : "Pre-health prep routes"}>
          <div className="prep-desk-routes-head"><span>YOUR PATHWAYS</span><span>{String(lanes.length).padStart(2, "0")} ROUTES</span></div>
          <div className="prep-desk-route-grid">
            {lanes.map((lane, index) => (
              <button key={lane.id} type="button" className={`prep-desk-route ${activeLane === lane.id ? "on" : ""}`}
                aria-current={activeLane === lane.id ? "page" : undefined} onClick={() => selectLane(lane.id)}>
                <span className="prep-desk-route-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="prep-desk-route-copy"><b>{lane.label}</b><small>{lane.sub}</small></span>
                <ArrowRight size={ICON_SIZE.body} aria-hidden="true" />
              </button>
            ))}
          </div>
          <p>Choose a lane. Your installed work stays where you left it.</p>
        </nav>
      </section>

      {openInstall
        ? <ContainerView install={openInstall} onClose={() => setOpenInstallId(null)} />
        : <LaneCatalog laneInstalls={laneInstalls} catalogIds={laneCatalog.map((b) => b.id)} installs={installs}
            onInstall={handleInstall} onOpen={setOpenInstallId} />}

      {dupFor && (
        <DuplicateDialog blueprintId={dupFor} onClose={() => setDupFor(null)} onOpened={(id) => { setDupFor(null); setOpenInstallId(id); }} />
      )}
    </>
  );
}

function LaneCatalog({
  catalogIds, laneInstalls, installs, onInstall, onOpen,
}: {
  catalogIds: string[];
  laneInstalls: InstalledBlueprint[];
  installs: InstalledBlueprint[];
  onInstall: (blueprintId: string) => void;
  onOpen: (installId: string) => void;
}) {
  const remove = useStore((s) => s.removeBlueprintInstall);
  return (
    <>
      {laneInstalls.length > 0 && (
        <GlassCard pad>
          <PanelHeader title="Installed blueprints" sub="Your live containers under the Course Tracker mastery tree." />
          <div className="bp-installed-list">
            {laneInstalls.map((install) => {
              const stats = installStats(install);
              return (
                <div className="bp-installed-row" key={install.id}>
                  <span className="bp-installed-mark"><Brain size={ICON_SIZE.emphasis} /></span>
                  <button type="button" className="grow bp-installed-open" onClick={() => onOpen(install.id)}>
                    <b>{install.title}</b>
                    <span>{stats.mastered}/{stats.total} mastered · {stats.pct}% overall</span>
                  </button>
                  <div className="bp-mini-track"><span style={{ width: `${stats.pct}%` }} /></div>
                  <GhostButton title="Open" onClick={() => onOpen(install.id)}><ArrowRight size={ICON_SIZE.body} /></GhostButton>
                  <GhostButton className="danger" title="Remove container" onClick={() => remove(install.id)}><Trash2 size={ICON_SIZE.body} /></GhostButton>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      <GlassCard pad>
        <PanelHeader title="Blueprint catalog" sub="Install a source-backed operating system for this lane." />
        <div className="bp-catalog-grid">
          {catalogIds.map((id) => {
            const bp = blueprintById(id)!;
            const installed = installs.filter((i) => i.blueprintId === id);
            const nodeCount = bp.categories.reduce((sum, c) => sum + c.nodes.length, 0);
            return (
              <div className="bp-catalog-card" key={id}>
                <div className="bp-catalog-top">
                  <span className="bp-catalog-mark"><Brain size={ICON_SIZE.emphasis} /></span>
                  <SourceBadge source={bp.source} />
                </div>
                <b>{bp.title}</b>
                <span className="bp-catalog-sum">{bp.summary}</span>
                <div className="bp-catalog-meta">
                  <span>{bp.categories.length} categories</span>
                  <span>{nodeCount} nodes</span>
                </div>
                <div className="bp-catalog-actions">
                  {installed.length > 0
                    ? <>
                        <GButton size="sm" onClick={() => onOpen(installed[0].id)}><ArrowRight size={ICON_SIZE.body} /> Open</GButton>
                        <GButton size="sm" onClick={() => onInstall(id)}><Copy size={ICON_SIZE.body} /> Duplicate</GButton>
                      </>
                    : <GButton size="sm" variant="primary" onClick={() => onInstall(id)}><Plus size={ICON_SIZE.body} /> Install blueprint</GButton>}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </>
  );
}

function DuplicateDialog({ blueprintId, onClose, onOpened }: { blueprintId: string; onClose: () => void; onOpened: (id: string) => void }) {
  const installs = useStore((s) => s.blueprintInstalls);
  const installBlueprint = useStore((s) => s.installBlueprint);
  const existing = installs.find((i) => i.blueprintId === blueprintId);
  const bp = blueprintById(blueprintId);
  return (
    <Modal title="Already installed" onClose={onClose}
      footer={<GhostButton onClick={onClose}>Cancel</GhostButton>}>
      <p className="sub" style={{ marginBottom: 14 }}>
        “{bp?.title}” is already installed as a container. Open the existing one, or create a versioned duplicate to track a fresh run.
      </p>
      <div className="stack gap8">
        <GButton variant="primary" onClick={() => existing && onOpened(existing.id)}><ArrowRight size={ICON_SIZE.body} /> Open existing blueprint</GButton>
        <GButton onClick={() => { const id = installBlueprint(blueprintId, { duplicate: true }); if (id) onOpened(id); }}><Copy size={ICON_SIZE.body} /> Create a versioned duplicate</GButton>
      </div>
    </Modal>
  );
}

function ContainerView({ install, onClose }: { install: InstalledBlueprint; onClose: () => void }) {
  const reconcile = useStore((s) => s.reconcileBlueprintInstall);
  const [depth, setDepth] = useState<"macro" | "detailed">(readDepth);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BlueprintNodeStatus | "all">("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);

  const bp = blueprintById(install.blueprintId);
  const needsUpdate = bp && install.catalogVersion < bp.version;
  const stats = installStats(install);
  const allTags = useMemo(() => [...new Set(install.nodes.flatMap((n) => n.tags))].sort(), [install.nodes]);

  function changeDepth(next: "macro" | "detailed") {
    setDepth(next);
    try { localStorage.setItem(DEPTH_KEY, next); } catch { /* ignore */ }
  }

  const q = query.trim().toLowerCase();
  const matches = (node: InstalledBlueprintNode) =>
    (statusFilter === "all" || node.status === statusFilter)
    && (tagFilter === "all" || node.tags.includes(tagFilter))
    && (!q || node.objective.toLowerCase().includes(q) || node.category.toLowerCase().includes(q) || node.tags.some((t) => t.includes(q)));

  const categories = useMemo(() => {
    const order: string[] = [];
    const map = new Map<string, InstalledBlueprintNode[]>();
    for (const node of install.nodes) {
      if (!map.has(node.category)) { map.set(node.category, []); order.push(node.category); }
      map.get(node.category)!.push(node);
    }
    return order.map((name) => ({ name, nodes: map.get(name)!.filter(matches) }))
      .filter((c) => c.nodes.length > 0);
  }, [install.nodes, q, statusFilter, tagFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GlassCard pad className="bp-container-card">
      <div className="bp-container-head">
        <GhostButton onClick={onClose} title="Back to catalog"><ChevronRight size={ICON_SIZE.emphasis} style={{ transform: "rotate(180deg)" }} /></GhostButton>
        <div className="grow">
          <div className="bp-container-title">{install.title}</div>
          <div className="bp-container-sub">
            {stats.mastered}/{stats.total} mastered · {stats.pct}% overall
            {bp && <> · <SourceBadge source={bp.source} inline /></>}
          </div>
        </div>
        <div className="depth-toggle" title="Macro shows strategy; Detailed exposes objectives + trackers">
          <button type="button" className={`depth-pill ${depth === "macro" ? "on" : ""}`} onClick={() => changeDepth("macro")}>Macro</button>
          <button type="button" className={`depth-pill ${depth === "detailed" ? "on" : ""}`} onClick={() => changeDepth("detailed")}>Detailed</button>
        </div>
      </div>

      {needsUpdate && (
        <div className="bp-update-note">
          <ShieldCheck size={ICON_SIZE.body} /> <span>A newer catalog version is available. Updating preserves your progress.</span>
          <GButton size="sm" onClick={() => reconcile(install.id)}>Update</GButton>
        </div>
      )}

      <div className="bp-toolbar">
        <div className="search-wrap bp-search">
          <Search size={ICON_SIZE.body} />
          <input className="search-input" placeholder="Search objectives, categories, tags…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <select className="field bp-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as BlueprintNodeStatus | "all")} aria-label="Status filter">
          <option value="all">All statuses</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {allTags.length > 0 && (
          <select className="field bp-filter" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} aria-label="Tag filter">
            <option value="all">All tags</option>
            {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>

      <div className="bp-category-list">
        {categories.map((category) => (
          <CategoryBlock key={category.name} name={category.name} nodes={category.nodes} depth={depth}
            installId={install.id} openNodeId={openNodeId} onOpenNode={setOpenNodeId}
            forceOpen={Boolean(q || statusFilter !== "all" || tagFilter !== "all")} />
        ))}
        {categories.length === 0 && <div className="dim" style={{ padding: "8px 2px" }}>No nodes match the current filters.</div>}
      </div>
    </GlassCard>
  );
}

function CategoryBlock({
  name, nodes, depth, installId, openNodeId, onOpenNode, forceOpen,
}: {
  name: string;
  nodes: InstalledBlueprintNode[];
  depth: "macro" | "detailed";
  installId: string;
  openNodeId: string | null;
  onOpenNode: (id: string | null) => void;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isOpen = forceOpen || open;
  const mastery = Math.round(nodes.reduce((sum, n) => sum + n.mastery, 0) / Math.max(1, nodes.length));
  const mastered = nodes.filter((n) => n.status === "mastered" || n.status === "done").length;

  if (depth === "macro") {
    const catId = `cat:${name}`;
    const macroOpen = openNodeId === catId || nodes.some((node) => node.id === openNodeId);
    const previewNodes = [...nodes]
      .sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority) || a.order - b.order)
      .slice(0, 6);
    const nextNode = previewNodes.find((node) => node.status !== "done" && node.status !== "mastered") ?? previewNodes[0];
    return (
      <div className={`bp-macro-block ${macroOpen ? "open" : ""}`}>
        <button type="button" className="bp-macro-cat" onClick={() => onOpenNode(macroOpen ? null : catId)}>
          <span className="bp-cat-icon"><Target size={ICON_SIZE.body} /></span>
          <span className="grow">
            <b>{name}</b>
            <small>{nodes.length} nodes · {mastered} mastered{nextNode ? ` · next: ${nextNode.objective}` : ""}</small>
          </span>
          <span className="bp-cat-mastery">{mastery}%</span>
          <div className="bp-mini-track"><span style={{ width: `${mastery}%` }} /></div>
        </button>
        {macroOpen && (
          <div className="bp-macro-detail">
            {previewNodes.map((node) => (
              <div className={`bp-macro-node ${openNodeId === node.id ? "open" : ""}`} key={node.id}>
                <button type="button" onClick={() => onOpenNode(openNodeId === node.id ? catId : node.id)}>
                  <span className="bp-node-dot" style={{ background: masteryColor(node.mastery, node.status) }} />
                  <span className="grow">
                    <b>{node.objective}</b>
                    <small>{STATUS_LABEL[node.status]} · {node.mastery}% · {node.priority} priority</small>
                  </span>
                  <ChevronRight size={ICON_SIZE.body} />
                </button>
                {openNodeId === node.id && <NodeDetail node={node} installId={installId} />}
              </div>
            ))}
            {nodes.length > previewNodes.length && <div className="bp-macro-more">{nodes.length - previewNodes.length} more objects available in Detailed mode</div>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`bp-cat ${isOpen ? "open" : ""}`}>
      <button type="button" className="bp-cat-head" onClick={() => setOpen((o) => !o)}>
        {isOpen ? <ChevronDown size={ICON_SIZE.body} /> : <ChevronRight size={ICON_SIZE.body} />}
        <span className="bp-cat-icon"><Target size={ICON_SIZE.body} /></span>
        <b className="grow">{name}</b>
        <span className="bp-cat-count">{mastered}/{nodes.length}</span>
        <span className="bp-cat-mastery">{mastery}%</span>
      </button>
      {isOpen && (
        <div className="bp-node-list">
          {nodes.map((node) => (
            <NodeRow key={node.id} node={node} installId={installId}
              open={openNodeId === node.id} onToggle={() => onOpenNode(openNodeId === node.id ? null : node.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function NodeRow({ node, installId, open, onToggle }: { node: InstalledBlueprintNode; installId: string; open: boolean; onToggle: () => void }) {
  const meta = TYPE_META[node.taskType];
  const done = node.status === "mastered" || node.status === "done";
  return (
    <div className={`bp-node ${open ? "open" : ""} ${done ? "done" : ""}`}>
      <button type="button" className="bp-node-row" onClick={onToggle}>
        <span className="bp-node-dot" style={{ background: masteryColor(node.mastery, node.status) }} />
        <span className="grow bp-node-main">
          <b>{node.objective}</b>
          <span className="bp-node-tags">
            <Tag tone={meta.tone}>{meta.label}</Tag>
            {node.sourceType && <i className={`bp-source-dot ${node.sourceType}`} title={`${node.sourceType} source`} />}
            {node.tags.slice(0, 3).map((t) => <em key={t}>#{t}</em>)}
          </span>
        </span>
        <span className="bp-node-status">{STATUS_LABEL[node.status]}</span>
        {open ? <ChevronDown size={ICON_SIZE.body} /> : <ChevronRight size={ICON_SIZE.body} />}
      </button>
      {open && <NodeDetail node={node} installId={installId} />}
    </div>
  );
}

function NodeDetail({ node, installId }: { node: InstalledBlueprintNode; installId: string }) {
  const update = useStore((s) => s.updateBlueprintNode);
  const patch = (p: Partial<InstalledBlueprintNode>) => update(installId, node.id, p);
  const link = (key: "linkedQuestions" | "linkedAnki" | "linkedErrorLog" | "linkedAssessments", delta: number) =>
    patch({ [key]: Math.max(0, node[key] + delta) });

  return (
    <div className="bp-node-detail">
      {node.detail && <p className="bp-node-desc">{node.detail}</p>}

      <div className="bp-detail-row">
        <span className="bp-detail-label">Status</span>
        <div className="bp-status-pills">
          {STATUS_ORDER.map((s) => (
            <button key={s} type="button" className={`bp-status-pill s-${s} ${node.status === s ? "on" : ""}`} onClick={() => patch({ status: s })}>
              {STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="bp-detail-row">
        <span className="bp-detail-label"><Gauge size={ICON_SIZE.body} /> Mastery</span>
        <div className="bp-mastery-pills">
          {[0, 25, 50, 75, 100].map((m) => (
            <button key={m} type="button" className={`bp-mastery-pill ${node.mastery === m ? "on" : ""}`} onClick={() => patch({ mastery: m })}>{m}</button>
          ))}
          <span className="bp-mastery-val">{node.mastery}%</span>
        </div>
      </div>

      <div className="bp-link-grid">
        <LinkStepper icon={<ListChecks size={ICON_SIZE.body} />} label="Questions" value={node.linkedQuestions} onStep={(d) => link("linkedQuestions", d)} />
        <LinkStepper icon={<Layers size={ICON_SIZE.body} />} label="Anki" value={node.linkedAnki} onStep={(d) => link("linkedAnki", d)} />
        <LinkStepper icon={<FlaskConical size={ICON_SIZE.body} />} label="Error log" value={node.linkedErrorLog} onStep={(d) => link("linkedErrorLog", d)} />
        <LinkStepper icon={<ClipboardCheck size={ICON_SIZE.body} />} label="Assessments" value={node.linkedAssessments} onStep={(d) => link("linkedAssessments", d)} />
      </div>

      <div className="bp-detail-grid">
        <label className="stack gap6">
          <span className="field-label">Due date</span>
          <input className="field" type="date" value={node.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || undefined })} />
        </label>
        <label className="stack gap6">
          <span className="field-label">Evidence of completion</span>
          <input className="field" placeholder="link, score, artifact…" value={node.evidenceOfCompletion ?? ""} onChange={(e) => patch({ evidenceOfCompletion: e.target.value || undefined })} />
        </label>
      </div>
      <label className="stack gap6">
        <span className="field-label">Notes</span>
        <textarea className="field" rows={2} value={node.notes ?? ""} onChange={(e) => patch({ notes: e.target.value || undefined })} />
      </label>

      <div className="bp-node-foot">
        {node.sourceUrl
          ? <a className="bp-node-source" href={node.sourceUrl} target="_blank" rel="noreferrer noopener"><ShieldCheck size={ICON_SIZE.microInline} /> {sourceStatusText(node)} <ExternalLink size={ICON_SIZE.microInline} /></a>
          : <span className="bp-node-source dim"><ShieldCheck size={ICON_SIZE.microInline} /> {sourceStatusText(node)}</span>}
        {node.resourceLinks.map((r) => (
          <a key={r.url} className={`bp-node-source kind-${r.kind}`} href={r.url} target="_blank" rel="noreferrer noopener">{r.label} <ExternalLink size={ICON_SIZE.microInline} /></a>
        ))}
        {node.sourceVersion && <span className="bp-node-verified">{node.sourceVersion}</span>}
        {node.lastVerified && <span className="bp-node-verified">audited {node.lastVerified}</span>}
      </div>
    </div>
  );
}

function LinkStepper({ icon, label, value, onStep }: { icon: React.ReactNode; label: string; value: number; onStep: (delta: number) => void }) {
  return (
    <div className="bp-link-stepper">
      <span className="bp-link-label">{icon} {label}</span>
      <div className="bp-link-ctl">
        <button type="button" onClick={() => onStep(-1)} aria-label={`Decrease ${label}`}>−</button>
        <b>{value}</b>
        <button type="button" onClick={() => onStep(1)} aria-label={`Increase ${label}`}>+</button>
      </div>
    </div>
  );
}

function SourceBadge({ source, inline }: { source: BlueprintSource; inline?: boolean }) {
  const { type, name, url, verification, sourceVersion, lastVerified } = source;
  const label = verification === "verified"
    ? "user confirmed"
    : verification === "source-audited"
      ? "audited"
      : verification === "needs-review"
        ? "needs review"
        : "unverified";
  const body = <>
    {type === "official" ? <ShieldCheck size={ICON_SIZE.microInline} /> : type === "tool" ? <FlaskConical size={ICON_SIZE.microInline} /> : <Trophy size={ICON_SIZE.microInline} />}
    {type === "official" ? "Official" : type === "tool" ? "Tool" : "Internal"}
    {` · ${label}`}
  </>;
  const title = [name, sourceVersion, lastVerified ? `audited ${lastVerified}` : ""].filter(Boolean).join(" · ");
  if (inline) return <span className={`bp-source-inline kind-${type}`} title={title}>{body}</span>;
  return url
    ? <a className={`tag ${SOURCE_TONE[type] === "cyan" ? "" : SOURCE_TONE[type]} bp-source-tag`} href={url} target="_blank" rel="noreferrer noopener" title={title}>{body}</a>
    : <span className={`tag ${SOURCE_TONE[type] === "cyan" ? "" : SOURCE_TONE[type]}`} title={title}>{body}</span>;
}

function sourceStatusText(node: InstalledBlueprintNode): string {
  const type = node.sourceType ?? "internal";
  const state = node.sourceVerification === "verified"
    ? "user confirmed"
    : node.sourceVerification === "source-audited"
      ? "source audited"
      : node.sourceVerification === "needs-review"
        ? "needs review"
        : "unverified";
  return `${type} source · ${state}`;
}

function installStats(install: InstalledBlueprint) {
  const total = install.nodes.length;
  const mastered = install.nodes.filter((n) => n.status === "mastered" || n.status === "done").length;
  const pct = total ? Math.round(install.nodes.reduce((sum, n) => sum + n.mastery, 0) / total) : 0;
  return { total, mastered, pct };
}

function masteryColor(mastery: number, status: BlueprintNodeStatus): string {
  if (status === "blocked") return "var(--red)";
  if (status === "mastered" || status === "done" || mastery >= 90) return "var(--green)";
  if (mastery >= 50) return "var(--cyan)";
  if (mastery > 0 || status === "in-progress") return "var(--orange)";
  return "rgba(255,255,255,0.18)";
}

function priorityWeight(priority: InstalledBlueprintNode["priority"]) {
  return priority === "high" ? 3 : priority === "medium" ? 2 : 1;
}

// Re-export the full catalog count for any callers that want a quick sanity number.
export const BLUEPRINT_COUNT = BLUEPRINTS.length;
