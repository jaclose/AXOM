import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, ExternalLink, GraduationCap, Hospital, RefreshCw, School, Search, ShieldCheck } from "lucide-react";
import { GlassCard, GButton, PanelHeader, Tag } from "../components/ui/primitives";
import { ApplicationProfilePanel } from "../components/applications/ApplicationProfilePanel";
import { ResidencyExplorer } from "../components/applications/ResidencyExplorer";
import { CompareSavedSchools } from "../components/applications/CompareSavedSchools";
import { EstimatesSection, RequirementChecks, ResearchFactGroups, RiskFlagSection } from "../components/applications/SchoolDetails";
import { CHECK_STATUS, CHECK_STATUS_ORDER, formatDate } from "../components/applications/applicationDisplay";
import { ICON_SIZE } from "../lib/iconSize";
import { useStore } from "../lib/store";
import { researchFactRevision, researchValue, type ApplicationResearchEntry, type SchoolResearchFact } from "../lib/applicationResearch";
import { isApplicationProfileEmpty } from "../lib/applicationProfile";
import { checkSchool, type EligibilityStatus, type SchoolCheckResult } from "../lib/applicationChecker";
import {
  parseApplicationSchoolDataset,
  type ApplicationSchool,
  type ApplicationSchoolDataset,
  type SchoolVerificationStatus,
} from "../lib/applicationSchools";

const DATASET_URL = "./application-schools.json";
const STATUS: Record<SchoolVerificationStatus, { label: string; tone: "green" | "orange" | "neutral" | "cyan" }> = {
  verified: { label: "Verified", tone: "green" },
  incomplete: { label: "Incomplete", tone: "orange" },
  unknown: { label: "Unknown", tone: "neutral" },
  "needs-refresh": { label: "Needs refresh", tone: "cyan" },
  conflicting: { label: "Conflicting", tone: "orange" },
};

type SortKey = "name" | "fewest-issues" | "competitiveness";
const SORTS: readonly { id: SortKey; label: string }[] = [
  { id: "name", label: "Name" },
  { id: "fewest-issues", label: "Fewest issues first" },
  { id: "competitiveness", label: "Estimated competitiveness" },
];
const ISSUE_RANK: Record<EligibilityStatus, number> = { "no-blockers-found": 0, "needs-review": 1, "possible-blocker": 2, "not-enough-information": 3 };
const BAND_RANK = { "at-or-above": 0, near: 1, mixed: 2, below: 3 } as const;
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; dataset: ApplicationSchoolDataset; warnings: string[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

export function ApplicationCheckerPage() {
  const research = useStore(s => s.profile.applicationResearch);
  const storedProfile = useStore(s => s.profile.applicationProfile);
  // Typing in the profile form stays responsive while 292 schools are re-checked.
  const profile = useDeferredValue(storedProfile);
  const [savedOnly, setSavedOnly] = useState(false);
  const [capturedOnly, setCapturedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);
  const [loadKey, setLoadKey] = useState(0);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SchoolVerificationStatus | "all">("all");
  const [program, setProgram] = useState("all");
  const [checkFilter, setCheckFilter] = useState<EligibilityStatus | "all">("all");
  const [sort, setSort] = useState<SortKey>("name");
  const [pathway, setPathway] = useState<Pathway>("medical");

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(DATASET_URL, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) return setState({ kind: "empty" });
        if (!response.ok) throw new Error(`Dataset request failed (${response.status}).`);
        // Several SPA hosts answer a missing static asset with index.html and
        // status 200. That means "not connected", not "corrupt admissions data".
        if (!response.headers.get("content-type")?.includes("application/json")) {
          return setState({ kind: "empty" });
        }
        const result = parseApplicationSchoolDataset(await response.json());
        if (!result.ok) throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join(" "));
        setState({ kind: "ready", dataset: result.dataset, warnings: result.issues.map((issue) => `${issue.path}: ${issue.message}`) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "School data could not be loaded." });
      });
    return () => controller.abort();
  }, [loadKey]);

  const schools = useMemo(() => state.kind === "ready" ? state.dataset.schools : [], [state]);
  const hasProfile = !isApplicationProfileEmpty(profile);
  // One pass per dataset or profile change; cards, filters, sorting and the comparison read from it.
  const results = useMemo(() => {
    const now = new Date();
    return new Map<string, SchoolCheckResult>(schools.map(school => [school.id, checkSchool(school, profile, { now })]));
  }, [schools, profile]);
  const statusCounts = useMemo(() => {
    const counts: Record<EligibilityStatus, number> = { "possible-blocker": 0, "needs-review": 0, "no-blockers-found": 0, "not-enough-information": 0 };
    for (const result of results.values()) counts[result.eligibility.status] += 1;
    return counts;
  }, [results]);

  const savedIds = useMemo(() => new Set((research ?? []).filter(entry => entry.shortlisted).map(entry => entry.schoolId)), [research]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const matches = schools.filter((school) => {
      if (savedOnly && !savedIds.has(school.id)) return false;
      if (capturedOnly && !school.researchFacts?.length) return false;
      if (status !== "all" && school.verificationStatus !== status) return false;
      if (program !== "all" && school.programType !== program) return false;
      if (checkFilter !== "all" && results.get(school.id)?.eligibility.status !== checkFilter) return false;
      return !needle || [school.name, school.location, school.degree, school.programType, school.applicationPlatform, ...(school.researchFacts ?? []).map(fact => fact.value)]
        .some((value) => value?.toLocaleLowerCase().includes(needle));
    });
    const byName = (a: ApplicationSchool, b: ApplicationSchool) => collator.compare(a.name, b.name);
    if (sort === "fewest-issues") {
      const key = (school: ApplicationSchool) => {
        const summary = results.get(school.id)?.eligibility;
        return summary ? [ISSUE_RANK[summary.status], summary.blockers, summary.reviews, summary.unknown] : [9, 0, 0, 0];
      };
      return matches.sort((a, b) => {
        const left = key(a), right = key(b);
        const index = left.findIndex((value, position) => value !== right[position]);
        return index === -1 ? byName(a, b) : left[index] - right[index];
      });
    }
    if (sort === "competitiveness") {
      const rank = (school: ApplicationSchool) => {
        const estimate = results.get(school.id)?.competitiveness;
        return estimate?.band ? BAND_RANK[estimate.band] : estimate ? 4 : 5;
      };
      return matches.sort((a, b) => rank(a) - rank(b) || byName(a, b));
    }
    return matches.sort(byName);
  }, [program, query, schools, status, savedOnly, capturedOnly, savedIds, checkFilter, results, sort]);

  const programs = useMemo(() => [...new Set(schools.map((school) => school.programType).filter((value): value is string => Boolean(value)))].sort(), [schools]);
  const savedSchools = useMemo(() => schools.filter(school => savedIds.has(school.id)).sort((a, b) => collator.compare(a.name, b.name)), [schools, savedIds]);

  function clearFilters() {
    setQuery(""); setStatus("all"); setProgram("all"); setSavedOnly(false); setCapturedOnly(false); setCheckFilter("all");
  }

  return (
    <div className="application-page">
      <GlassCard pad>
        <div className="row gap12" style={{ alignItems: "center" }}>
          <span className="folder-icon" style={{ color: "var(--cyan)" }}><ClipboardCheck size={ICON_SIZE.control} /></span>
          <div className="grow">
            <div style={{ fontSize: 18, fontWeight: 800 }}>Application Checker</div>
            <div className="sub">Explore sourced school requirements without turning missing information into advice.</div>
          </div>
          <Tag tone="cyan">Research workspace</Tag>
        </div>
      </GlassCard>

      <PathwaySwitch pathway={pathway} onChange={setPathway} medicalCount={schools.length} />

      {pathway === "residency" ? <ResidencyExplorer empty={<PathwayNotCollected pathway="residency" />} />
        : pathway === "undergraduate" ? <PathwayNotCollected pathway="undergraduate" /> : <>
      <ApplicationProfilePanel />

      {state.kind === "ready" && <CompareSavedSchools schools={savedSchools} results={results} hasProfile={hasProfile} />}

      <GlassCard pad>
        <PanelHeader title="Medical school data" sub="Historical research, not an eligibility decision. Confirm current policies and application cycles with each school." />
        {state.kind === "loading" && <div className="application-state" role="status">Loading school data…</div>}
        {state.kind === "empty" && (
          <div className="application-state">
            <ShieldCheck size={ICON_SIZE.display} />
            <h3>No verified school dataset is connected yet</h3>
            <p className="sub">The review surface and versioned ingestion contract are ready. AXOM will not display placeholder admissions facts while the external source pipeline is being validated.</p>
          </div>
        )}
        {state.kind === "error" && (
          <div className="application-state" role="alert">
            <h3>School data needs attention</h3>
            <p className="sub">{state.message}</p>
            <GButton size="sm" onClick={() => setLoadKey((key) => key + 1)}><RefreshCw size={ICON_SIZE.body} /> Retry</GButton>
          </div>
        )}
        {state.kind === "ready" && (
          <>
            <div className="application-dataset-meta">
              <span>{schools.length} schools</span>
              <span>Dataset updated {formatDate(state.dataset.generatedAt)}</span>
              <span>{state.dataset.incompleteRecords} incomplete · {state.dataset.rejectedRecords} rejected</span>
              <span>{schools.filter(school => school.researchFacts?.length).length} with collected research</span>
              {state.warnings.length > 0 && <Tag tone="orange">{state.warnings.length} data warning{state.warnings.length === 1 ? "" : "s"}</Tag>}
            </div>
            {hasProfile && (
              <div className="application-dataset-meta application-status-counts" aria-label="Automatic check results across all schools">
                {CHECK_STATUS_ORDER.map(key => <span key={key}><i className={`application-dot tone-${CHECK_STATUS[key].tone}`} aria-hidden="true" />{CHECK_STATUS[key].label}: {statusCounts[key]}</span>)}
              </div>
            )}
            <p className="sub">A source link or historical official capture does not verify every requirement today. Unreported fields are not waived requirements. Your checkmarks record research reviewed, not requirements met.</p>
            <div className="row wrap gap12 application-toggles">
              <label><input type="checkbox" checked={savedOnly} onChange={event => setSavedOnly(event.target.checked)} /> Saved schools ({research?.filter(entry => entry.shortlisted).length ?? 0})</label>
              <label><input type="checkbox" checked={capturedOnly} onChange={event => setCapturedOnly(event.target.checked)} /> Has collected research</label>
            </div>
            <div className="application-controls">
              <label className="application-search"><Search size={ICON_SIZE.body} /><span className="sr-only">Search schools</span><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search school, location, degree…" /></label>
              <label><span className="sr-only">Filter verification status</span><select className="field" value={status} onChange={(event) => setStatus(event.target.value as SchoolVerificationStatus | "all")}>
                <option value="all">All data states</option>
                {Object.entries(STATUS).map(([value, meta]) => <option value={value} key={value}>{meta.label}</option>)}
              </select></label>
              <label><span className="sr-only">Filter program type</span><select className="field" value={program} onChange={(event) => setProgram(event.target.value)}>
                <option value="all">All programs</option>
                {programs.map((value) => <option value={value} key={value}>{value.toUpperCase()}</option>)}
              </select></label>
              <label><span className="sr-only">Check result</span><select className="field" value={checkFilter} onChange={(event) => setCheckFilter(event.target.value as EligibilityStatus | "all")}>
                <option value="all">All check results</option>
                {CHECK_STATUS_ORDER.map(key => <option value={key} key={key}>{CHECK_STATUS[key].label}</option>)}
              </select></label>
              <label className="application-sort"><span>Sort</span><select className="field" value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                {SORTS.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}
              </select></label>
            </div>
            <p className="sub" role="status">Showing {Math.min(visibleCount, filtered.length)} of {filtered.length} matching schools</p>
            {filtered.length ? <div className="application-school-grid">{filtered.slice(0, visibleCount).map((school) => <SchoolCard school={school} result={results.get(school.id)} hasProfile={hasProfile} key={school.id} />)}</div>
              : <div className="application-state"><h3>No matching schools</h3><button className="ghost-btn" type="button" onClick={clearFilters}>Clear search and filters</button></div>}
            {filtered.length > visibleCount && <GButton onClick={() => setVisibleCount(count => count + 24)}>Show more schools</GButton>}
          </>
        )}
      </GlassCard>
      </>}
    </div>
  );
}

type Pathway = "medical" | "residency" | "undergraduate";

const PATHWAYS: Array<{ id: Pathway; label: string; detail: string; icon: typeof School }> = [
  { id: "medical", label: "Medical school", detail: "MD / DO programs", icon: School },
  { id: "residency", label: "Residency", detail: "ACGME programs · import to enable", icon: Hospital },
  { id: "undergraduate", label: "Undergrad & pre-med", detail: "Advising & linkage · not collected yet", icon: GraduationCap },
];

function PathwaySwitch({ pathway, onChange, medicalCount }: { pathway: Pathway; onChange: (pathway: Pathway) => void; medicalCount: number }) {
  return (
    <div className="application-pathways" role="tablist" aria-label="Application pathway">
      {PATHWAYS.map(({ id, label, detail, icon: Icon }) => (
        <button key={id} type="button" role="tab" aria-selected={pathway === id} className={pathway === id ? "on" : ""} onClick={() => onChange(id)}>
          <Icon size={ICON_SIZE.emphasis} aria-hidden="true" />
          <span><b>{label}</b><small>{id === "medical" && medicalCount ? `MD / DO · ${medicalCount} researched` : detail}</small></span>
        </button>
      ))}
    </div>
  );
}

function PathwayNotCollected({ pathway }: { pathway: Exclude<Pathway, "medical"> }) {
  const residency = pathway === "residency";
  return (
    <GlassCard pad className="application-pathway-empty">
      <PanelHeader
        title={residency ? "Residency programs — dataset not collected yet" : "Undergraduate & pre-med — dataset not collected yet"}
        sub="AXOM won’t invent program data. This pathway turns on as soon as a sourced dataset is added."
      />
      <div className="application-pathway-grid">
        <div>
          <b>What you’ll be able to do</b>
          <ul>
            {residency ? (
              <>
                <li>Search programs by specialty, state, and track (categorical, preliminary, transitional, advanced).</li>
                <li>See sourced requirements: Step 2 minimums, COMLEX acceptance, graduation-year limits, visa sponsorship (J-1/H-1B), signals.</li>
                <li>Save programs, review each captured fact, and compare against your profile as review items — never as match odds.</li>
              </>
            ) : (
              <>
                <li>Find schools’ pre-health advising, committee-letter policies, and linkage or early-assurance programs.</li>
                <li>Save institutions and track what you’ve verified, just like medical schools.</li>
              </>
            )}
          </ul>
        </div>
        <div>
          <b>What the data needs</b>
          {residency ? (
            <ol className="sub residency-steps">
              <li>Download the official program list from <a href="https://acgmecloud.org/analytics/explore-public-data/program-search" target="_blank" rel="noopener noreferrer">ACGME Cloud → Explore Public Data</a> (the “ProgramListing” spreadsheet).</li>
              <li>Run <code>npm run residency:import -- path/to/ProgramListing.xlsx</code> from the repository root.</li>
              <li>Reload — ~13,700 accredited programs appear with specialty, sponsor, location, length, and status. Requirement fields stay “Unknown” until sourced.</li>
            </ol>
          ) : (
            <p className="sub">
              One JSON file with a source URL and retrieval date for every fact; missing facts stay “Unknown”. The exact contract is in
              <code> docs/APPLICATION-PATHWAY-DATASETS.md</code>, matching the medical-school format so saved programs and backups work the same way.
            </p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

function SchoolCard({ school, result, hasProfile }: { school: ApplicationSchool; result?: SchoolCheckResult; hasProfile: boolean }) {
  const entry = useStore(s => s.profile.applicationResearch?.find(item => item.schoolId === school.id));
  const [open, setOpen] = useState(false);
  function update(patch: Partial<ApplicationResearchEntry>) {
    const store = useStore.getState();
    const entries = store.profile.applicationResearch ?? [];
    const current = entries.find(item => item.schoolId === school.id) ?? { schoolId: school.id, shortlisted: false, reviewedFacts: {} };
    store.updateProfile({ applicationResearch: [...entries.filter(item => item.schoolId !== school.id), { ...current, ...patch }] });
  }
  function setReviewed(fact: SchoolResearchFact, reviewed: boolean) {
    const latest = useStore.getState().profile.applicationResearch?.find(item => item.schoolId === school.id);
    const checks = { ...latest?.reviewedFacts };
    if (reviewed) checks[fact.id] = researchFactRevision(fact); else delete checks[fact.id];
    update({ reviewedFacts: checks });
  }
  const facts = school.researchFacts ?? [];
  const reviewed = facts.filter(fact => entry?.reviewedFacts[fact.id] === researchFactRevision(fact)).length;
  const capturedValue = (id: string) => { const fact = facts.find(item => item.id === id); return fact ? `${researchValue(fact.value)} (historical capture)` : "Unknown"; };
  const meta = STATUS[school.verificationStatus];
  const source = school.sources[0];
  const check = result ? CHECK_STATUS[result.eligibility.status] : undefined;
  return (
    <article className="application-school-card" data-open={open ? "" : undefined}>
      <div className="row application-school-head"><div className="grow"><h3>{school.name}</h3><div className="sub">{[school.location, school.degree, school.programType].filter(Boolean).join(" · ") || "Details not supplied"}</div></div><Tag tone={meta.tone}>{meta.label}</Tag></div>
      {result && check && (
        <div className={`application-check-summary tone-${check.tone} ${hasProfile ? "" : "idle"}`}>
          <Tag tone={check.tone}>{check.label}</Tag>
          <p>{result.eligibility.headline}</p>
        </div>
      )}
      <button type="button" className={`filter-pill ${entry?.shortlisted ? "on" : ""}`} aria-pressed={entry?.shortlisted ?? false} onClick={() => update({ shortlisted: !entry?.shortlisted })}>{entry?.shortlisted ? "Saved school" : "Save school"}</button>
      <dl>
        <div><dt>Application</dt><dd>{school.applicationPlatform ?? capturedValue("application_process_raw.application_service")}</dd></div>
        <div><dt>Deadline</dt><dd>{school.deadline ?? capturedValue("application_process_raw.primary_deadline")}</dd></div>
        <div><dt>MCAT policy</dt><dd>{school.mcatPolicy ?? capturedValue("admissions_requirements_raw.mcat_recency_policy")}</dd></div>
      </dl>
      <div className="application-source">
        <span>{school.updatedAt ? `Record updated ${formatDate(school.updatedAt)}` : "Record update date unknown"}</span>
        {source ? <a href={source.url} target="_blank" rel="noreferrer noopener">Source <ExternalLink size={ICON_SIZE.microInline} /></a> : <span>No source supplied</span>}
      </div>
      <details className="application-school-details" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>Review available details{facts.length ? ` · ${reviewed}/${facts.length} reviewed` : ""}</summary>
        {open && (
          <div className="application-school-body">
            <div className="application-school-column">
              {result && <RequirementChecks result={result} hasProfile={hasProfile} />}
            </div>
            <div className="application-school-column">
              {result && <EstimatesSection school={school} result={result} />}
              {school.riskFlag && <RiskFlagSection flag={school.riskFlag} />}
              <ResearchFactGroups facts={facts} entry={entry} onReviewedChange={setReviewed} />
              <dl>
                <div><dt>Prerequisites</dt><dd>{school.prerequisiteCategories?.join(", ") ?? "Unknown"}</dd></div>
                <div><dt>CASPer</dt><dd>{school.casperPolicy ?? "Unknown"}</dd></div>
                <div><dt>PREview</dt><dd>{school.previewPolicy ?? "Unknown"}</dd></div>
                <div><dt>Letters</dt><dd>{school.letters ?? "Unknown"}</dd></div>
                <div><dt>Mission</dt><dd>{school.missionNotes ?? "Unknown"}</dd></div>
              </dl>
              {school.conflicts && <p className="application-conflict" role="alert">Conflicting fields need review: {Object.keys(school.conflicts).join(", ")}.</p>}
              {school.conflicts && <dl>{Object.entries(school.conflicts).map(([field, conflict]) => <div key={field}><dt>{field}</dt><dd>{conflict.existing}<br />Other recorded value: {conflict.incoming}</dd></div>)}</dl>}
              {school.website && <a href={school.website} target="_blank" rel="noreferrer noopener">School website (roster link)</a>}
            </div>
          </div>
        )}
      </details>
    </article>
  );
}
