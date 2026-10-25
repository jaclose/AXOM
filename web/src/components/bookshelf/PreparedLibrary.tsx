import { useEffect, useMemo, useRef, useState } from "react";
import { LibraryBig, Upload, ShieldCheck } from "lucide-react";
import { useStore } from "../../lib/store";
import { bankFiles, folderLibraryReader, installPrivateLibrary, readCatalog, readPreparedBank, zipLibraryReader, type LibraryReader } from "../../lib/privateLibrary/install";
import { PRIVATE_LIBRARY_DOCUMENT, PRIVATE_REVIEW_DOCUMENT, type PreparedBank, type PrivateLibraryCatalog } from "../../lib/privateLibrary/types";
import { BankImportReview } from "../questions/BankImportReview";
import { GButton } from "../ui/primitives";
import { Modal } from "../ui/Modal";
import {
  assertVaultWrite,
  assertVaultWritesSince,
  flushLocalVaultWrites,
  getVaultWriteCheckpoint,
} from "../../lib/localVault";
import { hasStoredSourceOriginal, readSourceOriginal } from "../../lib/decode/sources";
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
  catalogDocumentId?: string,
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
      const sourceChecksum = reviewDocumentId.startsWith("private-review-")
        ? reviewDocumentId.slice("private-review-".length)
        : undefined;
      const catalogDocuments = state.documents.filter(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT);
      const catalogDocument = catalogDocumentId
        ? catalogDocuments.find(document => document.id === catalogDocumentId)
        : catalogDocuments.find(document => {
          try {
            const candidate = readCatalog(JSON.parse(document.rawText));
            return candidate.sources.some(source => source.checksum === sourceChecksum);
          } catch {
            return false;
          }
        });
      if (catalogDocumentId && !catalogDocument) {
        throw new Error("The prepared library catalog for this source is no longer available.");
      }
      const updates = new Map<string, SourceDocument>();
      updates.set(reviewDocument.id, {
        ...reviewDocument,
        rawText: JSON.stringify({ ...bank, pkg }),
      });
      if (catalogDocument) {
        const liveCatalog = readCatalog(JSON.parse(catalogDocument.rawText));
        if (!liveCatalog.sources.some(source => source.checksum === sourceChecksum)) {
          throw new Error("The prepared library catalog no longer contains this source.");
        }
        updates.set(catalogDocument.id, {
          ...catalogDocument,
          rawText: JSON.stringify({
            ...liveCatalog,
            sources: liveCatalog.sources.map(source => {
              if (source.checksum !== sourceChecksum) return source;
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

const STORAGE_FULL_MESSAGE = "Browser storage on this device is full.";

function preparedLibraryError(cause: unknown, fallback: string, progress = ""): string {
  let current: unknown = cause;
  const seen = new Set<unknown>();
  for (let depth = 0; current !== undefined && current !== null && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    const record = typeof current === "object" ? current as { name?: unknown; message?: unknown; cause?: unknown } : undefined;
    const name = typeof record?.name === "string" ? record.name : "";
    const message = typeof record?.message === "string" ? record.message : typeof current === "string" ? current : "";
    if (name === "QuotaExceededError" || /quota.?exceeded|browser storage is full|device storage is full|disk is full/i.test(`${name} ${message}`)) {
      const checkpoint = progress.trim().replace(/[.…]+$/, "");
      return checkpoint
        ? `${STORAGE_FULL_MESSAGE} AXOM stopped while ${checkpoint.charAt(0).toLowerCase()}${checkpoint.slice(1)}. Content confirmed before this step remains saved; this step was not confirmed. Free disk space, then retry the same bundle.`
        : `${STORAGE_FULL_MESSAGE} No new content was confirmed. Free disk space, then retry the same bundle.`;
    }
    current = record?.cause;
  }
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause.trim()) return cause;
  return fallback;
}

interface ParsedCatalogDocument {
  documentId: string;
  catalog: PrivateLibraryCatalog;
}

interface InstalledPreparedSource {
  source: PrivateLibraryCatalog["sources"][number];
  catalogDocumentId: string;
}

type OriginalAvailability = "checking" | "stored" | "missing";

export function PreparedLibrary() {
  const documents = useStore(s => s.documents);
  const questions = useStore(s => s.questions);
  const catalogDocuments = useMemo(
    () => documents.filter(document => document.fileType === PRIVATE_LIBRARY_DOCUMENT),
    [documents],
  );
  const parsed = useMemo(() => {
    const catalogs: ParsedCatalogDocument[] = [];
    let failures = 0;
    for (const document of catalogDocuments) {
      try {
        catalogs.push({ documentId: document.id, catalog: readCatalog(JSON.parse(document.rawText)) });
      } catch {
        failures += 1;
      }
    }
    const error = failures === 0 ? ""
      : catalogs.length
        ? `${failures} installed library catalog${failures === 1 ? "" : "s"} could not be read. Other prepared collections remain available. Reinstall the affected bundle to repair it.`
        : "The library catalog could not be read. Your saved courses and questions are intact. Reinstall the private bundle to repair the catalog.";
    return { catalogs, error };
  }, [catalogDocuments]);
  const collection = useMemo(() => {
    const templates = new Set<string>();
    const sources = new Map<string, InstalledPreparedSource>();
    const versions = new Set<string>();
    for (const entry of parsed.catalogs) {
      versions.add(entry.catalog.version);
      for (const template of entry.catalog.templates) templates.add(template.checksum);
      // Documents are newest-first. A bank-bearing entry must own its review
      // action even when a newer reference-only catalog repeats the checksum.
      // Preserve an original-file hint from either entry for local source view.
      for (const source of entry.catalog.sources) {
        const candidate = { source, catalogDocumentId: entry.documentId };
        const current = sources.get(source.checksum);
        if (!current) {
          sources.set(source.checksum, candidate);
          continue;
        }
        const owner = current.source.bankFile || !candidate.source.bankFile ? current : candidate;
        const other = owner === current ? candidate : current;
        if (!owner.source.originalFile && other.source.originalFile) {
          sources.set(source.checksum, {
            ...owner,
            source: { ...owner.source, originalFile: other.source.originalFile },
          });
        } else {
          sources.set(source.checksum, owner);
        }
      }
    }
    return {
      templateCount: templates.size,
      sources: [...sources.values()],
      versions: [...versions],
    };
  }, [parsed.catalogs]);
  const hasCatalog = parsed.catalogs.length > 0;
  const reviews = documents.filter(d => d.fileType === PRIVATE_REVIEW_DOCUMENT);
  const originalDocumentsByChecksum = useMemo(() => {
    const originals = new Map<string, SourceDocument>();
    for (const document of documents) {
      const checksum = document.checksum?.replace(/^sha256:/, "");
      if (checksum && document.fileType !== PRIVATE_REVIEW_DOCUMENT && !originals.has(checksum)) {
        originals.set(checksum, document);
      }
    }
    return originals;
  }, [documents]);
  const exceedsCloudLimit = documents.reduce((bytes, document) => bytes + (document.rawText?.length ?? 0), 0) > MAX_SNAPSHOT_BYTES;
  const input = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<{ id: string; catalogDocumentId: string; bank: PreparedBank; files: File[]; originalFile?: Blob }>();
  const reviewRequest = useRef(0);
  const originalProbeCache = useRef(new Map<string, OriginalAvailability | Promise<OriginalAvailability>>());
  const [originalAvailability, setOriginalAvailability] = useState<Record<string, OriginalAvailability>>({});
  async function install(read: LibraryReader) {
    setBusy(true); setError("");
    let lastProgress = "";
    try {
      const result = await installPrivateLibrary(read, progress => {
        lastProgress = progress;
        setMessage(progress);
      });
      if (result.status === "partial") {
        setError(`${result.questionIds.length} answer-ready question${result.questionIds.length === 1 ? " remains" : "s remain"} saved on this device. ${result.warnings.slice(0, 3).join(" ")}`);
      }
    }
    catch (cause) { setError(preparedLibraryError(cause, "Library installation failed. Retry with the same bundle.", lastProgress)); }
    finally { setBusy(false); }
  }
  // A real, explicitly prepared local package initializes clean local profiles.
  useEffect(() => {
    if (!import.meta.env.DEV || !["localhost", "127.0.0.1"].includes(location.hostname) || catalogDocuments.length) return;
    let active = true;
    void localRead("catalog.json").then(() => { if (active) void install(localRead); }).catch(() => {});
    return () => { active = false; };
  }, [catalogDocuments.length]);
  async function review(entry: InstalledPreparedSource) {
    const request = ++reviewRequest.current;
    setError("");
    try {
      const id = `private-review-${entry.source.checksum}`;
      const doc = documents.find(d => d.id === id)!;
      const bank = readPreparedBank(JSON.parse(doc.rawText));
      const source = entry.source;
      const originalDocument = source.originalFile ? originalDocumentsByChecksum.get(source.checksum) : undefined;
      const files = await bankFiles(bank);
      const originalFile = originalDocument ? await readSourceOriginal(originalDocument.id, originalDocument.checksum) : undefined;
      if (request === reviewRequest.current) setOpened({ id, catalogDocumentId: entry.catalogDocumentId, bank, files, originalFile });
    } catch (cause) {
      if (request === reviewRequest.current) setError(cause instanceof Error ? cause.message : "Review could not open.");
    }
  }
  async function original(checksum: string, name: string) {
    setError("");
    try {
      const doc = originalDocumentsByChecksum.get(checksum);
      const blob = doc && await readSourceOriginal(doc.id, doc.checksum);
      if (!blob) throw new Error("The original is not on this device. Reinstall the prepared bundle to restore it.");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Source could not be opened."); }
  }
  const sources = useMemo(() => collection.sources.filter(({ source }) => (
    `${source.name} ${source.module ?? ""} ${source.status}`.toLowerCase().includes(query.toLowerCase())
  )), [collection.sources, query]);
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
  const checksums = new Set(collection.sources.map(entry => entry.source.checksum));
  const installedQuestions = [...sourceStats].reduce((total, [checksum, stats]) => total + (checksums.has(checksum) ? stats.ready : 0), 0);
  const heldQuestions = collection.sources.reduce((total, entry) => total + entry.source.review, 0);
  useEffect(() => {
    originalProbeCache.current.clear();
  }, [documents]);
  useEffect(() => {
    let active = true;
    const originals = sources.slice(0, 40).map(entry => entry.source).filter(source => source.originalFile);
    if (!originals.length) {
      setOriginalAvailability({});
      return () => { active = false; };
    }
    const probeTargets = originals.map(source => {
      const document = originalDocumentsByChecksum.get(source.checksum);
      const key = document ? `${document.id}:${document.checksum ?? source.checksum}` : `missing:${source.checksum}`;
      const cached = originalProbeCache.current.get(key);
      return { source, document, key, cached };
    });
    setOriginalAvailability(Object.fromEntries(probeTargets.map(({ source, document, cached }) => [
      source.checksum,
      !document ? "missing" : typeof cached === "string" ? cached : "checking",
    ])));
    void (async () => {
      // Presence checks read only pointers, manifests and declared chunk sizes.
      // Full byte hashing remains behind explicit Open and Review actions.
      for (const { source, document, key } of probeTargets) {
        if (!document) continue;
        let probe = originalProbeCache.current.get(key);
        if (!probe) {
          probe = hasStoredSourceOriginal(document.id, document.checksum)
            .then<OriginalAvailability>(stored => stored ? "stored" : "missing")
            .catch(() => "missing");
          originalProbeCache.current.set(key, probe);
        }
        const availability = typeof probe === "string" ? probe : await probe;
        if (!active) return;
        originalProbeCache.current.set(key, availability);
        setOriginalAvailability(current => ({ ...current, [source.checksum]: availability }));
      }
    })();
    return () => { active = false; };
  }, [originalDocumentsByChecksum, sources]);
  return <section className="prepared-library" aria-label="Prepared library">
    <div className="prepared-library-summary">
      <LibraryBig size={22} aria-hidden="true" />
      <div><strong>{hasCatalog ? "Your prepared library" : "Your academic collection"}</strong>
        <p>{hasCatalog ? `${collection.templateCount} templates · ${installedQuestions} locally answer-ready questions` : "Connect your prepared collection once. Courses stay available until you choose to load them."}</p></div>
      <GButton disabled={busy} onClick={() => input.current?.click()}><Upload size={16} />{hasCatalog ? "Update library" : "Install prepared library"}</GButton>
      <GButton disabled={busy} onClick={() => folderInput.current?.click()}>Install prepared folder</GButton>
      <input ref={folderInput} type="file" hidden multiple {...{ webkitdirectory: "" }} aria-label="Prepared library folder" onChange={event => {
        const files = Array.from(event.target.files ?? []);
        if (files.length) { try { void install(folderLibraryReader(files)); } catch (cause) { setError(preparedLibraryError(cause, "The prepared folder could not be opened.")); } }
        event.target.value = "";
      }} />
      <input ref={input} type="file" accept=".zip" hidden aria-label="Prepared library bundle" onChange={event => {
        const file = event.target.files?.[0];
        if (file) void zipLibraryReader(file).then(install).catch(cause => setError(preparedLibraryError(cause, "The prepared bundle could not be opened.")));
        event.target.value = "";
      }} />
    </div>
    {(busy || message) && <p role="status">{message}</p>}
    {error && <p role="alert">{error}</p>}
    {parsed.error && <p role="alert">{parsed.error}</p>}
    {hasCatalog && exceedsCloudLimit && <p>Saved on this device. This collection exceeds the current cloud sync limit. Keep a portable workspace backup.</p>}
    {hasCatalog && <details><summary><ShieldCheck size={15} /> Source coverage & review ({heldQuestions} held)</summary>
      <p className="sub">Only locally answer-ready questions enter scored practice. Review items and source gaps remain visible here. Supplementary generation is still outstanding.</p>
      <p className="sub">Keep your private bundle for transfer and restore. Workspace backups include question and review images; original document bytes are restored from the bundle.</p>
      <p className="sub">{parsed.catalogs.length === 1
        ? `Content version ${collection.versions[0]}`
        : `${parsed.catalogs.length} installed collections · Content versions ${collection.versions.join(", ")}`}</p>
      <input aria-label="Find a source" placeholder="Find a source, module or status" value={query} onChange={event => setQuery(event.target.value)} />
      <ul className="prepared-source-list">{sources.slice(0, 40).map(entry => {
        const source = entry.source;
        const local = sourceStats.get(source.checksum) ?? { stored: 0, ready: 0, review: 0 };
        const originalState = source.originalFile ? (originalAvailability[source.checksum] ?? "checking") : undefined;
        const originalLabel = originalState === "stored" ? "Original stored on this device; verified when opened"
          : originalState === "missing" ? "Original listed but missing on this device"
          : originalState === "checking" ? "Checking original storage"
          : /local-only|remains local/i.test(source.reason) ? "Original remains outside this AXOM collection"
          : "No original included in this package";
        return <li key={source.checksum}>
        <div><strong>{source.name}</strong><span>{source.module ?? "Unfiled"} · {local.ready} locally answer-ready · {local.review} stored for review · {source.review} held in source · {source.status === "prepared" ? "Prepared package" : source.status}</span><small>{source.reason} · {originalLabel}</small></div>
        {reviews.some(d => d.id === `private-review-${source.checksum}`) && <GButton onClick={() => void review(entry)}>Review source</GButton>}
        {source.originalFile && <GButton disabled={originalState !== "stored"} onClick={() => void original(source.checksum, source.name)}>Open original</GButton>}
      </li>; })}</ul>
      {sources.length === 0 && <p role="status">No prepared sources match this search.</p>}
      {sources.length > 40 && <p>{sources.length - 40} more sources. Narrow the search to find a specific collection.</p>}
    </details>}
    {opened && <Modal title="Source review" className="course-template-modal" onClose={() => setOpened(undefined)}>
      <BankImportReview bank={{ ...opened.bank, originalFile: opened.originalFile, sourceText: { ...opened.bank.sourceText, pageTexts: opened.bank.sourceText.pageTexts ?? [] }, files: opened.files, conversionIssues: opened.bank.issues, warnings: [], unplaced: [] }} onBack={() => setOpened(undefined)}
        onReviewed={(pkg, result) => persistPreparedLibraryReview(opened.id, opened.bank, pkg, result, opened.catalogDocumentId)} />
    </Modal>}
  </section>;
}
