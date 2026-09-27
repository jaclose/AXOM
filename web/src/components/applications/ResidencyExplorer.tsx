import { useEffect, useMemo, useState } from "react";
import { Bookmark, BookmarkCheck, ExternalLink, Hospital, RefreshCw, Search } from "lucide-react";
import { GButton, GlassCard, PanelHeader, Tag } from "../ui/primitives";
import { ICON_SIZE } from "../../lib/iconSize";
import { useStore } from "../../lib/store";
import {
  UNKNOWN,
  filterResidencyPrograms,
  parseResidencyDataset,
  type ResidencyDataset,
  type ResidencyProgram,
} from "../../lib/residencyPrograms";

export const RESIDENCY_DATASET_URL = "./application-residency-programs.json";

type LoadState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ready"; dataset: ResidencyDataset; warnings: number };

const REQUIREMENT_LABELS: Array<[keyof ResidencyProgram["requirements"], string]> = [
  ["step2Minimum", "Step 2 CK minimum"],
  ["comlexAccepted", "COMLEX accepted"],
  ["visaSponsorship", "Visa sponsorship"],
  ["yearsSinceGraduation", "Years since graduation"],
  ["signals", "Preference signals"],
];

/**
 * Residency pathway. Identity and basics come from the ACGME public program
 * listing; requirement fields show "Unknown" honestly until sourced.
 */
export function ResidencyExplorer({ empty }: { empty: React.ReactNode }) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [reload, setReload] = useState(0);
  const [query, setQuery] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [region, setRegion] = useState("");
  const [coreOnly, setCoreOnly] = useState(true);
  const [savedOnly, setSavedOnly] = useState(false);
  const [visible, setVisible] = useState(30);
  const research = useStore((s) => s.profile.applicationResearch);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    fetch(RESIDENCY_DATASET_URL, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404 || !response.headers.get("content-type")?.includes("application/json")) return setState({ kind: "empty" });
        if (!response.ok) throw new Error(`Residency data request failed (${response.status}).`);
        const result = parseResidencyDataset(await response.json());
        if (!result.ok) throw new Error(result.issues.map((issue) => issue.message).join(" "));
        setState({ kind: "ready", dataset: result.dataset, warnings: result.issues.length });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: error instanceof Error ? error.message : "Residency data could not be loaded." });
      });
    return () => controller.abort();
  }, [reload]);

  const programs = useMemo(() => (state.kind === "ready" ? state.dataset.programs : []), [state]);
  const specialties = useMemo(() => [...new Set(programs.filter((program) => !coreOnly || !program.isSubspecialty).map((program) => program.specialty))].sort(), [programs, coreOnly]);
  const regions = useMemo(() => [...new Set(programs.map((program) => program.state).filter((value): value is string => Boolean(value)))].sort(), [programs]);
  const savedIds = useMemo(() => new Set((research ?? []).filter((entry) => entry.shortlisted && entry.schoolId.startsWith("acgme-")).map((entry) => entry.schoolId)), [research]);
  const filtered = useMemo(
    () => filterResidencyPrograms(programs, { query, specialty, state: region, coreOnly, savedIds: savedOnly ? savedIds : undefined }),
    [programs, query, specialty, region, coreOnly, savedOnly, savedIds],
  );
  useEffect(() => { setVisible(30); }, [query, specialty, region, coreOnly, savedOnly]);

  if (state.kind === "empty") return <>{empty}</>;

  return (
    <GlassCard pad className="residency-explorer">
      <PanelHeader
        title="Residency programs"
        sub="Identity and basics from the ACGME public program listing. Requirements stay “Unknown” until a sourced capture adds them — always confirm on the program’s own site."
        action={state.kind === "ready" ? <Tag tone="cyan">{state.dataset.recordCount.toLocaleString()} programs{state.dataset.academicYear ? ` · AY ${state.dataset.academicYear}` : ""}</Tag> : undefined}
      />
      {state.kind === "loading" && <div className="application-state" role="status">Loading residency programs…</div>}
      {state.kind === "error" && (
        <div className="application-state" role="alert">
          <p>{state.message}</p>
          <GButton size="sm" onClick={() => setReload((value) => value + 1)}><RefreshCw size={ICON_SIZE.body} /> Try again</GButton>
        </div>
      )}
      {state.kind === "ready" && (
        <>
          <div className="application-controls residency-controls">
            <label className="application-search"><Search size={ICON_SIZE.body} /><span className="sr-only">Search residency programs</span>
              <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search program, hospital, city, ACGME code…" />
            </label>
            <label><span className="sr-only">Specialty</span>
              <select className="field" value={specialty} onChange={(event) => setSpecialty(event.target.value)} aria-label="Specialty">
                <option value="">All specialties</option>
                {specialties.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label><span className="sr-only">State</span>
              <select className="field" value={region} onChange={(event) => setRegion(event.target.value)} aria-label="State">
                <option value="">All states</option>
                {regions.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
            <label className="residency-toggle"><input type="checkbox" checked={coreOnly} onChange={(event) => setCoreOnly(event.target.checked)} /> Residencies only (hide fellowships)</label>
            <label className="residency-toggle"><input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} /> Saved ({savedIds.size})</label>
          </div>
          <p className="sub" role="status">Showing {Math.min(visible, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()} matching programs</p>
          <div className="residency-grid">
            {filtered.slice(0, visible).map((program) => <ResidencyCard key={program.id} program={program} saved={savedIds.has(program.id)} />)}
          </div>
          {filtered.length > visible && <GButton onClick={() => setVisible((value) => value + 30)}>Show more programs</GButton>}
        </>
      )}
    </GlassCard>
  );
}

function ResidencyCard({ program, saved }: { program: ResidencyProgram; saved: boolean }) {
  function toggleSaved() {
    const store = useStore.getState();
    const entries = store.profile.applicationResearch ?? [];
    const current = entries.find((entry) => entry.schoolId === program.id) ?? { schoolId: program.id, shortlisted: false, reviewedFacts: {} };
    store.updateProfile({ applicationResearch: [...entries.filter((entry) => entry.schoolId !== program.id), { ...current, shortlisted: !saved }] });
  }
  const known = REQUIREMENT_LABELS.filter(([key]) => program.requirements[key] !== UNKNOWN);
  return (
    <article className={`residency-card ${saved ? "saved" : ""}`}>
      <div className="residency-card-head">
        <Hospital size={ICON_SIZE.emphasis} aria-hidden="true" />
        <div>
          <b>{program.programName}</b>
          <small>{program.specialty}{program.isSubspecialty ? " · fellowship" : ""}</small>
        </div>
        <button type="button" className={`residency-save ${saved ? "on" : ""}`} aria-pressed={saved} aria-label={`${saved ? "Unsave" : "Save"} ${program.programName}`} onClick={toggleSaved}>
          {saved ? <BookmarkCheck size={ICON_SIZE.body} /> : <Bookmark size={ICON_SIZE.body} />}
        </button>
      </div>
      <dl className="residency-facts">
        <div><dt>Location</dt><dd>{[program.city, program.state].filter(Boolean).join(", ") || "Unknown"}</dd></div>
        <div><dt>Sponsor</dt><dd>{program.sponsorName ?? "Unknown"}</dd></div>
        <div><dt>Length</dt><dd>{program.trainingYears ? `${program.trainingYears} yr` : "Unknown"}</dd></div>
        <div><dt>Residents</dt><dd>{program.positionsFilled?.toLocaleString() ?? "Unknown"}</dd></div>
        <div><dt>Status</dt><dd>{program.accreditationStatus ?? "Unknown"}</dd></div>
        <div><dt>ACGME</dt><dd>{program.acgmeProgramId}</dd></div>
      </dl>
      <div className="residency-requirements">
        {known.length
          ? known.map(([key, label]) => <span key={key}><b>{label}:</b> {program.requirements[key]}</span>)
          : <span className="residency-unknown">Step minimums, visa sponsorship, and signals: not captured yet — check the program site.</span>}
      </div>
      <div className="residency-source">
        <span>Source: {program.sources[0]?.title ?? "ACGME listing"} · {new Date(program.sources[0]?.retrievedAt ?? "").toLocaleDateString()}</span>
        {program.website && <a href={program.website} target="_blank" rel="noopener noreferrer">Program site <ExternalLink size={ICON_SIZE.microInline} /></a>}
      </div>
    </article>
  );
}
