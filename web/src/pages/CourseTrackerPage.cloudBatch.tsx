import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account/accountStore";
import { GlassCard, GButton } from "../components/ui/primitives";
import {
  academicReconciliationLedger, uploadAcademicBatch,
  type AcademicBatchJob, type AcademicBatchOutcome, type AcademicBatchReport,
} from "../lib/academicLibrary/batch";
import { prepareAcademicUpload, type AcademicUnscheduledScope } from "../lib/academicLibrary/upload";
import { readCatalog, zipLibraryReader } from "../lib/privateLibrary/install";
import { SGU_CURRICULUM } from "../lib/curricula";

/** A prepared ZIP is private until the signed-in owner explicitly uploads it. */
interface StagedAcademicZip {
  key: string;
  /** Unique ordinal + filename, including repeated filenames within one batch. */
  reviewLabel: string;
  file: File;
  bankSources: number;
  declaredReady: number;
  declaredReview: number;
  /** Source-only packages lack a verified course template; never infer term/week. */
  needsSourceReview: boolean;
  /** Review hints supplied by the source manifest, not authoritative school evidence. */
  declaredModules: string[];
}

const BYTES_PER_MIB = 1024 * 1024;
const MAX_JOBS = 100;
const TERMS: AcademicUnscheduledScope["term"][] = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
interface ReviewedSourceScope {
  term: AcademicUnscheduledScope["term"] | "";
  module: string;
  checkedAgainstSource: boolean;
}
/** Only case, spaces and benign hyphenation are interchangeable. Never erase
 * slash, plus, ampersand, punctuation, or an explicit combined-module label. */
const SINGLE_MODULES = new Set([...SGU_CURRICULUM.terms.flatMap(term =>
  term.courses.flatMap(course => course.modules)), "MI"]
  .map(name => name.toLowerCase().replace(/[ -]+/g, "")));
const canonicalModule = (value: string): string | undefined => {
  const name = value.trim();
  if (!name || name.length > 80 || !/^[a-z0-9 -]+$/i.test(name)
    || /\b(?:and|or|plus|versus|vs)\b/i.test(name)) return undefined;
  // GOER-NCRS is two recognized modules, not benign punctuation in GOERNCRS.
  const parts = name.split(/\s*-\s*/);
  if (parts.length > 1 && parts.filter(part => SINGLE_MODULES.has(part.trim().toLowerCase().replace(/ +/g, ""))).length > 1) return undefined;
  return name.toLowerCase().replace(/[ -]+/g, "");
};
const isSupportedModule = (value: string): boolean => canonicalModule(value) !== undefined;
const declaredModuleReview = (item: StagedAcademicZip): {
  blocked: boolean;
  singleHint?: string;
} => {
  const declared = item.declaredModules.map(canonicalModule);
  if (declared.some(module => module === undefined)) return { blocked: true };
  const distinct = [...new Set(declared as string[])];
  return distinct.length > 1
    ? { blocked: true }
    : { blocked: false, singleHint: distinct[0] };
};
const reviewedModuleDiffersFromHint = (
  item: StagedAcademicZip,
  review: ReviewedSourceScope | undefined,
): boolean => {
  const declared = declaredModuleReview(item);
  const reviewed = review ? canonicalModule(review.module) : undefined;
  return !declared.blocked && Boolean(declared.singleHint && reviewed
    && declared.singleHint !== reviewed);
};
const isConfirmedScope = (item: StagedAcademicZip, review: ReviewedSourceScope | undefined): boolean => {
  if (!item.needsSourceReview) return true;
  if (!review?.checkedAgainstSource || !TERMS.includes(review.term as AcademicUnscheduledScope["term"])
    || !isSupportedModule(review.module)) return false;
  // A single source hint can be stale and may be corrected after the reviewer
  // checks the original. Conflicting or combined hints still require a split.
  return !declaredModuleReview(item).blocked;
};
const summaryStatus: Record<AcademicBatchOutcome["state"], string> = {
  verified: "Authenticated bank and figure bytes re-read",
  superseded: "Not counted — a newer revision is active",
  "duplicate-input": "Duplicate of an already verified input",
  failed: "Upload/readback incomplete — safe to retry",
  cancelled: "Cancelled; pending inputs preserved locally",
  "auth-blocked": "Account authorization changed; sign in again",
};

/**
 * A thin UI over Agent3's canonical private batch engine.
 * The browser File objects remain local until explicit consent and upload.
 * This never creates public Storage objects or bypasses owner authentication.
 */
export function PrivateAcademicBatchUpload() {
  const accountId = useAccount((state) => state.user?.id);
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [prepared, setPrepared] = useState<StagedAcademicZip[]>([]);
  const [sourceScopes, setSourceScopes] = useState<Record<string, ReviewedSourceScope>>({});
  const [stagedForOwner, setStagedForOwner] = useState<string>();
  const [confirmed, setConfirmed] = useState(false);
  const [phase, setPhase] = useState<"idle" | "reviewing" | "uploading">("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [outcomes, setOutcomes] = useState<AcademicBatchOutcome[]>([]);
  const [report, setReport] = useState<AcademicBatchReport>();

  // A changed account invalidates both staged private files and any running
  // operation. The batch engine separately rechecks the owner on the server.
  useEffect(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
    setPrepared([]); setSourceScopes({}); setStagedForOwner(undefined);
    setConfirmed(false); setOutcomes([]); setReport(undefined);
    setMessage(""); setError("");
    setPhase("idle");
  }, [accountId]);

  // Signed-out students can audit an inert ZIP manifest, but their staged
  // files cannot carry over into another owner's authenticated session.
  const ownerKey = accountId ?? "anonymous-local-preview";
  const staged = stagedForOwner === ownerKey ? prepared : [];
  const scopesVerified = staged.every(item => isConfirmedScope(item, sourceScopes[item.key]));
  const status = (state: AcademicBatchOutcome["state"]) => summaryStatus[state];
  const allBytes = staged.reduce((sum, item) => sum + item.file.size, 0);

  function changeSourceScope(key: string, update: Partial<ReviewedSourceScope>) {
    setSourceScopes(current => {
      const prior = current[key] ?? { term: "", module: "", checkedAgainstSource: false };
      return { ...current, [key]: {
        ...prior, ...update,
        checkedAgainstSource: update.checkedAgainstSource ?? false,
      } };
    });
    // Changing the reviewed source identity invalidates the prior private
    // cloud receipt, outcome list, success status AND export eligibility.
    setConfirmed(false);
    setReport(undefined);
    setOutcomes([]);
    setMessage("");
    setError("");
  }

  async function select(files: File[]) {
    if (phase !== "idle") return;
    const run = ++generation.current;
    const selectedOwnerKey = ownerKey;
    const stillCurrent = () => run === generation.current
      && (useAccount.getState().user?.id ?? "anonymous-local-preview") === selectedOwnerKey;
    setPrepared([]); setSourceScopes({}); setConfirmed(false); setReport(undefined);
    setOutcomes([]); setMessage(""); setError("");
    if (files.length < 1 || files.length > MAX_JOBS) {
      setError("Choose 1–100 reviewed AXOM ZIP packages per private batch.");
      return;
    }
    setPhase("reviewing");
    try {
      const stagedItems: StagedAcademicZip[] = [];
      for (const [index, file] of files.entries()) {
        if (!/\.zip$/i.test(file.name)) throw new Error("Every selected academic package must be an AXOM .zip file.");
        setMessage(`Reading private package manifest ${index + 1} of ${files.length}…`);
        const reader = await zipLibraryReader(file);
        if (!stillCurrent()) return;
        const raw = JSON.parse(new TextDecoder().decode(await reader("catalog.json"))) as unknown;
        if (!stillCurrent()) return;
        const catalog = readCatalog(raw);
        const banks = catalog.sources.filter((source) => Boolean(source.bankFile));
        if (!banks.length) throw new Error(`${file.name} contains no prepared bank source; use the existing course-template importer for lectures.`);
        if (catalog.templates.length > 1) throw new Error(`${file.name} contains several course templates. Split the package by course before private upload.`);
        // This is NOT school-syllabus proof. A reviewer must verify the actual
        // original source and supply term/module explicitly for every ZIP
        // lacking a complete, reviewed course plan.
        // Include original-only/reference sources as well: an unrelated NCRS
        // original cannot ride along with a GOER bank unnoticed.
        const declaredModules = [...new Set(catalog.sources.flatMap(source =>
          typeof source.module === "string" && source.module.trim() ? [source.module.trim()] : []))];
        stagedItems.push({
          key: `source-${index + 1}-${file.name.slice(0, 90)}`,
          reviewLabel: `Package ${index + 1}: ${file.name}`,
          file, bankSources: banks.length,
          needsSourceReview: catalog.templates.length === 0, declaredModules,
          declaredReady: banks.reduce((sum, source) => sum + source.ready, 0),
          declaredReview: banks.reduce((sum, source) => sum + source.review, 0),
        });
      }
      if (!stillCurrent()) return;
      setStagedForOwner(selectedOwnerKey);
      setPrepared(stagedItems);
      setMessage(`${stagedItems.length} prepared packages staged on this device. Declared counts are not independent answer-key proof or cloud evidence. Only bank and figure bytes become authenticated after readback.`);
    } catch (cause) {
      if (!stillCurrent()) return;
      setPrepared([]); setStagedForOwner(undefined);
      setError(cause instanceof Error ? cause.message : "The private package manifest could not be inspected.");
      setMessage("");
    } finally { if (stillCurrent()) setPhase("idle"); }
  }

  async function upload() {
    if (!accountId || phase !== "idle" || !staged.length || !confirmed || !scopesVerified) return;
    setPhase("uploading"); setError(""); setOutcomes([]); setReport(undefined);
    const abort = new AbortController();
    controller.current = abort;
    const account = accountId;
    const run = generation.current;
    const stillCurrent = () => run === generation.current && useAccount.getState().user?.id === account;
    try {
      const jobs: AcademicBatchJob[] = staged.map((item) => {
        const reviewed = sourceScopes[item.key];
        // Capture immutable reviewer scope with the exact source ZIP. Never
        // invent an academic week or inherit a module from the filename.
        if (!isConfirmedScope(item, reviewed)) throw new Error("Review the original source term and module for every unscheduled package before upload.");
        const scope: AcademicUnscheduledScope | undefined = item.needsSourceReview ? {
          term: reviewed!.term as AcademicUnscheduledScope["term"],
          module: reviewed!.module.trim(),
          evidence: "human-reviewed",
        } : undefined;
        return {
          key: item.key,
          prepare: async (signal) => {
            if (signal?.aborted) throw new DOMException("Private upload cancelled", "AbortError");
            const reader = await zipLibraryReader(item.file);
            if (signal?.aborted) throw new DOMException("Private upload cancelled", "AbortError");
            return prepareAcademicUpload(reader, scope);
          },
        };
      });
      const outcome = await uploadAcademicBatch(jobs, {
        signal: abort.signal,
        progress: (progress) => { if (stillCurrent()) setMessage(progress); },
        onOutcome: (row) => { if (stillCurrent()) setOutcomes((previous) => [...previous, row]); },
      });
      // Never display one owner's result under a newly signed-in account.
      // The backend already rechecks actual authentication per source.
      if (!stillCurrent()) return;
      setReport(outcome);
      setMessage(`${outcome.verified} collections independently re-read in your private cloud account · ${outcome.verifiedReadyQuestions} locally assessed practice-ready questions with authenticated bytes re-read · ${outcome.reviewRequired} review-held · ${outcome.verifiedFigures} figure references checked · originals: ${outcome.cloudVerifiedOriginals} cloud-re-read, ${outcome.localOnlyOriginals} local-only, ${outcome.originalsNotProvided} not provided. ${outcome.failed + outcome.authBlocked + outcome.cancelled} interrupted or failed; retry without discarding the original packages.`);
    } catch (cause) {
      if (stillCurrent()) setError(cause instanceof Error ? cause.message : "Private upload could not be verified.");
    } finally {
      if (controller.current === abort) controller.current = null;
      if (stillCurrent()) setPhase("idle");
    }
  }

  function exportVerifiedLedger() {
    if (!report || !report.verified) return;
    let url: string | undefined;
    try {
      const ledger = academicReconciliationLedger(report);
      if (!ledger.sources.length) throw new Error("No owner-authenticated academic readback evidence was available.");
      const blob = new Blob([JSON.stringify({ format: "axom-owner-private-academic-readback-v2", ...ledger }, null, 2)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "axom-private-academic-readback.json";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click(); a.remove();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authenticated receipt export failed.");
    } finally {
      if (url) { const previous = url; window.setTimeout(() => URL.revokeObjectURL(previous), 1000); }
    }
  }

  return <GlassCard pad className="tracker-private-batch">
    <details>
      <summary><b>Private academic cloud batch</b><span className="sub">Reviewed ZIP sources · owner-authenticated readback</span></summary>
      <p className="sub">Select 1–100 prepared AXOM ZIP packages. Their manifests are checked locally before any upload. For each ZIP without a reviewed course plan, confirm the exact term and module from the original source. No week is inferred from filenames, ZIP folders or an AXOM question-bank filing label. The academic batch engine then saves privately, verifies bank/figure bytes through your signed-in account, and records whether each original was cloud-re-read, local-only, or not provided. This does not publish protected school material.</p>
      {!accountId && <p className="sub" role="note">You are not signed in. You can inspect ZIP manifests privately on this device; to upload later, sign in and select your files again. No authenticated cloud receipt exists in preview mode.</p>}
      <input ref={input} type="file" accept=".zip,application/zip" multiple hidden
        aria-label="Choose prepared private academic ZIP packages"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length) void select(files);
        }} />
      <div className="tracker-private-batch-actions">
        <GButton size="sm" disabled={phase !== "idle"} onClick={() => input.current?.click()}>
          {phase === "reviewing" ? "Reviewing manifests…" : "Choose prepared ZIP packages"}
        </GButton>
        {phase === "uploading" && <GButton size="sm" onClick={() => controller.current?.abort()}>Cancel pending uploads</GButton>}
      </div>
      {staged.length > 0 && <div className="tracker-private-batch-review">
        <p className="sub"><b>{staged.length}</b> prepared packages · {(allBytes / BYTES_PER_MIB).toFixed(1)} MiB selected · {staged.reduce((sum, item) => sum + item.bankSources, 0)} declared sources · {staged.reduce((sum, item) => sum + item.declaredReady, 0)} declared ready · {staged.reduce((sum, item) => sum + item.declaredReview, 0)} declared review. Declared is not cloud-verified.</p>
        <ul>{staged.map((item) => <li key={item.key}>
          <b>{item.reviewLabel}</b>
          <small>{item.bankSources} source banks · {item.declaredReady} declared ready · {item.declaredReview} declared review</small>
          {item.needsSourceReview ? <fieldset disabled={phase !== "idle"}
            aria-label={`Source-supported classification for ${item.reviewLabel}`} className="stack gap8">
            <legend>Review the original source — week unassigned</legend>
            <small>This ZIP has no verified course template. Check the term and module against the original academic source or syllabus, not a filename, folder, or inferred week. No course activities are created.</small>
            {item.declaredModules.length > 0 && <small>
              Package-declared module hints (not proof): {item.declaredModules.join(", ")}.
              {item.declaredModules.some(module => canonicalModule(module) === undefined)
                || new Set(item.declaredModules.map(canonicalModule)).size > 1
                ? " Conflicting source modules require correcting or splitting this ZIP before upload."
                : " Compare this hint with the original material. If it is stale, keep it as evidence and enter the corrected module."}
            </small>}
            <label className="stack gap6">Source-supported academic term
              <select className="scope-select" aria-label={`Verified term for ${item.reviewLabel}`}
                value={sourceScopes[item.key]?.term ?? ""}
                onChange={event => changeSourceScope(item.key, {
                  term: event.target.value as AcademicUnscheduledScope["term"] | "",
                })}>
                <option value="">Choose term verified from original source</option>
                {TERMS.map(term => <option key={term} value={term}>{term}</option>)}
              </select>
            </label>
            <label className="stack gap6">Source-supported module
              <input className="field" type="text" maxLength={80} autoComplete="off"
                aria-label={`Verified module for ${item.reviewLabel}`}
                placeholder="e.g. GOER, NCRS, RHPS (check original)"
                value={sourceScopes[item.key]?.module ?? ""}
                onChange={event => changeSourceScope(item.key, { module: event.target.value })} />
            </label>
            {reviewedModuleDiffersFromHint(item, sourceScopes[item.key]) && <small role="note">
              Reviewed module differs from the package hint. The original hint remains evidence;
              after original-source confirmation, the reviewed filing controls placement.
            </small>}
            {["Term 4", "Term 5"].includes(sourceScopes[item.key]?.term ?? "") && <small>
              Check course/cohort version: the reviewed source catalog lists PCM 500/PCM 501
              and MI, while older AXOM shells may say PPM 500/PPM 501 or NMI.
              These are not interchangeable source proofs. Do not silently refile.
            </small>}
            <label className="row gap8">
              <input type="checkbox"
                aria-label={`I verified original source for ${item.reviewLabel}`}
                checked={sourceScopes[item.key]?.checkedAgainstSource ?? false}
                onChange={event => changeSourceScope(item.key, { checkedAgainstSource: event.target.checked })} />
              <span>I checked this term and module against the original source. Its academic week remains unassigned.</span>
            </label>
            {!isConfirmedScope(item, sourceScopes[item.key]) && <small>
              Source-only preparation is held until term, module and original-source confirmation agree.
            </small>}
          </fieldset> : <small>Includes a course template. Its own reviewed term/module identity is validated during preparation; no manual override is applied.</small>}
        </li>)}</ul>
        {accountId ? <>
          <label className="tracker-private-batch-consent">
            <input type="checkbox" checked={confirmed} disabled={phase !== "idle" || !scopesVerified} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I reviewed these packages and confirm I have permission to store their contents in my private academic account. I understand this does not grant public sharing rights.</span>
          </label>
          <GButton size="sm" disabled={phase !== "idle" || !confirmed || !scopesVerified}
            onClick={() => void upload()}>{phase === "uploading" ? "Verifying cloud readback…" : `Upload ${staged.length} privately and verify`}</GButton>
        </> : <p className="sub" role="note">Sign in and select these files again before private upload. There is no public upload option.</p>}
      </div>}
      {outcomes.length > 0 && <ul className="tracker-private-batch-outcomes" aria-label="Private source upload outcomes">
        {outcomes.map((item) => <li key={item.key}>
          <b>{item.key}</b><span>{status(item.state)}</span>
        </li>)}
      </ul>}
      {report && <div className="tracker-private-batch-result">
        <b>{report.verified} owner-authenticated revisions verified · {report.pending} pending</b>
        <small>{report.verifiedReadyQuestions} locally assessed practice-ready questions with bank/figure bytes re-read · {report.reviewRequired} review-held questions · {report.verifiedFigures} figure references checked</small>
        <small>Original sources: {report.cloudVerifiedOriginals} cloud-re-read · {report.localOnlyOriginals} local-only · {report.originalsNotProvided} not provided</small>
        <GButton size="tiny" disabled={!report.verified} onClick={exportVerifiedLedger}>Export academic readback evidence</GButton>
      </div>}
      {message && <p role="status" className="sub">{message}</p>}
      {error && <p role="alert" className="sub">{error}</p>}
      <p className="sub">A local ZIP selection, an upload request, or a service-role management count is not proof of durable cloud availability. Only the account-authenticated bank/figure readback reported above certifies stored practice content; original-source proof is limited to originals explicitly marked cloud-re-read. New-device login verification remains a separate integration gate.</p>
    </details>
  </GlassCard>;
}
