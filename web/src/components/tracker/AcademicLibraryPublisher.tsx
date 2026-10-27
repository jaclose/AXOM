import { useEffect, useMemo, useRef, useState } from "react";
import { FileArchive, FolderOpen, Library, Square, UploadCloud } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { isAcademicReviewer, shareAcademicCourses } from "../../lib/academicLibrary/client";
import { uploadAcademicBatch } from "../../lib/academicLibrary/batch";
import {
  PUBLICATION_INPUT_LIMITS, planPublication, publicationCatalogId, publicationJobs, readPublicationInventory,
  type PlannedCourse, type PublicationInventory,
} from "../../lib/academicLibrary/publication";
import { folderLibraryReader, zipLibraryReader, type LibraryReader } from "../../lib/privateLibrary/install";
import type { ReviewedFiling } from "../../lib/privateLibrary/types";
import { ICON_SIZE } from "../../lib/iconSize";
import { TechnicalDetails } from "../shell/TechnicalDetails";
import { GButton, GhostButton, Tag } from "../ui/primitives";

type Term = ReviewedFiling["term"];
const TERMS: Term[] = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
type CourseState =
  | { state: "published"; ready: number; files: number; keptLocal?: number; shared?: boolean; approved?: boolean; sharingError?: string }
  | { state: "failed"; message: string }
  | { state: "stopped" };

const label = (course: Pick<PlannedCourse, "term" | "module">) => `${course.term} ${course.module}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** A course is worth selecting by default when it brings a plan or practice-ready questions. */
const usefulByDefault = (course: PlannedCourse) => course.termBasis !== "proposed" && (course.sections.length > 0 || course.ready > 0);

/** Publish a prepared library as one private course per term and module. */
export function AcademicLibraryPublisher({ onPublished }: { onPublished: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const folderInput = useRef<HTMLInputElement>(null);
  const zipInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController>();
  const [library, setLibrary] = useState<{ accountId: string; name: string; read: LibraryReader; inventory: PublicationInventory }>();
  const [confirmedTerms, setConfirmedTerms] = useState<Record<string, Term>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reviewer, setReviewer] = useState(false);
  const [share, setShare] = useState(true);
  const [approve, setApprove] = useState(false);
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState<"reading" | "publishing">();
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, CourseState>>({});

  useEffect(() => {
    let active = true;
    setReviewer(false);
    if (accountId) void isAcademicReviewer(accountId).then(value => { if (active) setReviewer(value); });
    return () => { active = false; };
  }, [accountId]);
  useEffect(() => () => controller.current?.abort(), []);

  const current = library && library.accountId === accountId ? library : undefined;
  const plan = useMemo(() => current ? planPublication(current.inventory, confirmedTerms) : undefined, [current, confirmedTerms]);
  const chosen = plan?.courses.filter(course => selected.has(course.catalogId) && course.termBasis !== "proposed") ?? [];
  const terms = [...new Set(plan?.courses.map(course => course.term) ?? [])];

  async function open(name: string, reader: () => Promise<LibraryReader>) {
    if (!accountId || busy) return;
    const scope = academicAccountScope(accountId);
    const abort = new AbortController();
    controller.current = abort;
    setBusy("reading"); setError(""); setResults({}); setLibrary(undefined); setConfirmedTerms({});
    setProgress("Reading the library…");
    try {
      const read = await reader();
      const inventory = await readPublicationInventory(read, setProgress, abort.signal);
      scope.assertCurrent();
      setLibrary({ accountId, name, read, inventory });
      setSelected(new Set(planPublication(inventory).courses.filter(usefulByDefault).map(course => course.catalogId)));
      setProgress("");
    } catch (cause) {
      setProgress("");
      setError(abort.signal.aborted ? "Reading stopped. Nothing was uploaded."
        : cause instanceof Error ? cause.message : "The library could not be read.");
    } finally { scope.dispose(); setBusy(undefined); if (controller.current === abort) controller.current = undefined; }
  }

  function confirmTerm(moduleKey: string, term: Term, previous?: string) {
    if (!current) return;
    setConfirmedTerms(terms => ({ ...terms, [moduleKey]: term }));
    setSelected(ids => {
      const next = new Set(ids);
      if (previous) next.delete(previous);
      // The collection identity includes the term, so select the confirmed course.
      next.add(publicationCatalogId(current.inventory.library.id, term, moduleKey));
      return next;
    });
  }

  async function publish() {
    if (!accountId || !current || !plan || busy || !chosen.length || (share && !rights)) return;
    const scope = academicAccountScope(accountId);
    const abort = new AbortController();
    controller.current = abort;
    const courses = chosen;
    const byKey = new Map(courses.map(course => [course.catalogId, course]));
    setBusy("publishing"); setError(""); setResults({});
    try {
      const { jobs, notes } = publicationJobs(current.read, current.inventory, courses);
      const published = new Map<string, string>();
      const report = await uploadAcademicBatch(jobs, {
        signal: abort.signal,
        progress: message => {
          const split = message.indexOf(": ");
          const course = byKey.get(message.slice(0, split));
          setProgress(course ? `${label(course)}: ${message.slice(split + 2)}` : message);
        },
        onOutcome: outcome => {
          const course = byKey.get(outcome.key);
          if (!course) return;
          let next: CourseState;
          if (outcome.state === "verified") {
            published.set(outcome.receipt.collectionId, outcome.key);
            next = { state: "published", ready: outcome.receipt.readyQuestions, files: outcome.receipt.verifiedFiles,
              ...(notes.keptLocal.has(outcome.key) ? { keptLocal: notes.keptLocal.get(outcome.key) } : {}) };
          } else if (outcome.state === "superseded") {
            next = { state: "failed", message: "A newer version of this course is already active in your account. Nothing was replaced." };
          } else if (outcome.state === "cancelled") next = { state: "stopped" };
          else if (outcome.state === "auth-blocked") next = { state: "failed", message: outcome.message };
          else if (outcome.state === "duplicate-input") next = { state: "failed", message: "This course repeats another course in the same library." };
          else next = { state: "failed", message: notes.failures.get(outcome.key) ?? outcome.message };
          setResults(states => ({ ...states, [outcome.key]: next }));
        },
      });
      if (share && published.size && !abort.signal.aborted) {
        setProgress("Sharing the published courses…");
        const outcomes = await shareAcademicCourses([...published.keys()], accountId,
          { approve: approve && reviewer, assertCurrent: scope.assertCurrent, signal: abort.signal });
        setResults(states => {
          const next = { ...states };
          for (const outcome of outcomes) {
            const key = published.get(outcome.collectionId);
            const state = key ? next[key] : undefined;
            if (key && state?.state === "published") next[key] = { ...state, shared: outcome.shared, approved: outcome.approved,
              ...(outcome.error ? { sharingError: outcome.error } : {}) };
          }
          return next;
        });
      }
      setSelected(ids => new Set([...ids].filter(id => !report.outcomes.some(outcome => outcome.key === id && outcome.state === "verified"))));
      const missed = report.expected - report.verified;
      setProgress(abort.signal.aborted ? "Publishing stopped. Courses already published stay in your account."
        : `${plural(report.verified, "course")} published and verified.${missed ? ` ${plural(missed, "course")} not published. See each course for the reason.` : ""}`);
      if (report.verified) onPublished();
    } catch (cause) {
      setProgress("");
      setError(cause instanceof Error ? cause.message : "Publishing could not start. Nothing was uploaded.");
    } finally { scope.dispose(); setBusy(undefined); if (controller.current === abort) controller.current = undefined; }
  }

  if (!accountId) return null;
  return <section className="academic-publisher" aria-label="Publish a prepared library" aria-busy={Boolean(busy)}>
    <div className="academic-publisher-heading">
      <Library size={ICON_SIZE.control} aria-hidden="true" />
      <div><h3>Publish a prepared library</h3>
        <p>Choose the folder AXOM prepared from your course files. AXOM makes one course for each term and module, checks every question and image, and saves each course to your account.</p></div>
    </div>
    <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} aria-label="Prepared library folder" onChange={event => {
      const files = [...(event.target.files ?? [])];
      event.target.value = "";
      if (files.length) void open((files[0].webkitRelativePath ?? "").split("/")[0] || "Selected folder", async () => folderLibraryReader(files, PUBLICATION_INPUT_LIMITS));
    }} />
    <input ref={zipInput} type="file" hidden accept=".zip" aria-label="Prepared library ZIP" onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void open(file.name, () => zipLibraryReader(file));
    }} />
    <div className="academic-publisher-actions">
      <GButton disabled={Boolean(busy)} onClick={() => folderInput.current?.click()}><FolderOpen size={ICON_SIZE.emphasis} /> Choose library folder</GButton>
      <GButton disabled={Boolean(busy)} onClick={() => zipInput.current?.click()}><FileArchive size={ICON_SIZE.emphasis} /> Choose library ZIP</GButton>
      {busy && <GhostButton onClick={() => controller.current?.abort()}><Square size={ICON_SIZE.body} /> Stop</GhostButton>}
    </div>

    {plan && current && <div className="academic-publisher-plan">
      <p className="academic-publisher-summary"><b>{current.name}</b>: {plural(plan.courses.length, "course")} found. {plural(chosen.length, "course")} selected to publish.</p>
      {terms.map(term => <fieldset key={term} className="academic-publisher-term" disabled={Boolean(busy)}>
        <legend>{term}</legend>
        {plan.courses.filter(course => course.term === term).map(course => {
          const result = results[course.catalogId];
          const proposed = course.termBasis === "proposed";
          return <article key={course.catalogId} className="academic-publisher-course" data-state={result?.state ?? (proposed ? "needs-term" : "ready")}>
            <label className="academic-publisher-choice">
              <input type="checkbox" checked={selected.has(course.catalogId) && !proposed} disabled={proposed}
                onChange={event => setSelected(ids => {
                  const next = new Set(ids);
                  if (event.target.checked) next.add(course.catalogId); else next.delete(course.catalogId);
                  return next;
                })} />
              <span><b>{course.module}</b><small>{course.sections.length ? `${plural(course.sections.length, "plan section")} · ${plural(course.activities, "activity", "activities")}` : "No weekly plan"}</small></span>
            </label>
            <p className="academic-publisher-facts">
              <span>{plural(course.ready, "ready question")}</span>
              {course.review > 0 && <span>{course.review} awaiting review</span>}
              <span>{plural(course.banks, "question set")}</span>
              {course.originals > 0 && <span>{plural(course.originals, "source file")}</span>}
            </p>
            {proposed ? <div className="academic-publisher-confirm">
              <p>{course.proposalReason} Confirm the term to publish this course.</p>
              <ConfirmTerm course={course} onConfirm={term => confirmTerm(course.moduleKey, term, course.catalogId)} />
            </div> : <p className="academic-publisher-basis">{course.termBasis === "plan" ? "Term stated by the course plan."
              : course.termBasis === "confirmed" ? "Term you confirmed." : "Term from its question files. Questions keep the weeks their sources state."}</p>}
            {result && <CourseResult result={result} />}
          </article>;
        })}
      </fieldset>)}
      {plan.blocked.length > 0 && <details className="academic-publisher-notes">
        <summary>{plural(plan.blocked.length, "course plan")} need attention</summary>
        <ul>{plan.blocked.map(entry => <li key={entry.name}><b>{entry.name}</b>: {entry.reason}</li>)}</ul>
        {[...new Set(plan.blocked.flatMap(entry => entry.needsTerm && entry.moduleKey ? [entry.moduleKey] : []))]
          .map(moduleKey => <div key={moduleKey} className="academic-publisher-confirm">
            <p>Choose the term for {plan.blocked.find(entry => entry.moduleKey === moduleKey)!.name}.</p>
            <ConfirmTerm label={`Term for ${plan.blocked.find(entry => entry.moduleKey === moduleKey)!.name}`}
              onConfirm={term => confirmTerm(moduleKey, term)} />
          </div>)}
      </details>}
      {plan.excluded.length > 0 && <details className="academic-publisher-notes">
        <summary>{plural(plan.excluded.length, "source file")} stay on this device</summary>
        <ul>{plan.excluded.map(entry => <li key={entry.id}><b>{entry.name}</b>: {entry.reason}</li>)}</ul>
      </details>}

      <fieldset className="academic-publisher-options" disabled={Boolean(busy)}>
        <legend>After uploading</legend>
        <label><input type="checkbox" checked={share} onChange={event => { setShare(event.target.checked); if (!event.target.checked) setApprove(false); }} />
          <span>Share with every signed-in AXOM account</span></label>
        {reviewer && <label><input type="checkbox" checked={approve} disabled={!share} onChange={event => setApprove(event.target.checked)} />
          <span>Approve sharing now. You are an academic reviewer.</span></label>}
        {share && <label><input type="checkbox" checked={rights} onChange={event => setRights(event.target.checked)} />
          <span>I have the right to share this course material with every AXOM account.</span></label>}
        <p>{share && !approve ? "Shared courses stay private until an academic reviewer approves them. " : ""}Answers, notes and progress are never shared.</p>
      </fieldset>
      <GButton variant="primary" disabled={Boolean(busy) || !chosen.length || (share && !rights)} onClick={() => void publish()}>
        <UploadCloud size={ICON_SIZE.emphasis} /> {busy === "publishing" ? "Publishing…" : `Publish ${plural(chosen.length, "course")}`}
      </GButton>
      <TechnicalDetails label="Library details">
        <p>Library {current.inventory.library.id}, version {current.inventory.library.version}. Each course is saved to its own collection, so publishing again updates the same course.</p>
        <ul>{plan.courses.map(course => <li key={course.catalogId}><code>{course.catalogId}</code></li>)}</ul>
      </TechnicalDetails>
    </div>}
    {progress && <p role="status" aria-live="polite">{progress}</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

function ConfirmTerm({ course, label: name, onConfirm }: { course?: PlannedCourse; label?: string; onConfirm: (term: Term) => void }) {
  const [term, setTerm] = useState<Term | "">(course?.term ?? "");
  return <div className="academic-publisher-term-choice">
    <label><span className="sr-only">{name ?? `Term for ${course?.module ?? "this course"}`}</span>
      <select value={term} onChange={event => setTerm(event.target.value as Term | "")}>
        <option value="">Choose a term</option>
        {TERMS.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
    <GButton size="sm" disabled={!term} onClick={() => { if (term) onConfirm(term); }}>{term ? `Confirm ${term}` : "Confirm"}</GButton>
  </div>;
}

function CourseResult({ result }: { result: CourseState }) {
  if (result.state === "stopped") return <p className="academic-publisher-result"><Tag tone="neutral">Stopped</Tag> Not published.</p>;
  if (result.state === "failed") return <p className="academic-publisher-result"><Tag tone="red">Not published</Tag> {result.message}</p>;
  return <p className="academic-publisher-result">
    <Tag tone="green">Published</Tag>
    {result.approved ? <Tag tone="gold">Shared with everyone</Tag> : result.shared ? <Tag tone="neutral">Sharing awaits review</Tag> : null}
    {" "}{plural(result.ready, "ready question")} and {plural(result.files, "file")} verified.
    {result.keptLocal ? ` ${plural(result.keptLocal, "source file")} stay on this device to fit the course size limit.` : ""}
    {result.sharingError ? ` ${result.sharingError}` : ""}
  </p>;
}
