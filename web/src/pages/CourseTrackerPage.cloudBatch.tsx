import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account/accountStore";
import { GlassCard, GButton } from "../components/ui/primitives";
import {
  academicReconciliationLedger, uploadAcademicBatch,
  type AcademicBatchJob, type AcademicBatchOutcome, type AcademicBatchReport,
} from "../lib/academicLibrary/batch";
import { prepareAcademicUpload } from "../lib/academicLibrary/upload";
import { readCatalog, zipLibraryReader } from "../lib/privateLibrary/install";

/** A prepared ZIP is private until the signed-in owner explicitly uploads it. */
interface StagedAcademicZip {
  key: string;
  file: File;
  bankSources: number;
  declaredReady: number;
  declaredReview: number;
}

const BYTES_PER_MIB = 1024 * 1024;
const MAX_JOBS = 100;
const summaryStatus: Record<AcademicBatchOutcome["state"], string> = {
  verified: "Verified by owner-authenticated source/figure readback",
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
    setPrepared([]); setStagedForOwner(undefined);
    setConfirmed(false); setOutcomes([]); setReport(undefined);
    setMessage(""); setError("");
    setPhase("idle");
  }, [accountId]);

  // Signed-out students can audit an inert ZIP manifest, but their staged
  // files cannot carry over into another owner's authenticated session.
  const ownerKey = accountId ?? "anonymous-local-preview";
  const staged = stagedForOwner === ownerKey ? prepared : [];
  const status = (state: AcademicBatchOutcome["state"]) => summaryStatus[state];
  const allBytes = staged.reduce((sum, item) => sum + item.file.size, 0);

  async function select(files: File[]) {
    if (phase !== "idle") return;
    const run = ++generation.current;
    const selectedOwnerKey = ownerKey;
    const stillCurrent = () => run === generation.current
      && (useAccount.getState().user?.id ?? "anonymous-local-preview") === selectedOwnerKey;
    setPrepared([]); setConfirmed(false); setReport(undefined);
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
        stagedItems.push({
          key: `source-${index + 1}-${file.name.slice(0, 90)}`,
          file, bankSources: banks.length,
          declaredReady: banks.reduce((sum, source) => sum + source.ready, 0),
          declaredReview: banks.reduce((sum, source) => sum + source.review, 0),
        });
      }
      if (!stillCurrent()) return;
      setStagedForOwner(selectedOwnerKey);
      setPrepared(stagedItems);
      setMessage(`${stagedItems.length} prepared packages staged on this device. Declared counts are not answer-trusted or cloud-verified until private source readback finishes.`);
    } catch (cause) {
      if (!stillCurrent()) return;
      setPrepared([]); setStagedForOwner(undefined);
      setError(cause instanceof Error ? cause.message : "The private package manifest could not be inspected.");
      setMessage("");
    } finally { if (stillCurrent()) setPhase("idle"); }
  }

  async function upload() {
    if (!accountId || phase !== "idle" || !staged.length || !confirmed) return;
    setPhase("uploading"); setError(""); setOutcomes([]); setReport(undefined);
    const abort = new AbortController();
    controller.current = abort;
    const account = accountId;
    const run = generation.current;
    const stillCurrent = () => run === generation.current && useAccount.getState().user?.id === account;
    try {
      const jobs: AcademicBatchJob[] = staged.map(({ key, file }) => ({
        key, prepare: async (signal) => {
          if (signal?.aborted) throw new DOMException("Private upload cancelled", "AbortError");
          const reader = await zipLibraryReader(file);
          if (signal?.aborted) throw new DOMException("Private upload cancelled", "AbortError");
          return prepareAcademicUpload(reader);
        },
      }));
      const outcome = await uploadAcademicBatch(jobs, {
        signal: abort.signal,
        progress: (progress) => { if (stillCurrent()) setMessage(progress); },
        onOutcome: (row) => { if (stillCurrent()) setOutcomes((previous) => [...previous, row]); },
      });
      // Never display one owner's result under a newly signed-in account.
      // The backend already rechecks actual authentication per source.
      if (!stillCurrent()) return;
      setReport(outcome);
      setMessage(`${outcome.verified} collections independently re-read in your private cloud account · ${outcome.verifiedReadyQuestions} verified ready questions · ${outcome.reviewRequired} review-held · ${outcome.verifiedFigures} verified figure references. ${outcome.failed + outcome.authBlocked + outcome.cancelled} interrupted or failed; retry without discarding the original packages.`);
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
      if (!ledger.sources.length) throw new Error("No owner-authenticated source receipt was available.");
      const blob = new Blob([JSON.stringify({ format: "axom-owner-private-verified-sources-v1", ...ledger }, null, 2)], { type: "application/json" });
      url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "axom-private-source-receipts.json";
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
      <p className="sub">Select 1–100 prepared AXOM ZIP packages. Their manifests are checked locally before any upload. The academic batch engine saves one private source at a time, verifies question/figure bytes through your signed-in account and holds unresolved answers for review. This does not publish protected school material.</p>
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
        <ul>{staged.slice(0, 12).map((item) => <li key={item.key}>
          <b>{item.file.name}</b><small>{item.bankSources} source banks · {item.declaredReady} declared ready · {item.declaredReview} declared review</small>
        </li>)}</ul>
        {staged.length > 12 && <p className="sub">{staged.length - 12} additional prepared files staged.</p>}
        {accountId ? <>
          <label className="tracker-private-batch-consent">
            <input type="checkbox" checked={confirmed} disabled={phase !== "idle"} onChange={(event) => setConfirmed(event.target.checked)} />
            <span>I reviewed these packages and confirm I have permission to store their contents in my private academic account. I understand this does not grant public sharing rights.</span>
          </label>
          <GButton size="sm" disabled={phase !== "idle" || !confirmed}
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
        <small>{report.verifiedReadyQuestions} ready questions with original/figure checks · {report.reviewRequired} review-held questions · {report.verifiedFigures} figure references checked</small>
        <GButton size="tiny" disabled={!report.verified} onClick={exportVerifiedLedger}>Export verified private source receipts</GButton>
      </div>}
      {message && <p role="status" className="sub">{message}</p>}
      {error && <p role="alert" className="sub">{error}</p>}
      <p className="sub">A local ZIP selection, an upload request, or a service-role management count is not proof of durable cloud availability. Only the account-authenticated source/figure readback reported above certifies a private collection. New-device login verification remains a separate integration gate.</p>
    </details>
  </GlassCard>;
}
