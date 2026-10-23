import { useEffect, useState } from "react";
import { readSourceOriginal } from "../../lib/decode/sources";
import type { SourceDocument } from "../../lib/library";
import { GButton } from "../ui/primitives";
import { ImportImagePreview } from "./ImportImagePreview";

/** Source files remain in the verified originals store, separate from notes. */
export function SourceOriginalPreview({ document }: { document: SourceDocument }) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFile(undefined); setError("");
    void readSourceOriginal(document.id, document.checksum).then(blob => {
      if (cancelled) return;
      if (!blob) throw new Error("The original is not available on this device. Restore its backup or select the exact source file.");
      setFile(new File([blob], document.fileName, { type: document.originalFile?.mimeType ?? blob.type }));
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : "The original could not be read."); });
    return () => { cancelled = true; };
  }, [document.id, document.checksum, document.fileName, document.originalFile?.mimeType, retry]);
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const anchor = window.document.createElement("a");
    anchor.href = url; anchor.download = file.name; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section aria-label="Preserved original" className="stack gap10">
    {file?.type.startsWith("image/") && <ImportImagePreview file={file} />}
    {file && <GButton onClick={download}>Download original</GButton>}
    {!file && !error && <p role="status">Reading the preserved original…</p>}
    {error && <div role="alert"><p>{error}</p><GButton onClick={() => setRetry(value => value + 1)}>Retry original</GButton></div>}
  </section>;
}
