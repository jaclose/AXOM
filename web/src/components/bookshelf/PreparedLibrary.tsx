import { useEffect, useMemo, useRef, useState } from "react";
import { LibraryBig, Upload, ShieldCheck } from "lucide-react";
import { useStore } from "../../lib/store";
import { bankFiles, folderLibraryReader, installPrivateLibrary, readCatalog, readPreparedBank, zipLibraryReader, type LibraryReader } from "../../lib/privateLibrary/install";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank } from "../../lib/privateLibrary/types";
import { BankImportReview } from "../questions/BankImportReview";
import { GButton } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import {
  assertVaultWrite,
  assertVaultWritesSince,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
} from "../../lib/localVault";
import { readSourceOriginal } from "../../lib/decode/sources";
import { MAX_SNAPSHOT_BYTES } from "../../lib/sync/syncPolicy";
import { questionPracticeReadiness } from "../../lib/questionFilters";
import type { QuestionRecord } from "../../lib/questions";
import type { SourceDocument } from "../../lib/library";
import type { ImportPackage } from "../../lib/question-content/package";
import type { BankSave } from "../../lib/question-content/bankImport";

export function practiceReadyQuestionCount(questions: readonly QuestionRecord[], checksum: string): number {
  return questions.filter(question => (
    question.content?.provenance.sourceChecksum?.replace(/^sha256:/, "") === checksum
    && questionPracticeReadiness(question) === "ready"
  )).length;
}

export async function persistPreparedLibraryReview(
  reviewDocumentId: string,
  bank: PreparedBank,
  pkg: ImportPackage,
  result: BankSave,
): Promise<void> {
  const checkpoint = getVaultWriteCheckpoint();
  const beforeDocuments = useStore.getState().documents;
  const beforeById = new Map(beforeDocuments.map(document => [document.id, document]));
  let committedById = new Map<string, SourceDocument>();
  let committedDocuments: SourceDocument[] = [];
  let commitApplied = false;
  try {
    useStore.setState((state) => {
      const reviewDocument = state.documents.find(document => document.id === reviewDocumentId);
      if (!reviewDocument) throw new Error("The prepared review record is no longer available.");
      const catalogDocument = state.documents.find(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT);
      const updates = new Map<string, SourceDocument>();
      updates.set(reviewDocument.id, {
        ...reviewDocument,
        rawText: JSON.stringify({ ...bank, pkg }),
      });
      if (catalogDocument) {
        const liveCatalog = readCatalog(JSON.parse(catalogDocument.rawText));
        updates.set(catalogDocument.id, {
          ...catalogDocument,
          rawText: JSON.stringify({
            ...liveCatalog,
            sources: liveCatalog.sources.map(source => {
              if (`private-review-${source.checksum}` !== reviewDocumentId) return source;
              const ready = practiceReadyQuestionCount(state.questions, source.checksum);
              const incomplete = result.status === "partial";
              return {
                ...source,
                ready,
                review: result.held.length + (bank.unreadableQuestions ?? 0),
                status: ready && !incomplete ? "prepared" : "review-required",
                ...(incomplete ? {
                  reason: `${ready} answer-ready question${ready === 1 ? " remains" : "s remain"} saved on this device, but this source still needs attention: ${result.errors.slice(0, 3).join(" ")}`,
                } : {}),
              };
            }),
          }),
        });
      }
      committedById = updates;
      committedDocuments = state.documents.map(document => updates.get(document.id) ?? document);
      return { documents: committedDocuments };
    });
    commitApplied = true;
    await flushLocalVaultWrites();
    assertVaultWrite(checkpoint + 1);
    assertVaultWritesSince(checkpoint);
  } catch (cause) {
    const rollbackConflicts: string[] = [];
    let rollbackFailure = "";
    if (commitApplied && committedById.size) {
      const rollbackCheckpoint = getVaultWriteCheckpoint();
      try {
        useStore.setState((state) => {
          const restored = state.documents.map(document => {
            const committed = committedById.get(document.id);
            if (!committed) return document;
            if (JSON.stringify(document) !== JSON.stringify(committed)) {
              rollbackConflicts.push(document.id);
              return document;
            }
            return beforeById.get(document.id) ?? document;
          });
          const committedOrderUnchanged = state.documents.length === committedDocuments.length
            && state.documents.every((document, index) => document.id === committedDocuments[index]?.id);
          if (!committedOrderUnchanged) return { documents: restored };
          const restoredById = new Map(restored.map(document => [document.id, document]));
          return { documents: beforeDocuments.flatMap(document => {
            const current = restoredById.get(document.id);
            return current ? [current] : [];
          }) };
        });
        await flushLocalVaultWrites();
        assertVaultWrite(rollbackCheckpoint + 1);
        assertVaultWritesSince(rollbackCheckpoint);
      } catch (rollbackCause) {
        rollbackFailure = rollbackCause instanceof Error ? rollbackCause.message : "The prior review metadata could not be restored.";
      }
    }
    const saved = new Set([
      ...result.sections.flatMap(section => section.savedIds),
      ...result.incompleteSections.flatMap(section => section.savedIds),
    ]).size;
    const detail = cause instanceof Error ? cause.message : "The local vault write failed.";
    const rollbackDetail = rollbackFailure
      ? ` Prior review metadata could not be restored and must be treated as pending: ${rollbackFailure}`
      : rollbackConflicts.length
        ? ` Concurrent review metadata remains open and unconfirmed for ${rollbackConflicts.join(", ")}.`
        : " The prior review metadata was restored.";
    throw new Error(`${saved} imported question${saved === 1 ? " remains" : "s remain"} saved, but AXOM could not confirm the reviewed source and library catalog on this device. Keep this review open and retry. ${detail}${rollbackDetail}`, { cause });
  }
}

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
  const [originalAvailability, setOriginalAvailability] = useState<Record<string, "checking" | "available" | "missing">>({});
  async function install(read: LibraryReader) {
    setBusy(true); setError("");
    try {
      const result = await installPrivateLibrary(read, setMessage);
      if (result.status === "partial") {
        setError(`${result.questionIds.length} answer-ready question${result.questionIds.length === 1 ? " remains" : "s remain"} saved on this device. ${result.warnings.slice(0, 3).join(" ")}`);
      }
    }
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
  const sources = useMemo(() => catalog?.sources.filter(s => `${s.name} ${s.module ?? ""} ${s.status}`.toLowerCase().includes(query.toLowerCase())) ?? [], [catalog, query]);
  const sourceStats = useMemo(() => {
    const stats = new Map<string, { stored: number; ready: number; review: number }>();
    for (const question of questions) {
      const checksum = question.content?.provenance.sourceChecksum?.replace(/^sha256:/, "");
      if (!checksum) continue;
      const current = stats.get(checksum) ?? { stored: 0, ready: 0, review: 0 };
      current.stored += 1;
      if (questionPracticeReadiness(question) === "ready") current.ready += 1;
      else current.review += 1;
      stats.set(checksum, current);
    }
    return stats;
  }, [questions]);
  const checksums = new Set(catalog?.sources.map(s => s.checksum));
  const installedQuestions = [...sourceStats].reduce((total, [checksum, stats]) => total + (checksums.has(checksum) ? stats.ready : 0), 0);
  useEffect(() => {
    let active = true;
    const originals = sources.slice(0, 40).filter(source => source.originalFile);
    if (!originals.length) {
      setOriginalAvailability({});
      return () => { active = false; };
    }
    setOriginalAvailability(Object.fromEntries(originals.map(source => [source.checksum, "checking" as const])));
    void (async () => {
      // Originals can be tens of MiB. Verify one at a time so opening the
      // library cannot materialize forty large blobs concurrently.
      for (const source of originals) {
        let availability: "available" | "missing" = "missing";
        try {
          const document = documents.find(candidate => candidate.checksum?.replace(/^sha256:/, "") === source.checksum
            && candidate.fileType !== PRIVATE_REVIEW_DOCUMENT);
          const original = document && await readSourceOriginal(document.id, document.checksum);
          availability = original ? "available" : "missing";
        } catch {
          availability = "missing";
        }
        if (!active) return;
        setOriginalAvailability(current => ({ ...current, [source.checksum]: availability }));
      }
    })();
    return () => { active = false; };
  }, [documents, sources]);
  return <section className="prepared-library" aria-label="Prepared library">
    <div className="prepared-library-summary">
      <LibraryBig size={22} aria-hidden="true" />
      <div><strong>{catalog ? "Your prepared library" : "Your academic collection"}</strong>
        <p>{catalog ? `${catalog.templates.length} templates · ${installedQuestions} locally answer-ready questions` : "Connect your prepared collection once. Courses stay available until you choose to load them."}</p></div>
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
      <p className="sub">Only locally answer-ready questions enter scored practice. Review items and source gaps remain visible here. Supplementary generation is still outstanding.</p>
      <p className="sub">Keep your private bundle for transfer and restore. Workspace backups include question and review images; original document bytes are restored from the bundle.</p>
      <p className="sub">Content version {catalog.version}</p>
      <input aria-label="Find a source" placeholder="Find a source, module or status" value={query} onChange={event => setQuery(event.target.value)} />
      <ul className="prepared-source-list">{sources.slice(0, 40).map(source => {
        const local = sourceStats.get(source.checksum) ?? { stored: 0, ready: 0, review: 0 };
        const originalState = source.originalFile ? (originalAvailability[source.checksum] ?? "checking") : undefined;
        const originalLabel = originalState === "available" ? "Original available on this device"
          : originalState === "missing" ? "Original listed but missing on this device"
          : originalState === "checking" ? "Checking original availability"
          : /local-only|remains local/i.test(source.reason) ? "Original remains outside this AXOM collection"
          : "No original included in this package";
        return <li key={source.sourcePath}>
        <div><strong>{source.name}</strong><span>{source.module ?? "Unfiled"} · {local.ready} locally answer-ready · {local.review} stored for review · {source.review} held in source · {source.status === "prepared" ? "Prepared package" : source.status}</span><small>{source.reason} · {originalLabel}</small></div>
        {reviews.some(d => d.id === `private-review-${source.checksum}`) && <GButton onClick={() => void review(`private-review-${source.checksum}`)}>Review source</GButton>}
        {source.originalFile && <GButton disabled={originalState !== "available"} onClick={() => void original(source.checksum, source.name)}>Open original</GButton>}
      </li>; })}</ul>
      {sources.length === 0 && <p role="status">No prepared sources match this search.</p>}
      {sources.length > 40 && <p>{sources.length - 40} more sources. Narrow the search to find a specific collection.</p>}
    </details>}
    {opened && <Modal title="Source review" className="course-template-modal" onClose={() => setOpened(undefined)}>
      <BankImportReview bank={{ ...opened.bank, sourceText: { ...opened.bank.sourceText, pageTexts: opened.bank.sourceText.pageTexts ?? [] }, files: opened.files, conversionIssues: opened.bank.issues, warnings: [], unplaced: [] }} onBack={() => setOpened(undefined)}
        onReviewed={(pkg, result) => persistPreparedLibraryReview(opened.id, opened.bank, pkg, result)} />
    </Modal>}
  </section>;
}
