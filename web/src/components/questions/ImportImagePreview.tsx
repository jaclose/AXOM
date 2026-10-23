import { useEffect, useState } from "react";
import { Modal } from "../ui/Modal";
import "../../styles/import-images.css";

/** File identity is checked during render so reassignment never flashes the
 * preceding source image while the object URL effect catches up. */
export function ImportImagePreview({ file }: { file: File }) {
  const [preview, setPreview] = useState<{ file: File; url: string }>();
  const [failed, setFailed] = useState<File>();
  const [decoded, setDecoded] = useState<File>();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setOpen(false); setFailed(undefined); setDecoded(undefined);
    let url: string;
    try { url = URL.createObjectURL(file); }
    catch { setFailed(file); return; }
    setPreview({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file, retry]);
  const url = preview?.file === file ? preview.url : undefined;
  if (failed === file) return <div className="import-image-preview-error" role="status">
    Cannot preview this image. Its file is still retained.
    <button type="button" className="gbtn" onClick={() => setRetry(value => value + 1)}>Retry image preview</button>
  </div>;
  return <>
    <button type="button" className="import-image-preview" disabled={!url || decoded !== file}
      aria-label={`Preview ${file.name}`} onClick={() => setOpen(true)}>
      {url && <img src={url} alt={`Import image: ${file.name}`} onLoad={() => setDecoded(file)} onError={() => setFailed(file)} />}
      {decoded !== file && <span role="status">Loading image…</span>}
    </button>
    {open && url && <Modal title={file.name} onClose={() => setOpen(false)} className="import-image-dialog">
      <img src={url} alt={`Full-size import image: ${file.name}`} onError={() => { setFailed(file); setOpen(false); }} />
    </Modal>}
  </>;
}
