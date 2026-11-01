import { useEffect, useMemo, useRef, useState } from "react";
import { FileArchive, FolderOpen, Library, ListChecks, Square, UploadCloud } from "lucide-react";
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
/** Source files a course leaves on this device because of type or size limits. */
interface KeptFiles { keptLocal?: number; overLimit?: number }
type CourseState =
  | { state: "checked"; ready: number; review: number; files: number; bytes: number } & KeptFiles
  | { state: "published"; ready: number; files: number; shared?: boolean; approved?: boolean; sharingError?: string } & KeptFiles
  | { state: "failed"; message: string; during: "check" | "publish" }
  | { state: "stopped" };
/** uploadAcademicBatch accepts at most 100 jobs per run. */
const BATCH_SIZE = 100;

const label = (course: Pick<PlannedCourse, "term" | "module">) => `${course.term} ${course.module}`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [busy, setBusy] = useState<"reading" | "checking" | "publishing">();
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

  /** Prepare every selected course exactly as publishing does, without uploading anything. */
  async function check() {
    if (!accountId || !current || busy || !chosen.length) return;
    const scope = academicAccountScope(accountId);
    const abort = new AbortController();
    controller.current = abort;
    const courses = chosen;
    setBusy("checking"); setError(""); setResults({});
    try {
      const { jobs, notes } = publicationJobs(current.read, current.inventory, courses);
      const sources = new Map<string, string>();
      const failed = new Set<string>();
      for (const [index, job] of jobs.entries()) {
        if (abort.signal.aborted) break;
        const course = courses[index];
        setProgress(`Checking ${label(course)} · ${index + 1} of ${jobs.length}`);
        let next: CourseState;
        try {
          const upload = await job.prepare(abort.signal);
          // Publishing refuses a source that another course in the run already holds.
          const repeated = upload.provenance.sourceChecksums.find(sha => sources.has(sha));
          if (repeated) throw new Error(`It shares a source file with ${sources.get(repeated)}. Each source can be published in one course only.`);
          for (const sha of upload.provenance.sourceChecksums) sources.set(sha, label(course));
          next = { state: "checked", ready: Number(upload.metadata.ready_questions), review: Number(upload.metadata.review_questions),
            files: upload.files.length, bytes: upload.files.reduce((sum, file) => sum + file.byte_size, 0),
            ...kept(notes.keptLocal.get(job.key), upload.localOnlyOriginals.length) };
        } catch (cause) {
          if (abort.signal.aborted) break;
          failed.add(job.key);
          next = { state: "failed", during: "check",
            message: notes.failures.get(job.key) ?? (cause instanceof Error ? cause.message : "This course could not be prepared.") };
        }
        scope.assertCurrent();
        setResults(states => ({ ...states, [job.key]: next }));
      }
      if (abort.signal.aborted) {
        setProgress("Checking stopped. Nothing was uploaded.");
        return;
      }
      if (failed.size) setSelected(ids => new Set([...ids].filter(id => !failed.has(id))));
      setProgress(failed.size
        ? `${jobs.length - failed.size} of ${plural(jobs.length, "course")} ready to publish. ${plural(failed.size, "course")} ${failed.size === 1 ? "needs" : "need"} attention and ${failed.size === 1 ? "was" : "were"} unselected. Nothing was uploaded.`
        : `${jobs.length === 1 ? "The course is" : `All ${jobs.length} courses are`} ready to publish. Nothing was uploaded.`);
    } catch (cause) {
      setProgress("");
      setError(cause instanceof Error ? cause.message : "The check could not finish. Nothing was uploaded.");
    } finally { scope.dispose(); setBusy(undefined); if (controller.current === abort) controller.current = undefined; }
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
      let blocked = false;
      for (let start = 0; start < jobs.length && !blocked && !abort.signal.aborted; start += BATCH_SIZE) {
        const report = await uploadAcademicBatch(jobs.slice(start, start + BATCH_SIZE), {
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
                ...kept(notes.keptLocal.get(outcome.key), outcome.receipt.localOnlyOriginals.length) };
            } else if (outcome.state === "superseded") {
              next = { state: "failed", during: "publish", message: "A newer version of this course is already active in your account. Nothing was replaced." };
            } else if (outcome.state === "cancelled") next = { state: "stopped" };
            else if (outcome.state === "auth-blocked") next = { state: "failed", during: "publish", message: outcome.message };
            else if (outcome.state === "duplicate-input") next = { state: "failed", during: "publish", message: "This course repeats another course in the same library." };
            else next = { state: "failed", during: "publish", message: notes.failures.get(outcome.key) ?? outcome.message };
            setResults(states => ({ ...states, [outcome.key]: next }));
          },
        });
        blocked = report.authBlocked > 0;
      }
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
      const verified = new Set(published.values());
      setSelected(ids => new Set([...ids].filter(id => !verified.has(id))));
      const missed = jobs.length - verified.size;
      setProgress(abort.signal.aborted ? "Publishing stopped. Courses already published stay in your account."
        : `${plural(verified.size, "course")} published and verified.${missed ? ` ${plural(missed, "course")} not published. See each course for the reason.` : ""}`);
      if (verified.size) onPublished();
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
      {busy === "reading" && <GhostButton onClick={() => controller.current?.abort()}><Square size={ICON_SIZE.body} /> Stop</GhostButton>}
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
      <p className="academic-publisher-hint">Checking reads and verifies every selected course on this device, exactly as publishing will. Nothing is uploaded until you publish.</p>
      <div className="academic-publisher-actions">
        <GButton disabled={Boolean(busy) || !chosen.length} onClick={() => void check()}>
          <ListChecks size={ICON_SIZE.emphasis} /> {busy === "checking" ? "Checking…" : `Check ${plural(chosen.length, "course")}`}
        </GButton>
        <GButton variant="primary" disabled={Boolean(busy) || !chosen.length || (share && !rights)} onClick={() => void publish()}>
          <UploadCloud size={ICON_SIZE.emphasis} /> {busy === "publishing" ? "Publishing…" : `Publish ${plural(chosen.length, "course")}`}
        </GButton>
        {(busy === "checking" || busy === "publishing") && <GhostButton onClick={() => controller.current?.abort()}><Square size={ICON_SIZE.body} /> Stop</GhostButton>}
      </div>
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

function kept(keptLocal: number | undefined, overLimit: number): KeptFiles {
  return { ...(keptLocal ? { keptLocal } : {}), ...(overLimit ? { overLimit } : {}) };
}

function keptNote({ keptLocal, overLimit }: KeptFiles, future: boolean) {
  const stay = (count: number) => future ? "will stay" : count === 1 ? "stays" : "stay";
  return `${keptLocal ? ` ${plural(keptLocal, "source file")} ${stay(keptLocal)} on this device because the file type or course size limit prevents upload.` : ""}${
    overLimit ? ` ${plural(overLimit, "source file")} over 50 MB ${stay(overLimit)} on this device.` : ""}`;
}

function CourseResult({ result }: { result: CourseState }) {
  if (result.state === "stopped") return <p className="academic-publisher-result"><Tag tone="neutral">Stopped</Tag> Not published.</p>;
  if (result.state === "failed") return <p className="academic-publisher-result"><Tag tone="red">{result.during === "check" ? "Needs attention" : "Not published"}</Tag> {result.message}</p>;
  if (result.state === "checked") return <p className="academic-publisher-result">
    <Tag>Ready to publish</Tag>
    {" "}{plural(result.ready, "ready question")}{result.review ? `, ${result.review} awaiting review,` : ""} and {plural(result.files, "file")} checked ({fileSize(result.bytes)}).
    {keptNote(result, true)}
  </p>;
  return <p className="academic-publisher-result">
    <Tag tone="green">Published</Tag>
    {result.approved ? <Tag tone="gold">Shared with everyone</Tag> : result.shared ? <Tag tone="neutral">Sharing awaits review</Tag> : null}
    {" "}{plural(result.ready, "ready question")} and {plural(result.files, "file")} verified.
    {keptNote(result, false)}
    {result.sharingError ? ` ${result.sharingError}` : ""}
  </p>;
}
