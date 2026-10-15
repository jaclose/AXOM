import { useRef, useState } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { academicClient } from "../../lib/academicLibrary/client";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import {
  prepareAcademicUpload, uploadAcademicCourse,
  type AcademicUpload, type AcademicUnscheduledScope,
} from "../../lib/academicLibrary/upload";
import { readCatalog, zipLibraryReader, type LibraryReader } from "../../lib/privateLibrary/install";
import { GButton } from "../ui/primitives";

const TERMS: AcademicUnscheduledScope["term"][] = ["Term 1", "Term 2", "Term 3", "Term 4", "Term 5"];
interface UnscheduledCandidate { accountId: string; reader: LibraryReader; filename: string }

/** Private academic uploads are never published by selecting this control. */
export function AcademicCourseUpload({ onSaved }: { onSaved: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const input = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ accountId: string; upload: AcademicUpload }>();
  const [unscheduled, setUnscheduled] = useState<UnscheduledCandidate>();
  const [chosenTerm, setChosenTerm] = useState<AcademicUnscheduledScope["term"] | "">("");
  const [module, setModule] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const upload = prepared && prepared.accountId === accountId ? prepared.upload : undefined;
  const candidate = unscheduled && unscheduled.accountId === accountId ? unscheduled : undefined;

  async function select(file: File) {
    if (!accountId) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError(""); setPrepared(undefined); setUnscheduled(undefined);
    setChosenTerm(""); setModule(""); setConfirmed(false);
    setMessage("Checking the private academic package…");
    try {
      const reader = await zipLibraryReader(file);
      scope.assertCurrent();
      const catalog = readCatalog(JSON.parse(new TextDecoder().decode(await reader("catalog.json"))));
      if (catalog.templates.length === 0) {
        if (!catalog.sources.some(source => source.bankFile)) {
          throw new Error("This package contains no reviewed course template or prepared questions.");
        }
        setUnscheduled({ accountId, reader, filename: file.name });
        setMessage("No verified weekly plan is included. Confirm the term and module from the original source. The questions will remain unscheduled.");
      } else {
        const upload = await prepareAcademicUpload(reader);
        scope.assertCurrent();
        setPrepared({ accountId, upload });
        setMessage("");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The academic package could not be read.");
      setMessage("");
    } finally { scope.dispose(); setBusy(false); }
  }

  async function prepareUnscheduled() {
    if (!candidate || !accountId || !chosenTerm || !module.trim() || !confirmed) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError(""); setMessage("Validating the unscheduled collection and original source evidence…");
    try {
      const upload = await prepareAcademicUpload(candidate.reader, {
        term: chosenTerm,
        module: module.trim(),
        evidence: "human-reviewed",
      });
      scope.assertCurrent();
      setPrepared({ accountId, upload }); setUnscheduled(undefined); setMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The classification could not be verified.");
      setMessage("");
    } finally { scope.dispose(); setBusy(false); }
  }

  async function save() {
    if (!upload || !accountId) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError("");
    try {
      const result = await uploadAcademicCourse(await academicClient(accountId), accountId, upload, scope.assertCurrent, setMessage);
      setMessage(result.status === "superseded"
        ? "Your private upload was verified, but a newer revision is already active. Open the latest collection from Available courses."
        : "Private academic collection saved and verified. Open it from Available courses.");
      setPrepared(undefined);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The private academic collection could not be saved. Retry when connected.");
    } finally { scope.dispose(); setBusy(false); }
  }

  if (!accountId) return null;
  return <section className="academic-upload" aria-label="Private academic upload">
    <h3>Add a prepared academic collection to your account</h3>
    <p>Upload a reviewed AXOM ZIP package with its questions and images. An official weekly plan is optional when you confirm its term and module. All content stays private; answers and figures are checked before saving.</p>
    <input ref={input} type="file" accept=".zip" hidden onChange={event => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) void select(file);
    }} />
    <GButton disabled={busy} onClick={() => input.current?.click()}>Choose prepared package</GButton>

    {candidate && <fieldset className="stack gap10" disabled={busy} aria-label="Confirm unscheduled course classification">
      <legend>Identify the original source — {candidate.filename}</legend>
      <p className="sub">This package has no verified week-by-week course plan. Use the source's actual academic context. AXOM will not invent a week or publish the material.</p>
      <label className="stack gap6">Academic term
        <select className="field" value={chosenTerm} onChange={event => setChosenTerm(event.target.value as AcademicUnscheduledScope["term"] | "")}>
          <option value="">Choose the verified term</option>
          {TERMS.map(term => <option key={term} value={term}>{term}</option>)}
        </select>
      </label>
      <label className="stack gap6">Course/module from the original material
        <input className="field" type="text" maxLength={80} autoComplete="off" value={module}
          onChange={event => setModule(event.target.value)} placeholder="e.g. GOER, NCRS, RHPS" />
      </label>
      <label className="row gap8">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        <span>I checked the source's term and module. Its academic week remains unassigned.</span>
      </label>
      <GButton disabled={!chosenTerm || !module.trim() || !confirmed} onClick={() => void prepareUnscheduled()}>Validate private collection</GButton>
    </fieldset>}

    {upload && <div>
      <p>{upload.metadata.module} · {upload.metadata.term} · {upload.metadata.ready_questions} ready questions
        {upload.metadata.review_questions ? ` · ${upload.metadata.review_questions} awaiting review` : ""}
        {upload.provenance.weekAssignment === "unassigned" ? " · Week unassigned" : ""}
        { ` · ${(upload.files.reduce((sum, file) => sum + file.byte_size, 0) / 1024 / 1024).toFixed(2)} MiB` }
      </p>
      <GButton disabled={busy} onClick={() => void save()}>{busy ? "Saving privately…" : "Save private collection"}</GButton>
    </div>}
    <p role="status">{message}</p>{error && <p role="alert">{error}</p>}
  </section>;
}
