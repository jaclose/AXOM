import { useLayoutEffect, useRef, useState } from "react";
import { Download } from "lucide-react";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { createStoredReviewArchive, createStoredSourceArchive } from "../../lib/academicLibrary/reviewExport";
import type { AcademicCourse } from "../../lib/academicLibrary/client";
import type { LibraryInstallScope } from "../../lib/privateLibrary/install";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton } from "../ui/primitives";

/** Mounted only inside the academic review controls. Export never approves or
 * installs content and cannot change the learner's workspace. */
export function AcademicReviewFiles({ course, accountId }: { course: AcademicCourse; accountId: string }) {
  const current = useRef<LibraryInstallScope>();
  const exporting = useRef<LibraryInstallScope>();
  const [busy, setBusy] = useState<"review" | "source">();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    setMessage(""); setError("");
    const account = academicAccountScope(accountId);
    const scope: LibraryInstallScope = { key: account.key, assertCurrent: () => {
      account.assertCurrent();
      if (current.current !== scope) throw new Error("The course changed. Reopen review files to continue.");
    } };
    current.current = scope;
    return () => { current.current = undefined; account.dispose(); };
  }, [accountId, course.id, course.current_revision_id]);
  async function download(kind: "review" | "source") {
    const scope = current.current;
    if (!scope || exporting.current) return;
    exporting.current = scope; setBusy(kind); setError(""); setMessage("");
    try {
      const create = kind === "source" ? createStoredSourceArchive : createStoredReviewArchive;
      const result = await create(course, scope, value => {
        scope.assertCurrent(); setMessage(value);
      });
      scope.assertCurrent();
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url; link.download = result.fileName; document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); }
      setMessage(kind === "source" ? `Download started for all ${result.includedFiles} stored course files. Your workspace is unchanged.`
        : `Download started for ${result.includedFiles} stored review files. Images and original PDFs remain separate.`);
    } catch (cause) {
      if (current.current === scope) { setMessage(""); setError(cause instanceof Error ? cause.message : "Review files could not be exported."); }
    } finally {
      if (exporting.current === scope) {
        exporting.current = undefined;
        if (current.current) setBusy(undefined);
      }
    }
  }
  return <div className="course-review-files">
    <GButton type="button" disabled={Boolean(busy)} aria-busy={busy === "review"} onClick={() => void download("review")}>
      <Download size={ICON_SIZE.control} aria-hidden="true" />{busy === "review" ? "Preparing review files…" : "Export stored review files"}
    </GButton>
    <p>Download the stored questions, explanations and file list for review. Images and original PDFs are separate. This does not install or approve the course.</p>
    <GButton type="button" disabled={Boolean(busy)} aria-busy={busy === "source"} onClick={() => void download("source")}>
      <Download size={ICON_SIZE.control} aria-hidden="true" />{busy === "source" ? "Preparing source package…" : "Download full source package"}
    </GButton>
    <p>Include every stored image, original file and course template. Large courses take longer to prepare. This does not change your workspace or approve the course.</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
