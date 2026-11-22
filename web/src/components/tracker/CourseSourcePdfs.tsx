import { useId, useLayoutEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { useAccount } from "../../lib/account/accountStore";
import { academicAccountScope } from "../../lib/academicLibrary/accountScope";
import { downloadAcademicSourcePdf, listAcademicSourcePdfs, type AcademicSourcePdf } from "../../lib/academicLibrary/sourcePdfs";
import type { LibraryInstallScope } from "../../lib/privateLibrary/install";
import { ICON_SIZE } from "../../lib/iconSize";
import { GButton } from "../ui/primitives";

const fileSize = (bytes: number) => bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function CourseSourcePdfs({ revisionId }: { revisionId: string }) {
  const accountId = useAccount(account => account.user?.id);
  const headingId = useId();
  const [pdfs, setPdfs] = useState<AcademicSourcePdf[]>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [expanded, setExpanded] = useState(false);
  const current = useRef<LibraryInstallScope>();
  const listing = useRef<LibraryInstallScope>();
  const downloading = useRef<LibraryInstallScope>();
  useLayoutEffect(() => {
    setPdfs(undefined); setError(""); setMessage(""); setBusy(""); setExpanded(false);
    if (!accountId) return;
    const account = academicAccountScope(accountId);
    const scope: LibraryInstallScope = { key: account.key, assertCurrent: () => {
      account.assertCurrent();
      if (current.current !== scope) throw new Error("The course changed. Reopen its PDFs to continue.");
    } };
    current.current = scope;
    return () => { current.current = undefined; account.dispose(); };
  }, [accountId, revisionId]);

  async function loadPdfs() {
    const scope = current.current;
    if (!scope || listing.current === scope) return;
    listing.current = scope;
    setExpanded(true); setPdfs(undefined); setError(""); setMessage("");
    try {
      scope.assertCurrent();
      const files = await listAcademicSourcePdfs(revisionId, scope);
      scope.assertCurrent(); setPdfs(files);
    } catch (cause) {
      if (current.current === scope) setError(cause instanceof Error ? cause.message : "The original PDFs could not be loaded.");
    } finally {
      if (listing.current === scope) listing.current = undefined;
    }
  }

  async function download(pdf: AcademicSourcePdf) {
    const scope = current.current;
    if (!scope || downloading.current === scope || !pdf.available) return;
    downloading.current = scope;
    setBusy(pdf.id); setError(""); setMessage("");
    try {
      const blob = await downloadAcademicSourcePdf(pdf, scope);
      scope.assertCurrent();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = pdf.fileName; document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
      setMessage(`Download started for ${pdf.name}.`);
    } catch (cause) {
      if (current.current === scope) setError(cause instanceof Error ? cause.message : "This PDF could not be downloaded. Try again.");
    } finally {
      if (downloading.current === scope) downloading.current = undefined;
      if (current.current === scope) setBusy("");
    }
  }

  if (!accountId) return null;
  return <section className="course-source-pdfs" aria-labelledby={headingId}>
    <div className="course-section-heading"><h2 id={headingId}>Original PDFs</h2></div>
    <p className="course-source-pdfs-intro">Read or print the original documents alongside the questions.</p>
    {!expanded && <GButton type="button" onClick={() => void loadPdfs()}>Show original PDFs</GButton>}
    {expanded && pdfs === undefined && !error && <p role="status">Checking available PDFs…</p>}
    {pdfs?.length === 0 && <p>No original PDFs are available in this course revision.</p>}
    {!!pdfs?.length && <ul className="course-source-pdf-list">{pdfs.map(pdf => <li key={pdf.id}>
      <FileText size={ICON_SIZE.control} aria-hidden="true" />
      <div className="course-source-pdf-info"><strong>{pdf.name}</strong>
        <span>{pdf.available ? `PDF · ${fileSize(pdf.byteSize)}` : "Original PDF unavailable in this revision"}</span></div>
      {pdf.available && <GButton type="button" disabled={!!busy} aria-busy={busy === pdf.id} aria-label={`Download PDF: ${pdf.name}`} onClick={() => void download(pdf)}>
        <Download size={ICON_SIZE.emphasis} aria-hidden="true" />{busy === pdf.id ? "Downloading…" : "Download PDF"}
      </GButton>}
    </li>)}</ul>}
    {message && <p role="status">{message}</p>}
    {error && <div role="alert"><p>{error}</p>{pdfs === undefined && <GButton type="button" onClick={() => void loadPdfs()}>Retry PDFs</GButton>}</div>}
  </section>;
}
