import { useEffect, useMemo, useRef, useState } from "react";
import { LibraryBig, Upload, ShieldCheck } from "lucide-react";
import { useStore } from "../../lib/store";
import { bankFiles, folderLibraryReader, installPrivateLibrary, readCatalog, readPreparedBank, zipLibraryReader, type LibraryReader } from "../../lib/privateLibrary/install";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "../../lib/privateLibrary/types";
import { BankImportReview } from "../questions/BankImportReview";
import { GButton } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import { flushLocalVaultWrites } from "../../lib/localVault";
import { readSourceOriginal } from "../../lib/decode/sources";
import { MAX_SNAPSHOT_BYTES } from "../../lib/sync/syncPolicy";

const localRead: LibraryReader = async path => {
  const response = await fetch(`/__axom_private_library/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: { "X-AXOM-Library": "local" }, cache: "no-store" });
  if (!response.ok || response.status === 204) throw new Error("Prepared library is not available on this local server.");
  return new Uint8Array(await response.arrayBuffer());
};
export function PreparedLibrary() {
  const documents = useStore(s => s.documents);
  const questions = useStore(s => s.questions);
  const catalogDoc = documents.find(d => d.fileType === PRIVATE_LIBRARY_DOCUMENT);
  const parsed = useMemo(() => {
    try { return { catalog: catalogDoc ? readCatalog(JSON.parse(catalogDoc.rawText)) : undefined, error: "" }; }
    catch { return { catalog: undefined, error: "The library catalog could not be read. Your saved courses and questions are intact. Reinstall the private bundle to repair the catalog." }; }
  }, [catalogDoc]);
  const catalog = parsed.catalog;
  const reviews = documents.filter(d => d.fileType === PRIVATE_REVIEW_DOCUMENT);
  const exceedsCloudLimit = documents.reduce((bytes, document) => bytes + (document.rawText?.length ?? 0), 0) > MAX_SNAPSHOT_BYTES;
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<{ id: string; bank: PreparedBank; files: File[] }>();
  async function install(read: LibraryReader) {
    setBusy(true); setError("");
    try { await installPrivateLibrary(read, setMessage); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Library installation failed. Retry with the same bundle."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!import.meta.env.DEV || !["localhost", "127.0.0.1"].includes(location.hostname) || catalogDoc) return;
    let active = true;
    void localRead("catalog.json").then(() => { if (active) void install(localRead); }).catch(() => {});
    return () => { active = false; };
    // A real, explicitly prepared local package initializes clean local profiles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogDoc?.id]);
  async function review(id: string) {
    setError("");
    try {
      const doc = documents.find(d => d.id === id)!;
      const bank = readPreparedBank(JSON.parse(doc.rawText));
      setOpened({ id, bank, files: await bankFiles(bank) });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Review could not open."); }
  }
  async function original(checksum: string, name: string) {
    setError("");
    try {
      const doc = documents.find(d => d.checksum?.replace(/^sha256:/, "") === checksum);
      const blob = doc && await readSourceOriginal(doc.id, doc.checksum);
      if (!blob) throw new Error("The original is not on this device. Reinstall the prepared bundle to restore it.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Source could not be opened."); }
  }
  const sources = catalog?.sources.filter(s => `${s.name} ${s.module ?? ""} ${s.status}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  const checksums = new Set(catalog?.sources.map(s => s.checksum));
  const installedQuestions = questions.filter(q => checksums.has(q.content?.provenance.sourceChecksum?.replace(/^sha256:/, "") ?? "")).length;
  return <section className="prepared-library" aria-label="Prepared library">
    <div className="prepared-library-summary">
      <LibraryBig size={22} aria-hidden="true" />
      <div><strong>{catalog ? "Your prepared library" : "Your academic collection"}</strong>
        <p>{catalog ? `${catalog.templates.length} templates · ${installedQuestions} installed questions` : "Connect your prepared collection once. Courses stay available until you choose to load them."}</p></div>
      <GButton disabled={busy} onClick={() => input.current?.click()}><Upload size={16} />{catalog ? "Update library" : "Install prepared library"}</GButton>
      <GButton disabled={busy} onClick={() => folderInput.current?.click()}>Install prepared folder</GButton>
      <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} aria-label="Prepared library folder" onChange={event => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) { try { void install(folderLibraryReader(files)); } catch (cause) { setError(String(cause)); } }
        event.target.value = "";
      }} />
      <input ref={input} type="file" accept=".zip" hidden aria-label="Prepared library bundle" onChange={event => {
        const file = event.target.files?.[0]; if (file) void zipLibraryReader(file).then(install).catch(cause => setError(String(cause))); event.target.value = "";
      }} />
    </div>
    {(busy || message) && <p role="status">{message}</p>}
    {(error || parsed.error) && <p role="alert">{error || parsed.error}</p>}
    {catalog && exceedsCloudLimit && <p>Saved on this device. This collection exceeds the current cloud sync limit. Keep a portable workspace backup.</p>}
    {catalog && <details><summary><ShieldCheck size={15} /> Source coverage & review ({catalog.sources.reduce((n, s) => n + s.review, 0)} held)</summary>
      <p className="sub">Only stored, verified questions enter scored practice. Review items and source gaps remain visible here. Supplementary generation is still outstanding.</p>
      <p className="sub">Keep your private bundle for transfer and restore. Workspace backups include question and review images; original document bytes are restored from the bundle.</p>
      <p className="sub">Content version {catalog.version}</p>
      <input aria-label="Find a source" placeholder="Find a source, module or status" value={query} onChange={event => setQuery(event.target.value)} />
      <ul className="prepared-source-list">{sources.slice(0, 40).map(source => <li key={source.sourcePath}>
        <div><strong>{source.name}</strong><span>{source.module ?? "Unfiled"} · {source.ready} ready · {source.review} held · {source.status === "prepared" ? "Installed" : source.status}</span><small>{source.reason}</small></div>
        {reviews.some(d => d.id === `private-review-${source.checksum}`) && <GButton onClick={() => void review(`private-review-${source.checksum}`)}>Review source</GButton>}
        {source.originalFile && <GButton onClick={() => void original(source.checksum, source.name)}>Open original</GButton>}
      </li>)}</ul>
      {sources.length > 40 && <p>{sources.length - 40} more sources. Narrow the search to find a specific collection.</p>}
    </details>}
    {opened && <Modal title="Source review" className="course-template-modal" onClose={() => setOpened(undefined)}>
      <BankImportReview bank={{ ...opened.bank, sourceText: { ...opened.bank.sourceText, pageTexts: opened.bank.sourceText.pageTexts ?? [] }, files: opened.files, conversionIssues: opened.bank.issues, warnings: [], unplaced: [] }} onBack={() => setOpened(undefined)}
        onReviewed={async (pkg, result) => {
          const s = useStore.getState(); const doc = s.documents.find(d => d.id === opened.id)!;
          s.addDocument({ ...doc, rawText: JSON.stringify({ ...opened.bank, pkg }) });
          if (catalog && catalogDoc) s.addDocument({ ...catalogDoc, rawText: JSON.stringify({ ...catalog, sources: catalog.sources.map(source => {
            if (`private-review-${source.checksum}` !== opened.id) return source;
            const ready = s.questions.filter(q => q.content?.provenance.sourceChecksum?.replace(/^sha256:/, "") === source.checksum).length;
            return { ...source, ready, review: result.held.length + (opened.bank.unreadableQuestions ?? 0), status: ready ? "prepared" : "review-required" };
          }) }) });
          await flushLocalVaultWrites();
        }} />
    </Modal>}
  </section>;
}
