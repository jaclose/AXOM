import { useRef, useState } from "react";
import { useAccount } from "../../lib/account/accountStore";
import { academicClient } from "../../lib/academicLibrary/client";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { prepareAcademicUpload, uploadAcademicCourse, type AcademicUpload } from "../../lib/academicLibrary/upload";
import { zipLibraryReader } from "../../lib/privateLibrary/install";
import { GButton } from "../ui/primitives";

export function AcademicCourseUpload({ onSaved }: { onSaved: () => void }) {
  const accountId = useAccount(state => state.user?.id);
  const input = useRef<HTMLInputElement>(null);
  const [prepared, setPrepared] = useState<{ accountId: string; upload: AcademicUpload }>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const upload = prepared && prepared.accountId === accountId ? prepared.upload : undefined;
  async function select(file: File) {
    if (!accountId) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError(""); setPrepared(undefined); setMessage("Checking the course package…");
    try {
      const upload = await prepareAcademicUpload(await zipLibraryReader(file)); scope.assertCurrent();
      setPrepared({ accountId, upload }); setMessage("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The course package could not be read."); }
    finally { scope.dispose(); setBusy(false); }
  }
  async function save() {
    if (!upload || !accountId) return;
    const scope = academicAccountScope(accountId);
    setBusy(true); setError("");
    try {
      await uploadAcademicCourse(await academicClient(accountId), accountId, upload, scope.assertCurrent, setMessage);
      setMessage("Private course saved. Open it from Available courses."); setPrepared(undefined); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The private course could not be saved. Retry when connected."); }
    finally { scope.dispose(); setBusy(false); }
  }
  if (!accountId) return null;
  return <section className="academic-upload" aria-label="Private academic upload">
    <h3>Add a prepared course to your account</h3>
    <p>Upload one reviewed course package with its weekly plan, questions and images. It stays private. Your study history and notes are not part of this upload.</p>
    <input ref={input} type="file" accept=".zip" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void select(file); }} />
    <GButton disabled={busy} onClick={() => input.current?.click()}>Choose course package</GButton>
    {upload && <div><p>{upload.metadata.module} · {upload.metadata.term} · {upload.metadata.ready_questions} prepared questions · {(upload.files.reduce((sum, file) => sum + file.byte_size, 0) / 1024 / 1024).toFixed(2)} MiB</p>
      <GButton disabled={busy} onClick={() => void save()}>{busy ? "Saving privately…" : "Save private course"}</GButton></div>}
    <p role="status">{message}</p>{error && <p role="alert">{error}</p>}
  </section>;
}
